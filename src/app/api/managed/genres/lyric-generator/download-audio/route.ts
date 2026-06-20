export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { downloadYouTubeAudio } from "@/lib/services/audio-sourcer";

/**
 * POST /api/managed/genres/lyric-generator/download-audio
 * 
 * Downloads audio from a YouTube video via yt-dlp, saves to disk.
 * Body: { videoId: string, title?: string, artist?: string }
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
    const { videoId } = body;

    if (!videoId || typeof videoId !== "string") {
      return NextResponse.json({ error: "videoId is required" }, { status: 400 });
    }

    console.log(`[LyricGenerator] Downloading audio for YouTube video: ${videoId}`);

    const result = await downloadYouTubeAudio(videoId);

    console.log(`[LyricGenerator] Audio downloaded: ${result.filePath} (${result.duration}s)`);

    return NextResponse.json({
      filePath: result.filePath,
      fileName: result.fileName,
      duration: result.duration,
    });
  } catch (err: any) {
    console.error("[LyricGenerator] Audio download error:", err);
    return NextResponse.json({ error: err.message || "Audio download failed" }, { status: 500 });
  }
}
