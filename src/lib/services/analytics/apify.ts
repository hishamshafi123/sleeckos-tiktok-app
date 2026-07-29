/**
 * Apify analytics provider — clockworks/tiktok-scraper via Apify API v2
 * (run-sync-get-dataset-items). Raw fetch, no npm deps.
 *
 * Env:
 *   APIFY_TOKEN            (required) Apify API token
 *   APIFY_ACTOR_ID         actor id, default "clockworks~tiktok-scraper"
 *   APIFY_PROFILES_FIELD   input field for profile usernames, default "profiles"
 *   APIFY_POST_URLS_FIELD  input field for specific video URLs, default "postURLs"
 *   APIFY_TIMEOUT_MS       per-call timeout, default 120000
 */

import {
  AnalyticsProvider,
  ProviderError,
  ProviderVideo,
  ProviderVideoStats,
} from "./provider";

const DEFAULT_ACTOR = "clockworks~tiktok-scraper";
const DEFAULT_TIMEOUT_MS = 120_000;

// Actor item errorCodes meaning the post/profile does not exist or is private.
const NOT_FOUND_CODES = new Set([
  "POST_NOT_FOUND_OR_PRIVATE",
  "NOT_FOUND",
  "PROFILE_PRIVATE",
]);

function getToken(): string {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    throw new ProviderError(
      "auth",
      "APIFY_TOKEN not set — campaign analytics (Apify) is disabled until it is configured"
    );
  }
  return token;
}

function classifyHttpStatus(status: number): ProviderError["kind"] {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limited";
  return "transient";
}

function classifyActorErrorCode(code: unknown): ProviderError["kind"] {
  if (typeof code === "string" && NOT_FOUND_CODES.has(code)) return "not_found";
  return "transient";
}

function toBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
  if (typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v);
  return BigInt(0);
}

/** Extract the numeric TikTok video id from a video URL. */
export function extractVideoIdFromUrl(url: string): string | null {
  const m = url.match(/\/video\/(\d+)/);
  return m ? m[1] : null;
}

/**
 * Call the actor synchronously and return dataset items. Throws ProviderError
 * with a classified kind on transport/HTTP/parse failure. The raw body (first
 * 500 chars) is logged whenever the response is not usable JSON.
 */
async function runActor(input: Record<string, unknown>): Promise<any[]> {
  const token = getToken();
  const actor = process.env.APIFY_ACTOR_ID || DEFAULT_ACTOR;
  const timeoutMs = Number(process.env.APIFY_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(
    actor
  )}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new ProviderError("transient", `Apify actor call timed out after ${timeoutMs}ms`);
    }
    throw new ProviderError("transient", `Apify fetch failed: ${err?.message || String(err)}`);
  } finally {
    clearTimeout(timer);
  }

  const raw = await res.text();

  if (!res.ok) {
    const kind = classifyHttpStatus(res.status);
    console.error(
      `[Apify] HTTP ${res.status} (classified ${kind}). Body: ${raw.slice(0, 500)}`
    );
    throw new ProviderError(kind, `Apify HTTP ${res.status}: ${raw.slice(0, 200)}`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("json")) {
    console.error(`[Apify] Non-JSON response (${contentType}). Body: ${raw.slice(0, 500)}`);
    throw new ProviderError("transient", `Apify returned non-JSON content-type: ${contentType}`);
  }

  let items: any;
  try {
    items = JSON.parse(raw);
  } catch {
    console.error(`[Apify] JSON parse failed. Body: ${raw.slice(0, 500)}`);
    throw new ProviderError("transient", "Apify returned invalid JSON");
  }

  if (!Array.isArray(items)) {
    console.error(`[Apify] Non-array dataset. Body: ${raw.slice(0, 500)}`);
    throw new ProviderError("transient", "Apify dataset was not an array");
  }

  return items;
}

export class ApifyProvider implements AnalyticsProvider {
  /** Latest videos for a TikTok profile, newest first. */
  async fetchLatestVideosForAccount(username: string, max: number): Promise<ProviderVideo[]> {
    const profilesField = process.env.APIFY_PROFILES_FIELD || "profiles";
    const clean = username.replace(/^@/, "");
    const items = await runActor({
      [profilesField]: [clean],
      profileSorting: "latest",
      profileScrapeSections: ["videos"],
      resultsPerPage: max,
    });

    const videos: ProviderVideo[] = [];
    for (const item of items) {
      if (item?.errorCode) {
        // A profile-level error (e.g. PROFILE_PRIVATE) is not a per-video failure.
        const kind = classifyActorErrorCode(item.errorCode);
        console.warn(
          `[Apify] Profile scrape error for @${clean}: ${item.errorCode} (classified ${kind})`
        );
        if (kind === "not_found") {
          throw new ProviderError("not_found", `Profile @${clean}: ${item.errorCode}`);
        }
        continue;
      }
      const videoId = item?.id != null ? String(item.id) : null;
      const createTimeISO = item?.createTimeISO || item?.createTime;
      const createTime = createTimeISO ? new Date(createTimeISO) : null;
      if (!videoId || !createTime || isNaN(createTime.getTime())) continue;

      videos.push({
        videoId,
        url:
          item.webVideoUrl ||
          `https://www.tiktok.com/@${clean}/video/${videoId}`,
        createTime,
        views: toBigInt(item.playCount),
        likes: toBigInt(item.diggCount),
        comments: toBigInt(item.commentCount),
        shares: toBigInt(item.shareCount),
      });
    }

    videos.sort((a, b) => b.createTime.getTime() - a.createTime.getTime());
    return videos.slice(0, max);
  }

  /** Current stats for specific video URLs, keyed by video id. */
  async fetchStatsForVideoUrls(urls: string[]): Promise<Map<string, ProviderVideoStats>> {
    const result = new Map<string, ProviderVideoStats>();
    if (urls.length === 0) return result;

    const urlsField = process.env.APIFY_POST_URLS_FIELD || "postURLs";
    const items = await runActor({
      [urlsField]: urls,
      resultsPerPage: urls.length,
    });

    // Index returned items by video id (item.id, else parsed from its URL).
    const byId = new Map<string, any>();
    for (const item of items) {
      const id =
        item?.id != null
          ? String(item.id)
          : item?.webVideoUrl
            ? extractVideoIdFromUrl(String(item.webVideoUrl))
            : null;
      if (id) byId.set(id, item);
    }

    for (const url of urls) {
      const videoId = extractVideoIdFromUrl(url);
      if (!videoId) continue;
      const item = byId.get(videoId);

      if (!item) {
        // Actor said nothing about this video — ambiguous (could be transient
        // actor failure). Omit from the map so the caller counts it as a
        // failed refresh rather than retiring the video as unavailable.
        console.warn(`[Apify] No dataset item returned for video ${videoId}`);
        continue;
      }
      if (item.errorCode) {
        const kind = classifyActorErrorCode(item.errorCode);
        if (kind === "not_found") {
          result.set(videoId, { unavailable: true });
        } else {
          console.warn(`[Apify] Video ${videoId} scrape error: ${item.errorCode}`);
        }
        continue;
      }

      result.set(videoId, {
        views: toBigInt(item.playCount),
        likes: toBigInt(item.diggCount),
        comments: toBigInt(item.commentCount),
        shares: toBigInt(item.shareCount),
      });
    }

    return result;
  }
}

export const apifyProvider = new ApifyProvider();
