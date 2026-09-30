/**
 * Campaign tracking query — backs GET /api/campaigns/[id]/tracking and the
 * CSV export. Shape here is the public UI contract; change with care.
 *
 * TrackedVideo.status note: "removed" rows (operator-removed 0-view links,
 * see previewZeroViewRemoval) are excluded from every list/total here and in
 * track-share.ts, and from all refresh paths (sweep/refresh/spot-check all
 * select status "captured" — or "captured"+"dormant" for the free sweep
 * refresh — so "removed" drops out automatically).
 */

import prisma from "@/lib/db";
import { Prisma } from "@prisma/client";
import { getOrgTimezone, getZonedDateString } from "@/lib/services/timezone";
import { getLastRecoveryRun } from "./recover";
import { ZERO_VIEW_MIN_AGE_DAYS } from "./refresh";

const TREND_DAYS = 30;

export interface TrackingVideoRow {
  id: string;
  tiktokVideoId: string;
  url: string;
  accountUsername: string;
  publishedAt: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  lastRefreshedAt: string | null;
  status: string;
  statsProvider: string | null; // "TikLiveAPI" | "Apify" — last scraper to write stats
}

const VIDEO_SELECT = {
  id: true,
  tiktokVideoId: true,
  url: true,
  accountId: true,
  publishedAt: true,
  views: true,
  likes: true,
  comments: true,
  shares: true,
  lastRefreshedAt: true,
  status: true,
  statsProvider: true,
} as const;

type TrackedVideoRecord = {
  id: string;
  tiktokVideoId: string;
  url: string;
  accountId: string;
  publishedAt: Date;
  views: bigint;
  likes: bigint;
  comments: bigint;
  shares: bigint;
  lastRefreshedAt: Date | null;
  status: string;
  statsProvider: string | null;
};

function toTrackingRow(v: TrackedVideoRecord, usernameById: Map<string, string>): TrackingVideoRow {
  return {
    id: v.id,
    tiktokVideoId: v.tiktokVideoId,
    url: v.url,
    accountUsername: usernameById.get(v.accountId) ?? "",
    publishedAt: v.publishedAt.toISOString(),
    views: Number(v.views),
    likes: Number(v.likes),
    comments: Number(v.comments),
    shares: Number(v.shares),
    lastRefreshedAt: v.lastRefreshedAt ? v.lastRefreshedAt.toISOString() : null,
    status: v.status,
    statsProvider: v.statsProvider,
  };
}

async function loadUsernames(accountIds: string[]): Promise<Map<string, string>> {
  const accounts = await prisma.managedAccount.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, tiktokUsername: true },
  });
  return new Map(accounts.map((a) => [a.id, a.tiktokUsername]));
}

/** Full video list (captured + dormant + unavailable) — used by the CSV export only. */
export async function getCampaignTrackingVideos(campaignId: string): Promise<TrackingVideoRow[]> {
  const videos = await prisma.trackedVideo.findMany({
    where: { campaignId, status: { in: ["captured", "dormant", "unavailable"] } },
    orderBy: { publishedAt: "desc" },
    select: VIDEO_SELECT,
  });
  const usernameById = await loadUsernames([...new Set(videos.map((v) => v.accountId))]);
  return videos.map((v) => toTrackingRow(v, usernameById));
}

export interface TrackingVideosPage {
  rows: TrackingVideoRow[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Paginated video list for the tracking table — sorting and account search
 * happen in SQL so the payload stays small no matter how large the campaign
 * gets (the old all-rows payload reached 20k+ rows / ~8 MB per load).
 */
export async function getCampaignTrackingVideosPage(
  campaignId: string,
  opts: { page?: number; pageSize?: number; sort?: string; dir?: string; q?: string } = {}
): Promise<TrackingVideosPage> {
  const page = Math.max(1, Math.floor(opts.page ?? 1) || 1);
  const pageSize = Math.min(200, Math.max(1, Math.floor(opts.pageSize ?? 50) || 50));
  const dir = opts.dir === "asc" ? ("asc" as const) : ("desc" as const);

  const where: Prisma.TrackedVideoWhereInput = {
    campaignId,
    status: { in: ["captured", "dormant", "unavailable"] },
  };

  const q = (opts.q ?? "").trim();
  if (q) {
    const matching = await prisma.managedAccount.findMany({
      where: { tiktokUsername: { contains: q, mode: "insensitive" } },
      select: { id: true },
    });
    where.accountId = { in: matching.map((a) => a.id) };
  }

  const orderBy: Prisma.TrackedVideoOrderByWithRelationInput =
    opts.sort === "views"
      ? { views: dir }
      : opts.sort === "likes"
        ? { likes: dir }
        : opts.sort === "refreshed"
          ? { lastRefreshedAt: { sort: dir, nulls: "last" } }
          : { publishedAt: dir };

  const [total, videos] = await Promise.all([
    prisma.trackedVideo.count({ where }),
    prisma.trackedVideo.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: VIDEO_SELECT,
    }),
  ]);

  const usernameById = await loadUsernames([...new Set(videos.map((v) => v.accountId))]);
  return { rows: videos.map((v) => toTrackingRow(v, usernameById)), total, page, pageSize };
}

export async function getCampaignTracking(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { exportedCount: true, postedCount: true },
  });
  if (!campaign) return null;

  const listedWhere = { campaignId, status: { in: ["captured", "dormant", "unavailable"] } };

  // Totals via SQL aggregation — the video rows themselves are served by the
  // paginated /tracking/videos endpoint, never shipped wholesale here.
  const [agg, capturedCount, unresolvedCount, dormantCount, lastRecovery] = await Promise.all([
    prisma.trackedVideo.aggregate({
      where: listedWhere,
      _sum: { views: true, likes: true },
      _count: { _all: true },
    }),
    prisma.trackedVideo.count({ where: { campaignId, status: "captured" } }),
    prisma.trackedVideo.count({ where: { campaignId, status: "unresolved" } }),
    prisma.trackedVideo.count({ where: { campaignId, status: "dormant" } }),
    getLastRecoveryRun(campaignId),
  ]);

  const views = Number(agg._sum.views ?? 0);
  const likes = Number(agg._sum.likes ?? 0);
  const listedCount = agg._count._all;

  // Per-IST-day trend, aggregated in SQL (used to pull every snapshot row
  // into JS — 160k+ rows for large campaigns).
  const timezone = await getOrgTimezone();
  const now = new Date();
  const windowStart = new Date(now.getTime() - (TREND_DAYS - 1) * 24 * 60 * 60 * 1000);

  const trendRows = await prisma.$queryRaw<{ day: string; views: bigint; likes: bigint }[]>`
    SELECT to_char(date_trunc('day', s."recordedAt" AT TIME ZONE ${timezone}), 'YYYY-MM-DD') AS day,
           SUM(s."views")::bigint AS views,
           SUM(s."likes")::bigint AS likes
    FROM "VideoStatSnapshot" s
    JOIN "TrackedVideo" t ON t.id = s."trackedVideoId"
    WHERE t."campaignId" = ${campaignId}
      AND s."recordedAt" >= ${windowStart}
    GROUP BY 1
  `;
  const byDay = new Map(
    trendRows.map((r) => [r.day, { views: Number(r.views), likes: Number(r.likes) }])
  );

  const trend: { date: string; views: number; likes: number }[] = [];
  for (let i = TREND_DAYS - 1; i >= 0; i--) {
    const day = getZonedDateString(now.getTime() - i * 24 * 60 * 60 * 1000, timezone);
    const b = byDay.get(day);
    trend.push({ date: day, views: b?.views ?? 0, likes: b?.likes ?? 0 });
  }

  return {
    totals: {
      exported: campaign.exportedCount,
      posted: campaign.postedCount,
      captured: capturedCount,
      unresolved: unresolvedCount,
      dormant: dormantCount,
      views,
      likes,
      avgViews: listedCount > 0 ? Math.round(views / listedCount) : 0,
    },
    trend,
    unresolvedCount,
    dormantCount,
    lastRecovery,
  };
}

// ─── Remove 0-view links (operator cleanup) ─────────────────────────────────
// A TrackedVideo qualifies when ALL hold: views = 0, publishedAt older than
// ZERO_VIEW_MIN_AGE_DAYS, refreshed at least once (lastRefreshedAt not null),
// status "captured" or "dormant". Removal sets status "removed" — the row is
// kept for history but drops out of every list, total, and refresh path.

const zeroViewRemovalWhere = (campaignId: string) => ({
  campaignId,
  views: BigInt(0),
  publishedAt: { lte: new Date(Date.now() - ZERO_VIEW_MIN_AGE_DAYS * 24 * 60 * 60 * 1000) },
  lastRefreshedAt: { not: null },
  status: { in: ["captured", "dormant"] },
});

export interface ZeroViewRemovalPreview {
  count: number;
  sample: {
    url: string;
    accountId: string;
    publishedAt: string;
    lastRefreshedAt: string | null;
  }[];
}

export async function previewZeroViewRemoval(campaignId: string): Promise<ZeroViewRemovalPreview> {
  const where = zeroViewRemovalWhere(campaignId);
  const [count, rows] = await Promise.all([
    prisma.trackedVideo.count({ where }),
    prisma.trackedVideo.findMany({
      where,
      orderBy: { publishedAt: "desc" },
      take: 5,
      select: { url: true, accountId: true, publishedAt: true, lastRefreshedAt: true },
    }),
  ]);
  return {
    count,
    sample: rows.map((r) => ({
      url: r.url,
      accountId: r.accountId,
      publishedAt: r.publishedAt.toISOString(),
      lastRefreshedAt: r.lastRefreshedAt?.toISOString() ?? null,
    })),
  };
}

export async function removeZeroViewVideos(campaignId: string): Promise<{ removed: number }> {
  const res = await prisma.trackedVideo.updateMany({
    where: zeroViewRemovalWhere(campaignId),
    data: { status: "removed" },
  });
  if (res.count > 0) {
    console.log(`[Tracking] Campaign ${campaignId}: removed ${res.count} 0-view link(s)`);
  }
  return { removed: res.count };
}
