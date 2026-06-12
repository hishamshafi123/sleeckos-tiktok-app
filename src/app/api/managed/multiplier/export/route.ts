export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import fs from "fs";
import path from "path";
import { getMultiplierDriveClient } from "../google/drive-helper";

// Global export queue — serialize exports to prevent rate limiting
let exportQueue: string[] = [];
let isProcessingQueue = false;

async function processExportQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (exportQueue.length > 0) {
    const batchId = exportQueue.shift()!;
    try {
      await exportToDriveInBackground(batchId);
    } catch (err: any) {
      console.error(`[Export Queue] Failed batch ${batchId}:`, err?.message || err);
    }
  }

  isProcessingQueue = false;
}

// POST /api/managed/multiplier/export — Upload rendered videos to assigned Drive folder
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { batchId } = await req.json();

    if (!batchId) {
      return NextResponse.json({ error: "Missing batchId" }, { status: 400 });
    }

    const batch = await prisma.multiplierBatch.findUnique({
      where: { id: batchId },
      include: {
        items: {
          where: { status: "RENDERED" },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    // Check that at least batch folder or some item folders exist
    const hasAnyFolder = batch.driveFolderId || batch.items.some((i: any) => i.driveFolderId);
    if (!hasAnyFolder) {
      return NextResponse.json({ error: "No Drive folder assigned. Select a folder for items or the batch first." }, { status: 400 });
    }

    if (batch.items.length === 0) {
      return NextResponse.json({ error: "No rendered videos to export" }, { status: 400 });
    }

    if (batch.driveExportStatus === "EXPORTING") {
      return NextResponse.json({ error: "Export already in progress" }, { status: 400 });
    }

    // Mark as exporting
    await prisma.multiplierBatch.update({
      where: { id: batchId },
      data: { driveExportStatus: "EXPORTING", errorMessage: null },
    });

    // Add to serialized queue instead of running concurrently
    exportQueue.push(batchId);
    processExportQueue().catch((err) => {
      console.error(`[Export Queue] Queue processing failed:`, err);
    });

    return NextResponse.json({ success: true, message: "Export queued" });
  } catch (err: any) {
    console.error("[Multiplier Export] Error:", err);
    return NextResponse.json({ error: err?.message || "Internal Server Error" }, { status: 500 });
  }
}

// GET /api/managed/multiplier/export?batchId=... — Check export status
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const batchId = searchParams.get("batchId");

  if (!batchId) {
    return NextResponse.json({ error: "Missing batchId" }, { status: 400 });
  }

  const batch = await prisma.multiplierBatch.findUnique({
    where: { id: batchId },
    select: { driveExportStatus: true, driveFolderId: true, driveFolderName: true, errorMessage: true },
  });

  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  return NextResponse.json({
    status: batch.driveExportStatus,
    folderId: batch.driveFolderId,
    folderName: batch.driveFolderName,
    error: batch.errorMessage,
  });
}

// PATCH /api/managed/multiplier/export — Reset stuck or failed export status
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { action } = await req.json();

    if (action === "reset-stuck") {
      const result = await prisma.multiplierBatch.updateMany({
        where: { driveExportStatus: "EXPORTING" },
        data: { driveExportStatus: null, errorMessage: null },
      });
      return NextResponse.json({ success: true, resetCount: result.count });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("[Multiplier Export] PATCH error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function uploadWithRetry(
  drive: any,
  filePath: string,
  fileName: string,
  folderId: string,
  maxRetries = 3
): Promise<{ success: boolean; error?: string }> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const fileStream = fs.createReadStream(filePath);
      await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [folderId],
        },
        media: {
          mimeType: "video/mp4",
          body: fileStream,
        },
        fields: "id",
        supportsAllDrives: true,
      });
      return { success: true };
    } catch (err: any) {
      const status = err?.response?.status || err?.code;
      const message = err?.response?.data?.error?.message || err?.message || String(err);

      // Don't retry on auth errors
      if (status === 401 || status === 403) {
        return { success: false, error: `Auth error (${status}): ${message}` };
      }

      console.warn(`[Export] Upload attempt ${attempt}/${maxRetries} failed: ${message}`);

      if (attempt < maxRetries) {
        const backoff = Math.pow(3, attempt) * 1000;
        await delay(backoff);
      }
    }
  }
  return { success: false, error: "Failed after 3 retries" };
}

// ─── Background Export Worker ────────────────────────────────────────────────

async function exportToDriveInBackground(batchId: string) {
  console.log(`[Export Worker] Starting export for batch ${batchId}`);

  try {
    const batch = await prisma.multiplierBatch.findUnique({
      where: { id: batchId },
      include: {
        items: {
          where: { status: "RENDERED" },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!batch) {
      throw new Error("Batch not found");
    }

    const hasAnyFolder = batch.driveFolderId || batch.items.some((i) => i.driveFolderId);
    if (!hasAnyFolder) {
      throw new Error("No Drive folders assigned to batch or items");
    }

    // Get Drive client
    const drive = await getMultiplierDriveClient();
    if (!drive) {
      throw new Error("Google Drive not connected or token expired. Reconnect Drive in the Manage section.");
    }

    // Quick connectivity check — list 1 file to verify token works
    try {
      await drive.files.list({ pageSize: 1, fields: "files(id)" });
      console.log("[Export Worker] Drive connectivity check passed");
    } catch (checkErr: any) {
      const msg = checkErr?.response?.data?.error?.message || checkErr?.message || String(checkErr);
      throw new Error(`Drive connectivity check failed: ${msg}`);
    }

    const publicDir = path.join(process.cwd(), "public");
    let uploadedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let lastError = "";

    for (let i = 0; i < batch.items.length; i++) {
      const item = batch.items[i];
      if (!item.renderedVideoUrl) {
        skippedCount++;
        continue;
      }

      const filePath = path.join(publicDir, item.renderedVideoUrl);
      if (!fs.existsSync(filePath)) {
        console.warn(`[Export Worker] File not found: ${filePath}`);
        lastError = `File not found: ${item.renderedVideoUrl}`;
        skippedCount++;
        continue;
      }

      const targetFolderId = item.driveFolderId || batch.driveFolderId;
      if (!targetFolderId) {
        skippedCount++;
        continue;
      }

      const hookSlug = item.hookText
        .replace(/[^a-zA-Z0-9 ]/g, "")
        .trim()
        .replace(/\s+/g, "_")
        .substring(0, 40);
      const fileName = `${String(i + 1).padStart(3, "0")}_${hookSlug || "video"}.mp4`;

      const result = await uploadWithRetry(drive, filePath, fileName, targetFolderId);
      if (result.success) {
        uploadedCount++;
        console.log(`[Export Worker] Uploaded ${uploadedCount}/${batch.items.length}: ${fileName}`);
      } else {
        failedCount++;
        lastError = result.error || "Unknown upload error";
        console.error(`[Export Worker] Failed: ${fileName} — ${lastError}`);

        // If auth error, stop — all subsequent uploads will fail too
        if (lastError.includes("Auth error")) {
          console.error(`[Export Worker] Auth error — stopping batch export`);
          break;
        }
      }

      // Rate limit: 2s between uploads
      if (i < batch.items.length - 1) {
        await delay(2000);
      }
    }

    const finalStatus = uploadedCount > 0 ? "EXPORTED" : "FAILED";
    const errorMsg = finalStatus === "FAILED" 
      ? `${lastError} (${failedCount} failed, ${skippedCount} skipped, ${uploadedCount} uploaded)`
      : null;

    await prisma.multiplierBatch.update({
      where: { id: batchId },
      data: { driveExportStatus: finalStatus, errorMessage: errorMsg },
    });

    console.log(`[Export Worker] Batch ${batchId} done: ${uploadedCount} uploaded, ${failedCount} failed, ${skippedCount} skipped`);
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.error(`[Export Worker] Fatal error for batch ${batchId}: ${errMsg}`);
    await prisma.multiplierBatch.update({
      where: { id: batchId },
      data: { driveExportStatus: "FAILED", errorMessage: errMsg.substring(0, 500) },
    });
  }
}
