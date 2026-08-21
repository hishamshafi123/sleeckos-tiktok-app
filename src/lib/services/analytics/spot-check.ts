/**
 * Campaign Spot-Check — operator-driven sampling of a campaign's recent posts.
 *
 * The operator picks campaigns + a sample size, previews the last N
 * terminal-published PostJobs per campaign (free — DB only), then presses one
 * button that does BOTH:
 *  1. CAPTURE PASS — sample posts with no link yet are matched to a video via
 *     one profile call per account (fetchLatestVideosForAccount) and the
 *     shared captureJobsFromAccountVideos matcher (same rules as the daily
 *     sweep; captureMethod "spot_check"). New links get stats straight from
 *     the payload — no extra call.
 *  2. REFRESH PASS — batched fetchStatsForVideoUrls for the sample's
 *     previously-captured videos.
 * Each paid run is saved as a CampaignSpotCheck row so the next run can
 * compare averages against the previous one.
 *
 * Cost rules (operator policy, same as refresh.ts / sweep.ts):
 * - Only "captured" TrackedVideos are ever sent to fetchStatsForVideoUrls.
 *   "dormant" (0-view) and "unavailable" links are excluded from ALL paid
 *   refreshes, including this manual one.
 * - sampleSize ≤ 100 per campaign; ≤ MAX_REFRESH_TARGETS videos per run
 *   counting refreshed + newly-captured combined (checked up front against
 *   the worst case: captured links + link-less posts); ≤ MAX_ACCOUNT_LOOKUPS
 *   profile calls per run (excess accounts skipped and reported). Beyond
 *   these the run is rejected with a SpotCheckGuardrailError.
 *
 * JSON note: CampaignSpotCheck.totalsJson stores view counts as plain numbers
 * because JSON cannot serialize BigInt (safe — view counts << 2^53).
 */

import prisma from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { can } from "@/lib/services/permissions";
import { getOrgTimezone } from "@/lib/services/timezone";
import { TERMINAL_PUBLISHED_STATES } from "@/lib/services/analytics/account-stats";
import { ensureDailySnapshot } from "@/lib/services/analytics/refresh";
import {
  captureJobsFromAccountVideos,
  type CampaignInfoCache,
  type CaptureJobInput,
} from "@/lib/services/analytics/sweep";
import { ProviderError } from "./provider";
import type { AnalyticsProvider } from "./provider";
import { apifyProvider } from "./apify";

export const SPOT_CHECK_SAMPLE_SIZES = [10, 25, 50, 100] as const;
export const MAX_SAMPLE_SIZE = 100;
export const MAX_REFRESH_TARGETS = 400;
export const MAX_ACCOUNT_LOOKUPS = 25;
const BATCH_SIZE = 25;
const HISTORY_LIMIT = 20;
const SLEEP_BETWEEN_CALLS_MS = 500;
// Profile-fetch depth per account: enough to cover the account's uncaptured
// sample posts, min 5 (same as the sweep), capped at 15.
const ACCOUNT_LOOKUP_MIN_DEPTH = 5;
const ACCOUNT_LOOKUP_MAX_DEPTH = 15;

export class ForbiddenError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "ForbiddenError";
  }
}

/** Input validation / cost-guardrail rejection — routes map this to 400. */
export class SpotCheckGuardrailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpotCheckGuardrailError";
  }
}

async function assertAccess(userId: string): Promise<void> {
  if (!(await can(userId, "analytics"))) throw new ForbiddenError();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Types (API contract) ─────────────────────────────────────────────────────

export interface SpotCheckPostRow {
  postJobId: string;
  publishedAt: string; // ISO
  accountId: string;
  accountHandle: string; // tiktok username, no "@"
  link: string; // video URL, or the account profile URL as fallback
  linkIsProfileFallback: boolean;
  video: {
    id: string;
    url: string;
    views: number;
    likes: number;
    lastRefreshedAt: string | null; // ISO
    status: string; // captured | unresolved | unavailable | dormant
  } | null;
}

export interface SpotCheckCampaignSample {
  campaignId: string;
  title: string;
  posts: SpotCheckPostRow[];
  withLinks: number; // rows linked to a TrackedVideo
  withStats: number; // rows whose TrackedVideo has stats (captured/dormant/unavailable)
  avgViews: number | null; // mean views over rows with stats; null when none
}

export interface SpotCheckSample {
  sampleSize: number;
  campaigns: SpotCheckCampaignSample[];
}

/** Per-campaign totals as persisted in CampaignSpotCheck.totalsJson. */
export interface SpotCheckTotalsEntry {
  campaignId: string;
  title: string;
  posts: number;
  withLinks: number;
  withStats: number;
  avgViews: number | null;
}

export interface SpotCheckRunSummary {
  id: string;
  createdAt: string; // ISO
  createdBy: string | null;
  campaignIds: string[];
  sampleSize: number;
  refreshedCount: number; // pre-existing captured links refreshed via fetchStatsForVideoUrls
  capturedNow: number; // links found by this run's capture pass
  noMatch: number; // sampled posts still without a link after the run
  accountLookups: number; // paid profile calls made by the capture pass
  totals: SpotCheckTotalsEntry[];
}

/** Capture-pass breakdown returned alongside a run (not persisted per-post). */
export interface SpotCheckCaptureSummary {
  accountLookups: number;
  capturedNow: number;
  noMatch: number;
  unmatchedPostJobIds: string[]; // sample posts still link-less after the run
  skippedAccounts: string[]; // handles skipped by the MAX_ACCOUNT_LOOKUPS guardrail
}

export interface SpotCheckRunResult {
  run: SpotCheckRunSummary;
  sample: SpotCheckSample; // fresh, post-capture + post-refresh
  previousRun: SpotCheckRunSummary | null; // most recent prior run with overlapping campaigns
  aborted: { kind: string; message: string } | null; // set when auth/rate_limited cut the run short
  capture: SpotCheckCaptureSummary;
}

// ── Validation ───────────────────────────────────────────────────────────────

function validateInputs(campaignIds: string[], sampleSize: number): string[] {
  const ids = [...new Set(campaignIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (ids.length === 0) {
    throw new SpotCheckGuardrailError("Select at least one campaign.");
  }
  if (!Number.isInteger(sampleSize) || sampleSize < 1 || sampleSize > MAX_SAMPLE_SIZE) {
    throw new SpotCheckGuardrailError(
      `Sample size must be a whole number between 1 and ${MAX_SAMPLE_SIZE}.`
    );
  }
  return ids;
}

// ── Sample building (free — DB only, no provider spend) ─────────────────────

interface SampleBuild {
  sample: SpotCheckSample;
  /** Full job records keyed by PostJob id — the capture pass needs these. */
  jobsById: Map<string, CaptureJobInput>;
}

async function buildSample(
  campaignIds: string[],
  sampleSize: number
): Promise<SampleBuild> {
  const campaigns = await prisma.campaign.findMany({
    where: { id: { in: campaignIds } },
    select: { id: true, title: true },
  });
  const titleById = new Map(campaigns.map((c) => [c.id, c.title]));

  // Last `sampleSize` terminal-published PostJobs per campaign. Per-campaign
  // queries keep each `take` bounded instead of windowing one big query.
  const jobsByCampaign = new Map<string, Awaited<ReturnType<typeof fetchJobs>>>();
  for (const id of campaignIds) {
    jobsByCampaign.set(id, await fetchJobs(id, sampleSize));
  }

  // Join account handles + linked TrackedVideos in two bulk queries.
  const accountIds = new Set<string>();
  const postJobIds: string[] = [];
  for (const jobs of jobsByCampaign.values()) {
    for (const j of jobs) {
      accountIds.add(j.accountId);
      postJobIds.push(j.id);
    }
  }

  const [accounts, videos] = await Promise.all([
    accountIds.size
      ? prisma.managedAccount.findMany({
          where: { id: { in: [...accountIds] } },
          select: { id: true, tiktokUsername: true },
        })
      : [],
    postJobIds.length
      ? prisma.trackedVideo.findMany({
          where: { postJobId: { in: postJobIds } },
          select: {
            id: true,
            postJobId: true,
            url: true,
            views: true,
            likes: true,
            lastRefreshedAt: true,
            status: true,
          },
        })
      : [],
  ]);
  const handleByAccount = new Map(accounts.map((a) => [a.id, a.tiktokUsername]));
  const videoByPostJob = new Map(videos.map((v) => [v.postJobId, v]));

  const out: SpotCheckCampaignSample[] = [];
  for (const id of campaignIds) {
    const title = titleById.get(id);
    if (!title) continue; // unknown campaign id — silently dropped from results
    const jobs = jobsByCampaign.get(id) ?? [];
    const rows: SpotCheckPostRow[] = jobs.map((j) => {
      const handle = handleByAccount.get(j.accountId) ?? "";
      const video = videoByPostJob.get(j.id) ?? null;
      return {
        postJobId: j.id,
        publishedAt: (j.publishedAt ?? j.updatedAt).toISOString(),
        accountId: j.accountId,
        accountHandle: handle,
        link: video ? video.url : `https://www.tiktok.com/@${handle}`,
        linkIsProfileFallback: !video,
        video: video
          ? {
              id: video.id,
              url: video.url,
              views: Number(video.views),
              likes: Number(video.likes),
              lastRefreshedAt: video.lastRefreshedAt?.toISOString() ?? null,
              status: video.status,
            }
          : null,
      };
    });
    out.push({ campaignId: id, title, ...summarizeRows(rows), posts: rows });
  }

  const jobsById = new Map<string, CaptureJobInput>();
  for (const [campaignId, jobs] of jobsByCampaign) {
    for (const j of jobs) {
      jobsById.set(j.id, {
        id: j.id,
        accountId: j.accountId,
        campaignId,
        publishedAt: j.publishedAt,
        tiktokPublishId: j.tiktokPublishId,
        driveFileId: j.driveFileId,
      });
    }
  }
  return { sample: { sampleSize, campaigns: out }, jobsById };

  function fetchJobs(campaignId: string, take: number) {
    return prisma.postJob.findMany({
      where: {
        campaignId,
        state: { in: TERMINAL_PUBLISHED_STATES },
        publishedAt: { not: null },
      },
      orderBy: { publishedAt: "desc" },
      take,
      select: {
        id: true,
        accountId: true,
        publishedAt: true,
        updatedAt: true,
        tiktokPublishId: true,
        driveFileId: true,
      },
    });
  }
}

function summarizeRows(rows: SpotCheckPostRow[]) {
  const withLinks = rows.filter((r) => r.video !== null).length;
  // "with stats" = link resolved to an actual video (unresolved links are
  // placeholders with no meaningful counters).
  const statsRows = rows.filter((r) => r.video !== null && r.video.status !== "unresolved");
  const withStats = statsRows.length;
  const avgViews =
    withStats > 0
      ? Math.round(statsRows.reduce((a, r) => a + r.video!.views, 0) / withStats)
      : null;
  return { withLinks, withStats, avgViews };
}

function totalsFromSample(sample: SpotCheckSample): SpotCheckTotalsEntry[] {
  return sample.campaigns.map((c) => ({
    campaignId: c.campaignId,
    title: c.title,
    posts: c.posts.length,
    withLinks: c.withLinks,
    withStats: c.withStats,
    avgViews: c.avgViews,
  }));
}

// ── Public services ──────────────────────────────────────────────────────────

/** Free preview: the sample as it currently stands in the DB. No provider spend. */
export async function getSpotCheckSample(
  userId: string,
  campaignIds: string[],
  sampleSize: number
): Promise<SpotCheckSample> {
  await assertAccess(userId);
  const ids = validateInputs(campaignIds, sampleSize);
  return (await buildSample(ids, sampleSize)).sample;
}

/** Campaign list for the picker (analytics permission, not campaigns). */
export async function getSpotCheckCampaigns(
  userId: string
): Promise<{ id: string; title: string; status: string }[]> {
  await assertAccess(userId);
  const campaigns = await prisma.campaign.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, status: true },
  });
  return campaigns;
}

function serializeRun(run: {
  id: string;
  createdAt: Date;
  createdBy: string | null;
  campaignIds: string[];
  sampleSize: number;
  refreshedCount: number;
  capturedNow: number;
  noMatch: number;
  accountLookups: number;
  totalsJson: unknown;
}): SpotCheckRunSummary {
  return {
    id: run.id,
    createdAt: run.createdAt.toISOString(),
    createdBy: run.createdBy,
    campaignIds: run.campaignIds,
    sampleSize: run.sampleSize,
    refreshedCount: run.refreshedCount,
    capturedNow: run.capturedNow,
    noMatch: run.noMatch,
    accountLookups: run.accountLookups,
    totals: (run.totalsJson as SpotCheckTotalsEntry[]) ?? [],
  };
}

/** Most recent prior run sharing at least one campaign with `campaignIds`. */
async function findPreviousRun(
  campaignIds: string[],
  excludeId?: string
): Promise<SpotCheckRunSummary | null> {
  const prev = await prisma.campaignSpotCheck.findFirst({
    where: {
      campaignIds: { hasSome: campaignIds },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return prev ? serializeRun(prev) : null;
}

/**
 * Paid run, two passes:
 *  1. CAPTURE — sample posts with no link yet (no TrackedVideo, or only an
 *     unresolved placeholder) are grouped by account; each account gets one
 *     fetchLatestVideosForAccount call (depth covers its uncaptured posts,
 *     min 5 / max 15) and the shared sweep matcher links what it can
 *     (captureMethod "spot_check", stats + snapshot from the payload, no
 *     extra call). At most MAX_ACCOUNT_LOOKUPS profile calls per run —
 *     accounts past the cap are skipped and reported in capture.skippedAccounts.
 *  2. REFRESH — batched fetchStatsForVideoUrls for the sample's previously-
 *     captured videos (dormant/unavailable are never sent to the provider).
 * Then a CampaignSpotCheck row is persisted and fresh results returned plus
 * the previous matching run for comparison.
 *
 * Provider failure policy mirrors refresh.ts/sweep.ts: auth/rate_limited
 * aborts the run (still saved with whatever succeeded, `aborted` set); a
 * transient account/batch failure is logged and the run continues.
 */
export async function runSpotCheck(
  userId: string,
  campaignIds: string[],
  sampleSize: number,
  provider: AnalyticsProvider = apifyProvider
): Promise<SpotCheckRunResult> {
  await assertAccess(userId);
  const ids = validateInputs(campaignIds, sampleSize);
  const timezone = await getOrgTimezone();
  const now = new Date();

  const { sample, jobsById } = await buildSample(ids, sampleSize);

  // Refresh targets: sampled rows with a captured TrackedVideo only.
  const targets = new Map<string, { id: string; tiktokUrl: string }>();
  // Capture candidates: rows with no link (dormant/unavailable rows already
  // HAVE a link — excluded here and from the paid refresh alike).
  const uncapturedJobIds: string[] = [];
  const handleByAccount = new Map<string, string>();
  for (const c of sample.campaigns) {
    for (const row of c.posts) {
      if (row.accountHandle) handleByAccount.set(row.accountId, row.accountHandle);
      if (row.video && row.video.status === "captured") {
        targets.set(row.video.id, { id: row.video.id, tiktokUrl: row.video.url });
      } else if (!row.video || row.video.status === "unresolved") {
        uncapturedJobIds.push(row.postJobId);
      }
    }
  }
  const targetList = [...targets.values()];

  // Cost guardrail — worst case: every link-less post captures, then every
  // captured link refreshes, so capturedNow + refreshed ≤ targets + uncaptured.
  if (targetList.length + uncapturedJobIds.length > MAX_REFRESH_TARGETS) {
    throw new SpotCheckGuardrailError(
      `This sample could touch up to ${targetList.length + uncapturedJobIds.length} videos (${targetList.length} linked + ${uncapturedJobIds.length} link-less) — over the ${MAX_REFRESH_TARGETS}-per-run limit. Pick fewer campaigns or a smaller sample size.`
    );
  }

  // previousRun is resolved before saving so a run never compares to itself.
  const previousRun = await findPreviousRun(ids);

  let aborted: SpotCheckRunResult["aborted"] = null;

  // ── Capture pass: one profile call per account with link-less posts ──────
  const byAccount = new Map<string, CaptureJobInput[]>();
  for (const jobId of uncapturedJobIds) {
    const job = jobsById.get(jobId);
    if (!job) continue;
    const arr = byAccount.get(job.accountId) ?? [];
    arr.push(job);
    byAccount.set(job.accountId, arr);
  }
  // Oldest-first per account, same order the sweep matches in.
  for (const jobs of byAccount.values()) {
    jobs.sort((a, b) => (a.publishedAt?.getTime() ?? 0) - (b.publishedAt?.getTime() ?? 0));
  }

  const campaignCache: CampaignInfoCache = new Map();
  let accountLookups = 0;
  let capturedNow = 0;
  const skippedAccounts: string[] = [];
  const accountEntries = [...byAccount.entries()];

  for (const [accountId, jobs] of accountEntries) {
    if (aborted) break;
    const handle = handleByAccount.get(accountId) ?? "";
    if (!handle) continue; // account without a username can't be looked up
    if (accountLookups >= MAX_ACCOUNT_LOOKUPS) {
      skippedAccounts.push(handle);
      continue;
    }
    const depth = Math.min(
      ACCOUNT_LOOKUP_MAX_DEPTH,
      Math.max(ACCOUNT_LOOKUP_MIN_DEPTH, jobs.length)
    );

    let latest: Awaited<ReturnType<AnalyticsProvider["fetchLatestVideosForAccount"]>>;
    try {
      latest = await provider.fetchLatestVideosForAccount(handle, depth);
    } catch (err: any) {
      if (err instanceof ProviderError && (err.kind === "rate_limited" || err.kind === "auth")) {
        aborted = { kind: err.kind, message: err.message };
        break;
      }
      console.error(
        `[SpotCheck] Latest-videos fetch failed for @${handle} (transient): ${err?.message || err}`
      );
      continue;
    }
    accountLookups++;

    const cap = await captureJobsFromAccountVideos({
      account: { id: accountId, tiktokUsername: handle },
      jobs,
      latestVideos: latest,
      timezone,
      now,
      captureMethod: "spot_check",
      campaignCache,
      logTag: "[SpotCheck]",
    });
    capturedNow += cap.succeeded;

    if (accountEntries[accountEntries.length - 1]?.[0] !== accountId) {
      await sleep(SLEEP_BETWEEN_CALLS_MS);
    }
  }

  // ── Batched paid refresh of previously-captured links ───────────────────
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < targetList.length && !aborted; i += BATCH_SIZE) {
    const batch = targetList.slice(i, i + BATCH_SIZE);

    let statsById: Awaited<ReturnType<AnalyticsProvider["fetchStatsForVideoUrls"]>>;
    try {
      statsById = await provider.fetchStatsForVideoUrls(batch.map((t) => t.tiktokUrl));
    } catch (err: any) {
      if (err instanceof ProviderError && (err.kind === "rate_limited" || err.kind === "auth")) {
        aborted = { kind: err.kind, message: err.message };
        break;
      }
      // Transient whole-batch failure: count items failed and continue.
      console.error(`[SpotCheck] Batch fetch failed (transient): ${err?.message || err}`);
      failed += batch.length;
      if (i + BATCH_SIZE < targetList.length) await sleep(SLEEP_BETWEEN_CALLS_MS);
      continue;
    }

    for (const target of batch) {
      try {
        // fetchStatsForVideoUrls is keyed by TikTok video id, not our row id —
        // recover the row via the URL we sent.
        const stats = findStatsForUrl(statsById, target.tiktokUrl);
        if (!stats) {
          failed++;
        } else if ("unavailable" in stats) {
          await prisma.trackedVideo.update({
            where: { id: target.id },
            data: { status: "unavailable" },
          });
          skipped++;
        } else {
          await prisma.trackedVideo.update({
            where: { id: target.id },
            data: { ...stats, lastRefreshedAt: now },
          });
          await ensureDailySnapshot(target.id, stats, timezone, now);
          succeeded++;
        }
      } catch (err: any) {
        if (err instanceof ProviderError && (err.kind === "rate_limited" || err.kind === "auth")) {
          aborted = { kind: err.kind, message: err.message };
          break;
        }
        console.error(`[SpotCheck] Refresh failed for video ${target.id}:`, err?.message || err);
        failed++;
      }
    }

    if (!aborted && i + BATCH_SIZE < targetList.length) await sleep(SLEEP_BETWEEN_CALLS_MS);
  }

  // ── Rebuild from fresh data, persist, return ────────────────────────────
  const freshSample = (await buildSample(ids, sampleSize)).sample;
  const unmatchedPostJobIds = freshSample.campaigns
    .flatMap((c) => c.posts)
    .filter((r) => !r.video || r.video.status === "unresolved")
    .map((r) => r.postJobId);

  const run = await prisma.campaignSpotCheck.create({
    data: {
      createdBy: userId,
      campaignIds: ids,
      sampleSize,
      totalsJson: totalsFromSample(freshSample) as unknown as Prisma.InputJsonValue,
      refreshedCount: succeeded,
      capturedNow,
      noMatch: unmatchedPostJobIds.length,
      accountLookups,
    },
  });

  console.log(
    `[SpotCheck] Run ${run.id} done: lookups=${accountLookups} capturedNow=${capturedNow} targets=${targetList.length} refreshed=${succeeded} failed=${failed} skipped=${skipped} noMatch=${unmatchedPostJobIds.length}${skippedAccounts.length ? ` skippedAccounts=${skippedAccounts.length}` : ""}${aborted ? ` aborted=${aborted.kind}` : ""}`
  );

  return {
    run: serializeRun(run),
    sample: freshSample,
    previousRun,
    aborted,
    capture: {
      accountLookups,
      capturedNow,
      noMatch: unmatchedPostJobIds.length,
      unmatchedPostJobIds,
      skippedAccounts,
    },
  };
}

/**
 * Match a provider result back to the URL we requested. The provider map is
 * keyed by TikTok video id, so compare against the id embedded in the URL.
 */
function findStatsForUrl(
  statsById: Map<string, import("./provider").ProviderVideoStats>,
  url: string
) {
  const videoId = url.split("/video/")[1]?.split(/[/?#]/)[0];
  if (videoId) {
    const hit = statsById.get(videoId);
    if (hit) return hit;
  }
  // Fallback: some providers key by URL directly.
  return statsById.get(url);
}

/** Last runs, newest first; optionally filtered to runs including a campaign. */
export async function getSpotCheckHistory(
  userId: string,
  campaignId?: string
): Promise<SpotCheckRunSummary[]> {
  await assertAccess(userId);
  const runs = await prisma.campaignSpotCheck.findMany({
    where: campaignId ? { campaignIds: { has: campaignId } } : undefined,
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
  });
  return runs.map(serializeRun);
}
