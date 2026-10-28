/**
 * Automatic analytics refresh — pulls current stats for captured TrackedVideos
 * via the analytics provider, writes per-day snapshots, and records resumable
 * AnalyticsRun rows so a crashed run continues on the next trigger.
 *
 * Automatic paid refreshes are due every 12 hours and stop after 72 hours
 * without a view-count change. Manual campaign refreshes override both rules.
 * Statuses: "captured" = eligible for paid refresh; "dormant" = views have
 * stayed ≤ ZERO_VIEW_THRESHOLD for ZERO_VIEW_CONSEC_DAYS consecutive org-tz
 * days (and the video is past the ZERO_VIEW_MIN_AGE_DAYS grace period) —
 * excluded from the paid rotation to save spend, but still refreshed for free
 * by the daily account sweep, which wakes it back to "captured" if views pick
 * up. Manual campaign refreshes also exclude dormant rows — dormant links are
 * never part of any paid refresh again. "unavailable" is never refreshed.
 */

import prisma from "@/lib/db";
import { ProviderError } from "./provider";
import type { AnalyticsProvider, ProviderCallContext } from "./provider";
import { analyticsProvider } from "./resilient";
import { rollupAccountsToday } from "./account-stats";
import { getOrgTimezone, getZonedDateString } from "@/lib/services/timezone";

// ── Automatic paid refresh policy (env-overridable) ─────────────────────────
export const AUTOMATIC_REFRESH_STALE_HOURS =
  Number(process.env.ANALYTICS_REFRESH_STALE_HOURS) || 12;
export const UNCHANGED_VIEWS_STOP_HOURS =
  Number(process.env.ANALYTICS_UNCHANGED_VIEWS_STOP_HOURS) || 72;

const BATCH_SIZE = Number(process.env.ANALYTICS_BATCH_SIZE) || 25;
const SLEEP_BETWEEN_CALLS_MS = Number(process.env.ANALYTICS_SLEEP_MS) || 500;
// A run still "running" after this long is treated as crashed and resumed.
const STALE_RUN_MINUTES = Number(process.env.ANALYTICS_STALE_RUN_MINUTES) || 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// ── Dormant-link detection (cost saving) ─────────────────────────────────────
// A captured link whose views stay ≤ threshold across consecutive daily checks
// drops out of the paid rotation (see header comment).
export const ZERO_VIEW_THRESHOLD = Number(process.env.ZERO_VIEW_THRESHOLD) || 1;
export const ZERO_VIEW_MIN_AGE_DAYS = Number(process.env.ZERO_VIEW_MIN_AGE_DAYS) || 2;
export const ZERO_VIEW_CONSEC_DAYS = Number(process.env.ZERO_VIEW_CONSEC_DAYS) || 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type RefreshPolicyVideo = {
  publishedAt: Date;
  capturedAt?: Date | null;
  lastRefreshedAt: Date | null;
  lastViewsChangedAt?: Date | null;
};

/** True when automatic paid refreshes have stopped after 72h without a view change. */
export function hasStoppedAutomaticRefresh(video: RefreshPolicyVideo, now: Date): boolean {
  const baseline = video.lastViewsChangedAt ?? video.capturedAt ?? video.publishedAt;
  return now.getTime() - baseline.getTime() >= UNCHANGED_VIEWS_STOP_HOURS * HOUR_MS;
}

/** True when an automatic paid refresh is both active and at least 12h stale. */
export function isDueForRefresh(video: RefreshPolicyVideo, now: Date): boolean {
  if (hasStoppedAutomaticRefresh(video, now)) return false;
  const basis = video.lastRefreshedAt ?? video.publishedAt;
  return now.getTime() - basis.getTime() >= AUTOMATIC_REFRESH_STALE_HOURS * HOUR_MS;
}

/**
 * THE stats-write path for TrackedVideo: writes stats + lastRefreshedAt,
 * maintains unchangedViewsStreak (increment when the view count matches the
 * previously stored one, reset to 0 on any change), advances
 * lastViewsChangedAt only when views change, and records the per-day snapshot.
 * Used by every refresh path (paid rotation, free sweep, spot-check) so the
 * view-change signal stays accurate no matter which path saw the video.
 * Capture (first link creation) is the exception — a fresh link starts at
 * streak 0. Status transitions (dormant wake, maybeMarkDormant, unavailable)
 * stay with the callers.
 */
export async function applyStatsUpdate(
  trackedVideoId: string,
  stats: { views: bigint; likes: bigint; comments: bigint; shares: bigint },
  timezone: string,
  now: Date,
  provider?: string
): Promise<{ unchangedViewsStreak: number }> {
  // Strip to the four counter columns — provider stats objects may carry
  // extra fields (createTime, text) that are NOT TrackedVideo columns and
  // crash Prisma validation when spread through (in production's minimal
  // error format this surfaces as an empty-message failure per video).
  const countersOnly = {
    views: stats.views,
    likes: stats.likes,
    comments: stats.comments,
    shares: stats.shares,
  };
  const prev = await prisma.trackedVideo.findUnique({
    where: { id: trackedVideoId },
    select: { views: true, unchangedViewsStreak: true },
  });
  const viewsChanged = !prev || prev.views !== countersOnly.views;
  const streak =
    prev && !viewsChanged ? prev.unchangedViewsStreak + 1 : 0;
  await prisma.trackedVideo.update({
    where: { id: trackedVideoId },
    data: {
      ...countersOnly,
      lastRefreshedAt: now,
      ...(viewsChanged ? { lastViewsChangedAt: now } : {}),
      unchangedViewsStreak: streak,
      ...(provider ? { statsProvider: provider } : {}),
    },
  });
  await ensureDailySnapshot(trackedVideoId, countersOnly, timezone, now);
  return { unchangedViewsStreak: streak };
}

/** Write one snapshot per video per org-timezone (IST) day — and keep it
 * current: a same-day refresh UPDATES today's row instead of skipping, so
 * the Account Performance rollup (which computes daily gains from snapshots)
 * reflects the latest numbers immediately, not tomorrow. */
export async function ensureDailySnapshot(
  trackedVideoId: string,
  stats: { views: bigint; likes: bigint; comments: bigint; shares: bigint },
  timezone: string,
  now: Date
): Promise<boolean> {
  const latest = await prisma.videoStatSnapshot.findFirst({
    where: { trackedVideoId },
    orderBy: { recordedAt: "desc" },
    select: { id: true, recordedAt: true },
  });
  if (
    latest &&
    getZonedDateString(latest.recordedAt, timezone) === getZonedDateString(now, timezone)
  ) {
    await prisma.videoStatSnapshot.update({ where: { id: latest.id }, data: stats });
    return true;
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
 * - Automatic scheduled runs select videos at least 12h stale, excluding those
 *   stopped after 72h without a view change. Manual campaign runs override
 *   both rules and refresh every captured video in the campaign.
 * - Oldest-refreshed-first; batched provider calls; per-item error isolation.
 * - A previous crashed run (status "running", stale) is resumed automatically
 *   on daily triggers; resumeRunId forces a specific resume.
 */
export async function runAnalyticsRefresh(opts: RefreshOptions = {}): Promise<{ runId: string }> {
  const { type = "daily", campaignId, provider = analyticsProvider } = opts;
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
  const overrideAutomaticPolicy = type === "manual" && !!campaignId;
  // Paused campaigns are never refreshed — pausing is the operator's "stop
  // spending on this campaign" switch (posting already respects it).
  const paused = await prisma.campaign.findMany({
    where: { status: "PAUSED" },
    select: { id: true },
  });
  const pausedIds = paused.map((p) => p.id);
  const all = await prisma.trackedVideo.findMany({
    where: {
      // Dormant (0-view) links are excluded from ALL paid refreshes — automatic
      // scheduled runs and manual campaign refreshes alike (operator decision).
      // They are still updated for free by the daily sweep.
      status: "captured",
      // Non-campaign videos are never refreshed (operator decision: refresh
      // budget goes to campaign-attributed videos only).
      campaignId: campaignId ? campaignId : { not: null, notIn: pausedIds },
    },
    select: {
      id: true,
      tiktokVideoId: true,
      url: true,
      accountId: true,
      publishedAt: true,
      capturedAt: true,
      lastRefreshedAt: true,
      lastViewsChangedAt: true,
    },
  });

  const stoppedAutomatic = overrideAutomaticPolicy
    ? 0
    : all.filter((v) => hasStoppedAutomaticRefresh(v, now)).length;

  // Oldest-refreshed-first (never refreshed first).
  let due = all
    .filter((v) => overrideAutomaticPolicy || isDueForRefresh(v, now))
    .sort((a, b) => (a.lastRefreshedAt?.getTime() ?? 0) - (b.lastRefreshedAt?.getTime() ?? 0));

  // Resume: skip everything up to and including the cursor video.
  if (run.cursor) {
    const idx = due.findIndex((v) => v.id === run.cursor);
    if (idx >= 0) due = due.slice(idx + 1);
  }

  // Accounts whose videos got fresh stats — rolled up at the end so the
  // Account Performance bars reflect this run immediately.
  const refreshedAccountIds = new Set<string>();

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
    const batchCtx: ProviderCallContext = { source: "refresh", refId: run.id };
    try {
      statsById = await provider.fetchStatsForVideoUrls(
        batch.map((v) => v.url),
        batchCtx
      );
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
          await applyStatsUpdate(video.id, stats, timezone, now, batchCtx.usedProvider);
          // After the snapshot so today's check counts toward the streak.
          await maybeMarkDormant(video, stats, timezone, now);
          refreshedAccountIds.add(video.accountId);
          counters.succeeded++;
        }
      } catch (err: any) {
        if (err instanceof ProviderError && (err.kind === "rate_limited" || err.kind === "auth")) {
          await saveProgress(video.id);
          await abortRun(err.kind, err.message);
          return { runId: run.id };
        }
        console.error(
          `[Analytics] Refresh failed for video ${video.tiktokVideoId} (${err?.name || "Error"}):`,
          err?.message || err
        );
        counters.failed++;
      }
      await saveProgress(video.id);
    }

    if (i + BATCH_SIZE < due.length) await sleep(SLEEP_BETWEEN_CALLS_MS);
  }

  await saveProgress(due.length > 0 ? due[due.length - 1].id : run.cursor, "done");
  console.log(
    `[Analytics] Run ${run.id} (${type}) done: attempted=${counters.attempted} succeeded=${counters.succeeded} failed=${counters.failed} skipped=${counters.skipped} selection: stopped=${stoppedAutomatic} due=${due.length}`
  );

  // Move the Account Performance bars now — don't wait for the daily rollup cron.
  if (refreshedAccountIds.size > 0) {
    const rolled = await rollupAccountsToday(refreshedAccountIds);
    console.log(`[Analytics] Rolled up ${rolled} account(s) after refresh run ${run.id}`);
  }
  return { runId: run.id };
}

/** Manual subset: refresh every captured video of a campaign, overriding the automatic policy. */
export async function refreshCampaignNow(
  campaignId: string,
  provider?: AnalyticsProvider
): Promise<{ runId: string }> {
  return runAnalyticsRefresh({ type: "manual", campaignId, provider });
}
