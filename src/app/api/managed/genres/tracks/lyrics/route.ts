export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { parseLrc, convertLinesToWords } from "@/lib/services/lyric-generator";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "composer"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q");

  if (!query || !query.trim()) {
    return NextResponse.json({ error: "Query parameter 'q' is required" }, { status: 400 });
  }

  try {
    console.log(`[LRCLIB API] Querying synced lyrics for: "${query}"`);
    const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(query.trim())}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
    
    const res = await fetch(searchUrl, {
      headers: {
        "User-Agent": "SleeckOS-LyricalFetcher/1.0 (https://github.com/hishamshafi/sleeckos-tiktok-app)"
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.error(`[LRCLIB API] lrclib.net returned status ${res.status}`);
      return NextResponse.json({ error: `LRCLIB API returned HTTP ${res.status}` }, { status: res.status });
    }

    const matches = await res.json();
    if (!Array.isArray(matches)) {
      return NextResponse.json([]);
    }

    // Process and enrich matches with parsed lines and word arrays
    const enriched = matches.map((match: any) => {
      const parsedLines = parseLrc(match.syncedLyrics || "");
      const words = convertLinesToWords(parsedLines);
      
      return {
        id: match.id,
        trackName: match.trackName,
        artistName: match.artistName,
        albumName: match.albumName,
        duration: match.duration,
        plainLyrics: match.plainLyrics || "",
        syncedLyrics: match.syncedLyrics || "",
        parsedLines,
        words
      };
    });

    return NextResponse.json(enriched);
  } catch (err: any) {
    console.error("[LRCLIB API] Error querying lyrics:", err);
    return NextResponse.json({ error: err.message || "Failed to search synced lyrics from LRCLIB" }, { status: 500 });
  }
}
