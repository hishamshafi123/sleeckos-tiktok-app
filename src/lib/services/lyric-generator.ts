/**
 * Lyric Generator Service
 * 
 * Core logic for searching LRCLIB synced lyrics, parsing LRC format,
 * selecting line ranges, and managing LyricGeneration history records.
 */

import prisma from "@/lib/db";

// ── Types ────────────────────────────────────────────────────────────────────

export interface LrcLine {
  text: string;
  start: number;
  end: number;
  index: number;
}

export interface WordTime {
  word: string;
  start: number;
  end: number;
}

export interface LrclibSearchResult {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  plainLyrics: string;
  syncedLyrics: string;
  parsedLines: LrcLine[];
  words: WordTime[];
}

export interface LineRangeResult {
  startTime: number;
  endTime: number;
  selectedLines: LrcLine[];
  timedWords: WordTime[];
  clipDuration: number;
}

// ── LRC Parsing ──────────────────────────────────────────────────────────────

/**
 * Parse raw LRC text → array of timed lines.
 * Format: [mm:ss.xx] Lyric text here
 */
export function parseLrc(lrcText: string): LrcLine[] {
  if (!lrcText) return [];
  const rawLines = lrcText.split("\n");
  const parsedLines: LrcLine[] = [];
  const timeRegex = /\[(\d+):(\d+(?:\.\d+)?)]/;
  let idx = 0;

  for (const line of rawLines) {
    const match = timeRegex.exec(line);
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseFloat(match[2]);
      const timestamp = minutes * 60 + seconds;
      const text = line.replace(timeRegex, "").trim();

      parsedLines.push({ text, start: timestamp, end: 0, index: idx++ });
    }
  }

  // Sort by start time
  parsedLines.sort((a, b) => a.start - b.start);

  // Reindex after sort
  parsedLines.forEach((l, i) => { l.index = i; });

  // Compute end time of each line
  for (let i = 0; i < parsedLines.length; i++) {
    if (i < parsedLines.length - 1) {
      parsedLines[i].end = parsedLines[i + 1].start;
    } else {
      parsedLines[i].end = parsedLines[i].start + 4.0;
    }
  }

  return parsedLines;
}

/**
 * Convert line-level timestamps to word-level proportional timestamps.
 */
export function convertLinesToWords(lines: LrcLine[]): WordTime[] {
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

// ── Line Range Selection ─────────────────────────────────────────────────────

/**
 * Select a range of lines by index, derive start/end timestamps and word timing.
 * This is the key feature: click start line + end line → auto-derive clip timestamps.
 */
export function selectLineRange(
  allLines: LrcLine[],
  startLineIdx: number,
  endLineIdx: number
): LineRangeResult {
  const start = Math.max(0, Math.min(startLineIdx, allLines.length - 1));
  const end = Math.max(start, Math.min(endLineIdx, allLines.length - 1));

  const selectedLines = allLines.slice(start, end + 1);
  if (selectedLines.length === 0) {
    return { startTime: 0, endTime: 0, selectedLines: [], timedWords: [], clipDuration: 0 };
  }

  const startTime = selectedLines[0].start;
  const endTime = selectedLines[selectedLines.length - 1].end;

  // Generate word-level timing for the selected range, offset to 0
  const timedWords = convertLinesToWords(selectedLines).map(w => ({
    word: w.word,
    start: Number((w.start - startTime).toFixed(3)),
    end: Number((w.end - startTime).toFixed(3)),
  }));

  return {
    startTime,
    endTime,
    selectedLines,
    timedWords,
    clipDuration: Number((endTime - startTime).toFixed(3)),
  };
}

// ── LRCLIB Search ────────────────────────────────────────────────────────────

/**
 * Search LRCLIB for synced lyrics matching a query.
 */
export async function searchLrclib(query: string): Promise<LrclibSearchResult[]> {
  const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(query.trim())}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  const res = await fetch(searchUrl, {
    headers: {
      "User-Agent": "SleeckOS-LyricGenerator/1.0 (https://sleeckos.com)"
    },
    signal: controller.signal
  });

  clearTimeout(timeoutId);

  if (!res.ok) {
    throw new Error(`LRCLIB API returned HTTP ${res.status}`);
  }

  const matches = await res.json();
  if (!Array.isArray(matches)) {
    return [];
  }

  // Enrich results with parsed lines (only those with synced lyrics)
  return matches
    .filter((m: any) => m.syncedLyrics)
    .map((match: any) => {
      const parsedLines = parseLrc(match.syncedLyrics || "");
      const words = convertLinesToWords(parsedLines);

      return {
        id: match.id,
        trackName: match.trackName || match.name || "",
        artistName: match.artistName || "",
        albumName: match.albumName || "",
        duration: match.duration || 0,
        plainLyrics: match.plainLyrics || "",
        syncedLyrics: match.syncedLyrics || "",
        parsedLines,
        words,
      };
    });
}

// ── DB Operations ────────────────────────────────────────────────────────────

/**
 * Create a LyricGeneration history record.
 */
export async function createLyricGeneration(data: {
  songQuery: string;
  artistName?: string;
  trackName?: string;
  lrclibId?: number;
  youtubeVideoId?: string;
  syncedLyrics?: string;
  startLine: number;
  endLine: number;
  startTime: number;
  endTime: number;
  timedWords?: string;
  audioFileUrl?: string;
  trackId?: string;
  sourceType?: string;
  createdById?: string;
}) {
  return prisma.lyricGeneration.create({
    data: {
      songQuery: data.songQuery,
      artistName: data.artistName,
      trackName: data.trackName,
      lrclibId: data.lrclibId,
      youtubeVideoId: data.youtubeVideoId,
      syncedLyrics: data.syncedLyrics,
      startLine: data.startLine,
      endLine: data.endLine,
      startTime: data.startTime,
      endTime: data.endTime,
      timedWords: data.timedWords,
      audioFileUrl: data.audioFileUrl,
      trackId: data.trackId,
      sourceType: data.sourceType || "lrclib",
      createdById: data.createdById,
    }
  });
}

/**
 * List all LyricGeneration records, most recent first.
 */
export async function getLyricGenerations(limit = 50) {
  return prisma.lyricGeneration.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      track: {
        select: { id: true, title: true, artist: true, fileUrl: true }
      }
    }
  });
}

/**
 * Format seconds to mm:ss display.
 */
export function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 100);
  return `${mins}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}
