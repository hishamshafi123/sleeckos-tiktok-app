export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { parseLrc } from "@/lib/services/lyric-generator";
import { createFactoryTrackFromUpload } from "@/lib/services/factory";
import { uploadToR2 } from "@/lib/services/storage";

const ALLOWED_EXT = new Set([".mp3", ".wav", ".m4a", ".ogg"]);

/**
 * POST /api/factory/tracks/upload (multipart form) — direct audio upload for a
 * factory lyric track.
 * Fields: file (mp3/wav/m4a/ogg), title, artist?, lrcText?, trimStart?,
 *         trimEnd?, maxReuse?
 * Stores to public/uploads/factory-audio/track_<uuid>.<ext> (+ R2 offload) and
 * creates the Track: with lrcText the .lrc is parsed (same parser as the
 * genres lyric flow) into lrcData; without it the track is lyric-less and the
 * worker transcribes it once at render time (stable-ts).
 * Returns: { track }
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "composer"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const title = (formData.get("title") as string | null)?.trim();
    const artist = (formData.get("artist") as string | null)?.trim() || null;
    const lrcText = (formData.get("lrcText") as string | null) ?? "";
    const trimStartRaw = formData.get("trimStart") as string | null;
    const trimEndRaw = formData.get("trimEnd") as string | null;
    const maxReuseRaw = formData.get("maxReuse") as string | null;

    if (!file) return NextResponse.json({ error: "file is required" }, { status: 400 });
    if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });

    const ext = path.extname(file.name || "").toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      return NextResponse.json({ error: `Unsupported audio type "${ext || "?"}" — use mp3, wav, m4a or ogg` }, { status: 400 });
    }

    const uploadDir = path.join(process.cwd(), "public", "uploads", "factory-audio");
    fs.mkdirSync(uploadDir, { recursive: true });
    const fileName = `track_${randomUUID()}${ext}`;
    const absPath = path.join(uploadDir, fileName);
    fs.writeFileSync(absPath, Buffer.from(await file.arrayBuffer()));
    const audioRef = `/uploads/factory-audio/${fileName}`;
    try {
      await uploadToR2(absPath, `uploads/factory-audio/${fileName}`);
    } catch (r2Err) {
      console.warn("[Factory Track Upload] R2 offload failed (local copy kept):", r2Err);
    }

    // Parse the pasted .lrc with the same parser the genres lyric flow uses.
    const lrcLines = lrcText.trim()
      ? parseLrc(lrcText).map((l) => ({ t: l.start, text: l.text }))
      : null;

    const track = await createFactoryTrackFromUpload({
      title,
      artist,
      audioRef,
      lrcLines,
      trimStart: trimStartRaw !== null && trimStartRaw !== "" ? Number(trimStartRaw) : null,
      trimEnd: trimEndRaw !== null && trimEndRaw !== "" ? Number(trimEndRaw) : null,
      maxReuse: maxReuseRaw !== null && maxReuseRaw !== "" ? Number(maxReuseRaw) : null,
      createdBy: session.userId,
    });

    return NextResponse.json({ track }, { status: 201 });
  } catch (err: any) {
    console.error("[Factory Track Upload] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to upload track" }, { status: 400 });
  }
}
