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
    const { batchId } = body;

    if (!batchId) {
      return NextResponse.json(
        { error: "Missing required fields: batchId" },
        { status: 400 }
      );
    }

    console.log(`[Clip Mixer Smart Download] Request: batch=${batchId}`);

    // Fetch rendered or uploaded items
    const batch = await prisma.clipMixerBatch.findUnique({
      where: { id: batchId },
      include: {
        items: {
          where: {
            status: { in: ["RENDERED", "UPLOADED"] }
          },
          include: {
            folder: {
              select: { name: true }
            },
            account: {
              select: { id: true, tiktokUsername: true }
            }
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!batch || batch.items.length === 0) {
      return NextResponse.json({ error: "No rendered or uploaded videos available for this batch" }, { status: 400 });
    }

    // Map unique account IDs present in the items to sequential names (e.g. Account_1, Account_2, ...)
    const uniqueAccountsMap = new Map<string, { id: string; tiktokUsername: string }>();
    for (const item of batch.items) {
      const username = item.account?.tiktokUsername || "unknown";
      if (!uniqueAccountsMap.has(item.accountId)) {
        uniqueAccountsMap.set(item.accountId, {
          id: item.accountId,
          tiktokUsername: username,
        });
      }
    }

    const uniqueAccountsList = Array.from(uniqueAccountsMap.values()).sort((a, b) => 
      a.tiktokUsername.localeCompare(b.tiktokUsername)
    );

    const accountFolderMap = new Map<string, string>();
    uniqueAccountsList.forEach((acc, index) => {
      accountFolderMap.set(acc.id, `Account_${index + 1}`);
    });

    // Map rendered items to real files and folder name
    const publicDir = path.join(process.cwd(), "public");
    const available: { absPath: string; name: string; folderName: string; accountId: string }[] = [];
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
          accountId: item.accountId,
        });
      }
    }

    if (available.length === 0) {
      return NextResponse.json({ error: "No video files found on disk" }, { status: 400 });
    }

    // Build archive inline
    const archivesDir = path.join(process.cwd(), "public", "uploads", "clip-mixer", "archives");
    const archiveName = `smart_clip_${batchId.substring(0, 8)}_${Date.now()}.tar`;
    const archivePath = path.join(archivesDir, archiveName);
    tempDir = path.join(archivesDir, `tmp_smart_${Date.now()}`);

    fs.mkdirSync(archivesDir, { recursive: true });
    fs.mkdirSync(tempDir, { recursive: true });

    // Copy files exactly to their assigned directories: tempDir/Account_X/folderName/name
    let totalCopied = 0;
    for (const fileItem of available) {
      const accountFolder = accountFolderMap.get(fileItem.accountId) || "Account_1";
      const targetDir = path.join(tempDir, accountFolder, fileItem.folderName);
      fs.mkdirSync(targetDir, { recursive: true });
      fs.copyFileSync(fileItem.absPath, path.join(targetDir, fileItem.name));
      totalCopied++;
    }

    console.log(`[Clip Mixer Smart Download] Copied ${totalCopied} files into account/folder structures. Packaging...`);

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
      message: `${uniqueAccountsList.length} accounts, ${totalCopied} videos`,
    });
  } catch (err: any) {
    console.error("[Clip Mixer Smart Download] ❌ Error:", err);
    if (tempDir) { try { fs.rmSync(tempDir, { recursive: true }); } catch {} }
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 });
  }
}
