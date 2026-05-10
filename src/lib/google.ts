import { google } from "googleapis";

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

// ── Build authenticated Drive client using a Service Account ─────────────────
function getDriveClient() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!b64) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON env var not set");

  const json = JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
  const auth = new google.auth.GoogleAuth({
    credentials: json,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

// ── List video files in a Drive folder (sorted by name ascending) ─────────────
export async function listVideoFilesInFolder(folderId: string) {
  const drive = getDriveClient();
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
export async function getFolderMeta(folderId: string) {
  const drive = getDriveClient();
  const res = await drive.files.get({
    fileId: folderId,
    fields: "id,name,mimeType",
    supportsAllDrives: true,
  });
  return res.data;
}

// ── Download a Drive file as a Buffer ────────────────────────────────────────
export async function downloadDriveFile(fileId: string): Promise<Buffer> {
  const drive = getDriveClient();
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(res.data as ArrayBuffer);
}

// ── Delete/trash a file from Drive (after successful post) ───────────────────
export async function deleteDriveFile(fileId: string): Promise<void> {
  const drive = getDriveClient();

  // Try permanent delete
  try {
    await drive.files.delete({ fileId, supportsAllDrives: true });
    console.log(`[Drive] Permanently deleted file ${fileId}`);
    return;
  } catch (delErr) {
    console.log(`[Drive] delete() failed for ${fileId}, trying trash...`, delErr instanceof Error ? delErr.message : String(delErr));
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
  } catch (trashErr) {
    console.error(`[Drive] trash() also failed for ${fileId}:`, trashErr instanceof Error ? trashErr.message : String(trashErr));
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
  } catch (removeErr) {
    console.error(`[Drive] removeParents also failed for ${fileId}:`, removeErr instanceof Error ? removeErr.message : String(removeErr));
    throw removeErr;
  }
}

// ── Make a file temporarily public (anyone with link can view) ────────────────
export async function makeFilePublic(fileId: string): Promise<void> {
  const drive = getDriveClient();
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
export async function revokeFilePublic(fileId: string): Promise<void> {
  const drive = getDriveClient();
  try {
    await drive.permissions.delete({ fileId, permissionId: "anyoneWithLink", supportsAllDrives: true });
  } catch {
    // Permission may already be removed or not exist
  }
}
