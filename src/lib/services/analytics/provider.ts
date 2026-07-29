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
    }
  | { unavailable: true };

export type ProviderErrorKind = "auth" | "rate_limited" | "not_found" | "transient";

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
  fetchLatestVideosForAccount(username: string, max: number): Promise<ProviderVideo[]>;
  /** Current stats for specific video URLs, keyed by video id. */
  fetchStatsForVideoUrls(urls: string[]): Promise<Map<string, ProviderVideoStats>>;
}
