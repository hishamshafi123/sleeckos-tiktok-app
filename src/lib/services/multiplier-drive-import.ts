import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { pipeline } from "stream/promises";
import {
  parseDriveFolderId,
  getFolderMeta,
  listVideoFilesInFolder,
  getDriveClient,
} from "@/lib/google";
import {
  createBulkBatch,
  appendToBulkBatch,
  finalizeBulkBatch,
  clampBulkHookCount,
} from "@/lib/services/multiplier";

// ─── Drive → Bulk Intake import ──────────────────────────────────────────────
// Operators paste a Drive folder URL, preview its videos, then approve a
// selection. Downloads run IN-PROCESS in the background (pollable progress,
// same pattern as startPausedFilesDeletion in campaign-priority.ts) and each
// downloaded file is appended to a standard bulk batch — processing only
// starts when the whole selection is staged and the batch is finalized.

export class DriveImportInvalidUrlError extends Error {}
export class DriveImportFolderNotFoundError extends Error {}

export interface DriveImportPreviewFile {
  id: string;
  name: string;
  size: number;
}

export interface DriveImportProgress {
  status: "running" | "done" | "failed";
  batchId: string;
  total: number;
  processed: number;
  downloaded: number;
  failed: number;
  failures: { name: string; error: string }[];
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

const importRuns = new Map<string, DriveImportProgress>();

export function getDriveImportProgress(batchId: string): DriveImportProgress | null {
  return importRuns.get(batchId) ?? null;
}

// Google Drive API errors carry the HTTP status in either of these spots.
function driveStatus(err: any): number | null {
  const s = err?.response?.status ?? err?.code;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Resolve a pasted folder URL to its videos (video/* mimeTypes only, sorted
 * by name). 400-class: unparseable URL. 404-class: folder missing or not
 * accessible to the service account.
 */
export async function previewDriveImport(folderUrl: string): Promise<{
  files: DriveImportPreviewFile[];
  folderName: string;
}> {
  const folderId = parseDriveFolderId(folderUrl || "");
  if (!folderId) {
    throw new DriveImportInvalidUrlError("Invalid Google Drive folder URL");
  }

  let meta;
  try {
    meta = await getFolderMeta(folderId, undefined, true);
  } catch (err: any) {
    const status = driveStatus(err);
    if (status === 403 || status === 404) {
      throw new DriveImportFolderNotFoundError("Folder not found or inaccessible");
    }
    throw err;
  }
  if (meta.mimeType && meta.mimeType !== "application/vnd.google-apps.folder") {
    throw new DriveImportFolderNotFoundError("URL points to a file, not a folder");
  }

  let rawFiles;
  try {
    rawFiles = await listVideoFilesInFolder(folderId, undefined, true);
  } catch (err: any) {
    const status = driveStatus(err);
    if (status === 403 || status === 404) {
      throw new DriveImportFolderNotFoundError("Folder not found or inaccessible");
    }
    throw err;
  }

  return {
    files: rawFiles
      .filter((f) => f.id && f.name)
      .map((f) => ({ id: f.id as string, name: f.name as string, size: Number(f.size ?? 0) })),
    folderName: meta.name ?? "",
  };
}

// Stream a Drive file to a temp file — never buffer whole videos in memory
// (the app container has 2GB RAM). Temp staging matches bulk-upload (os.tmpdir()).
async function downloadToTempFile(fileId: string, fileName: string): Promise<string> {
  const drive = await getDriveClient(undefined, true);
  const tempPath = path.join(
    os.tmpdir(),
    `driveimport_${Date.now()}_${crypto.randomBytes(6).toString("hex")}_${fileName}`
  );
  try {
    const res = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "stream" }
    );
    await pipeline(res.data as NodeJS.ReadableStream, fs.createWriteStream(tempPath));
    return tempPath;
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch {}
    throw err;
  }
}

const DOWNLOAD_CONCURRENCY = 2; // VPS is CPU/RAM constrained

async function runDriveImport(
  jobId: string,
  files: { id: string; name: string }[],
  progress: DriveImportProgress,
  opts: { hooksEnabled: boolean; hookCount: number }
) {
  try {
    let cursor = 0;
    const workers = Array.from({ length: DOWNLOAD_CONCURRENCY }, async () => {
      while (cursor < files.length) {
        const file = files[cursor++];
        try {
          const tempPath = await downloadToTempFile(file.id, file.name);
          // appendToBulkBatch moves the temp file into public/uploads/ and
          // deletes it — on both success and per-file failure.
          const groupIds = await appendToBulkBatch(
            jobId,
            [{ tempPath, fileName: file.name }],
            opts
          );
          if (groupIds.length === 0) {
            progress.failed++;
            progress.failures.push({ name: file.name, error: "Failed to add file to batch" });
          } else {
            progress.downloaded++;
          }
        } catch (err: any) {
          progress.failed++;
          progress.failures.push({ name: file.name, error: err?.message || String(err) });
          console.warn(`[Multiplier Drive Import] Failed to import ${file.name} (${file.id}):`, err?.message || err);
        }
        progress.processed++;
      }
    });
    await Promise.all(workers);
    progress.status = "done";
  } catch (err: any) {
    progress.status = "failed";
    progress.error = err?.message || String(err);
    console.error(`[Multiplier Drive Import] Import failed for batch ${jobId}:`, err);
  } finally {
    // Kick off transcribe/hooks for whatever landed (idempotent once the job
    // leaves RECEIVING), even on partial failure, so staged files aren't stranded.
    try {
      await finalizeBulkBatch(jobId);
    } catch (err) {
      console.error(`[Multiplier Drive Import] Failed to finalize batch ${jobId}:`, err);
    }
    progress.finishedAt = new Date().toISOString();
  }
}

/**
 * Create a new bulk batch (RECEIVING), register progress, and fire the
 * background download runner. Always creates a new batch — the in-memory map
 * is keyed by the fresh batchId, so concurrent imports never collide.
 */
export async function startDriveImport(input: {
  files: { id: string; name: string }[];
  campaignId: string | null;
  styleIds: string[];
  namePrefix: string;
  hooksEnabled: boolean;
  hookCount: number;
  createdBy?: string | null;
}): Promise<DriveImportProgress> {
  // Guard against duplicate file ids within one request.
  const seen = new Set<string>();
  const files = input.files.filter((f) => {
    if (!f || typeof f.id !== "string" || !f.id || seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });
  if (files.length === 0) {
    throw new DriveImportInvalidUrlError("No files selected");
  }

  const hookCount = clampBulkHookCount(input.hookCount);
  const created = await createBulkBatch({
    files: [],
    campaignId: input.campaignId,
    styleIds: input.styleIds,
    namePrefix: input.namePrefix,
    hooksEnabled: input.hooksEnabled,
    hookCount,
    createdBy: input.createdBy ?? null,
  });

  const progress: DriveImportProgress = {
    status: "running",
    batchId: created.jobId,
    total: files.length,
    processed: 0,
    downloaded: 0,
    failed: 0,
    failures: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };
  importRuns.set(created.jobId, progress);
  void runDriveImport(created.jobId, files, progress, {
    hooksEnabled: input.hooksEnabled,
    hookCount,
  });
  return progress;
}
