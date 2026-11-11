import prisma from "@/lib/db";
import fs from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { after, NextResponse } from "next/server";
import { clipSession, clipError } from "@/lib/services/content-clips/http";
import { createClip, queueClip } from "@/lib/services/content-clips/data";
import { mediaPath } from "@/lib/services/content-clips/media";
import { runClipJobs } from "@/lib/services/content-clips/worker";
import { MAX_BYTES } from "@/lib/content-clips/schema";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 1800;
export async function POST(request: Request) {
  let file: string | undefined;
  let createdId: string | undefined;
  try {
    const actor = await clipSession(request, true);
    const params = new URL(request.url).searchParams;
    if (
      !request.body ||
      Number(request.headers.get("content-length")) > MAX_BYTES
    )
      return NextResponse.json(
        { error: "Upload a video smaller than 500 MB." },
        { status: 413 },
      );
    const clip = await createClip(
      params.get("story") || "",
      params.get("name") || "Uploaded video",
      null,
      actor,
    );
    createdId = clip.id;
    await fs.promises.mkdir(mediaPath(clip.id), { recursive: true });
    const relative = `${clip.id}/upload.bin`;
    file = mediaPath(relative);
    let size = 0;
    const limit = new Transform({
      transform(chunk, _encoding, cb) {
        size += chunk.length;
        cb(
          size > MAX_BYTES
            ? new Error("Upload a video smaller than 500 MB.")
            : null,
          chunk,
        );
      },
    });
    await pipeline(
      Readable.fromWeb(request.body as never),
      limit,
      fs.createWriteStream(file),
      { signal: request.signal },
    );
    await queueClip(clip.id, "IMPORT", actor, { uploadPath: relative });
    file = undefined;
    createdId = undefined;
    after(async () => {
      await runClipJobs(2);
    });
    return NextResponse.json({ id: clip.id });
  } catch (e) {
    if (file) await fs.promises.rm(file, { force: true });
    if (createdId)
      await prisma.contentClip.deleteMany({ where: { id: createdId } });
    return clipError(e);
  }
}
