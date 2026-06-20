export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { trimAudio } from "@/lib/services/audio-sourcer";

/**
 * POST /api/managed/genres/lyric-generator/trim-audio
 * 
 * Trims an audio file to a specific time range using FFmpeg.
 * Body: { audioFileUrl: string, startTime: number, endTime: number }
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
    const { audioFileUrl, startTime, endTime } = body;

    if (!audioFileUrl) {
      return NextResponse.json({ error: "audioFileUrl is required" }, { status: 400 });
    }
    if (startTime === undefined || endTime === undefined) {
      return NextResponse.json({ error: "startTime and endTime are required" }, { status: 400 });
    }

    console.log(`[LyricGenerator] Trimming audio: ${audioFileUrl} [${startTime}s → ${endTime}s]`);

    const result = await trimAudio(audioFileUrl, startTime, endTime);

    console.log(`[LyricGenerator] Audio trimmed: ${result.filePath} (${result.duration}s)`);

    return NextResponse.json({
      filePath: result.filePath,
      fileName: result.fileName,
      duration: result.duration,
    });
  } catch (err: any) {
    console.error("[LyricGenerator] Trim error:", err);
    return NextResponse.json({ error: err.message || "Audio trim failed" }, { status: 500 });
  }
}
