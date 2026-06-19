import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { getR2SignedUrl, isR2Configured } from "@/lib/services/storage";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: pathSegments } = await params;
    if (!pathSegments || pathSegments.length === 0) {
      return new NextResponse("Not Found", { status: 404 });
    }

    // Resolve the absolute path to ensure no directory traversal
    const safePath = pathSegments.join(path.sep);
    const absolutePath = path.join(process.cwd(), "public", "uploads", safePath);

    // Basic security check: verify that the resolved path is inside "public/uploads"
    const uploadsDir = path.join(process.cwd(), "public", "uploads");
    if (!absolutePath.startsWith(uploadsDir)) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    if (!fs.existsSync(absolutePath)) {
      if (isR2Configured()) {
        const r2Key = `uploads/${pathSegments.join("/")}`;
        console.log(`[Uploads serve handler] Local file missing, checking R2 key: ${r2Key}`);
        const signedUrl = await getR2SignedUrl(r2Key);
        if (signedUrl) {
          console.log(`[Uploads serve handler] Redirecting to R2 signed URL: ${signedUrl.substring(0, 100)}...`);
          return NextResponse.redirect(signedUrl, { status: 307 });
        }
      }
      return new NextResponse("Not Found", { status: 404 });
    }

    const stat = fs.statSync(absolutePath);
    const fileSize = stat.size;

    // Detect Content-Type
    const ext = path.extname(absolutePath).toLowerCase();
    let contentType = "application/octet-stream";
    if (ext === ".mp4") contentType = "video/mp4";
    else if (ext === ".webm") contentType = "video/webm";
    else if (ext === ".mp3") contentType = "audio/mpeg";
    else if (ext === ".wav") contentType = "audio/wav";
    else if (ext === ".ogg") contentType = "audio/ogg";
    else if (ext === ".png") contentType = "image/png";
    else if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
    else if (ext === ".gif") contentType = "image/gif";

    // Handle range requests for video seeking/loading
    const range = req.headers.get("range");
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize) {
        return new NextResponse("Requested Range Not Satisfiable", {
          status: 416,
          headers: { "Content-Range": `bytes */${fileSize}` },
        });
      }

      const chunksize = end - start + 1;
      const fileStream = fs.createReadStream(absolutePath, { start, end });
      const webStream = Readable.toWeb(fileStream);

      return new NextResponse(webStream as any, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunksize.toString(),
          "Content-Type": contentType,
          "Cache-Control": "no-cache",
        },
      });
    }

    const fileStream = fs.createReadStream(absolutePath);
    const webStream = Readable.toWeb(fileStream);

    return new NextResponse(webStream as any, {
      status: 200,
      headers: {
        "Content-Length": fileSize.toString(),
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=31536000",
      },
    });
  } catch (err) {
    console.error("[Uploads API Route Error]:", err);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
