/**
 * Campaign tracking query — backs GET /api/campaigns/[id]/tracking and the
 * CSV export. Shape here is the public UI contract; change with care.
 */

import prisma from "@/lib/db";
import { getOrgTimezone, getZonedDateString } from "@/lib/services/timezone";

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
}

/** Video list rows (captured + unavailable — unresolved surface via counts). */
export async function getCampaignTrackingVideos(campaignId: string): Promise<TrackingVideoRow[]> {
  const videos = await prisma.trackedVideo.findMany({
    where: { campaignId, status: { in: ["captured", "unavailable"] } },
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
  }));
}

export async function getCampaignTracking(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { exportedCount: true, postedCount: true },
  });
  if (!campaign) return null;

  const [videos, unresolvedCount] = await Promise.all([
    getCampaignTrackingVideos(campaignId),
    prisma.trackedVideo.count({ where: { campaignId, status: "unresolved" } }),
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
      views,
      likes,
      avgViews: videos.length > 0 ? Math.round(views / videos.length) : 0,
    },
    videos,
    trend,
    unresolvedCount,
  };
}
