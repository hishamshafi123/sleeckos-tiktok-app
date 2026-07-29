/**
 * Campaign link capture — links a published PostJob back to its TikTok video
 * by scraping the account's latest videos via the analytics provider (Apify)
 * and matching on publish time.
 *
 * NEVER blocks or fails the posting path: every public function catches its
 * own errors, logs them, and unresolved rows are retried later by
 * retryUnresolvedCaptures (driven from the analytics-refresh cron).
 */

import prisma from "@/lib/db";
import { AnalyticsProvider, ProviderVideo } from "./provider";
import { apifyProvider } from "./apify";

// A candidate is accepted only if its createTime falls within
// [publishedAt - 2min, publishedAt + 15min].
const WINDOW_BEFORE_MS = 2 * 60 * 1000;
const WINDOW_AFTER_MS = 15 * 60 * 1000;

// Retry backoff per attempt count: after attempt 1 wait 1h, after 2 wait 6h,
// then 24h for every subsequent attempt.
const BACKOFF_MS = [0, 1 * 60 * 60 * 1000, 6 * 60 * 60 * 1000, 24 * 60 * 60 * 1000];

function backoffForAttempts(attempts: number): number {
  return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)];
}

export function unresolvedPlaceholderId(postJobId: string): string {
  return `unresolved_${postJobId}`;
}

const TERMINAL_PUBLISHED_STATES = ["PUBLISHED", "PENDING_DELETION", "DELETED"];

type CaptureResult =
  | { status: "captured"; trackedVideoId: string; tiktokVideoId: string; confidence: string }
  | { status: "unresolved"; trackedVideoId: string; reason: string }
  | { status: "skipped"; reason: string };

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

    const publishedAt = job.publishedAt;
    const windowStart = new Date(publishedAt.getTime() - WINDOW_BEFORE_MS);
    const windowEnd = new Date(publishedAt.getTime() + WINDOW_AFTER_MS);

    const latest = await provider.fetchLatestVideosForAccount(
      job.account.tiktokUsername,
      5
    );

    // Candidate must (a) be inside the publish window and (b) not already be
    // attributed to ANY TrackedVideo row (tiktokVideoId is globally unique).
    // This is what prevents double attribution when a human manually posts a
    // video on the same account inside the same window: the first job to
    // capture it owns the videoId, the other job goes unresolved instead of
    // stealing it. (The same-job case is already handled by the idempotency
    // early-return above.)
    const inWindow = latest.filter(
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

    // Closest to publishedAt wins.
    candidates.sort(
      (a, b) =>
        Math.abs(a.createTime.getTime() - publishedAt.getTime()) -
        Math.abs(b.createTime.getTime() - publishedAt.getTime())
    );

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
        `[Capture] No candidate for job ${job.id} (@${job.account.tiktokUsername}, published ${publishedAt.toISOString()}) — marked unresolved`
      );
      return { status: "unresolved", trackedVideoId: row.id, reason: "no candidate in window" };
    }

    const match = candidates[0];
    const confidence = candidates.length === 1 ? "high" : "medium";
    const now = new Date();

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
  } catch (err: any) {
    console.error(`[Capture] captureVideoLink(${postJobId}) failed:`, err?.message || err);
    return { status: "skipped", reason: err?.message || String(err) };
  }
}

/**
 * Re-run capture for unresolved rows — most recent (last 48h) first — honoring
 * per-attempt backoff (1h, then 6h, then 24h). Never throws.
 */
export async function retryUnresolvedCaptures(
  limit = 20,
  provider: AnalyticsProvider = apifyProvider
): Promise<{ retried: number; captured: number; stillUnresolved: number; skippedBackoff: number }> {
  const summary = { retried: 0, captured: 0, stillUnresolved: 0, skippedBackoff: 0 };
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
    const eligible = backoffReady.slice(0, limit);
    summary.skippedBackoff = rows.length - backoffReady.length;

    for (const row of eligible) {
      summary.retried++;
      const res = await captureVideoLink(row.postJobId!, provider);
      if (res.status === "captured") summary.captured++;
      else if (res.status === "unresolved") summary.stillUnresolved++;
    }
  } catch (err: any) {
    console.error("[Capture] retryUnresolvedCaptures failed:", err?.message || err);
  }
  console.log(
    `[Capture] Retry pass: retried=${summary.retried} captured=${summary.captured} stillUnresolved=${summary.stillUnresolved} backoffSkipped=${summary.skippedBackoff}`
  );
  return summary;
}
