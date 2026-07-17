export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { downloadFromR2, uploadToR2 } from "@/lib/services/storage";

// POST /api/managed/multiplier/smart-download
// Body: { groupIds: string[], accountCount: number, videosPerAccount: number, includeExported?: boolean }
// Shuffles completed outputs across selected groups → packages into account folders → tar → R2

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let tempDir = "";

  try {
    const body = await req.json();
    const { groupIds, accountCount, videosPerAccount, includeExported } = body;

    if (!groupIds || !Array.isArray(groupIds) || groupIds.length === 0) {
      return NextResponse.json(
        { error: "Missing or empty groupIds array" },
        { status: 400 }
      );
    }
    if (!accountCount || !videosPerAccount) {
      return NextResponse.json(
        { error: "Missing required fields: accountCount, videosPerAccount" },
        { status: 400 }
      );
    }

    const numAccounts = Math.max(1, Math.min(50, parseInt(accountCount) || 1));
    const vidsPerAccount = Math.max(1, Math.min(100, parseInt(videosPerAccount) || 1));
    const totalNeeded = numAccounts * vidsPerAccount;

    console.log(`[Multiplier Smart Download] Request: ${groupIds.length} groups, ${numAccounts} accounts × ${vidsPerAccount} videos = ${totalNeeded} total`);

    // 1. Fetch all completed outputs across selected groups
    const outputs = await prisma.multiplierOutput.findMany({
      where: {
        groupId: { in: groupIds },
        status: "COMPLETED",
        outputRef: { not: null },
        ...(includeExported ? {} : { exportedAt: null }),
      },
      include: {
        hook: { select: { text: true } },
        group: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    if (outputs.length === 0) {
      return NextResponse.json(
        { error: "No completed (unexported) videos found across the selected groups." },
        { status: 400 }
      );
    }

    if (totalNeeded > outputs.length) {
      return NextResponse.json(
        { error: `Not enough videos! Need ${totalNeeded} but only ${outputs.length} available.` },
        { status: 400 }
      );
    }

    // 2. Map outputs to real files (download from R2 if needed)
    const publicDir = path.join(process.cwd(), "public");
    const available: { absPath: string; name: string; outputId: string }[] = [];

    for (const out of outputs) {
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
          .substring(0, 30);
        const groupSlug = (out.group?.name || "group")
          .replace(/[^a-zA-Z0-9 ]/g, "")
          .trim()
          .replace(/\s+/g, "_")
          .substring(0, 20);
        available.push({
          absPath,
          name: `${groupSlug}_${hookSlug || "video"}.mp4`,
          outputId: out.id,
        });
      }
    }

    if (available.length === 0) {
      return NextResponse.json({ error: "No video files found on disk" }, { status: 400 });
    }

    // 3. Build archive inline (same logic as genres smart download)
    const archivesDir = path.join(process.cwd(), "public", "uploads", "multiplier", "archives");
    const archiveName = `smart_multi_${groupIds.length}g_${numAccounts}x${vidsPerAccount}_${Date.now()}.tar`;
    const archivePath = path.join(archivesDir, archiveName);
    tempDir = path.join(archivesDir, `tmp_smart_${Date.now()}`);

    fs.mkdirSync(archivesDir, { recursive: true });
    fs.mkdirSync(tempDir, { recursive: true });

    // 3a. Fisher-Yates shuffle — interleave across groups
    const shuffled = [...available];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // 3b. Distribute into folders
    const includedOutputIds: string[] = [];
    let idx = 0;
    for (let a = 0; a < numAccounts; a++) {
      const folderName = `Account_${a + 1}`;
      const dir = path.join(tempDir, folderName);
      fs.mkdirSync(dir, { recursive: true });

      for (let v = 0; v < vidsPerAccount; v++) {
        const fileToCopy = shuffled[idx % shuffled.length];
        fs.copyFileSync(
          fileToCopy.absPath,
          path.join(dir, `${String(v + 1).padStart(2, "0")}_${fileToCopy.name}`)
        );
        // Track which outputs are being included
        if (!includedOutputIds.includes(fileToCopy.outputId)) {
          includedOutputIds.push(fileToCopy.outputId);
        }
        idx++;
      }
    }

    console.log(`[Multiplier Smart Download] Copied ${idx} files into ${numAccounts} folders. Packaging...`);

    // 3c. tar
    await new Promise<void>((resolve, reject) => {
      exec(`tar -cf "${archivePath}" -C "${tempDir}" .`, { maxBuffer: 200 * 1024 * 1024 }, (err, _, stderr) => {
        if (err) {
          console.error("[Multiplier Smart Download] tar error:", stderr);
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

    // 4. Upload to R2
    await uploadToR2(archivePath, `uploads/multiplier/archives/${archiveName}`);

    const size = fs.statSync(archivePath).size;
    const downloadUrl = `/uploads/multiplier/archives/${archiveName}`;

    // 5. Mark included outputs as exported (export-once guard)
    if (includedOutputIds.length > 0) {
      await prisma.multiplierOutput.updateMany({
        where: { id: { in: includedOutputIds } },
        data: { exportedAt: new Date() },
      });
    }

    console.log(`[Multiplier Smart Download] ✅ Done: ${archiveName} (${(size / 1024 / 1024).toFixed(1)}MB), marked ${includedOutputIds.length} outputs as exported`);

    return NextResponse.json({
      status: "COMPLETED",
      downloadUrl,
      size,
      message: `${numAccounts} folders × ${vidsPerAccount} videos from ${groupIds.length} groups`,
      exportedCount: includedOutputIds.length,
    });
  } catch (err: any) {
    console.error("[Multiplier Smart Download] ❌ Error:", err);
    if (tempDir) { try { fs.rmSync(tempDir, { recursive: true }); } catch {} }
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 });
  }
}
