import { google } from "googleapis";
import prisma from "./db";

// ── Helper: extract folder ID from a Drive URL or raw ID ─────────────────────
export function parseDriveFolderId(urlOrId: string): string | null {
  const raw = urlOrId.trim();
  // Already a bare ID (no slashes/dots)
  if (/^[\w-]{25,}$/.test(raw)) return raw;

  // e.g. https://drive.google.com/drive/folders/FOLDER_ID
  const folderMatch = raw.match(/\/folders\/([^/?&#]+)/);
  if (folderMatch) return folderMatch[1];

  // e.g. https://drive.google.com/drive/u/0/folders/FOLDER_ID
  const uMatch = raw.match(/folders\/([^/?&#]+)/);
  if (uMatch) return uMatch[1];

  return null;
}

// ── Build authenticated OAuth2 client for an account ─────────────────────────
export async function getOAuth2ClientForAccount(account: any) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.APP_URL}/api/managed/accounts/auth/google/callback`
  );

  oauth2Client.setCredentials({
    access_token: account.googleAccessToken || undefined,
    refresh_token: account.googleRefreshToken || undefined,
  });

  // Check if token is expired or close to expiry (expires in < 5 minutes)
  const now = new Date();
  const isExpired = !account.googleTokenExpiresAt || 
    new Date(account.googleTokenExpiresAt).getTime() - now.getTime() < 5 * 60 * 1000;

  if (isExpired && account.googleRefreshToken) {
    console.log(`[Google OAuth] Token expired or expiring soon for @${account.tiktokUsername}. Refreshing...`);
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      
      // Update database with refreshed credentials
      await prisma.managedAccount.update({
        where: { id: account.id },
        data: {
          googleAccessToken: credentials.access_token || undefined,
          googleTokenExpiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : undefined,
          ...(credentials.refresh_token ? { googleRefreshToken: credentials.refresh_token } : {}),
        },
      });
      console.log(`[Google OAuth] Token successfully refreshed and saved for @${account.tiktokUsername}`);
      
      // Re-set refreshed credentials on client
      oauth2Client.setCredentials({
        access_token: credentials.access_token || undefined,
        refresh_token: credentials.refresh_token || account.googleRefreshToken,
      });
    } catch (refreshErr) {
      console.error(`[Google OAuth] Failed to refresh token for @${account.tiktokUsername}:`, refreshErr);
    }
  }

  return oauth2Client;
}

// ── Build authenticated Drive client (OAuth or fallback to Service Account) ───
// Per-account OAuth first, then master OAuth, then (optionally) service account.
export async function getDriveClient(accountId?: string, useServiceAccount = false) {
  // If accountId has its own OAuth, we should ALWAYS prefer it!
  if (accountId) {
    const account = await prisma.managedAccount.findUnique({
      where: { id: accountId },
    });
    if (account && account.googleAccessToken && account.googleRefreshToken) {
      const auth = await getOAuth2ClientForAccount(account);
      return google.drive({ version: "v3", auth });
    }
  }

  if (useServiceAccount) {
    return getServiceAccountDriveClient();
  }

  // Master/Global OAuth Fallback: Look for ANY account that has connected via OAuth
  const masterAccount = await prisma.managedAccount.findFirst({
    where: {
      googleRefreshToken: { not: null },
    },
  });
  if (masterAccount) {
    console.log(`[Google OAuth] Falling back to master OAuth credentials from @${masterAccount.tiktokUsername}`);
    const auth = await getOAuth2ClientForAccount(masterAccount);
    return google.drive({ version: "v3", auth });
  }

  return getServiceAccountDriveClient();
}

async function getServiceAccountDriveClient() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!b64) {
    throw new Error("Google Drive credentials not set (Service Account GOOGLE_SERVICE_ACCOUNT_JSON not set)");
  }

  const json = JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
  const auth = new google.auth.GoogleAuth({
    credentials: json,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

// ── List video files in a Drive folder (sorted by name ascending) ─────────────
export async function listVideoFilesInFolder(folderId: string, accountId?: string, useServiceAccount = true) {
  const drive = await getDriveClient(accountId, useServiceAccount);
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType contains 'video/' and trashed = false`,
    orderBy: "name",
    fields: "files(id,name,size,mimeType,createdTime)",
    pageSize: 100,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files ?? [];
}

// ── Get folder metadata (name, existence check) ───────────────────────────────
export async function getFolderMeta(folderId: string, accountId?: string, useServiceAccount = true) {
  const drive = await getDriveClient(accountId, useServiceAccount);
  const res = await drive.files.get({
    fileId: folderId,
    fields: "id,name,mimeType,owners(emailAddress)",
    supportsAllDrives: true,
  });
  return res.data;
}

// ── Download a Drive file as a Buffer ────────────────────────────────────────
export async function downloadDriveFile(fileId: string, accountId?: string, useServiceAccount = true): Promise<Buffer> {
  const drive = await getDriveClient(accountId, useServiceAccount);
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(res.data as ArrayBuffer);
}

// ── Delete/trash a file from Drive (after successful post) ───────────────────
// NOTE: useServiceAccount defaults to FALSE because the Service Account often
// lacks delete permissions on files in the user's personal Drive.
export async function deleteDriveFile(fileId: string, accountId?: string, useServiceAccount = false): Promise<void> {
  const drive = await getDriveClient(accountId, useServiceAccount);

  // Try permanent delete
  try {
    await drive.files.delete({ fileId, supportsAllDrives: true });
    console.log(`[Drive] Permanently deleted file ${fileId} (account=${accountId || 'default'})`);
    return;
  } catch (delErr: any) {
    const status = delErr?.response?.status || delErr?.code;
    const msg = delErr?.response?.data?.error?.message || delErr?.message || String(delErr);
    console.warn(`[Drive] delete() failed for ${fileId} (status=${status}): ${msg}`);

    // If Service Account was used and it got a 403/404, retry with OAuth
    if (useServiceAccount && accountId && (status === 403 || status === 404)) {
      console.log(`[Drive] Retrying delete with OAuth credentials for account ${accountId}`);
      try {
        const oauthDrive = await getDriveClient(accountId, false);
        await oauthDrive.files.delete({ fileId, supportsAllDrives: true });
        console.log(`[Drive] Permanently deleted file ${fileId} via OAuth fallback`);
        return;
      } catch (oauthErr: any) {
        console.warn(`[Drive] OAuth delete also failed: ${oauthErr?.message || oauthErr}`);
      }
    }
  }

  // Fallback: move to trash
  try {
    await drive.files.update({
      fileId,
      requestBody: { trashed: true },
      supportsAllDrives: true,
    });
    console.log(`[Drive] Trashed file ${fileId}`);
    return;
  } catch (trashErr: any) {
    const msg = trashErr?.response?.data?.error?.message || trashErr?.message || String(trashErr);
    console.warn(`[Drive] trash() failed for ${fileId}: ${msg}`);
  }

  // Last resort: remove file from folder (unparent it so it disappears from listing)
  try {
    const file = await drive.files.get({ fileId, fields: "parents", supportsAllDrives: true });
    const parents = file.data.parents;
    if (parents && parents.length > 0) {
      await drive.files.update({
        fileId,
        removeParents: parents.join(","),
        supportsAllDrives: true,
      });
      console.log(`[Drive] Removed file ${fileId} from parent folder(s)`);
      return;
    }
  } catch (removeErr: any) {
    const msg = removeErr?.response?.data?.error?.message || removeErr?.message || String(removeErr);
    console.error(`[Drive] All delete methods failed for ${fileId}: ${msg}`);
    throw removeErr;
  }
}

// ── Make a file temporarily public (anyone with link can view) ────────────────
export async function makeFilePublic(fileId: string, accountId?: string, useServiceAccount = true): Promise<void> {
  const drive = await getDriveClient(accountId, useServiceAccount);
  await drive.permissions.create({
    fileId,
    supportsAllDrives: true,
    requestBody: {
      role: "reader",
      type: "anyone",
    },
  });
  console.log(`[Drive] Made file ${fileId} public`);
}

// ── Revoke public access from a file ─────────────────────────────────────────
export async function revokeFilePublic(fileId: string, accountId?: string, useServiceAccount = true): Promise<void> {
  const drive = await getDriveClient(accountId, useServiceAccount);
  try {
    await drive.permissions.delete({ fileId, permissionId: "anyoneWithLink", supportsAllDrives: true });
  } catch {
    // Permission may already be removed or not exist
  }
}

// ── Upload a Buffer to a Google Drive folder ─────────────────────────────────
export async function uploadFileToFolder(
  folderId: string,
  fileName: string,
  fileBuffer: Buffer,
  mimeType: string = "video/mp4",
  accountId?: string,
  useServiceAccount = false
): Promise<string> {
  const { Readable } = await import("stream");
  const drive = await getDriveClient(accountId, useServiceAccount);
  
  const readableStream = new Readable();
  readableStream.push(fileBuffer);
  readableStream.push(null);

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: readableStream,
    },
    fields: "id",
    supportsAllDrives: true,
  });

  if (!response.data.id) {
    throw new Error("Failed to upload file to Google Drive: no ID returned");
  }

  return response.data.id;
}
