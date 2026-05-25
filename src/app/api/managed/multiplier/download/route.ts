export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import fs from "fs";
import path from "path";
import { exec } from "child_process";

// GET /api/managed/multiplier/download?batchId=... — Download all rendered videos as a tar.gz archive
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
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    const renderedItems = batch.items.filter((i) => i.renderedVideoUrl);
    if (renderedItems.length === 0) {
      return NextResponse.json({ error: "No rendered videos available for download" }, { status: 400 });
    }

    // Collect file paths
    const publicDir = path.join(process.cwd(), "public");
    const filePaths: { absPath: string; name: string }[] = [];

    for (let i = 0; i < renderedItems.length; i++) {
      const item = renderedItems[i];
      const absPath = path.join(publicDir, item.renderedVideoUrl!);
      if (fs.existsSync(absPath)) {
        // Name with a clean index and sanitized hook text
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
      return NextResponse.json({ error: "Rendered video files not found on disk" }, { status: 400 });
    }

    // Create a temp directory with clean-named copies for archiving
    const tempDir = path.join(process.cwd(), "public", "uploads", "multiplier", "temp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const batchLabel = batch.name || batchId.substring(0, 8);
    const linkDir = path.join(tempDir, `dl_${batchId.substring(0, 8)}`);
    if (fs.existsSync(linkDir)) {
      fs.rmSync(linkDir, { recursive: true });
    }
    fs.mkdirSync(linkDir, { recursive: true });

    for (const fp of filePaths) {
      const dest = path.join(linkDir, fp.name);
      fs.copyFileSync(fp.absPath, dest);
    }

    // Use tar (available on Alpine Linux) instead of zip (not installed)
    const archiveName = `multiplier_${batchLabel.replace(/[^a-zA-Z0-9_-]/g, "_")}_${Date.now()}.tar.gz`;
    const archivePath = path.join(tempDir, archiveName);

    await new Promise<void>((resolve, reject) => {
      exec(
        `tar -czf "${archivePath}" -C "${linkDir}" .`,
        { maxBuffer: 100 * 1024 * 1024 },
        (error, _stdout, stderr) => {
          // Clean up link directory
          try { fs.rmSync(linkDir, { recursive: true }); } catch {}
          if (error) {
            console.error("[Multiplier Download] tar failed:", stderr);
            reject(error);
          } else {
            resolve();
          }
        }
      );
    });

    if (!fs.existsSync(archivePath)) {
      return NextResponse.json({ error: "Failed to create archive" }, { status: 500 });
    }

    // Stream the archive as response using lightweight chunks to prevent OOM / 502 crashes
    const fileStream = fs.createReadStream(archivePath);
    const size = fs.statSync(archivePath).size;

    const readableWebStream = new ReadableStream({
      start(controller) {
        fileStream.on("data", (chunk) => controller.enqueue(chunk));
        fileStream.on("end", () => {
          controller.close();
          try { fs.unlinkSync(archivePath); } catch {}
        });
        fileStream.on("error", (err) => {
          controller.error(err);
          try { fs.unlinkSync(archivePath); } catch {}
        });
      },
      cancel() {
        fileStream.destroy();
        try { fs.unlinkSync(archivePath); } catch {}
      }
    });

    return new NextResponse(readableWebStream, {
      status: 200,
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${archiveName}"`,
        "Content-Length": size.toString(),
      },
    });
  } catch (err) {
    console.error("[Multiplier Download API] Error:", err);
    return NextResponse.json({ error: "Failed to generate download" }, { status: 500 });
  }
}
