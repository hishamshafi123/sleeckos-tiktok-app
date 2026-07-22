export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { listFactoryTracks, upsertTrackFromLrclib } from "@/lib/services/factory";

/**
 * GET /api/factory/tracks — factory lyric tracks (lrcData present) with usage counts.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "composer"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const tracks = await listFactoryTracks();
    return NextResponse.json({ tracks });
  } catch (err: any) {
    console.error("[Factory Tracks GET] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to list tracks" }, { status: 500 });
  }
}

/**
 * POST /api/factory/tracks — store a lyric track assembled by the wizard.
 * The wizard does the fetching itself via the existing genres lyric-generator
 * endpoints (LRCLIB search → version pick → line-range trim → YouTube audio
 * download); this route only persists the result.
 * Body: { title, artist?, lrcLines: [{ t, text }], trimStart, trimEnd?,
 *         maxReuse?, audioRef }
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
    const body = await req.json();
    const track = await upsertTrackFromLrclib({
      title: body.title,
      artist: body.artist ?? null,
      lrcLines: Array.isArray(body.lrcLines) ? body.lrcLines : [],
      trimStart: Number(body.trimStart ?? 0),
      trimEnd: body.trimEnd === null || body.trimEnd === undefined ? null : Number(body.trimEnd),
      maxReuse: body.maxReuse === null || body.maxReuse === undefined ? null : Number(body.maxReuse),
      audioRef: body.audioRef,
      createdBy: session.userId,
    });
    return NextResponse.json({ track }, { status: 201 });
  } catch (err: any) {
    console.error("[Factory Tracks POST] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to save track" }, { status: 400 });
  }
}
