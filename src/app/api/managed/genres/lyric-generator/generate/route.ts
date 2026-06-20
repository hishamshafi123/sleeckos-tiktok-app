export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import prisma from "@/lib/db";
import {
  parseLrc,
  selectLineRange,
  createLyricGeneration,
} from "@/lib/services/lyric-generator";
import { trimAudio } from "@/lib/services/audio-sourcer";

/**
 * POST /api/managed/genres/lyric-generator/generate
 * 
 * Final generation step. Takes synced lyrics + line range + audio,
 * trims audio, creates Track with lyricalTranscription, saves history.
 * 
 * Body: {
 *   syncedLyrics: string,       // Raw .lrc text (from LRCLIB or manual paste)
 *   startLine: number,          // 0-indexed start line
 *   endLine: number,            // 0-indexed end line
 *   audioFileUrl: string,       // Path to downloaded/uploaded audio
 *   title: string,
 *   artist: string,
 *   songQuery: string,
 *   lrclibId?: number,
 *   youtubeVideoId?: string,
 *   sourceType?: string,        // "lrclib" | "manual_lrc"
 * }
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
    const {
      syncedLyrics,
      startLine,
      endLine,
      audioFileUrl,
      title,
      artist,
      songQuery,
      lrclibId,
      youtubeVideoId,
      sourceType,
    } = body;

    // Validate required fields
    if (!syncedLyrics || typeof syncedLyrics !== "string") {
      return NextResponse.json({ error: "syncedLyrics is required" }, { status: 400 });
    }
    if (startLine === undefined || endLine === undefined) {
      return NextResponse.json({ error: "startLine and endLine are required" }, { status: 400 });
    }
    if (!audioFileUrl) {
      return NextResponse.json({ error: "audioFileUrl is required" }, { status: 400 });
    }
    if (!title || !artist) {
      return NextResponse.json({ error: "title and artist are required" }, { status: 400 });
    }

    console.log(`[LyricGenerator] Generating: "${title}" by ${artist}, lines ${startLine}-${endLine}`);

    // 1. Parse LRC and select line range
    const allLines = parseLrc(syncedLyrics);
    const rangeResult = selectLineRange(allLines, startLine, endLine);

    if (rangeResult.selectedLines.length === 0) {
      return NextResponse.json({ error: "No lines in the selected range" }, { status: 400 });
    }

    // 2. Trim audio to the line range
    let trimmedAudioUrl = audioFileUrl;
    let trackDuration = rangeResult.clipDuration;

    try {
      const trimResult = await trimAudio(
        audioFileUrl,
        rangeResult.startTime,
        rangeResult.endTime
      );
      trimmedAudioUrl = trimResult.filePath;
      trackDuration = trimResult.duration;
      console.log(`[LyricGenerator] Audio trimmed: ${trimResult.filePath} (${trimResult.duration}s)`);
    } catch (trimErr: any) {
      console.warn("[LyricGenerator] Audio trim failed, using full file:", trimErr.message);
      // Continue with the full audio — user can re-trim later
    }

    // 3. Create Track record with lyricalTranscription
    const timedWordsJson = JSON.stringify(rangeResult.timedWords);
    
    const track = await prisma.track.create({
      data: {
        title: title.trim(),
        artist: artist.trim(),
        fileUrl: trimmedAudioUrl,
        duration: trackDuration,
        defaultStart: 0,
        defaultDuration: trackDuration,
        isLyrical: true,
        lyricalTranscription: timedWordsJson,
      },
    });

    console.log(`[LyricGenerator] Track created: ${track.id}`);

    // 4. Save LyricGeneration history record
    const generation = await createLyricGeneration({
      songQuery: songQuery || `${title} - ${artist}`,
      artistName: artist,
      trackName: title,
      lrclibId: lrclibId || undefined,
      youtubeVideoId: youtubeVideoId || undefined,
      syncedLyrics,
      startLine,
      endLine,
      startTime: rangeResult.startTime,
      endTime: rangeResult.endTime,
      timedWords: timedWordsJson,
      audioFileUrl: trimmedAudioUrl,
      trackId: track.id,
      sourceType: sourceType || "lrclib",
      createdById: session.userId,
    });

    console.log(`[LyricGenerator] Generation saved: ${generation.id}`);

    return NextResponse.json({
      track,
      generation,
      lineRange: {
        startTime: rangeResult.startTime,
        endTime: rangeResult.endTime,
        clipDuration: rangeResult.clipDuration,
        lineCount: rangeResult.selectedLines.length,
        wordCount: rangeResult.timedWords.length,
      },
    });
  } catch (err: any) {
    console.error("[LyricGenerator] Generate error:", err);
    return NextResponse.json({ error: err.message || "Generation failed" }, { status: 500 });
  }
}
