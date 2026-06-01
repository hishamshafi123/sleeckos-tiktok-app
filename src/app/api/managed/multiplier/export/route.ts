export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import fs from "fs";
import path from "path";
import { getMultiplierDriveClient } from "../google/status/route";

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

    // Verify Drive client is available BEFORE starting background work
    const drive = await getMultiplierDriveClient();
    if (!drive) {
      return NextResponse.json({ error: "Google Drive not connected. Connect Drive in the Manage section first." }, { status: 400 });
    }

    // Mark as exporting
    await prisma.multiplierBatch.update({
      where: { id: batchId },
      data: { driveExportStatus: "EXPORTING" },
    });

    // Start background upload
    exportToDriveInBackground(batchId).catch((err) => {
      console.error(`[Multiplier Export] Background export failed for ${batchId}:`, err);
    });

    return NextResponse.json({ success: true, message: "Export started" });
  } catch (err) {
    console.error("[Multiplier Export] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
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
    select: { driveExportStatus: true, driveFolderId: true, driveFolderName: true },
  });

  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  return NextResponse.json({
    status: batch.driveExportStatus,
    folderId: batch.driveFolderId,
    folderName: batch.driveFolderName,
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
      // Reset all batches stuck at EXPORTING to null (allow retry)
      const result = await prisma.multiplierBatch.updateMany({
        where: { driveExportStatus: "EXPORTING" },
        data: { driveExportStatus: null },
      });
      return NextResponse.json({ success: true, resetCount: result.count });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("[Multiplier Export] PATCH error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// Simple delay helper
function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Upload a single file with retries
async function uploadWithRetry(
  drive: any,
  filePath: string,
  fileName: string,
  folderId: string,
  maxRetries = 3
): Promise<boolean> {
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
      return true;
    } catch (err: any) {
      const status = err?.response?.status || err?.code;
      const message = err?.message || String(err);

      // Don't retry on auth errors — they won't self-resolve
      if (status === 401 || status === 403) {
        console.error(`[Multiplier Export] Auth error (${status}), not retrying: ${message}`);
        throw err;
      }

      console.warn(`[Multiplier Export] Upload attempt ${attempt}/${maxRetries} failed: ${message}`);

      if (attempt < maxRetries) {
        // Exponential backoff: 3s, 9s, 27s
        const backoff = Math.pow(3, attempt) * 1000;
        console.log(`[Multiplier Export] Retrying in ${backoff / 1000}s...`);
        await delay(backoff);
      }
    }
  }
  return false;
}

async function exportToDriveInBackground(batchId: string) {
  console.log(`[Multiplier Export Worker] Starting export for batch ${batchId}`);

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

    // Check that there's at least one folder assigned (batch or item level)
    const hasAnyFolder = batch.driveFolderId || batch.items.some((i) => i.driveFolderId);
    if (!hasAnyFolder) {
      throw new Error("No Drive folders assigned");
    }

    // Get Drive client — single call, reused for all uploads
    const drive = await getMultiplierDriveClient();
    if (!drive) {
      throw new Error("Google Drive not connected. Connect Drive in the Manage section first.");
    }

    const publicDir = path.join(process.cwd(), "public");

    let uploadedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < batch.items.length; i++) {
      const item = batch.items[i];
      if (!item.renderedVideoUrl) {
        skippedCount++;
        continue;
      }

      const filePath = path.join(publicDir, item.renderedVideoUrl);
      if (!fs.existsSync(filePath)) {
        console.warn(`[Multiplier Export Worker] File not found: ${filePath}`);
        skippedCount++;
        continue;
      }

      // Use per-item folder if set, otherwise fall back to batch folder
      const targetFolderId = item.driveFolderId || batch.driveFolderId;
      if (!targetFolderId) {
        console.warn(`[Multiplier Export Worker] No folder for item ${item.id}, skipping`);
        skippedCount++;
        continue;
      }

      // Generate a clean filename
      const hookSlug = item.hookText
        .replace(/[^a-zA-Z0-9 ]/g, "")
        .trim()
        .replace(/\s+/g, "_")
        .substring(0, 40);
      const fileName = `${String(i + 1).padStart(3, "0")}_${hookSlug || "video"}.mp4`;

      try {
        const success = await uploadWithRetry(drive, filePath, fileName, targetFolderId);
        if (success) {
          uploadedCount++;
          console.log(`[Multiplier Export Worker] Uploaded ${uploadedCount}/${batch.items.length}: ${fileName}`);
        } else {
          failedCount++;
          console.error(`[Multiplier Export Worker] Failed after retries: ${fileName}`);
        }
      } catch (uploadErr: any) {
        failedCount++;
        const errMsg = uploadErr?.message || String(uploadErr);
        console.error(`[Multiplier Export Worker] Fatal error uploading ${fileName}: ${errMsg}`);
        
        // If it's an auth error, stop all uploads — they'll all fail
        const status = uploadErr?.response?.status || uploadErr?.code;
        if (status === 401 || status === 403) {
          console.error(`[Multiplier Export Worker] Auth error — stopping batch export`);
          break;
        }
      }

      // Rate limit: wait 1.5s between uploads to avoid Google API throttling
      if (i < batch.items.length - 1) {
        await delay(1500);
      }
    }

    const finalStatus = uploadedCount > 0 ? "EXPORTED" : "FAILED";
    await prisma.multiplierBatch.update({
      where: { id: batchId },
      data: { driveExportStatus: finalStatus },
    });

    console.log(`[Multiplier Export Worker] Batch ${batchId} export completed. ${uploadedCount} uploaded, ${failedCount} failed, ${skippedCount} skipped.`);
  } catch (err: any) {
    console.error(`[Multiplier Export Worker] Fatal error for batch ${batchId}:`, err?.message || err);
    await prisma.multiplierBatch.update({
      where: { id: batchId },
      data: { driveExportStatus: "FAILED" },
    });
  }
}
