/**
 * Deep recovery for unresolved campaign links.
 *
 * Background: the normal capture paths fetch the latest ~20–35 videos per
 * account and match by publish-time window. Anything that scrolled past the
 * depth, or whose confirmation lagged the window, stays "unresolved" and is
 * retried forever at 24h backoff — burning scraper calls with zero chance
 * for the majority, whose videos are simply NOT PUBLIC (shadowbanned /
 * suppressed accounts: PostPeer confirmed the upload, but TikTok never
 * showed the video on the profile — verified by public videoCount ≈ 0
 * against dozens of confirmed posts).
 *
 * One deep pass per account: paginated fetch (default 150 videos ≈ 7+ weeks
 * back at 3 posts/day) re-runs the time-window matcher for every uncaptured
 * job. Whatever still has no candidate AND is older than `olderThanDays`
 * (default 3) is terminally marked "unavailable" — the video is not publicly
 * visible, its views are effectively zero, and retrying it is wasted spend.
 */

import prisma from "@/lib/db";
import { captureAccountPosts } from "./capture";
import { notifyAdmin } from "@/lib/services/notifications";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DEPTH = 150;
const DEFAULT_OLDER_THAN_DAYS = 3;

export interface DeepRecoverResult {
  campaignId: string;
  accountsProcessed: number;
  captured: number;
  refreshed: number;
  markedUnavailable: number;
  stillUnresolvedRecent: number; // too recent to retire — left for normal retries
  failedAccounts: { username: string; reason: string }[];
}

export async function deepRecoverUnresolved(
  campaignId: string,
  opts: { depth?: number; olderThanDays?: number } = {}
): Promise<DeepRecoverResult> {
  const depth = opts.depth ?? DEFAULT_DEPTH;
  const olderThanDays = opts.olderThanDays ?? DEFAULT_OLDER_THAN_DAYS;

  // Accounts holding this campaign's unresolved rows.
  const unresolved = await prisma.trackedVideo.findMany({
    where: { campaignId, status: "unresolved" },
    select: { accountId: true },
    distinct: ["accountId"],
  });
  const accountIds = unresolved.map((r) => r.accountId);

  const result: DeepRecoverResult = {
    campaignId,
    accountsProcessed: 0,
    captured: 0,
    refreshed: 0,
    markedUnavailable: 0,
    stillUnresolvedRecent: 0,
    failedAccounts: [],
  };

  for (const accountId of accountIds) {
    const before = await prisma.trackedVideo.count({
      where: { accountId, status: "unresolved" },
    });
    try {
      const res = await captureAccountPosts(accountId, { depth });
      result.accountsProcessed++;
      result.refreshed += res.refreshed;
      const after = await prisma.trackedVideo.count({
        where: { accountId, status: "unresolved" },
      });
      result.captured += Math.max(0, before - after);
    } catch (err: any) {
      const account = await prisma.managedAccount.findUnique({
        where: { id: accountId },
        select: { tiktokUsername: true },
      });
      result.failedAccounts.push({
        username: account?.tiktokUsername ?? accountId,
        reason: err?.message?.slice(0, 120) || String(err),
      });
    }
  }

  // Terminal retirement: still-unresolved rows old enough that a public video
  // would have surfaced by now → the video is not publicly visible.
  const cutoff = new Date(Date.now() - olderThanDays * DAY_MS);
  const retire = await prisma.trackedVideo.updateMany({
    where: {
      campaignId,
      status: "unresolved",
      publishedAt: { lt: cutoff },
    },
    data: { status: "unavailable" },
  });
  result.markedUnavailable = retire.count;
  result.stillUnresolvedRecent = await prisma.trackedVideo.count({
    where: { campaignId, status: "unresolved" },
  });

  if (result.markedUnavailable > 0) {
    void notifyAdmin({
      level: "info",
      title: `Deep recovery: ${result.markedUnavailable} links retired as unavailable`,
      body: `Campaign deep recovery captured ${result.captured} previously-unresolved links and retired ${result.markedUnavailable} (not publicly visible on TikTok — likely suppressed accounts). ${result.stillUnresolvedRecent} recent links remain in normal retry.`,
      source: "analytics_capture",
      dedupeMinutes: 120,
    });
  }

  console.log(
    `[DeepRecover] Campaign ${campaignId}: accounts=${result.accountsProcessed} captured=${result.captured} refreshed=${result.refreshed} retired=${result.markedUnavailable} recentLeft=${result.stillUnresolvedRecent} failedAccounts=${result.failedAccounts.length}`
  );
  return result;
}
