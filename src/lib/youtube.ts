/**
 * YouTube Data API v3 helpers for video sourcing.
 *
 * Functions:
 * - parseYouTubeUrl: Extract channel/playlist ID from a pasted URL
 * - resolveChannel: Get channel metadata from the YouTube API
 * - resolvePlaylist: Get playlist metadata from the YouTube API
 * - fetchTopVideos: Fetch top videos from a channel (by views, last 48h)
 * - fetchPlaylistVideos: Fetch latest videos from a playlist
 * - getVideoDetails: Get stats + duration for a batch of video IDs
 */

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

function getApiKey(): string {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YOUTUBE_API_KEY is not set");
  return key;
}

// ── URL Parsing ─────────────────────────────────────────────────────────────

export type ParsedYouTubeUrl =
  | { type: "CHANNEL"; id: string; handle?: string }
  | { type: "PLAYLIST"; id: string }
  | null;

export function parseYouTubeUrl(url: string): ParsedYouTubeUrl {
  try {
    const u = new URL(url.trim());

    // Playlist: youtube.com/playlist?list=PLxxxxxx
    const listParam = u.searchParams.get("list");
    if (listParam && u.pathname.includes("playlist")) {
      return { type: "PLAYLIST", id: listParam };
    }

    // Channel handle: youtube.com/@handle
    const handleMatch = u.pathname.match(/^\/@([a-zA-Z0-9_.-]+)/);
    if (handleMatch) {
      return { type: "CHANNEL", id: "", handle: handleMatch[1] };
    }

    // Channel ID: youtube.com/channel/UCxxxxxx
    const channelMatch = u.pathname.match(/^\/channel\/(UC[a-zA-Z0-9_-]+)/);
    if (channelMatch) {
      return { type: "CHANNEL", id: channelMatch[1] };
    }

    // Legacy: youtube.com/c/ChannelName or youtube.com/user/Username
    const legacyMatch = u.pathname.match(/^\/(c|user)\/([a-zA-Z0-9_.-]+)/);
    if (legacyMatch) {
      return { type: "CHANNEL", id: "", handle: legacyMatch[2] };
    }

    return null;
  } catch {
    return null;
  }
}

// ── YouTube API calls ───────────────────────────────────────────────────────

async function ytFetch(endpoint: string, params: Record<string, string>) {
  const qs = new URLSearchParams({ ...params, key: getApiKey() });
  const res = await fetch(`${YOUTUBE_API_BASE}/${endpoint}?${qs}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API error (${res.status}): ${body}`);
  }
  return res.json();
}

export type ChannelInfo = {
  id: string;
  title: string;
  thumbnailUrl: string;
  subscriberCount: number;
  videoCount: number;
};

export async function resolveChannel(
  parsed: Extract<ParsedYouTubeUrl, { type: "CHANNEL" }>
): Promise<ChannelInfo> {
  let data;

  if (parsed.handle) {
    // Resolve by handle/username
    data = await ytFetch("channels", {
      part: "snippet,statistics",
      forHandle: parsed.handle,
    });
    if (!data.items?.length) {
      // Try forUsername as fallback
      data = await ytFetch("channels", {
        part: "snippet,statistics",
        forUsername: parsed.handle,
      });
    }
  } else {
    data = await ytFetch("channels", {
      part: "snippet,statistics",
      id: parsed.id,
    });
  }

  if (!data.items?.length) {
    throw new Error("Channel not found");
  }

  const ch = data.items[0];
  return {
    id: ch.id,
    title: ch.snippet.title,
    thumbnailUrl:
      ch.snippet.thumbnails?.medium?.url || ch.snippet.thumbnails?.default?.url || "",
    subscriberCount: parseInt(ch.statistics.subscriberCount || "0", 10),
    videoCount: parseInt(ch.statistics.videoCount || "0", 10),
  };
}

export type PlaylistInfo = {
  id: string;
  title: string;
  thumbnailUrl: string;
  itemCount: number;
  channelTitle: string;
};

export async function resolvePlaylist(playlistId: string): Promise<PlaylistInfo> {
  const data = await ytFetch("playlists", {
    part: "snippet,contentDetails",
    id: playlistId,
  });

  if (!data.items?.length) {
    throw new Error("Playlist not found");
  }

  const pl = data.items[0];
  return {
    id: pl.id,
    title: pl.snippet.title,
    thumbnailUrl:
      pl.snippet.thumbnails?.medium?.url || pl.snippet.thumbnails?.default?.url || "",
    itemCount: pl.contentDetails.itemCount || 0,
    channelTitle: pl.snippet.channelTitle || "",
  };
}

// ── Fetch Videos ────────────────────────────────────────────────────────────

export type VideoBasic = {
  videoId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  channelTitle: string;
  publishedAt: string;
};

/**
 * Fetch latest videos from a channel, sorted by date (most recent first).
 * Optimizes quota usage by fetching from the channel's uploads playlist (UU...)
 * which costs 1 quota unit, instead of using search.list which costs 100 quota units.
 */
export async function fetchLatestChannelVideos(
  channelId: string,
  maxResults: number = 10
): Promise<VideoBasic[]> {
  // Most YouTube channels start with 'UC'. Replacing 'UC' with 'UU' gives the uploads playlist ID.
  if (channelId.startsWith("UC")) {
    const uploadsPlaylistId = "UU" + channelId.substring(2);
    try {
      return await fetchPlaylistVideos(uploadsPlaylistId, maxResults);
    } catch (err) {
      console.warn("Failed to fetch uploads playlist, falling back to search", err);
    }
  }

  // Fallback to search.list (100 quota units) if channel ID is not standard
  const data = await ytFetch("search", {
    part: "snippet",
    channelId,
    type: "video",
    order: "date",
    maxResults: String(maxResults),
  });

  return (data.items || []).map((item: any) => ({
    videoId: item.id.videoId,
    title: item.snippet.title,
    description: item.snippet.description || "",
    thumbnailUrl:
      item.snippet.thumbnails?.high?.url ||
      item.snippet.thumbnails?.medium?.url ||
      "",
    channelTitle: item.snippet.channelTitle,
    publishedAt: item.snippet.publishedAt,
  }));
}

/**
 * Fetch latest videos from a playlist.
 * Uses playlistItems.list (1 quota unit per call).
 */
export async function fetchPlaylistVideos(
  playlistId: string,
  maxResults: number = 20
): Promise<VideoBasic[]> {
  const data = await ytFetch("playlistItems", {
    part: "snippet",
    playlistId,
    maxResults: String(maxResults),
  });

  return (data.items || [])
    .filter((item: any) => item.snippet.resourceId?.kind === "youtube#video")
    .map((item: any) => ({
      videoId: item.snippet.resourceId.videoId,
      title: item.snippet.title,
      description: item.snippet.description || "",
      thumbnailUrl:
        item.snippet.thumbnails?.high?.url ||
        item.snippet.thumbnails?.medium?.url ||
        "",
      channelTitle: item.snippet.channelTitle || "",
      publishedAt: item.snippet.publishedAt,
    }));
}

// ── Video Details (stats + duration) ────────────────────────────────────────

export type VideoDetails = {
  videoId: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  duration: string; // ISO 8601 e.g. "PT10M30S"
};

/**
 * Get statistics and duration for a batch of video IDs (max 50).
 * Uses videos.list (1 quota unit per call).
 */
export async function getVideoDetails(
  videoIds: string[]
): Promise<VideoDetails[]> {
  if (videoIds.length === 0) return [];

  // YouTube allows max 50 IDs per call
  const chunks: string[][] = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    chunks.push(videoIds.slice(i, i + 50));
  }

  const results: VideoDetails[] = [];
  for (const chunk of chunks) {
    const data = await ytFetch("videos", {
      part: "statistics,contentDetails",
      id: chunk.join(","),
    });

    for (const item of data.items || []) {
      results.push({
        videoId: item.id,
        viewCount: parseInt(item.statistics?.viewCount || "0", 10),
        likeCount: parseInt(item.statistics?.likeCount || "0", 10),
        commentCount: parseInt(item.statistics?.commentCount || "0", 10),
        duration: item.contentDetails?.duration || "PT0S",
      });
    }
  }

  return results;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse ISO 8601 duration (e.g. "PT10M30S") to human readable format.
 */
export function formatDuration(iso: string): string {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return iso;
  const h = parseInt(match[1] || "0", 10);
  const m = parseInt(match[2] || "0", 10);
  const s = parseInt(match[3] || "0", 10);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Parse ISO 8601 duration to total seconds.
 */
export function durationToSeconds(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return (
    parseInt(match[1] || "0", 10) * 3600 +
    parseInt(match[2] || "0", 10) * 60 +
    parseInt(match[3] || "0", 10)
  );
}

export function youtubeVideoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function youtubeChannelUrl(channelId: string): string {
  return `https://www.youtube.com/channel/${channelId}`;
}

/**
 * Clean standard stopwords out of text search contexts.
 */
export const STOPWORDS = new Set([
  "the", "and", "a", "of", "to", "in", "is", "that", "it", "on", "for", "with",
  "as", "at", "by", "an", "this", "about", "are", "be", "or", "from", "your", "my",
  "how", "video", "youtube", "channel", "playlist", "videos", "like", "so", "just"
]);

/**
 * Offline fallback heuristic-based summarizer.
 * Cleans descriptions of links, hashtags, socials, and emojis, then returns the first substantial sentence.
 */
export function generateHeuristicSummary(title: string, description: string): string {
  const cleanTitle = title.trim();
  let desc = description || "";

  // 1. Remove URLs
  desc = desc.replace(/https?:\/\/[^\s]+/g, "");
  // 2. Remove standard marketing / social call-to-actions
  desc = desc.replace(/(subscribe|follow|instagram|twitter|facebook|tiktok|email|business|coaching|course|patreon|support|donate|links|website)/gi, "");
  // 3. Remove hashtags
  desc = desc.replace(/#[a-zA-Z0-9_]+/g, "");
  // 4. Remove standard emojis
  desc = desc.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\uDFFF]/g, "");
  // 5. Clean whitespace
  desc = desc.replace(/\s+/g, " ").trim();

  if (!desc) {
    return `Overview of "${cleanTitle}" video content.`;
  }

  // 6. Extract the first substantial sentence
  const sentences = desc.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);
  if (sentences.length > 0) {
    const summarySentences = sentences[0] + ".";
    return summarySentences.substring(0, 140) + (summarySentences.length > 140 ? "..." : "");
  }

  return desc.substring(0, 120) + (desc.length > 120 ? "..." : "");
}

/**
 * Summarizes the video using Gemini API with a robust offline heuristic fallback.
 */
export async function generateVideoSummary(title: string, description: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return generateHeuristicSummary(title, description);
  }

  try {
    const prompt = `Summarize what this YouTube video is about in a single, short sentence (maximum 15 words) based on its title and description. Do not include promotional text, links, or hashtags. Keep it clean and highly informative.
Title: ${title}
Description: ${description || "No description provided."}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000); // 4-second timeout to avoid hanging fetches

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 50 }
        }),
        signal: controller.signal
      }
    );

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`API returned status ${res.status}`);
    }

    const data = await res.json();
    const aiSummary = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (aiSummary && aiSummary.length > 5) {
      return aiSummary.replace(/\s+/g, " ");
    }
  } catch (err) {
    console.warn("Failed to generate AI summary, falling back to heuristic", err);
  }

  return generateHeuristicSummary(title, description);
}

