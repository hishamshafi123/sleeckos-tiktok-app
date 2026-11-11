import fs from "node:fs";
import { Readable } from "node:stream";
import prisma from "@/lib/db";
import { clipAccess } from "@/lib/services/content-clips/data";
import { clipSession, clipError } from "@/lib/services/content-clips/http";
import { mediaPath, byteRange } from "@/lib/services/content-clips/media";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const actor = await clipSession(request);
    const params = new URL(request.url).searchParams;
    const clip = await clipAccess(params.get("id") || "", actor);
    const jobId = params.get("export");
    const job = jobId
      ? await prisma.contentClipJob.findFirst({
          where: {
            id: jobId,
            clipId: clip.id,
            kind: "RENDER",
            status: "COMPLETED",
          },
        })
      : null;
    const relative = jobId ? job?.outputPath : clip.sourcePath;
    if (!relative)
      return Response.json(
        { error: "This video is not ready to download yet." },
        { status: 404 },
      );
    const file = mediaPath(relative);
    const size = (await fs.promises.stat(file)).size;
    const range = byteRange(request.headers.get("range"), size);
    if (!range)
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    const stream = fs.createReadStream(file, {
      start: range.start,
      end: range.end,
    });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: range.partial ? 206 : 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(range.end - range.start + 1),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        ...(range.partial
          ? { "Content-Range": `bytes ${range.start}-${range.end}/${size}` }
          : {}),
        ...(params.has("download")
          ? {
              "Content-Disposition": `attachment; filename="${jobId ? "news-clip" : "source"}-${clip.id.slice(0, 8)}.mp4"`,
            }
          : {}),
      },
    });
  } catch (e) {
    return clipError(e);
  }
}
