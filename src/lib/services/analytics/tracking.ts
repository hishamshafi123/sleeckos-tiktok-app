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

/** Video list rows (captured + dormant + unavailable — unresolved surface via counts). */
export async function getCampaignTrackingVideos(campaignId: string): Promise<TrackingVideoRow[]> {
  const videos = await prisma.trackedVideo.findMany({
    where: { campaignId, status: { in: ["captured", "dormant", "unavailable"] } },
    orderBy: { publishedAt: "desc" },
  });

  const accountIds = [...new Set(videos.map((v) => v.accountId))];
  const accounts = await prisma.managedAccount.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, tiktokUsername: true },
  });
  const usernameById = new Map(accounts.map((a) => [a.id, a.tiktokUsername]));

  return videos.map((v) => ({
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
  }));
}

export async function getCampaignTracking(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { exportedCount: true, postedCount: true },
  });
  if (!campaign) return null;

  const [videos, unresolvedCount, dormantCount, lastRecovery] = await Promise.all([
    getCampaignTrackingVideos(campaignId),
    prisma.trackedVideo.count({ where: { campaignId, status: "unresolved" } }),
    prisma.trackedVideo.count({ where: { campaignId, status: "dormant" } }),
    getLastRecoveryRun(campaignId),
  ]);

  const views = videos.reduce((s, v) => s + v.views, 0);
  const likes = videos.reduce((s, v) => s + v.likes, 0);

  // Per-IST-day trend, summed from snapshots, last 30 days (zero-filled).
  const timezone = await getOrgTimezone();
  const now = new Date();
  const windowStart = new Date(now.getTime() - (TREND_DAYS - 1) * 24 * 60 * 60 * 1000);

  const snapshots = await prisma.videoStatSnapshot.findMany({
    where: {
      trackedVideo: { campaignId },
      recordedAt: { gte: windowStart },
    },
    select: { views: true, likes: true, recordedAt: true },
  });

  const dayBuckets = new Map<string, { views: number; likes: number }>();
  for (let i = TREND_DAYS - 1; i >= 0; i--) {
    const day = getZonedDateString(now.getTime() - i * 24 * 60 * 60 * 1000, timezone);
    dayBuckets.set(day, { views: 0, likes: 0 });
  }
  for (const snap of snapshots) {
    const day = getZonedDateString(snap.recordedAt, timezone);
    const bucket = dayBuckets.get(day);
    if (bucket) {
      bucket.views += Number(snap.views);
      bucket.likes += Number(snap.likes);
    }
  }

  const trend = [...dayBuckets.entries()].map(([date, b]) => ({
    date,
    views: b.views,
    likes: b.likes,
  }));

  return {
    totals: {
      exported: campaign.exportedCount,
      posted: campaign.postedCount,
      captured: videos.filter((v) => v.status === "captured").length,
      unresolved: unresolvedCount,
      dormant: dormantCount,
      views,
      likes,
      avgViews: videos.length > 0 ? Math.round(views / videos.length) : 0,
    },
    videos,
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
