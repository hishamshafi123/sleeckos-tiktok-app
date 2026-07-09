export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { downloadFromR2, uploadToR2 } from "@/lib/services/storage";

// GET /api/managed/multiplier/download?batchId=... — Check/Prepare download archive status
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const rawId = searchParams.get("batchId") || searchParams.get("groupId");
  const force = searchParams.get("force") === "true";

  if (!rawId) {
    return NextResponse.json({ error: "Missing batchId or groupId" }, { status: 400 });
  }

  try {
    let renderedCount = 0;
    
    // Check if it is a new group or legacy batch
    const group = await prisma.multiplierGroup.findUnique({
      where: { id: rawId },
      include: {
        outputs: {
          where: { status: "COMPLETED" },
        },
      },
    });

    if (group) {
      renderedCount = group.outputs.length;
    } else {
      const batch = await prisma.multiplierBatch.findUnique({
        where: { id: rawId },
        include: {
          items: {
            where: { status: "RENDERED" },
          },
        },
      });
      if (batch) {
        renderedCount = batch.items.length;
      } else {
        return NextResponse.json({ error: "Batch or Group not found" }, { status: 404 });
      }
    }

    if (renderedCount === 0) {
      return NextResponse.json({ error: "No completed videos available for download" }, { status: 400 });
    }

    const archivesDir = path.join(process.cwd(), "public", "uploads", "multiplier", "archives");
    const statusPath = path.join(archivesDir, `status_${rawId}.json`);
    const archiveName = `multiplier_${rawId}_archive.tar`;
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
      prepareArchiveInBackground(rawId, renderedCount).catch((err) => {
        console.error(`[Multiplier Download API] Background trigger failed for ${rawId}:`, err);
      });
    }

    return NextResponse.json(statusData);
  } catch (err) {
    console.error("[Multiplier Download API] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// ─── Background Preparation Worker ───────────────────────────────────────────

async function prepareArchiveInBackground(rawId: string, renderedCount: number) {
  console.log(`[Multiplier Download Worker] Starting background archive prep for target: ${rawId}`);
  
  const archivesDir = path.join(process.cwd(), "public", "uploads", "multiplier", "archives");
  const tempDir = path.join(process.cwd(), "public", "uploads", "multiplier", "temp");
  const publicDir = path.join(process.cwd(), "public");

  const statusPath = path.join(archivesDir, `status_${rawId}.json`);
  const archiveName = `multiplier_${rawId}_archive.tar`;
  const archivePath = path.join(archivesDir, archiveName);
  const linkDir = path.join(tempDir, `dl_${rawId}`);

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

    await updateStatus({ status: "PREPARING", progress: 5, message: "Fetching target details..." });

    // 2. Fetch rendered items
    const group = await prisma.multiplierGroup.findUnique({
      where: { id: rawId },
      include: {
        outputs: {
          where: { status: "COMPLETED" },
          include: {
            hook: { select: { text: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    let filePaths: { absPath: string; name: string }[] = [];

    if (group) {
      await updateStatus({ status: "PREPARING", progress: 10, message: "Collecting video files from group..." });

      for (let i = 0; i < group.outputs.length; i++) {
        const out = group.outputs[i];
        if (!out.outputRef) continue;
        const absPath = path.join(publicDir, out.outputRef);
        if (!fs.existsSync(absPath)) {
          const key = `uploads/multiplier/renders/multi_${out.id}.mp4`;
          await downloadFromR2(key, absPath);
        }
        if (fs.existsSync(absPath)) {
          const hookSlug = (out.hook?.text || "video")
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
    } else {
      const batch = await prisma.multiplierBatch.findUnique({
        where: { id: rawId },
        include: {
          items: {
            where: { status: "RENDERED" },
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!batch || batch.items.length === 0) {
        throw new Error("No rendered videos found for this target");
      }

      await updateStatus({ status: "PREPARING", progress: 10, message: "Collecting video files from legacy batch..." });

      for (let i = 0; i < batch.items.length; i++) {
        const item = batch.items[i];
        const absPath = path.join(publicDir, item.renderedVideoUrl!);
        if (!fs.existsSync(absPath)) {
          const key = `uploads/multiplier/renders/multi_${item.id}.mp4`;
          await downloadFromR2(key, absPath);
        }
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

    await updateStatus({ status: "PREPARING", progress: 60, message: "Packaging into tar archive..." });

    // 4. Run native tar compilation
    await new Promise<void>((resolve, reject) => {
      exec(
        `tar -cf "${archivePath}" -C "${linkDir}" .`,
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

    // Upload archive to R2
    await uploadToR2(archivePath, `uploads/multiplier/archives/${archiveName}`);

    const archiveSize = fs.statSync(archivePath).size;

    await updateStatus({
      status: "COMPLETED",
      progress: 100,
      message: "Archive prepared successfully!",
      downloadUrl: `/uploads/multiplier/archives/${archiveName}`,
      size: archiveSize,
    });

    console.log(`[Multiplier Download Worker] Batch ${rawId} archive completed successfully! (${archiveSize} bytes)`);
  } catch (err: any) {
    console.error(`[Multiplier Download Worker] Failed to prepare archive for batch ${rawId}:`, err);
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
