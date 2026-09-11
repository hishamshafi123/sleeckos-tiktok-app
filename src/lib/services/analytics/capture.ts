/**
 * Campaign link capture — links a published PostJob back to its TikTok video
 * by scraping the account's latest videos via the analytics provider (Apify)
 * and matching on publish time.
 *
 * Capture is PER-ACCOUNT and DEEP: one latest-videos fetch (depth
 * CAPTURE_DEPTH, default 20) is shared by every uncaptured post of the
 * account, so posts several days old on busy accounts still match and a
 * batch of missing posts on one account costs a single scrape. The fetch
 * also carries current stats for videos already captured, so those rows get
 * an opportunistic free refresh (snapshot only when the numbers changed).
 *
 * NEVER blocks or fails the posting path: every public function catches its
 * own errors, logs them, and unresolved rows are retried later by
 * retryUnresolvedCaptures (driven from the analytics-refresh cron).
 */

import prisma from "@/lib/db";
import type { AnalyticsProvider, ProviderVideo } from "./provider";
import { apifyProvider } from "./apify";
import { getOrgTimezone } from "@/lib/services/timezone";
import { rollupAccountsForDays, zonedDayString } from "./account-stats";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Recompute AccountDailyStat rows touched by a capture: today + yesterday
 * (opportunistic stats refreshes move those bars) plus the POST day of each
 * newly captured video (its first-snapshot views are attributed there).
 * Never throws.
 */
async function rollupAfterCapture(accountId: string, capturedPostDates: Date[]): Promise<void> {
  try {
    const tz = await getOrgTimezone();
    const now = Date.now();
    const days = new Set<string>([
      zonedDayString(new Date(now), tz),
      zonedDayString(new Date(now - DAY_MS), tz),
    ]);
    for (const d of capturedPostDates) days.add(zonedDayString(d, tz));
    await rollupAccountsForDays([accountId], days);
  } catch (err: any) {
    console.error(`[Capture] Post-capture rollup failed for account ${accountId}:`, err?.message || err);
  }
}

// PostPeer's publish CONFIRMATION lags the actual TikTok upload by several
// minutes (async publish + our poll interval), so a video's real createTime
// is almost always BEFORE our publishedAt — accept up to 20 min before and
// 5 min after confirmation.
const WINDOW_BEFORE_MS = 20 * 60 * 1000;
const WINDOW_AFTER_MS = 5 * 60 * 1000;

// Retry backoff per attempt count: after attempt 1 wait 1h, after 2 wait 6h,
// then 24h for every subsequent attempt.
const BACKOFF_MS = [0, 1 * 60 * 60 * 1000, 6 * 60 * 60 * 1000, 24 * 60 * 60 * 1000];

function backoffForAttempts(attempts: number): number {
  return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)];
}

/** Latest-videos depth for capture fetches (env CAPTURE_DEPTH, default 20). */
export function captureDepth(): number {
  const n = Number(process.env.CAPTURE_DEPTH);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
}

export function unresolvedPlaceholderId(postJobId: string): string {
  return `unresolved_${postJobId}`;
}

const TERMINAL_PUBLISHED_STATES = ["PUBLISHED", "PENDING_DELETION", "DELETED"];

type CaptureResult =
  | { status: "captured"; trackedVideoId: string; tiktokVideoId: string; confidence: string }
  | { status: "unresolved"; trackedVideoId: string; reason: string }
  | { status: "skipped"; reason: string };

/** Everything matchAndPersistCapture needs from a terminal-published PostJob. */
type CaptureJob = {
  id: string;
  accountId: string;
  campaignId: string | null;
  publishedAt: Date;
  tiktokPublishId: string | null;
  driveFileId: string;
  account: { tiktokUsername: string } | null;
};

/**
 * Match one job against an ALREADY-FETCHED latest-videos list and persist the
 * outcome: captured upsert (placeholder upgraded in place) + initial snapshot
 * + ScheduledPost URL writeback, or an unresolved placeholder. Shared by
 * captureVideoLink (single post) and captureAccountPosts (whole account) so
 * the matching rules can never drift between the two paths.
 */
async function matchAndPersistCapture(
  job: CaptureJob,
  videos: ProviderVideo[],
  now: Date
): Promise<CaptureResult> {
  const publishedAt = job.publishedAt;
  const windowStart = new Date(publishedAt.getTime() - WINDOW_BEFORE_MS);
  const windowEnd = new Date(publishedAt.getTime() + WINDOW_AFTER_MS);

  // Candidate must (a) be inside the publish window and (b) not already be
  // attributed to ANY TrackedVideo row (tiktokVideoId is globally unique).
  // This is what prevents double attribution when a human manually posts a
  // video on the same account inside the same window: the first job to
  // capture it owns the videoId, the other job goes unresolved instead of
  // stealing it. (The same-job case is already handled by the idempotency
  // early-return in the callers.)
  const inWindow = videos.filter(
    (v) => v.createTime >= windowStart && v.createTime <= windowEnd
  );

  const candidates: ProviderVideo[] = [];
  for (const v of inWindow) {
    const conflict = await prisma.trackedVideo.findFirst({
      where: { tiktokVideoId: v.videoId },
      select: { id: true },
    });
    if (conflict) continue;
    candidates.push(v);
  }

  // Prefer the candidate whose createTime is closest BEFORE publishedAt
  // (videos are always created before our confirmation); fall back to
  // closest overall only when nothing precedes it.
  const before = candidates.filter((v) => v.createTime <= publishedAt);
  const after = candidates.filter((v) => v.createTime > publishedAt);
  before.sort((a, b) => b.createTime.getTime() - a.createTime.getTime());
  after.sort((a, b) => a.createTime.getTime() - b.createTime.getTime());
  const ranked = [...before, ...after];

  const placeholderId = unresolvedPlaceholderId(job.id);

  if (candidates.length === 0) {
    const row = await prisma.trackedVideo.upsert({
      where: { tiktokVideoId: placeholderId },
      create: {
        tiktokVideoId: placeholderId,
        url: "",
        accountId: job.accountId,
        campaignId: job.campaignId,
        postJobId: job.id,
        publishedAt,
        captureMethod: "recent_match",
        status: "unresolved",
        captureAttempts: 1,
      },
      update: {
        status: "unresolved",
        captureAttempts: { increment: 1 },
      },
    });
    console.warn(
      `[Capture] No candidate for job ${job.id} (@${job.account?.tiktokUsername}, published ${publishedAt.toISOString()}) — marked unresolved`
    );
    return { status: "unresolved", trackedVideoId: row.id, reason: "no candidate in window" };
  }

  const match = ranked[0];
  const confidence = candidates.length === 1 ? "high" : "medium";

  try {
    // Upsert the placeholder (or create) as captured — never insert a
    // duplicate row for a job that already has an unresolved placeholder.
    const row = await prisma.trackedVideo.upsert({
      where: { tiktokVideoId: placeholderId },
      create: {
        tiktokVideoId: match.videoId,
        url: match.url,
        accountId: job.accountId,
        campaignId: job.campaignId,
        postJobId: job.id,
        publishedAt,
        captureMethod: "recent_match",
        confidence,
        status: "captured",
        views: match.views,
        likes: match.likes,
        comments: match.comments,
        shares: match.shares,
        lastRefreshedAt: now,
      },
      update: {
        tiktokVideoId: match.videoId,
        url: match.url,
        campaignId: job.campaignId,
        captureMethod: "recent_match",
        confidence,
        status: "captured",
        capturedAt: now, // placeholder upgraded now — the capture happened today
        views: match.views,
        likes: match.likes,
        comments: match.comments,
        shares: match.shares,
        lastRefreshedAt: now,
        captureAttempts: { increment: 1 },
      },
    });

    // Initial snapshot so per-day trend data starts at capture day.
    await prisma.videoStatSnapshot.create({
      data: {
        trackedVideoId: row.id,
        views: match.views,
        likes: match.likes,
        comments: match.comments,
        shares: match.shares,
      },
    });

    // Write the REAL video URL back to the ScheduledPost so the History
    // page links to the video, not the profile (PostPeer often returns
    // only a profile URL in platformPostUrl).
    await prisma.scheduledPost.updateMany({
      where: {
        accountId: job.accountId,
        OR: [
          { tiktokPublishId: job.tiktokPublishId ?? undefined },
          { driveFileId: job.driveFileId },
        ],
      },
      data: { tiktokPostUrl: match.url },
    });

    console.log(
      `[Capture] Job ${job.id} → video ${match.videoId} (confidence ${confidence}, ${candidates.length} candidate(s))`
    );
    return {
      status: "captured",
      trackedVideoId: row.id,
      tiktokVideoId: match.videoId,
      confidence,
    };
  } catch (err: any) {
    // Unique race: another capture claimed this videoId concurrently.
    console.error(`[Capture] Failed to persist capture for job ${job.id}:`, err?.message || err);
    return { status: "unresolved", trackedVideoId: "", reason: "persist failed (unique conflict)" };
  }
}

/**
 * Opportunistic stats refresh from a capture fetch: the latest-videos call
 * already carries current stats, so every fetched video that is ALREADY
 * captured (any account/post) is updated for free — views/likes/comments/
 * shares + lastRefreshedAt + unchangedViewsStreak (same semantics as
 * applyStatsUpdate in refresh.ts). A VideoStatSnapshot is written ONLY when
 * the numbers actually changed, so a second identical run adds zero
 * snapshots. Videos captured moments ago in this same run are skipped (they
 * already carry these stats and a fresh snapshot). Returns rows updated.
 */
async function refreshFetchedStats(
  videos: ProviderVideo[],
  now: Date,
  skipVideoIds: Set<string>
): Promise<number> {
  const candidates = videos.filter((v) => !skipVideoIds.has(v.videoId));
  if (candidates.length === 0) return 0;

  const rows = await prisma.trackedVideo.findMany({
    where: {
      tiktokVideoId: { in: candidates.map((v) => v.videoId) },
      status: { not: "unresolved" },
    },
    select: {
      id: true,
      tiktokVideoId: true,
      views: true,
      likes: true,
      comments: true,
      shares: true,
      unchangedViewsStreak: true,
    },
  });
  const byId = new Map(rows.map((r) => [r.tiktokVideoId, r]));

  let refreshed = 0;
  for (const v of candidates) {
    const row = byId.get(v.videoId);
    if (!row) continue;
    const changed =
      row.views !== v.views ||
      row.likes !== v.likes ||
      row.comments !== v.comments ||
      row.shares !== v.shares;
    await prisma.trackedVideo.update({
      where: { id: row.id },
      data: {
        views: v.views,
        likes: v.likes,
        comments: v.comments,
        shares: v.shares,
        lastRefreshedAt: now,
        unchangedViewsStreak: row.views === v.views ? row.unchangedViewsStreak + 1 : 0,
      },
    });
    if (changed) {
      await prisma.videoStatSnapshot.create({
        data: {
          trackedVideoId: row.id,
          views: v.views,
          likes: v.likes,
          comments: v.comments,
          shares: v.shares,
        },
      });
    }
    refreshed++;
  }
  return refreshed;
}

/**
 * Attempt to capture the TikTok video for a terminal-published PostJob.
 * Idempotent: an already-captured row for this job is returned as-is.
 * All errors are caught and logged — this never throws.
 */
export async function captureVideoLink(
  postJobId: string,
  provider: AnalyticsProvider = apifyProvider
): Promise<CaptureResult> {
  try {
    const job = await prisma.postJob.findUnique({
      where: { id: postJobId },
      include: { account: { select: { tiktokUsername: true } } },
    });

    if (!job) return { status: "skipped", reason: "job not found" };
    if (!TERMINAL_PUBLISHED_STATES.includes(job.state) || !job.publishedAt) {
      return { status: "skipped", reason: `job not terminal-published (state ${job.state})` };
    }
    if (!job.account?.tiktokUsername) {
      return { status: "skipped", reason: "account has no tiktokUsername" };
    }

    // Idempotency: already captured for this job → done.
    const existing = await prisma.trackedVideo.findFirst({
      where: { postJobId: job.id, status: "captured" },
    });
    if (existing) {
      return {
        status: "captured",
        trackedVideoId: existing.id,
        tiktokVideoId: existing.tiktokVideoId,
        confidence: existing.confidence,
      };
    }

    const latest = await provider.fetchLatestVideosForAccount(
      job.account.tiktokUsername,
      captureDepth(),
      { source: "capture", refId: postJobId }
    );

    const res = await matchAndPersistCapture(
      { ...job, publishedAt: job.publishedAt },
      latest,
      new Date()
    );
    if (res.status === "captured") {
      await rollupAfterCapture(job.accountId, [job.publishedAt]);
    }
    return res;
  } catch (err: any) {
    console.error(`[Capture] captureVideoLink(${postJobId}) failed:`, err?.message || err);
    return { status: "skipped", reason: err?.message || String(err) };
  }
}

export interface CaptureAccountResult {
  attempted: number;
  captured: number;
  unresolved: number;
  refreshed: number; // already-captured videos stats-refreshed for free by the same fetch
}

/**
 * Capture EVERY uncaptured terminal-published PostJob of one account from a
 * SINGLE latest-videos fetch (depth CAPTURE_DEPTH, default 20 — deep enough
 * that posts several days old on busy accounts still match). No uncaptured
 * jobs → returns early WITHOUT a provider call (zero cost).
 *
 * The fetch also carries current stats for the account's already-captured
 * videos, so those rows get an opportunistic refresh (snapshot only on
 * change) at no extra cost. Never throws.
 */
export async function captureAccountPosts(
  accountId: string,
  opts?: { depth?: number },
  provider: AnalyticsProvider = apifyProvider
): Promise<CaptureAccountResult> {
  const result: CaptureAccountResult = { attempted: 0, captured: 0, unresolved: 0, refreshed: 0 };
  try {
    const account = await prisma.managedAccount.findUnique({
      where: { id: accountId },
      select: { tiktokUsername: true },
    });
    if (!account?.tiktokUsername) return result;

    const jobs = await prisma.postJob.findMany({
      where: {
        accountId,
        state: { in: TERMINAL_PUBLISHED_STATES },
        publishedAt: { not: null },
      },
      select: {
        id: true,
        accountId: true,
        campaignId: true,
        publishedAt: true,
        tiktokPublishId: true,
        driveFileId: true,
      },
      orderBy: { publishedAt: "desc" },
    });
    if (jobs.length === 0) return result;

    const tracked = await prisma.trackedVideo.findMany({
      where: { postJobId: { in: jobs.map((j) => j.id) }, status: { not: "unresolved" } },
      select: { postJobId: true },
    });
    const doneJobIds = new Set(tracked.map((t) => t.postJobId));
    const uncaptured: CaptureJob[] = jobs
      .filter((j) => !doneJobIds.has(j.id) && j.publishedAt !== null)
      .map((j) => ({
        ...j,
        publishedAt: j.publishedAt as Date,
        account: { tiktokUsername: account.tiktokUsername },
      }));
    if (uncaptured.length === 0) return result; // nothing to do — no provider call

    const depth = opts?.depth ?? captureDepth();
    const videos = await provider.fetchLatestVideosForAccount(account.tiktokUsername, depth, {
      source: "capture",
      refId: accountId,
    });
    const now = new Date();

    const justCaptured = new Set<string>();
    const capturedPostDates: Date[] = [];
    for (const job of uncaptured) {
      result.attempted++;
      const res = await matchAndPersistCapture(job, videos, now);
      if (res.status === "captured") {
        result.captured++;
        justCaptured.add(res.tiktokVideoId);
        capturedPostDates.push(job.publishedAt);
      } else if (res.status === "unresolved") {
        result.unresolved++;
      }
    }

    result.refreshed = await refreshFetchedStats(videos, now, justCaptured);
    if (result.captured > 0 || result.refreshed > 0) {
      await rollupAfterCapture(accountId, capturedPostDates);
    }
    console.log(
      `[Capture] Account @${account.tiktokUsername}: attempted=${result.attempted} captured=${result.captured} unresolved=${result.unresolved} refreshed=${result.refreshed} (depth ${depth})`
    );
    return result;
  } catch (err: any) {
    console.error(`[Capture] captureAccountPosts(${accountId}) failed:`, err?.message || err);
    return result;
  }
}

/**
 * Re-run capture for unresolved rows — most recent (last 48h) first —
 * honoring per-attempt backoff (1h, then 6h, then 24h). Grouped BY ACCOUNT:
 * an account is eligible when it has at least one backoff-ready row, then ONE
 * scrape (captureAccountPosts) retries all of that account's uncaptured
 * posts. `limit` caps ACCOUNTS scraped per pass. Never throws.
 */
export async function retryUnresolvedCaptures(
  limit = 20,
  provider: AnalyticsProvider = apifyProvider
): Promise<{ retried: number; captured: number; stillUnresolved: number; skippedBackoff: number }> {
  const summary = { retried: 0, captured: 0, stillUnresolved: 0, skippedBackoff: 0 };
  let refreshed = 0;
  try {
    const rows = await prisma.trackedVideo.findMany({
      where: { status: "unresolved", postJobId: { not: null } },
      // Published within the last 48h first — older ones fill remaining slots.
      orderBy: { publishedAt: "desc" },
      take: limit * 3, // over-fetch: backoff filtering happens below
    });

    const now = Date.now();
    const backoffReady = rows.filter(
      (r) => now - r.updatedAt.getTime() >= backoffForAttempts(r.captureAttempts)
    );
    summary.skippedBackoff = rows.length - backoffReady.length;

    // One scrape per eligible account (ready rows first — rows are already
    // newest-first, so the newest accounts win the limited slots).
    const eligibleAccountIds: string[] = [];
    for (const row of backoffReady) {
      if (!eligibleAccountIds.includes(row.accountId)) eligibleAccountIds.push(row.accountId);
      if (eligibleAccountIds.length >= limit) break;
    }

    for (const accountId of eligibleAccountIds) {
      summary.retried++;
      const res = await captureAccountPosts(accountId, {}, provider);
      summary.captured += res.captured;
      summary.stillUnresolved += res.unresolved;
      refreshed += res.refreshed;
    }
  } catch (err: any) {
    console.error("[Capture] retryUnresolvedCaptures failed:", err?.message || err);
  }
  console.log(
    `[Capture] Retry pass: retried=${summary.retried} captured=${summary.captured} stillUnresolved=${summary.stillUnresolved} backoffSkipped=${summary.skippedBackoff} refreshed=${refreshed}`
  );
  return summary;
}
