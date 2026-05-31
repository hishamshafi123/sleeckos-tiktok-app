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

// ─── Background Export Worker ────────────────────────────────────────────────

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

    // Get Drive client from existing ManagedAccount connection
    const drive = await getMultiplierDriveClient();
    if (!drive) {
      throw new Error("Google Drive not connected. Connect Drive in the Manage section first.");
    }

    const publicDir = path.join(process.cwd(), "public");

    let uploadedCount = 0;

    for (let i = 0; i < batch.items.length; i++) {
      const item = batch.items[i];
      if (!item.renderedVideoUrl) continue;

      const filePath = path.join(publicDir, item.renderedVideoUrl);
      if (!fs.existsSync(filePath)) {
        console.warn(`[Multiplier Export Worker] File not found: ${filePath}`);
        continue;
      }

      // Generate a clean filename
      const hookSlug = item.hookText
        .replace(/[^a-zA-Z0-9 ]/g, "")
        .trim()
        .replace(/\s+/g, "_")
        .substring(0, 40);
      const fileName = `${String(i + 1).padStart(3, "0")}_${hookSlug}.mp4`;

      // Use per-item folder if set, otherwise fall back to batch folder
      const targetFolderId = item.driveFolderId || batch.driveFolderId;
      if (!targetFolderId) {
        console.warn(`[Multiplier Export Worker] No folder for item ${item.id}, skipping`);
        continue;
      }

      try {
        const fileStream = fs.createReadStream(filePath);

        await drive.files.create({
          requestBody: {
            name: fileName,
            parents: [targetFolderId],
          },
          media: {
            mimeType: "video/mp4",
            body: fileStream,
          },
          fields: "id",
          supportsAllDrives: true,
        });

        uploadedCount++;
        console.log(`[Multiplier Export Worker] Uploaded ${uploadedCount}/${batch.items.length}: ${fileName}`);
      } catch (uploadErr) {
        console.error(`[Multiplier Export Worker] Failed to upload ${fileName}:`, uploadErr);
      }
    }

    const finalStatus = uploadedCount > 0 ? "EXPORTED" : "FAILED";
    await prisma.multiplierBatch.update({
      where: { id: batchId },
      data: { driveExportStatus: finalStatus },
    });

    console.log(`[Multiplier Export Worker] Batch ${batchId} export completed. ${uploadedCount}/${batch.items.length} uploaded.`);
  } catch (err: any) {
    console.error(`[Multiplier Export Worker] Fatal error for batch ${batchId}:`, err);
    await prisma.multiplierBatch.update({
      where: { id: batchId },
      data: { driveExportStatus: "FAILED" },
    });
  }
}
