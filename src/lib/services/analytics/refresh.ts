/**
 * 24h analytics refresh — pulls current stats for captured TrackedVideos via
 * the analytics provider (Apify), writes per-day snapshots, and records
 * resumable AnalyticsRun rows so a crashed run continues on the next trigger.
 */

import prisma from "@/lib/db";
import { AnalyticsProvider, ProviderError } from "./provider";
import { apifyProvider } from "./apify";
import { getOrgTimezone, getZonedDateString } from "@/lib/services/timezone";

// ── Tier config (env-overridable) ────────────────────────────────────────────
// Tier is based on video age (publishedAt); staleness on lastRefreshedAt.
const TIER1_MAX_AGE_DAYS = Number(process.env.ANALYTICS_TIER1_MAX_AGE_DAYS) || 7;
const TIER1_STALE_HOURS = Number(process.env.ANALYTICS_TIER1_STALE_HOURS) || 24;
const TIER2_MAX_AGE_DAYS = Number(process.env.ANALYTICS_TIER2_MAX_AGE_DAYS) || 30;
const TIER2_STALE_HOURS = Number(process.env.ANALYTICS_TIER2_STALE_HOURS) || 72;
const TIER3_STALE_HOURS = Number(process.env.ANALYTICS_TIER3_STALE_HOURS) || 24 * 7;

const BATCH_SIZE = Number(process.env.ANALYTICS_BATCH_SIZE) || 25;
const SLEEP_BETWEEN_CALLS_MS = Number(process.env.ANALYTICS_SLEEP_MS) || 500;
// A run still "running" after this long is treated as crashed and resumed.
const STALE_RUN_MINUTES = Number(process.env.ANALYTICS_STALE_RUN_MINUTES) || 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Staleness threshold (hours) for a video of the given age in days. */
export function staleThresholdHours(ageDays: number): number {
  if (ageDays < TIER1_MAX_AGE_DAYS) return TIER1_STALE_HOURS;
  if (ageDays < TIER2_MAX_AGE_DAYS) return TIER2_STALE_HOURS;
  return TIER3_STALE_HOURS;
}

/** True when the video is due for a refresh under the tier rules. */
export function isDueForRefresh(
  video: { publishedAt: Date; lastRefreshedAt: Date | null },
  now: Date
): boolean {
  const ageDays = (now.getTime() - video.publishedAt.getTime()) / DAY_MS;
  const staleHours = staleThresholdHours(ageDays);
  const basis = video.lastRefreshedAt ?? video.publishedAt;
  return now.getTime() - basis.getTime() > staleHours * HOUR_MS;
}

/** Write at most one snapshot per video per org-timezone (IST) day. */
async function ensureDailySnapshot(
  trackedVideoId: string,
  stats: { views: bigint; likes: bigint; comments: bigint; shares: bigint },
  timezone: string,
  now: Date
): Promise<boolean> {
  const latest = await prisma.videoStatSnapshot.findFirst({
    where: { trackedVideoId },
    orderBy: { recordedAt: "desc" },
    select: { recordedAt: true },
  });
  if (
    latest &&
    getZonedDateString(latest.recordedAt, timezone) === getZonedDateString(now, timezone)
  ) {
    return false;
  }
  await prisma.videoStatSnapshot.create({ data: { trackedVideoId, ...stats } });
  return true;
}

export interface RefreshOptions {
  type?: "daily" | "manual";
  campaignId?: string;
  resumeRunId?: string;
  provider?: AnalyticsProvider;
}

/**
 * Run an analytics refresh pass. Returns the AnalyticsRun id.
 * - Tiered selection for daily runs (see staleThresholdHours); manual runs
 *   with a campaignId ignore tiers and refresh every captured video.
 * - Oldest-refreshed-first; batched provider calls; per-item error isolation.
 * - A previous crashed run (status "running", stale) is resumed automatically
 *   on daily triggers; resumeRunId forces a specific resume.
 */
export async function runAnalyticsRefresh(opts: RefreshOptions = {}): Promise<{ runId: string }> {
  const { type = "daily", campaignId, provider = apifyProvider } = opts;
  const now = new Date();
  const timezone = await getOrgTimezone();

  // ── Resolve / create the run row (with crash-resume) ──────────────────────
  let run: { id: string; attempted: number; succeeded: number; failed: number; skipped: number; cursor: string | null };

  if (opts.resumeRunId) {
    const prev = await prisma.analyticsRun.findUnique({ where: { id: opts.resumeRunId } });
    if (!prev) throw new Error(`AnalyticsRun ${opts.resumeRunId} not found`);
    run = prev;
  } else {
    // Auto-resume a crashed daily run (still "running" but stale).
    let crashed = null;
    if (type === "daily") {
      crashed = await prisma.analyticsRun.findFirst({
        where: {
          type: "daily",
          status: "running",
          startedAt: { lt: new Date(now.getTime() - STALE_RUN_MINUTES * 60 * 1000) },
        },
        orderBy: { startedAt: "desc" },
      });
    }
    if (crashed) {
      console.warn(`[Analytics] Resuming crashed run ${crashed.id} from cursor ${crashed.cursor ?? "(start)"}`);
      run = crashed;
    } else {
      run = await prisma.analyticsRun.create({ data: { type } });
    }
  }

  // ── Select due videos ─────────────────────────────────────────────────────
  const ignoreTiers = type === "manual" && !!campaignId;
  const all = await prisma.trackedVideo.findMany({
    where: {
      status: "captured",
      // Non-campaign videos are never refreshed (operator decision: refresh
      // budget goes to campaign-attributed videos only).
      campaignId: campaignId ? campaignId : { not: null },
    },
    select: { id: true, tiktokVideoId: true, url: true, publishedAt: true, lastRefreshedAt: true },
  });

  // Oldest-refreshed-first (never refreshed first).
  let due = all
    .filter((v) => ignoreTiers || isDueForRefresh(v, now))
    .sort((a, b) => (a.lastRefreshedAt?.getTime() ?? 0) - (b.lastRefreshedAt?.getTime() ?? 0));

  // Resume: skip everything up to and including the cursor video.
  if (run.cursor) {
    const idx = due.findIndex((v) => v.id === run.cursor);
    if (idx >= 0) due = due.slice(idx + 1);
  }

  const counters = {
    attempted: run.attempted,
    succeeded: run.succeeded,
    failed: run.failed,
    skipped: run.skipped,
  };

  const saveProgress = async (cursor: string | null, status?: string, error?: string) => {
    await prisma.analyticsRun.update({
      where: { id: run.id },
      data: {
        ...counters,
        cursor,
        ...(status ? { status } : {}),
        ...(error !== undefined ? { error } : {}),
        ...(status === "done" || status === "failed" ? { finishedAt: new Date() } : {}),
      },
    });
  };

  const abortRun = async (kind: string, message: string) => {
    console.error(`[Analytics] Run ${run.id} aborted (${kind}): ${message}`);
    await saveProgress(run.cursor, "failed", `${kind}: ${message}`);
  };

  // ── Batched refresh loop ──────────────────────────────────────────────────
  for (let i = 0; i < due.length; i += BATCH_SIZE) {
    const batch = due.slice(i, i + BATCH_SIZE);
    counters.attempted += batch.length;

    let statsById: Awaited<ReturnType<AnalyticsProvider["fetchStatsForVideoUrls"]>>;
    try {
      statsById = await provider.fetchStatsForVideoUrls(batch.map((v) => v.url));
    } catch (err: any) {
      if (err instanceof ProviderError && (err.kind === "rate_limited" || err.kind === "auth")) {
        counters.attempted -= batch.length; // none of the batch was attempted
        await abortRun(err.kind, err.message);
        return { runId: run.id };
      }
      // Transient whole-batch failure: count items failed and continue.
      console.error(`[Analytics] Batch fetch failed (transient): ${err?.message || err}`);
      counters.failed += batch.length;
      await saveProgress(batch[batch.length - 1].id);
      if (i + BATCH_SIZE < due.length) await sleep(SLEEP_BETWEEN_CALLS_MS);
      continue;
    }

    for (const video of batch) {
      try {
        const stats = statsById.get(video.tiktokVideoId);
        if (!stats) {
          // Provider returned nothing usable for this video — treat as a
          // transient failure (failed++, keep in rotation), never as gone.
          counters.failed++;
        } else if ("unavailable" in stats) {
          await prisma.trackedVideo.update({
            where: { id: video.id },
            data: { status: "unavailable" },
          });
          counters.skipped++;
        } else {
          await prisma.trackedVideo.update({
            where: { id: video.id },
            data: { ...stats, lastRefreshedAt: now },
          });
          await ensureDailySnapshot(video.id, stats, timezone, now);
          counters.succeeded++;
        }
      } catch (err: any) {
        if (err instanceof ProviderError && (err.kind === "rate_limited" || err.kind === "auth")) {
          await saveProgress(video.id);
          await abortRun(err.kind, err.message);
          return { runId: run.id };
        }
        console.error(`[Analytics] Refresh failed for video ${video.tiktokVideoId}:`, err?.message || err);
        counters.failed++;
      }
      await saveProgress(video.id);
    }

    if (i + BATCH_SIZE < due.length) await sleep(SLEEP_BETWEEN_CALLS_MS);
  }

  await saveProgress(due.length > 0 ? due[due.length - 1].id : run.cursor, "done");
  console.log(
    `[Analytics] Run ${run.id} (${type}) done: attempted=${counters.attempted} succeeded=${counters.succeeded} failed=${counters.failed} skipped=${counters.skipped}`
  );
  return { runId: run.id };
}

/** Manual subset: refresh every captured video of a campaign, ignoring tiers. */
export async function refreshCampaignNow(
  campaignId: string,
  provider?: AnalyticsProvider
): Promise<{ runId: string }> {
  return runAnalyticsRefresh({ type: "manual", campaignId, provider });
}
