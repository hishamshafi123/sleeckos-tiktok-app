/**
 * Analytics provider abstraction.
 *
 * Apify (clockworks/tiktok-scraper) is the only provider today, but everything
 * above this layer talks to this interface so another provider can drop in.
 */

export interface ProviderVideo {
  videoId: string;
  url: string;
  createTime: Date;
  /** Video description/caption text (used by caption-match recovery). */
  text: string;
  views: bigint;
  likes: bigint;
  comments: bigint;
  shares: bigint;
}

export type ProviderVideoStats =
  | {
      views: bigint;
      likes: bigint;
      comments: bigint;
      shares: bigint;
      /** Video's real TikTok create time, when the provider returns it. */
      createTime?: Date;
      /** Video description/caption text, when returned. */
      text?: string;
    }
  | { unavailable: true };

export type ProviderErrorKind =
  | "auth"
  | "rate_limited"
  | "not_found"
  | "transient";

export class ProviderError extends Error {
  kind: ProviderErrorKind;
  constructor(kind: ProviderErrorKind, message: string) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
  }
}

export interface AnalyticsProvider {
  /** Latest videos for a TikTok profile (newest first). */
  fetchLatestVideosForAccount(
    username: string,
    max: number,
    ctx?: ProviderCallContext,
  ): Promise<ProviderVideo[]>;
  /** Current stats for specific video URLs, keyed by video id. */
  fetchStatsForVideoUrls(
    urls: string[],
    ctx?: ProviderCallContext,
  ): Promise<Map<string, ProviderVideoStats>>;
}

/**
 * Call attribution for the spend ledger — every caller passes its
 * source ("sweep" | "refresh" | "spot_check" | "recover" | "capture").
 * The resilient provider writes `usedProvider` back onto this object after
 * a successful call so callers can stamp DB rows with the serving provider.
 */
export interface ProviderCallContext {
  source: string;
  refId?: string;
  /** Set by the resilient provider after a call: "TikLiveAPI" | "Apify". */
  usedProvider?: string;
}

/** Parse platform timestamps without substituting discovery time or local timezone. */
export function publicationTime(value: unknown): Date | undefined {
  let parsed: Date;
  if (
    typeof value === "number" ||
    (typeof value === "string" && /^\d{10}(?:\d{3})?$/.test(value))
  ) {
    const n = Number(value);
    parsed = new Date(n < 1e12 ? n * 1000 : n);
  } else if (
    typeof value === "string" &&
    /T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
  ) {
    parsed = new Date(value);
  } else return undefined;
  return Number.isFinite(parsed.getTime()) &&
    parsed.getTime() >= Date.UTC(2010, 0, 1)
    ? parsed
    : undefined;
}
