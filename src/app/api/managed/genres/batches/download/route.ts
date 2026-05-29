export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import fs from "fs";
import path from "path";
import { exec } from "child_process";

// GET /api/managed/genres/batches/download?batchId=... — Check/Prepare standard batch download archive status
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
    // 1. Fetch batch and count rendered/uploaded items
    const batch = await prisma.genreBatch.findUnique({
      where: { id: batchId },
      include: {
        items: {
          where: {
            OR: [
              { status: "RENDERED" },
              { status: "UPLOADED" }
            ]
          },
          include: {
            account: true
          }
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

    const archivesDir = path.join(process.cwd(), "public", "uploads", "genres", "archives");
    const statusPath = path.join(archivesDir, `status_${batchId}.json`);
    const archiveName = `genre_${batchId}_archive.tar.gz`;
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
      prepareGenreArchiveInBackground(batchId, renderedCount).catch((err) => {
        console.error(`[Genres Download API] Background trigger failed for ${batchId}:`, err);
      });
    }

    return NextResponse.json(statusData);
  } catch (err) {
    console.error("[Genres Download API] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// ─── Background Preparation Worker ───────────────────────────────────────────

async function prepareGenreArchiveInBackground(batchId: string, renderedCount: number) {
  console.log(`[Genres Download Worker] Starting background archive prep for batch: ${batchId}`);

  const archivesDir = path.join(process.cwd(), "public", "uploads", "genres", "archives");
  const tempDir = path.join(process.cwd(), "public", "uploads", "genres", "temp");
  const publicDir = path.join(process.cwd(), "public");

  const statusPath = path.join(archivesDir, `status_${batchId}.json`);
  const archiveName = `genre_${batchId}_archive.tar.gz`;
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
      console.error("[Genres Download Worker] Error writing status file:", err);
    }
  };

  try {
    // 1. Ensure directories exist
    if (!fs.existsSync(archivesDir)) fs.mkdirSync(archivesDir, { recursive: true });
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    await updateStatus({ status: "PREPARING", progress: 5, message: "Fetching batch details..." });

    // 2. Fetch rendered items
    const batch = await prisma.genreBatch.findUnique({
      where: { id: batchId },
      include: {
        items: {
          where: {
            OR: [
              { status: "RENDERED" },
              { status: "UPLOADED" }
            ]
          },
          include: {
            account: true
          },
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
      if (!item.renderedVideoUrl) continue;

      const absPath = path.join(publicDir, item.renderedVideoUrl);
      if (fs.existsSync(absPath)) {
        const username = item.account?.tiktokUsername || "account";
        const quoteSlug = item.quoteText
          .replace(/[^a-zA-Z0-9 ]/g, "")
          .trim()
          .replace(/\s+/g, "_")
          .substring(0, 30);
        filePaths.push({
          absPath,
          name: `${String(i + 1).padStart(3, "0")}_${username}_${quoteSlug}.mp4`,
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
          try { fs.rmSync(linkDir, { recursive: true }); } catch { }
          if (error) {
            console.error("[Genres Download Worker] tar command failed:", stderr);
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
      downloadUrl: `/uploads/genres/archives/${archiveName}`,
      size: archiveSize,
    });

    console.log(`[Genres Download Worker] Batch ${batchId} archive completed successfully! (${archiveSize} bytes)`);
  } catch (err: any) {
    console.error(`[Genres Download Worker] Failed to prepare archive for batch ${batchId}:`, err);
    // Cleanup temporary files
    try { if (fs.existsSync(linkDir)) fs.rmSync(linkDir, { recursive: true }); } catch { }
    // Cleanup failed archive
    try { if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath); } catch { }

    await updateStatus({
      status: "FAILED",
      progress: 100,
      message: err.message || String(err),
    });
  }
}

// ─── POST: Folderized Smart Download (Synchronous) ─────────────────────────
// POST /api/managed/genres/batches/download
// Body: { batchId, accountCount, videosPerAccount, accountNames?: string[] }
// Copies files → tars → returns download URL in a single response.

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let tempDir = "";

  try {
    const body = await req.json();
    const { batchId, accountCount, videosPerAccount, accountNames } = body;

    if (!batchId || !accountCount || !videosPerAccount) {
      return NextResponse.json(
        { error: "Missing required fields: batchId, accountCount, videosPerAccount" },
        { status: 400 }
      );
    }

    const numAccounts = Math.max(1, Math.min(50, parseInt(accountCount) || 1));
    const vidsPerAccount = Math.max(1, Math.min(100, parseInt(videosPerAccount) || 1));
    const totalNeeded = numAccounts * vidsPerAccount;

    console.log(`[Smart Download] Request: batch=${batchId}, ${numAccounts} accounts × ${vidsPerAccount} videos = ${totalNeeded} total`);

    // Fetch rendered items
    const batch = await prisma.genreBatch.findUnique({
      where: { id: batchId },
      include: {
        items: {
          where: {
            OR: [{ status: "RENDERED" }, { status: "UPLOADED" }],
          },
          include: { account: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!batch || batch.items.length === 0) {
      return NextResponse.json({ error: "No rendered videos available" }, { status: 400 });
    }

    // Map rendered items to real files
    const publicDir = path.join(process.cwd(), "public");
    const available: { absPath: string; name: string }[] = [];
    for (const item of batch.items) {
      if (!item.renderedVideoUrl) continue;
      const absPath = path.join(publicDir, item.renderedVideoUrl);
      if (fs.existsSync(absPath)) {
        const quoteSlug = item.quoteText
          .replace(/[^a-zA-Z0-9 ]/g, "")
          .trim()
          .replace(/\s+/g, "_")
          .substring(0, 30);
        available.push({ absPath, name: `${quoteSlug || "video"}.mp4` });
      }
    }

    if (available.length === 0) {
      return NextResponse.json({ error: "No video files found on disk" }, { status: 400 });
    }

    if (available.length < totalNeeded) {
      return NextResponse.json({
        error: `Not enough videos. Need ${totalNeeded} (${numAccounts}×${vidsPerAccount}) but only ${available.length} available.`
      }, { status: 400 });
    }

    // ── Build archive inline ────────────────────────────────────────────────
    const archivesDir = path.join(process.cwd(), "public", "uploads", "genres", "archives");
    const archiveName = `smart_${batchId.substring(0, 8)}_${numAccounts}x${vidsPerAccount}_${Date.now()}.tar.gz`;
    const archivePath = path.join(archivesDir, archiveName);
    tempDir = path.join(archivesDir, `tmp_smart_${Date.now()}`);

    fs.mkdirSync(archivesDir, { recursive: true });
    fs.mkdirSync(tempDir, { recursive: true });

    // 1. Shuffle
    const shuffled = [...available].sort(() => Math.random() - 0.5);

    // 2. Distribute into folders
    let idx = 0;
    for (let a = 0; a < numAccounts; a++) {
      const folderName = (accountNames && accountNames[a])
        ? accountNames[a].replace(/[^a-zA-Z0-9_\-. ]/g, "").trim() || `Account_${a + 1}`
        : `Account_${a + 1}`;

      const dir = path.join(tempDir, folderName);
      fs.mkdirSync(dir, { recursive: true });

      for (let v = 0; v < vidsPerAccount; v++) {
        if (idx >= shuffled.length) break;
        fs.copyFileSync(shuffled[idx].absPath, path.join(dir, `${String(v + 1).padStart(2, "0")}_${shuffled[idx].name}`));
        idx++;
      }
    }

    console.log(`[Smart Download] Copied ${idx} files into ${numAccounts} folders. Compressing...`);

    // 3. tar
    await new Promise<void>((resolve, reject) => {
      exec(`tar -czf "${archivePath}" -C "${tempDir}" .`, { maxBuffer: 200 * 1024 * 1024 }, (err, _, stderr) => {
        if (err) {
          console.error("[Smart Download] tar error:", stderr);
          reject(new Error(`tar failed: ${stderr}`));
        } else {
          resolve();
        }
      });
    });

    // Cleanup temp
    try { fs.rmSync(tempDir, { recursive: true }); } catch {}
    tempDir = "";

    if (!fs.existsSync(archivePath)) {
      throw new Error("tar completed but archive file not found on disk");
    }

    const size = fs.statSync(archivePath).size;
    const downloadUrl = `/uploads/genres/archives/${archiveName}`;

    console.log(`[Smart Download] ✅ Done: ${archiveName} (${(size / 1024 / 1024).toFixed(1)}MB)`);

    return NextResponse.json({
      status: "COMPLETED",
      downloadUrl,
      size,
      message: `${numAccounts} folders × ${vidsPerAccount} videos`,
    });
  } catch (err: any) {
    console.error("[Smart Download] ❌ Error:", err);
    if (tempDir) { try { fs.rmSync(tempDir, { recursive: true }); } catch {} }
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 });
  }
}

