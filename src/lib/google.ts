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
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
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
  });
  return res.data.files ?? [];
}

// ── Get folder metadata (name, existence check) ───────────────────────────────
export async function getFolderMeta(folderId: string) {
  const drive = getDriveClient();
  const res = await drive.files.get({
    fileId: folderId,
    fields: "id,name,mimeType",
  });
  return res.data;
}

// ── Download a Drive file as a Buffer ────────────────────────────────────────
export async function downloadDriveFile(fileId: string): Promise<Buffer> {
  const drive = getDriveClient();
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(res.data as ArrayBuffer);
}
