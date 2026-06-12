export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import fs from "fs";
import path from "path";
import { exec } from "child_process";

// POST /api/managed/clip-mixer/batches/download — Creates a folderized smart download archive
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let tempDir = "";

  try {
    const body = await req.json();
    const { batchId, accountCount, videosPerAccount } = body;

    if (!batchId || !accountCount || !videosPerAccount) {
      return NextResponse.json(
        { error: "Missing required fields: batchId, accountCount, videosPerAccount" },
        { status: 400 }
      );
    }

    const numAccounts = Math.max(1, Math.min(50, parseInt(accountCount) || 1));
    const vidsPerAccount = Math.max(1, Math.min(100, parseInt(videosPerAccount) || 1));
    const totalNeeded = numAccounts * vidsPerAccount;

    console.log(`[Clip Mixer Smart Download] Request: batch=${batchId}, ${numAccounts} accounts × ${vidsPerAccount} videos = ${totalNeeded} total`);

    // Fetch rendered items
    const batch = await prisma.clipMixerBatch.findUnique({
      where: { id: batchId },
      include: {
        items: {
          where: {
            status: "RENDERED"
          },
          include: {
            folder: {
              select: { name: true }
            }
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!batch || batch.items.length === 0) {
      return NextResponse.json({ error: "No rendered videos available for this batch" }, { status: 400 });
    }

    // Map rendered items to real files and folder name
    const publicDir = path.join(process.cwd(), "public");
    const available: { absPath: string; name: string; folderName: string }[] = [];
    for (const item of batch.items) {
      if (!item.renderedVideoUrl) continue;
      const absPath = path.join(publicDir, item.renderedVideoUrl);
      if (fs.existsSync(absPath)) {
        const fName = item.folder?.name || "root";
        const sanitizedFolderName = fName.replace(/[^a-zA-Z0-9_-]/g, "_");
        available.push({
          absPath,
          name: `video_${item.id.substring(0, 8)}.mp4`,
          folderName: sanitizedFolderName,
        });
      }
    }

    if (available.length === 0) {
      return NextResponse.json({ error: "No video files found on disk" }, { status: 400 });
    }

    // Group available items by folderName
    const byFolder: Record<string, typeof available> = {};
    for (const item of available) {
      if (!byFolder[item.folderName]) byFolder[item.folderName] = [];
      byFolder[item.folderName].push(item);
    }

    // Build archive inline
    const archivesDir = path.join(process.cwd(), "public", "uploads", "clip-mixer", "archives");
    const archiveName = `smart_clip_${batchId.substring(0, 8)}_${numAccounts}x${vidsPerAccount}_${Date.now()}.tar`;
    const archivePath = path.join(archivesDir, archiveName);
    tempDir = path.join(archivesDir, `tmp_smart_${Date.now()}`);

    fs.mkdirSync(archivesDir, { recursive: true });
    fs.mkdirSync(tempDir, { recursive: true });

    // Distribute into folders grouped by subfolders
    let totalCopied = 0;
    for (const [folderName, filesList] of Object.entries(byFolder)) {
      const folderSubdir = path.join(tempDir, folderName);
      fs.mkdirSync(folderSubdir, { recursive: true });

      // Shuffle files list per folder to ensure randomness
      const shuffled = [...filesList].sort(() => Math.random() - 0.5);

      let idx = 0;
      for (let a = 0; a < numAccounts; a++) {
        const accountDirName = `Account_${a + 1}`;
        const dir = path.join(folderSubdir, accountDirName);
        fs.mkdirSync(dir, { recursive: true });

        for (let v = 0; v < vidsPerAccount; v++) {
          const fileToCopy = shuffled[idx % shuffled.length];
          fs.copyFileSync(fileToCopy.absPath, path.join(dir, `${String(v + 1).padStart(2, "0")}_${fileToCopy.name}`));
          idx++;
          totalCopied++;
        }
      }
    }

    console.log(`[Clip Mixer Smart Download] Copied ${totalCopied} files into subfolder structures. Packaging...`);

    // tar
    await new Promise<void>((resolve, reject) => {
      exec(`tar -cf "${archivePath}" -C "${tempDir}" .`, { maxBuffer: 200 * 1024 * 1024 }, (err, _, stderr) => {
        if (err) {
          console.error("[Clip Mixer Smart Download] tar error:", stderr);
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
    const downloadUrl = `/uploads/clip-mixer/archives/${archiveName}`;

    console.log(`[Clip Mixer Smart Download] ✅ Done: ${archiveName} (${(size / 1024 / 1024).toFixed(1)}MB)`);

    return NextResponse.json({
      status: "COMPLETED",
      downloadUrl,
      size,
      message: `${numAccounts} folders × ${vidsPerAccount} videos`,
    });
  } catch (err: any) {
    console.error("[Clip Mixer Smart Download] ❌ Error:", err);
    if (tempDir) { try { fs.rmSync(tempDir, { recursive: true }); } catch {} }
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 });
  }
}
