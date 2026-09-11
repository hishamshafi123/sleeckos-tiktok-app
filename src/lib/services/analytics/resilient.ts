/**
 * Resilient analytics provider — TikLiveAPI primary, Apify fallback.
 *
 * Every call tries TikLiveAPI first (cheap: ~$0.0001/request). If it throws
 * (auth, rate limit, timeout, outage), the same call is retried against the
 * Apify provider so analytics never stop flowing.
 *
 * A small in-memory circuit breaker keeps a TikLive outage from slowing
 * everything down: after BREAKER_THRESHOLD consecutive primary failures the
 * primary is skipped for BREAKER_COOLDOWN_MS, then probed again. The breaker
 * is per-process (single app container) and resets on the first success.
 *
 * Partial results are NOT escalated: if TikLive returns a partial stats map,
 * the missing ids are treated by callers as failed refreshes (their normal
 * retry path) rather than being double-fetched via Apify.
 */

import { ProviderError } from "./provider";
import type {
  AnalyticsProvider,
  ProviderCallContext,
  ProviderVideo,
  ProviderVideoStats,
} from "./provider";
import { apifyProvider } from "./apify";
import { tikliveProvider } from "./tiklive";

const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 10 * 60 * 1000;

export class FallbackProvider implements AnalyticsProvider {
  private consecutiveFailures = 0;
  private openedAt = 0;

  constructor(
    private primary: AnalyticsProvider,
    private fallback: AnalyticsProvider
  ) {}

  private primaryAllowed(): boolean {
    if (this.consecutiveFailures < BREAKER_THRESHOLD) return true;
    if (Date.now() - this.openedAt >= BREAKER_COOLDOWN_MS) return true; // probe again
    return false;
  }

  private onPrimarySuccess(): void {
    this.consecutiveFailures = 0;
  }

  private onPrimaryFailure(err: unknown): void {
    this.consecutiveFailures++;
    this.openedAt = Date.now();
    const kind = err instanceof ProviderError ? err.kind : "transient";
    console.warn(
      `[Provider] TikLive failed (${kind}: ${err instanceof Error ? err.message : err}) — ` +
        (this.consecutiveFailures >= BREAKER_THRESHOLD
          ? `circuit open for ${BREAKER_COOLDOWN_MS / 60000}min, using Apify`
          : "falling back to Apify")
    );
  }

  async fetchLatestVideosForAccount(
    username: string,
    max: number,
    ctx?: ProviderCallContext
  ): Promise<ProviderVideo[]> {
    if (this.primaryAllowed()) {
      try {
        const videos = await this.primary.fetchLatestVideosForAccount(username, max, ctx);
        this.onPrimarySuccess();
        return videos;
      } catch (err) {
        this.onPrimaryFailure(err);
      }
    }
    return this.fallback.fetchLatestVideosForAccount(username, max, ctx);
  }

  async fetchStatsForVideoUrls(
    urls: string[],
    ctx?: ProviderCallContext
  ): Promise<Map<string, ProviderVideoStats>> {
    if (this.primaryAllowed()) {
      try {
        const stats = await this.primary.fetchStatsForVideoUrls(urls, ctx);
        this.onPrimarySuccess();
        return stats;
      } catch (err) {
        this.onPrimaryFailure(err);
      }
    }
    return this.fallback.fetchStatsForVideoUrls(urls, ctx);
  }
}

export const analyticsProvider = new FallbackProvider(tikliveProvider, apifyProvider);
