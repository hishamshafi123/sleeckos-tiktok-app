export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { uploadToR2 } from "@/lib/services/storage";

const ALLOWED_EXT = new Set([".mp3", ".wav", ".m4a", ".ogg"]);

/**
 * POST /api/factory/music-upload (multipart form, field `file`) — uploads a
 * background music bed for quote batches. Stores to
 * public/uploads/factory-audio/music_<uuid>.<ext> (+ R2 offload).
 * Returns: { audioRef } — pass it as musicAudioRef when creating the batch.
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
    if (!file) return NextResponse.json({ error: "file is required" }, { status: 400 });

    const ext = path.extname(file.name || "").toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      return NextResponse.json({ error: `Unsupported audio type "${ext || "?"}" — use mp3, wav, m4a or ogg` }, { status: 400 });
    }

    const uploadDir = path.join(process.cwd(), "public", "uploads", "factory-audio");
    fs.mkdirSync(uploadDir, { recursive: true });
    const fileName = `music_${randomUUID()}${ext}`;
    const absPath = path.join(uploadDir, fileName);
    fs.writeFileSync(absPath, Buffer.from(await file.arrayBuffer()));

    try {
      await uploadToR2(absPath, `uploads/factory-audio/${fileName}`);
    } catch (r2Err) {
      console.warn("[Factory Music Upload] R2 offload failed (local copy kept):", r2Err);
    }

    return NextResponse.json({ audioRef: `/uploads/factory-audio/${fileName}` }, { status: 201 });
  } catch (err: any) {
    console.error("[Factory Music Upload] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to upload music" }, { status: 400 });
  }
}
