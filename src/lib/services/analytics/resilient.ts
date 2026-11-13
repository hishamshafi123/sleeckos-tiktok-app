/**
 * TikLive-only analytics. Retry pacing lives in TikLiveProvider; failed calls
 * propagate to the caller so saved data is retained and scheduled runs retry.
 * There is deliberately no secondary paid provider or circuit that skips calls.
 */
import {
  ProviderError,
  type AnalyticsProvider,
  type ProviderCallContext,
} from "./provider";
import { tikliveProvider } from "./tiklive";
import { notifyAdmin } from "@/lib/services/notifications";

export class TikLiveOnlyProvider implements AnalyticsProvider {
  private failing = false;

  constructor(
    private provider: AnalyticsProvider = tikliveProvider,
    private notify: typeof notifyAdmin = notifyAdmin,
  ) {}

  private async call<T>(
    ctx: ProviderCallContext | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (ctx) delete ctx.usedProvider;
    try {
      const result = await operation();
      if (ctx) ctx.usedProvider = "TikLiveAPI";
      if (this.failing) {
        void this.notify({
          level: "info",
          title: "TikLiveAPI responding again",
          body: "An analytics request succeeded. Failed accounts will retry on their next scheduled run.",
          source: "analytics_provider",
          dedupeMinutes: 60,
        });
      }
      this.failing = false;
      return result;
    } catch (error) {
      const kind = error instanceof ProviderError ? error.kind : "transient";
      // Missing/private accounts are account problems, not provider outages.
      if (kind !== "not_found") {
        this.failing = true;
        const action =
          kind === "auth"
            ? "An admin must check TIKLIVE_API_KEY; retries cannot repair invalid credentials."
            : kind === "rate_limited"
              ? "Check the TikLiveAPI balance or quota. Scheduled runs will retry."
              : "TikLiveAPI returned an incomplete response or was unavailable. Scheduled runs will retry.";
        void this.notify({
          level: "error",
          title: "TikLiveAPI analytics request failed",
          body: `${action} Existing saved stats are retained. No Apify fallback is used.`,
          source: "analytics_provider",
          dedupeMinutes: 30,
        });
      }
      throw error;
    }
  }

  fetchAccountSnapshot(
    username: string,
    max: number,
    ctx?: ProviderCallContext,
  ) {
    return this.call(ctx, () => {
      if (!this.provider.fetchAccountSnapshot)
        throw new ProviderError(
          "transient",
          "Provider does not support profile snapshots",
        );
      return this.provider.fetchAccountSnapshot(username, max, ctx);
    });
  }

  fetchLatestVideosForAccount(
    username: string,
    max: number,
    ctx?: ProviderCallContext,
  ) {
    return this.call(ctx, () =>
      this.provider.fetchLatestVideosForAccount(username, max, ctx),
    );
  }

  fetchStatsForVideoUrls(urls: string[], ctx?: ProviderCallContext) {
    return this.call(ctx, () =>
      this.provider.fetchStatsForVideoUrls(urls, ctx),
    );
  }
}

export const analyticsProvider = new TikLiveOnlyProvider();
