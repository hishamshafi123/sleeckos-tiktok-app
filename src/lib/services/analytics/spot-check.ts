/**
 * Campaign Spot-Check — operator-driven sampling of a campaign's recent posts.
 *
 * The operator picks campaigns + a sample size, previews the last N
 * terminal-published PostJobs per campaign (free — DB only), then pays for a
 * targeted Apify refresh of exactly the sampled videos that have a captured
 * TrackedVideo. Each paid run is saved as a CampaignSpotCheck row so the next
 * run can compare averages against the previous one.
 *
 * Cost rules (operator policy, same as refresh.ts):
 * - Only "captured" TrackedVideos are ever sent to the paid provider.
 *   "dormant" (0-view) and "unavailable" links are excluded from ALL paid
 *   refreshes, including this manual one.
 * - sampleSize ≤ 100 per campaign and ≤ MAX_REFRESH_TARGETS URLs per run;
 *   beyond that the run is rejected with a SpotCheckGuardrailError.
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
import { ProviderError } from "./provider";
import type { AnalyticsProvider } from "./provider";
import { apifyProvider } from "./apify";

export const SPOT_CHECK_SAMPLE_SIZES = [10, 25, 50, 100] as const;
export const MAX_SAMPLE_SIZE = 100;
export const MAX_REFRESH_TARGETS = 400;
const BATCH_SIZE = 25;
const HISTORY_LIMIT = 20;
const SLEEP_BETWEEN_CALLS_MS = 500;

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
  refreshedCount: number;
  totals: SpotCheckTotalsEntry[];
}

export interface SpotCheckRunResult {
  run: SpotCheckRunSummary;
  sample: SpotCheckSample; // fresh, post-refresh
  previousRun: SpotCheckRunSummary | null; // most recent prior run with overlapping campaigns
  aborted: { kind: string; message: string } | null; // set when auth/rate_limited cut the refresh short
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

async function buildSample(
  campaignIds: string[],
  sampleSize: number
): Promise<SpotCheckSample> {
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
  return { sampleSize, campaigns: out };

  function fetchJobs(campaignId: string, take: number) {
    return prisma.postJob.findMany({
      where: {
        campaignId,
        state: { in: TERMINAL_PUBLISHED_STATES },
        publishedAt: { not: null },
      },
      orderBy: { publishedAt: "desc" },
      take,
      select: { id: true, accountId: true, publishedAt: true, updatedAt: true },
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
  return buildSample(ids, sampleSize);
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
  totalsJson: unknown;
}): SpotCheckRunSummary {
  return {
    id: run.id,
    createdAt: run.createdAt.toISOString(),
    createdBy: run.createdBy,
    campaignIds: run.campaignIds,
    sampleSize: run.sampleSize,
    refreshedCount: run.refreshedCount,
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
 * Paid run: refresh stats for exactly the sampled videos that have a captured
 * TrackedVideo (dormant/unavailable are never sent to the provider), persist a
 * CampaignSpotCheck row, and return fresh results plus the previous matching
 * run for comparison.
 *
 * Provider failure policy mirrors refresh.ts: auth/rate_limited aborts the
 * refresh loop (the run is still saved with whatever succeeded, and `aborted`
 * is set); a transient whole-batch failure is logged and the run continues.
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

  const sample = await buildSample(ids, sampleSize);

  // Refresh targets: sampled rows with a captured TrackedVideo only.
  const targets = new Map<string, { id: string; tiktokUrl: string }>();
  for (const c of sample.campaigns) {
    for (const row of c.posts) {
      if (row.video && row.video.status === "captured") {
        targets.set(row.video.id, { id: row.video.id, tiktokUrl: row.video.url });
      }
    }
  }
  const targetList = [...targets.values()];
  if (targetList.length > MAX_REFRESH_TARGETS) {
    throw new SpotCheckGuardrailError(
      `This sample would refresh ${targetList.length} videos — over the ${MAX_REFRESH_TARGETS}-per-run limit. Pick fewer campaigns or a smaller sample size.`
    );
  }

  // previousRun is resolved before saving so a run never compares to itself.
  const previousRun = await findPreviousRun(ids);

  // ── Batched paid refresh ────────────────────────────────────────────────
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let aborted: SpotCheckRunResult["aborted"] = null;

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
  const freshSample = await buildSample(ids, sampleSize);
  const run = await prisma.campaignSpotCheck.create({
    data: {
      createdBy: userId,
      campaignIds: ids,
      sampleSize,
      totalsJson: totalsFromSample(freshSample) as unknown as Prisma.InputJsonValue,
      refreshedCount: succeeded,
    },
  });

  console.log(
    `[SpotCheck] Run ${run.id} done: targets=${targetList.length} refreshed=${succeeded} failed=${failed} skipped=${skipped}${aborted ? ` aborted=${aborted.kind}` : ""}`
  );

  return { run: serializeRun(run), sample: freshSample, previousRun, aborted };
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
