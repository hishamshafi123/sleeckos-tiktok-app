/**
 * Daily per-account sweep — the primary (and cheapest) link-capture and
 * stats-refresh path.
 *
 * Instead of one Apify call per post, we make ONE profile call per active
 * account per day (latest N videos, default 5) and use that single payload
 * for two things:
 *
 *  1. CAPTURE — match terminal-published PostJobs that have no captured
 *     TrackedVideo yet to a video in the payload:
 *       a. Caption match (campaign jobs): the video description starts with
 *          one of the campaign's fixedTexts. Strong captions (normalized
 *          length ≥ 15) match on prefix alone; weak captions (3–14 chars)
 *          must also sit within ±30 min of the confirmed publish AND be the
 *          only candidate (same two-tier rule as recover.ts).
 *       b. Time-window fallback (also the only rule for non-campaign jobs):
 *          video createTime within [publishedAt − 20 min, publishedAt + 5 min]
 *          (same window as capture.ts — PostPeer's confirmation lags the real
 *          TikTok upload, so createTime is almost always before publishedAt).
 *     On a match: upsert the TrackedVideo (captureMethod "daily_sweep"),
 *     write the initial snapshot, and write the real video URL back to the
 *     ScheduledPost so History links to the video, not the profile.
 *
 *  2. REFRESH — every payload video already attributed to a captured
 *     TrackedVideo gets its stats + lastRefreshedAt updated and a per-IST-day
 *     snapshot. This costs nothing extra (the data is already in the
 *     payload), so fresh videos effectively get a daily stats update for free.
 *     Older videos that scrolled past the N-deep profile window are still
 *     handled by the tiered analytics-refresh cron.
 *
 * Safety rails (same as capture.ts / recover.ts):
 *  - A videoId already attributed to ANY TrackedVideo row is never stolen,
 *    and within a sweep each videoId is handed out at most once.
 *  - PAUSED campaigns are never swept: their jobs are not matched and their
 *    captured videos are not stats-refreshed (same "off switch" the posting
 *    pipeline uses). Jobs with no campaign are still captured (time-window
 *    match) so History links stay correct; per their standing rule they are
 *    not stats-refreshed.
 *  - Jobs that match nothing are NOT marked unresolved — tomorrow's sweep
 *    retries them while they're inside the lookback window. The campaign
 *    "Recover links" button (fetches 50 deep) is the backstop for
 *    high-volume accounts where a post scrolls past the N-deep window
 *    before the next sweep.
 *  - auth / rate_limited provider errors abort the whole run; a transient
 *    error on one account skips that account and continues.
 *
 * Run rows are AnalyticsRun type "sweep". Runs are one-shot (no resume
 * cursor) — a crashed run simply re-runs the next day.
 *
 * Env:
 *   SWEEP_LOOKBACK_DAYS  accounts/jobs considered active, default 7
 *   SWEEP_MAX_VIDEOS     latest videos fetched per account, default 5
 *   SWEEP_SLEEP_MS       pause between account calls, default 500
 */

import prisma from "@/lib/db";
import { ProviderError } from "./provider";
import type { AnalyticsProvider, ProviderVideo } from "./provider";
import { apifyProvider } from "./apify";
import { normalizeCaption } from "./recover";
import { unresolvedPlaceholderId } from "./capture";
import { ensureDailySnapshot } from "./refresh";
import { getOrgTimezone } from "@/lib/services/timezone";

const TERMINAL_PUBLISHED_STATES = ["PUBLISHED", "PENDING_DELETION", "DELETED"];

const LOOKBACK_DAYS = Number(process.env.SWEEP_LOOKBACK_DAYS) || 7;
const MAX_VIDEOS = Number(process.env.SWEEP_MAX_VIDEOS) || 5;
const SLEEP_MS = Number(process.env.SWEEP_SLEEP_MS) || 500;

const WINDOW_BEFORE_MS = 20 * 60 * 1000;
const WINDOW_AFTER_MS = 5 * 60 * 1000;
const WEAK_MATCH_WINDOW_MS = 30 * 60 * 1000;
const MIN_STRONG_CAPTION_LENGTH = 15;
const MIN_CAPTION_LENGTH = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CaptionPool {
  strong: string[];
  weak: string[];
}

interface CampaignInfo {
  status: string;
  pool: CaptionPool | null;
}

export interface SweepSummary {
  runId: string;
  accountsSwept: number;
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  refreshed: number;
}

/**
 * Run the daily account sweep. Awaits the full pass — callers that must not
 * block (cron route) should background the invocation.
 */
export async function runDailyAccountSweep(
  provider: AnalyticsProvider = apifyProvider
): Promise<SweepSummary> {
  const now = new Date();
  const timezone = await getOrgTimezone();
  const since = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS);

  const run = await prisma.analyticsRun.create({ data: { type: "sweep" } });
  const counters = { attempted: 0, succeeded: 0, failed: 0, skipped: 0 };
  let accountsSwept = 0;
  let refreshed = 0;

  const saveProgress = async (status?: string, error?: string) => {
    await prisma.analyticsRun.update({
      where: { id: run.id },
      data: {
        ...counters,
        ...(status ? { status } : {}),
        ...(error !== undefined ? { error } : {}),
        ...(status === "done" || status === "failed" ? { finishedAt: new Date() } : {}),
      },
    });
  };

  // ── Accounts with recent publishing activity ─────────────────────────────
  const accountRows = await prisma.postJob.findMany({
    where: {
      state: { in: TERMINAL_PUBLISHED_STATES },
      publishedAt: { gte: since },
    },
    select: { accountId: true },
    distinct: ["accountId"],
  });
  const accounts = await prisma.managedAccount.findMany({
    where: { id: { in: accountRows.map((r) => r.accountId) } },
    select: { id: true, tiktokUsername: true },
  });

  // Campaign info (status + caption pool) cached per campaign.
  const campaignCache = new Map<string, CampaignInfo | null>();
  const getCampaignInfo = async (campaignId: string): Promise<CampaignInfo | null> => {
    if (campaignCache.has(campaignId)) return campaignCache.get(campaignId)!;
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { status: true, fixedTexts: true },
    });
    if (!campaign) {
      campaignCache.set(campaignId, null);
      return null;
    }
    const all = [
      ...new Set(
        (campaign.fixedTexts ?? [])
          .map(normalizeCaption)
          .filter((c) => c.length >= MIN_CAPTION_LENGTH)
      ),
    ];
    const pool: CaptionPool | null =
      all.length === 0
        ? null
        : {
            strong: all.filter((c) => c.length >= MIN_STRONG_CAPTION_LENGTH),
            weak: all.filter((c) => c.length < MIN_STRONG_CAPTION_LENGTH),
          };
    const info: CampaignInfo = { status: campaign.status, pool };
    campaignCache.set(campaignId, info);
    return info;
  };
  const isPaused = async (campaignId: string): Promise<boolean> =>
    (await getCampaignInfo(campaignId))?.status === "PAUSED";

  // ── Per-account sweep ────────────────────────────────────────────────────
  for (const account of accounts) {
    if (!account.tiktokUsername) {
      console.warn(`[Sweep] Account ${account.id} has no tiktokUsername — skipped`);
      continue;
    }

    let latest: ProviderVideo[];
    try {
      latest = await provider.fetchLatestVideosForAccount(account.tiktokUsername, MAX_VIDEOS);
    } catch (err: any) {
      if (err instanceof ProviderError && (err.kind === "auth" || err.kind === "rate_limited")) {
        console.error(`[Sweep] Run ${run.id} aborted (${err.kind}): ${err.message}`);
        await saveProgress("failed", `${err.kind}: ${err.message}`);
        return { runId: run.id, accountsSwept, ...counters, refreshed };
      }
      console.error(
        `[Sweep] Latest-videos fetch failed for @${account.tiktokUsername} (transient): ${err?.message || err}`
      );
      if (accounts[accounts.length - 1] !== account) await sleep(SLEEP_MS);
      continue;
    }
    accountsSwept++;

    // Videos already attributed to ANY TrackedVideo row are untouchable for
    // matching — but they DO get a free stats refresh from this payload
    // (unless their campaign is PAUSED — paused campaigns are never swept).
    const tracked = await prisma.trackedVideo.findMany({
      where: { tiktokVideoId: { in: latest.map((v) => v.videoId) } },
      select: { id: true, tiktokVideoId: true, status: true, campaignId: true },
    });
    const trackedById = new Map(tracked.map((t) => [t.tiktokVideoId, t]));

    for (const v of latest) {
      const row = trackedById.get(v.videoId);
      if (!row || row.status !== "captured") continue;
      if (row.campaignId && (await isPaused(row.campaignId))) continue;
      try {
        const stats = { views: v.views, likes: v.likes, comments: v.comments, shares: v.shares };
        await prisma.trackedVideo.update({
          where: { id: row.id },
          data: { ...stats, lastRefreshedAt: now },
        });
        await ensureDailySnapshot(row.id, stats, timezone, now);
        refreshed++;
      } catch (err: any) {
        console.error(`[Sweep] Stats update failed for video ${v.videoId}:`, err?.message || err);
      }
    }

    // ── Uncaptured terminal-published jobs for this account ────────────────
    const jobs = await prisma.postJob.findMany({
      where: {
        accountId: account.id,
        state: { in: TERMINAL_PUBLISHED_STATES },
        publishedAt: { gte: since },
      },
      orderBy: { publishedAt: "asc" },
    });
    const capturedRows = await prisma.trackedVideo.findMany({
      where: { postJobId: { in: jobs.map((j) => j.id) }, status: "captured" },
      select: { postJobId: true },
    });
    const capturedJobIds = new Set(capturedRows.map((r) => r.postJobId));
    const missing = jobs.filter((j) => !capturedJobIds.has(j.id));
    counters.attempted += missing.length;

    const usedVideoIds = new Set<string>();

    for (const job of missing) {
      if (!job.publishedAt) {
        counters.skipped++;
        continue;
      }
      const publishedMs = job.publishedAt.getTime();
      const available = latest.filter(
        (v) => !trackedById.has(v.videoId) && !usedVideoIds.has(v.videoId)
      );

      let match: ProviderVideo | null = null;
      let confidence = "high";

      // (a) Caption match for campaign jobs. PAUSED campaigns are never
      // swept — their jobs stay uncaptured until the campaign is resumed.
      if (job.campaignId) {
        const info = await getCampaignInfo(job.campaignId);
        if (info?.status === "PAUSED") {
          counters.skipped++;
          continue;
        }
        const pool = info?.pool;
        if (pool) {
          const strongMatches = available
            .filter((v) =>
              pool.strong.some((c) => normalizeCaption(v.text || "").startsWith(c))
            )
            .sort(
              (a, b) =>
                Math.abs(a.createTime.getTime() - publishedMs) -
                Math.abs(b.createTime.getTime() - publishedMs)
            );
          if (strongMatches.length > 0) {
            match = strongMatches[0];
            confidence = strongMatches.length === 1 ? "high" : "medium";
          } else if (pool.weak.length > 0) {
            const weakMatches = available
              .filter((v) =>
                pool.weak.some((c) => normalizeCaption(v.text || "").startsWith(c))
              )
              .filter((v) => Math.abs(v.createTime.getTime() - publishedMs) <= WEAK_MATCH_WINDOW_MS);
            if (weakMatches.length === 1) {
              match = weakMatches[0];
              confidence = "low"; // short caption + time window — less certain
            }
          }
        }
      }

      // (b) Time-window fallback (only rule for non-campaign jobs).
      if (!match) {
        const inWindow = available.filter(
          (v) =>
            v.createTime.getTime() >= publishedMs - WINDOW_BEFORE_MS &&
            v.createTime.getTime() <= publishedMs + WINDOW_AFTER_MS
        );
        // Prefer the candidate closest BEFORE publishedAt (videos are created
        // before our confirmation); fall back to closest overall.
        const before = inWindow
          .filter((v) => v.createTime.getTime() <= publishedMs)
          .sort((a, b) => b.createTime.getTime() - a.createTime.getTime());
        const after = inWindow
          .filter((v) => v.createTime.getTime() > publishedMs)
          .sort((a, b) => a.createTime.getTime() - b.createTime.getTime());
        const ranked = [...before, ...after];
        if (ranked.length > 0) {
          match = ranked[0];
          confidence = inWindow.length === 1 ? "high" : "medium";
        }
      }

      if (!match) {
        // No placeholder row: tomorrow's sweep retries while the job is inside
        // the lookback window; the Recover button is the deep backstop.
        counters.skipped++;
        continue;
      }

      usedVideoIds.add(match.videoId);
      const placeholderId = unresolvedPlaceholderId(job.id);

      try {
        const row = await prisma.trackedVideo.upsert({
          where: { tiktokVideoId: placeholderId },
          create: {
            tiktokVideoId: match.videoId,
            url: match.url,
            accountId: job.accountId,
            campaignId: job.campaignId,
            postJobId: job.id,
            publishedAt: job.publishedAt,
            captureMethod: "daily_sweep",
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
            captureMethod: "daily_sweep",
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

        await prisma.videoStatSnapshot.create({
          data: {
            trackedVideoId: row.id,
            views: match.views,
            likes: match.likes,
            comments: match.comments,
            shares: match.shares,
          },
        });

        // Write the REAL video URL back to the ScheduledPost (same pattern as
        // capture.ts) so the History page links to the video, not the profile.
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
          `[Sweep] Job ${job.id} → video ${match.videoId} (@${account.tiktokUsername}, confidence ${confidence})`
        );
        counters.succeeded++;
      } catch (err: any) {
        console.error(`[Sweep] Failed to persist capture for job ${job.id}:`, err?.message || err);
        counters.failed++;
      }
    }

    await saveProgress();
    if (accounts[accounts.length - 1] !== account) await sleep(SLEEP_MS);
  }

  await saveProgress("done");
  console.log(
    `[Sweep] Run ${run.id} done: accounts=${accountsSwept} attempted=${counters.attempted} captured=${counters.succeeded} failed=${counters.failed} skipped=${counters.skipped} refreshed=${refreshed}`
  );
  return { runId: run.id, accountsSwept, ...counters, refreshed };
}
