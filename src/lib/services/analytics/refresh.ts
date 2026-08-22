/**
 * 24h analytics refresh — pulls current stats for captured TrackedVideos via
 * the analytics provider (Apify), writes per-day snapshots, and records
 * resumable AnalyticsRun rows so a crashed run continues on the next trigger.
 *
 * Statuses: "captured" = in the paid refresh rotation; "dormant" = views have
 * stayed ≤ ZERO_VIEW_THRESHOLD for ZERO_VIEW_CONSEC_DAYS consecutive org-tz
 * days (and the video is past the ZERO_VIEW_MIN_AGE_DAYS grace period) —
 * excluded from the paid rotation to save spend, but still refreshed for free
 * by the daily account sweep, which wakes it back to "captured" if views pick
 * up. Manual campaign refreshes also exclude dormant rows — dormant links are
 * never part of any paid refresh again. "unavailable" is never refreshed.
 */

import prisma from "@/lib/db";
import { ProviderError } from "./provider";
import type { AnalyticsProvider } from "./provider";
import { apifyProvider } from "./apify";
import { getOrgTimezone, getZonedDateString } from "@/lib/services/timezone";

// ── Tier config (env-overridable) ────────────────────────────────────────────
// Tier is based on video age (publishedAt); staleness on lastRefreshedAt.
// EXCEPTION: videos whose view count has not moved across
// STATIC_VIEW_STREAK_DAYS consecutive checks drop out of these tiers onto the
// 5-day slow cadence (STATIC_VIEW_STALE_HOURS) until views move again — see
// the slow-cadence block below.
const TIER1_MAX_AGE_DAYS = Number(process.env.ANALYTICS_TIER1_MAX_AGE_DAYS) || 7;
const TIER1_STALE_HOURS = Number(process.env.ANALYTICS_TIER1_STALE_HOURS) || 24;
const TIER2_MAX_AGE_DAYS = Number(process.env.ANALYTICS_TIER2_MAX_AGE_DAYS) || 30;
const TIER2_STALE_HOURS = Number(process.env.ANALYTICS_TIER2_STALE_HOURS) || 72;
const TIER3_STALE_HOURS = Number(process.env.ANALYTICS_TIER3_STALE_HOURS) || 24 * 7;

const BATCH_SIZE = Number(process.env.ANALYTICS_BATCH_SIZE) || 25;
const SLEEP_BETWEEN_CALLS_MS = Number(process.env.ANALYTICS_SLEEP_MS) || 500;
// A run still "running" after this long is treated as crashed and resumed.
const STALE_RUN_MINUTES = Number(process.env.ANALYTICS_STALE_RUN_MINUTES) || 30;

// ── Static-view slow cadence (cost saving) ───────────────────────────────────
// A captured video whose view count has not changed across
// STATIC_VIEW_STREAK_DAYS consecutive daily checks leaves the age tiers and is
// refreshed only once every STATIC_VIEW_STALE_HOURS instead. Any view change
// resets the streak (applyStatsUpdate) and normal cadence resumes immediately.
// Paid rotation only — the free sweep keeps its daily cadence (and maintains
// the streak signal). Manual/spot-check runs ignore tiers, so operators can
// always force-refresh slow-cadence videos. Dormant/unavailable/removed rules
// are unchanged and still take precedence over everything above.
export const STATIC_VIEW_STREAK_DAYS = Number(process.env.STATIC_VIEW_STREAK_DAYS) || 3;
export const STATIC_VIEW_STALE_HOURS = Number(process.env.STATIC_VIEW_STALE_HOURS) || 120;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// ── Dormant-link detection (cost saving) ─────────────────────────────────────
// A captured link whose views stay ≤ threshold across consecutive daily checks
// drops out of the paid rotation (see header comment).
export const ZERO_VIEW_THRESHOLD = Number(process.env.ZERO_VIEW_THRESHOLD) || 1;
export const ZERO_VIEW_MIN_AGE_DAYS = Number(process.env.ZERO_VIEW_MIN_AGE_DAYS) || 2;
export const ZERO_VIEW_CONSEC_DAYS = Number(process.env.ZERO_VIEW_CONSEC_DAYS) || 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Staleness threshold (hours) for a video of the given age in days. */
export function staleThresholdHours(ageDays: number): number {
  if (ageDays < TIER1_MAX_AGE_DAYS) return TIER1_STALE_HOURS;
  if (ageDays < TIER2_MAX_AGE_DAYS) return TIER2_STALE_HOURS;
  return TIER3_STALE_HOURS;
}

/** True when the video is due for a refresh under the tier rules. */
export function isDueForRefresh(
  video: { publishedAt: Date; lastRefreshedAt: Date | null; unchangedViewsStreak?: number },
  now: Date
): boolean {
  const basis = video.lastRefreshedAt ?? video.publishedAt;
  // Static-view slow cadence overrides the age tiers (see header comment).
  if ((video.unchangedViewsStreak ?? 0) >= STATIC_VIEW_STREAK_DAYS) {
    return now.getTime() - basis.getTime() > STATIC_VIEW_STALE_HOURS * HOUR_MS;
  }
  const staleHours = staleThresholdHours((now.getTime() - video.publishedAt.getTime()) / DAY_MS);
  return now.getTime() - basis.getTime() > staleHours * HOUR_MS;
}

/**
 * THE stats-write path for TrackedVideo: writes stats + lastRefreshedAt,
 * maintains unchangedViewsStreak (increment when the view count matches the
 * previously stored one, reset to 0 on any change), and records the per-day
 * snapshot. Used by every refresh path (paid rotation, free sweep, spot-check)
 * so the slow-cadence signal stays accurate no matter which path saw the
 * video. Capture (first link creation) is the exception — a fresh link starts
 * at streak 0. Status transitions (dormant wake, maybeMarkDormant,
 * unavailable) stay with the callers.
 */
export async function applyStatsUpdate(
  trackedVideoId: string,
  stats: { views: bigint; likes: bigint; comments: bigint; shares: bigint },
  timezone: string,
  now: Date
): Promise<{ unchangedViewsStreak: number }> {
  const prev = await prisma.trackedVideo.findUnique({
    where: { id: trackedVideoId },
    select: { views: true, unchangedViewsStreak: true },
  });
  const streak =
    prev && prev.views === stats.views ? prev.unchangedViewsStreak + 1 : 0;
  await prisma.trackedVideo.update({
    where: { id: trackedVideoId },
    data: { ...stats, lastRefreshedAt: now, unchangedViewsStreak: streak },
  });
  await ensureDailySnapshot(trackedVideoId, stats, timezone, now);
  return { unchangedViewsStreak: streak };
}

/** Write at most one snapshot per video per org-timezone (IST) day. */
export async function ensureDailySnapshot(
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

/**
 * Mark a captured video "dormant" when its views have stayed ≤
 * ZERO_VIEW_THRESHOLD across ZERO_VIEW_CONSEC_DAYS distinct org-tz days and it
 * is at least ZERO_VIEW_MIN_AGE_DAYS old (grace period for new videos).
 * Call AFTER ensureDailySnapshot so today's just-written snapshot counts.
 * No-op (returns false) when views are above the threshold — a dormant row is
 * revived to "captured" by the daily sweep, not here.
 */
export async function maybeMarkDormant(
  video: { id: string; publishedAt: Date },
  stats: { views: bigint },
  timezone: string,
  now: Date
): Promise<boolean> {
  if (stats.views > BigInt(ZERO_VIEW_THRESHOLD)) return false;
  if ((now.getTime() - video.publishedAt.getTime()) / DAY_MS < ZERO_VIEW_MIN_AGE_DAYS) {
    return false;
  }

  // Recent snapshots, newest first, deduped to distinct org-tz days.
  const snapshots = await prisma.videoStatSnapshot.findMany({
    where: { trackedVideoId: video.id },
    orderBy: { recordedAt: "desc" },
    take: ZERO_VIEW_CONSEC_DAYS * 3,
    select: { views: true, recordedAt: true },
  });
  const seenDays = new Set<string>();
  const distinctDays: bigint[] = [];
  for (const s of snapshots) {
    const day = getZonedDateString(s.recordedAt, timezone);
    if (seenDays.has(day)) continue;
    seenDays.add(day);
    distinctDays.push(s.views);
    if (distinctDays.length >= ZERO_VIEW_CONSEC_DAYS) break;
  }
  if (distinctDays.length < ZERO_VIEW_CONSEC_DAYS) return false;
  if (!distinctDays.every((v) => v <= BigInt(ZERO_VIEW_THRESHOLD))) return false;

  // Only transition captured → dormant; never clobber "unavailable".
  const res = await prisma.trackedVideo.updateMany({
    where: { id: video.id, status: "captured" },
    data: { status: "dormant" },
  });
  if (res.count > 0) {
    console.log(`[Analytics] Video ${video.id} marked dormant (0-view ${distinctDays.length}d)`);
  }
  return res.count > 0;
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
  // Paused campaigns are never refreshed — pausing is the operator's "stop
  // spending on this campaign" switch (posting already respects it).
  const paused = await prisma.campaign.findMany({
    where: { status: "PAUSED" },
    select: { id: true },
  });
  const pausedIds = paused.map((p) => p.id);
  const all = await prisma.trackedVideo.findMany({
    where: {
      // Dormant (0-view) links are excluded from ALL paid refreshes — daily
      // tiered runs and manual campaign refreshes alike (operator decision).
      // They are still updated for free by the daily sweep.
      status: "captured",
      // Non-campaign videos are never refreshed (operator decision: refresh
      // budget goes to campaign-attributed videos only).
      campaignId: campaignId ? campaignId : { not: null, notIn: pausedIds },
    },
    select: { id: true, tiktokVideoId: true, url: true, publishedAt: true, lastRefreshedAt: true, unchangedViewsStreak: true },
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

  // Cost-visibility: how many of this run's due videos are on the static-view
  // slow cadence (unchangedViewsStreak >= STATIC_VIEW_STREAK_DAYS) vs normal.
  const slowCadenceDue = due.filter(
    (v) => v.unchangedViewsStreak >= STATIC_VIEW_STREAK_DAYS
  ).length;

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
          await applyStatsUpdate(video.id, stats, timezone, now);
          // After the snapshot so today's check counts toward the streak.
          await maybeMarkDormant(video, stats, timezone, now);
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
    `[Analytics] Run ${run.id} (${type}) done: attempted=${counters.attempted} succeeded=${counters.succeeded} failed=${counters.failed} skipped=${counters.skipped} cadence: slow=${slowCadenceDue} normal=${due.length - slowCadenceDue}`
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
