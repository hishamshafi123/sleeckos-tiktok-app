export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";

interface LrcLine {
  text: string;
  start: number;
  end: number;
}

interface WordTime {
  word: string;
  start: number;
  end: number;
}

// Simple parser for LRC formatted text [mm:ss.xx]
function parseLrc(lrcText: string): LrcLine[] {
  if (!lrcText) return [];
  const lines = lrcText.split("\n");
  const parsedLines: LrcLine[] = [];
  const timeRegex = /\[(\d+):(\d+(?:\.\d+)?)]/;

  for (const line of lines) {
    const match = timeRegex.exec(line);
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseFloat(match[2]);
      const timestamp = minutes * 60 + seconds;
      const text = line.replace(timeRegex, "").trim();

      parsedLines.push({ text, start: timestamp, end: 0 });
    }
  }

  // Sort by start time
  parsedLines.sort((a, b) => a.start - b.start);

  // Compute end time of each line
  for (let i = 0; i < parsedLines.length; i++) {
    if (i < parsedLines.length - 1) {
      parsedLines[i].end = parsedLines[i + 1].start;
    } else {
      parsedLines[i].end = parsedLines[i].start + 4.0; // default last line duration
    }
  }

  return parsedLines;
}

// Convert line timestamps to word-level proportional timestamps
function convertLinesToWords(lines: LrcLine[]): WordTime[] {
  const words: WordTime[] = [];

  for (const line of lines) {
    const lineWords = line.text.split(/\s+/).filter(Boolean);
    if (lineWords.length === 0) continue;

    const duration = line.end - line.start;
    const wordDuration = Math.max(0.1, duration / lineWords.length);

    for (let i = 0; i < lineWords.length; i++) {
      words.push({
        word: lineWords[i],
        start: Number((line.start + i * wordDuration).toFixed(3)),
        end: Number((line.start + (i + 1) * wordDuration).toFixed(3)),
      });
    }
  }

  return words;
}

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
