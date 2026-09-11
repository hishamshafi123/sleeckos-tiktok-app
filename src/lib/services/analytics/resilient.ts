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
import { notifyAdmin } from "@/lib/services/notifications";

const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 10 * 60 * 1000;
const NOTIFY_SOURCE = "analytics_provider";

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
    if (this.consecutiveFailures >= BREAKER_THRESHOLD) {
      void notifyAdmin({
        level: "info",
        title: "TikLiveAPI recovered",
        body: "The primary analytics provider is responding again — scraping has switched back from the Apify fallback to TikLiveAPI.",
        source: NOTIFY_SOURCE,
        dedupeMinutes: 60,
      });
    }
    this.consecutiveFailures = 0;
  }

  private onPrimaryFailure(err: unknown): void {
    this.consecutiveFailures++;
    this.openedAt = Date.now();
    const kind = err instanceof ProviderError ? err.kind : "transient";
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[Provider] TikLive failed (${kind}: ${msg}) — ` +
        (this.consecutiveFailures >= BREAKER_THRESHOLD
          ? `circuit open for ${BREAKER_COOLDOWN_MS / 60000}min, using Apify`
          : "falling back to Apify")
    );
    if (this.consecutiveFailures === BREAKER_THRESHOLD) {
      void notifyAdmin({
        level: "warning",
        title: "TikLiveAPI failing — using Apify fallback",
        body: `The primary analytics provider failed ${BREAKER_THRESHOLD} times in a row (latest: ${kind}: ${msg}). Analytics calls are being served by Apify at the higher per-call cost until TikLiveAPI recovers.`,
        source: NOTIFY_SOURCE,
        dedupeMinutes: 60,
      });
    }
  }

  /** Run a call on the fallback; if BOTH providers are down, alert + rethrow. */
  private async callFallback<T>(
    what: string,
    call: (p: AnalyticsProvider) => Promise<T>
  ): Promise<T> {
    try {
      return await call(this.fallback);
    } catch (err) {
      const kind = err instanceof ProviderError ? err.kind : "transient";
      const msg = err instanceof Error ? err.message : String(err);
      void notifyAdmin({
        level: "error",
        title: "Analytics providers both failing",
        body: `TikLiveAPI and the Apify fallback both failed for ${what} (fallback error: ${kind}: ${msg}). Campaign stats and link capture are stalled until a provider recovers.`,
        source: NOTIFY_SOURCE,
        dedupeMinutes: 30,
      });
      throw err;
    }
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
    return this.callFallback(`latest-videos @${username}`, (p) =>
      p.fetchLatestVideosForAccount(username, max, ctx)
    );
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
    return this.callFallback(`stats for ${urls.length} video URL(s)`, (p) =>
      p.fetchStatsForVideoUrls(urls, ctx)
    );
  }
}

export const analyticsProvider = new FallbackProvider(tikliveProvider, apifyProvider);
