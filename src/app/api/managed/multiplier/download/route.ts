export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import fs from "fs";
import path from "path";
import { exec } from "child_process";

// GET /api/managed/multiplier/download?batchId=... — Check/Prepare download archive status
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const batchId = searchParams.get("batchId");
  const force = searchParams.get("force") === "true";

  if (!batchId) {
    return NextResponse.json({ error: "Missing batchId" }, { status: 400 });
  }

  try {
    // 1. Fetch batch details and count rendered items
    const batch = await prisma.multiplierBatch.findUnique({
      where: { id: batchId },
      include: {
        items: {
          where: { status: "RENDERED" },
        },
      },
    });

    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    const renderedCount = batch.items.length;
    if (renderedCount === 0) {
      return NextResponse.json({ error: "No rendered videos available for download" }, { status: 400 });
    }

    const archivesDir = path.join(process.cwd(), "public", "uploads", "multiplier", "archives");
    const statusPath = path.join(archivesDir, `status_${batchId}.json`);
    const archiveName = `multiplier_${batchId}_archive.tar.gz`;
    const archivePath = path.join(archivesDir, archiveName);

    let startPrep = false;
    let statusData: any = null;

    // Check if status file exists
    if (fs.existsSync(statusPath)) {
      try {
        statusData = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
      } catch (e) {
        startPrep = true;
      }
    } else {
      startPrep = true;
    }

    // Force regeneration or count mismatch triggers preparation
    if (force || (statusData && statusData.renderedCount !== renderedCount)) {
      startPrep = true;
    }

    // Reset if the archive preparation is in progress but stalled (> 10 mins)
    if (statusData && statusData.status === "PREPARING") {
      const tenMinutes = 10 * 60 * 1000;
      if (Date.now() - statusData.timestamp > tenMinutes) {
        startPrep = true;
      }
    }

    // Reset if marked COMPLETED but the physical archive file does not exist
    if (statusData && statusData.status === "COMPLETED" && !fs.existsSync(archivePath)) {
      startPrep = true;
    }

    if (startPrep) {
      if (!fs.existsSync(archivesDir)) {
        fs.mkdirSync(archivesDir, { recursive: true });
      }

      // Initialize status as PREPARING
      statusData = {
        status: "PREPARING",
        progress: 0,
        message: "Initializing archive preparation...",
        downloadUrl: null,
        size: 0,
        renderedCount,
        timestamp: Date.now()
      };
      fs.writeFileSync(statusPath, JSON.stringify(statusData, null, 2));

      // Trigger background preparation (asynchronously, does not block the HTTP response)
      prepareArchiveInBackground(batchId, renderedCount).catch((err) => {
        console.error(`[Multiplier Download API] Background trigger failed for ${batchId}:`, err);
      });
    }

    return NextResponse.json(statusData);
  } catch (err) {
    console.error("[Multiplier Download API] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// ─── Background Preparation Worker ───────────────────────────────────────────

async function prepareArchiveInBackground(batchId: string, renderedCount: number) {
  console.log(`[Multiplier Download Worker] Starting background archive prep for batch: ${batchId}`);
  
  const archivesDir = path.join(process.cwd(), "public", "uploads", "multiplier", "archives");
  const tempDir = path.join(process.cwd(), "public", "uploads", "multiplier", "temp");
  const publicDir = path.join(process.cwd(), "public");

  const statusPath = path.join(archivesDir, `status_${batchId}.json`);
  const archiveName = `multiplier_${batchId}_archive.tar.gz`;
  const archivePath = path.join(archivesDir, archiveName);
  const linkDir = path.join(tempDir, `dl_${batchId}`);

  const updateStatus = async (data: Partial<{
    status: "PREPARING" | "COMPLETED" | "FAILED";
    progress: number;
    message: string;
    error: string | null;
    size: number;
    downloadUrl: string | null;
  }>) => {
    try {
      const current = fs.existsSync(statusPath) ? JSON.parse(fs.readFileSync(statusPath, "utf-8")) : {};
      const next = {
        status: "PREPARING",
        progress: 0,
        message: "",
        downloadUrl: null,
        size: 0,
        renderedCount,
        timestamp: Date.now(),
        ...current,
        ...data,
      };
      fs.writeFileSync(statusPath, JSON.stringify(next, null, 2));
    } catch (err) {
      console.error("[Multiplier Download Worker] Error writing status file:", err);
    }
  };

  try {
    // 1. Ensure directories exist
    if (!fs.existsSync(archivesDir)) fs.mkdirSync(archivesDir, { recursive: true });
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    await updateStatus({ status: "PREPARING", progress: 5, message: "Fetching batch details..." });

    // 2. Fetch rendered items
    const batch = await prisma.multiplierBatch.findUnique({
      where: { id: batchId },
      include: {
        items: {
          where: { status: "RENDERED" },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!batch || batch.items.length === 0) {
      throw new Error("No rendered videos found for this batch");
    }

    await updateStatus({ status: "PREPARING", progress: 10, message: "Collecting video files..." });

    // 3. Match database items to actual public video files
    const filePaths: { absPath: string; name: string }[] = [];
    for (let i = 0; i < batch.items.length; i++) {
      const item = batch.items[i];
      const absPath = path.join(publicDir, item.renderedVideoUrl!);
      if (fs.existsSync(absPath)) {
        const hookSlug = item.hookText
          .replace(/[^a-zA-Z0-9 ]/g, "")
          .trim()
          .replace(/\s+/g, "_")
          .substring(0, 40);
        filePaths.push({
          absPath,
          name: `${String(i + 1).padStart(3, "0")}_${hookSlug}.mp4`,
        });
      }
    }

    if (filePaths.length === 0) {
      throw new Error("Rendered video files not found on disk");
    }

    // Clean up or recreate temporary linking folder
    if (fs.existsSync(linkDir)) {
      fs.rmSync(linkDir, { recursive: true });
    }
    fs.mkdirSync(linkDir, { recursive: true });

    // Copy files sequentially to update progress
    const totalFiles = filePaths.length;
    for (let i = 0; i < totalFiles; i++) {
      const fp = filePaths[i];
      const dest = path.join(linkDir, fp.name);
      fs.copyFileSync(fp.absPath, dest);

      const copyProgress = Math.round(15 + (i / totalFiles) * 35);
      await updateStatus({
        status: "PREPARING",
        progress: copyProgress,
        message: `Copying video ${i + 1} of ${totalFiles}...`
      });
    }

    await updateStatus({ status: "PREPARING", progress: 60, message: "Compressing into tar.gz archive..." });

    // 4. Run native tar compilation
    await new Promise<void>((resolve, reject) => {
      exec(
        `tar -czf "${archivePath}" -C "${linkDir}" .`,
        { maxBuffer: 100 * 1024 * 1024 },
        (error, _stdout, stderr) => {
          // Clean up temporary files
          try { fs.rmSync(linkDir, { recursive: true }); } catch {}
          if (error) {
            console.error("[Multiplier Download Worker] tar command failed:", stderr);
            reject(error);
          } else {
            resolve();
          }
        }
      );
    });

    if (!fs.existsSync(archivePath)) {
      throw new Error("Failed to create archive on disk");
    }

    const archiveSize = fs.statSync(archivePath).size;

    await updateStatus({
      status: "COMPLETED",
      progress: 100,
      message: "Archive prepared successfully!",
      downloadUrl: `/uploads/multiplier/archives/${archiveName}`,
      size: archiveSize,
    });

    console.log(`[Multiplier Download Worker] Batch ${batchId} archive completed successfully! (${archiveSize} bytes)`);
  } catch (err: any) {
    console.error(`[Multiplier Download Worker] Failed to prepare archive for batch ${batchId}:`, err);
    // Cleanup temporary files
    try { if (fs.existsSync(linkDir)) fs.rmSync(linkDir, { recursive: true }); } catch {}
    // Cleanup failed archive
    try { if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath); } catch {}

    await updateStatus({
      status: "FAILED",
      progress: 100,
      message: err.message || String(err),
    });
  }
}
