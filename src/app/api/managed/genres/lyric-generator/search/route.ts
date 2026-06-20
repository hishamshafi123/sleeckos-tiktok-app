export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { searchLrclib } from "@/lib/services/lyric-generator";
import { searchYouTubeAudio, getYouTubeVideoInfo } from "@/lib/services/audio-sourcer";

/**
 * POST /api/managed/genres/lyric-generator/search
 * 
 * Dual search: queries both YouTube (via yt-dlp) and LRCLIB simultaneously.
 * Body: { query: string, youtubeUrl?: string }
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
    const { query, youtubeUrl } = body;

    if (!query || typeof query !== "string" || !query.trim()) {
      return NextResponse.json({ error: "Search query is required" }, { status: 400 });
    }

    const trimmedQuery = query.trim();
    console.log(`[LyricGenerator] Dual search for: "${trimmedQuery}"`);

    // Run both searches in parallel
    const [lrclibResults, youtubeResults] = await Promise.allSettled([
      searchLrclib(trimmedQuery),
      youtubeUrl
        ? getYouTubeVideoInfo(youtubeUrl).then(r => [r])
        : searchYouTubeAudio(trimmedQuery, 5),
    ]);

    const lrclib = lrclibResults.status === "fulfilled" ? lrclibResults.value : [];
    const youtube = youtubeResults.status === "fulfilled" ? youtubeResults.value : [];

    if (lrclibResults.status === "rejected") {
      console.warn("[LyricGenerator] LRCLIB search failed:", lrclibResults.reason);
    }
    if (youtubeResults.status === "rejected") {
      console.warn("[LyricGenerator] YouTube search failed:", youtubeResults.reason);
    }

    return NextResponse.json({
      lrclib,
      youtube,
      errors: {
        lrclib: lrclibResults.status === "rejected" ? String(lrclibResults.reason) : null,
        youtube: youtubeResults.status === "rejected" ? String(youtubeResults.reason) : null,
      }
    });
  } catch (err: any) {
    console.error("[LyricGenerator] Search error:", err);
    return NextResponse.json({ error: err.message || "Search failed" }, { status: 500 });
  }
}
