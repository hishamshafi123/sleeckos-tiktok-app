/**
 * Campaign transfer — moves tracked videos (and their underlying published
 * PostJobs) from one campaign to another, scoped to an inclusive IST posted-date
 * range. Use case: videos exported under "…August" kept posting into September
 * and should live under "…September" instead.
 *
 * What moves:
 *  - TrackedVideo.campaignId (statuses other than "removed"; snapshots follow
 *    via the trackedVideoId relation, trend charts update automatically).
 *  - PostJob.campaignId for PUBLISHED jobs in the same range, so the Posting
 *    History grid and any post-based reporting stay consistent.
 *  - Campaign.postedCount is decremented on the source and incremented on the
 *    target by the number of jobs moved.
 *
 * Day boundaries are org-timezone (IST) — converted to UTC before querying.
 */

import { fromZonedTime } from "date-fns-tz";
import prisma from "@/lib/db";
import { getOrgTimezone } from "@/lib/services/timezone";

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface TransferPreview {
  videos: number;
  posts: number;
  sample: { url: string; accountUsername: string; publishedAt: string; views: number }[];
}

export interface TransferResult {
  videosMoved: number;
  postsMoved: number;
  targetCampaignId: string;
  targetTitle: string;
}

/** Inclusive [from, to] IST day range → UTC bounds. Throws on bad input. */
async function rangeToUtcBounds(from: string, to: string): Promise<{ gte: Date; lt: Date }> {
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    throw new Error("Dates must be YYYY-MM-DD");
  }
  if (from > to) {
    throw new Error("'from' must be on or before 'to'");
  }
  const timezone = await getOrgTimezone();
  const gte = fromZonedTime(`${from}T00:00:00`, timezone);
  // 'to' is inclusive → bound is the next IST midnight. Org tz (IST) has no DST,
  // so +24h is exact.
  const lt = new Date(fromZonedTime(`${to}T00:00:00`, timezone).getTime() + DAY_MS);
  return { gte, lt };
}

async function assertCampaigns(sourceId: string, targetId?: string) {
  const source = await prisma.campaign.findUnique({
    where: { id: sourceId },
    select: { id: true, title: true },
  });
  if (!source) throw new Error("Source campaign not found");
  if (targetId) {
    if (targetId === sourceId) throw new Error("Target must be a different campaign");
    const target = await prisma.campaign.findUnique({
      where: { id: targetId },
      select: { id: true, title: true },
    });
    if (!target) throw new Error("Target campaign not found");
    return { source, target };
  }
  return { source, target: null };
}

export async function previewCampaignTransfer(
  campaignId: string,
  from: string,
  to: string
): Promise<TransferPreview> {
  await assertCampaigns(campaignId);
  const { gte, lt } = await rangeToUtcBounds(from, to);

  const videoWhere = {
    campaignId,
    status: { not: "removed" },
    publishedAt: { gte, lt },
  };
  const [videos, posts, sampleRows] = await Promise.all([
    prisma.trackedVideo.count({ where: videoWhere }),
    prisma.postJob.count({
      where: { campaignId, state: "PUBLISHED", publishedAt: { gte, lt } },
    }),
    prisma.trackedVideo.findMany({
      where: videoWhere,
      orderBy: { publishedAt: "desc" },
      take: 5,
      select: { url: true, publishedAt: true, views: true, accountId: true },
    }),
  ]);

  // TrackedVideo has no account relation — resolve usernames separately.
  const accountIds = [...new Set(sampleRows.map((r) => r.accountId))];
  const accounts = accountIds.length
    ? await prisma.managedAccount.findMany({
        where: { id: { in: accountIds } },
        select: { id: true, tiktokUsername: true },
      })
    : [];
  const usernameById = new Map(accounts.map((a) => [a.id, a.tiktokUsername]));

  return {
    videos,
    posts,
    sample: sampleRows.map((r) => ({
      url: r.url,
      accountUsername: usernameById.get(r.accountId) ?? "",
      publishedAt: r.publishedAt.toISOString(),
      views: Number(r.views),
    })),
  };
}

export async function executeCampaignTransfer(
  campaignId: string,
  targetCampaignId: string,
  from: string,
  to: string
): Promise<TransferResult> {
  const { target } = await assertCampaigns(campaignId, targetCampaignId);
  const { gte, lt } = await rangeToUtcBounds(from, to);

  const videosMoved = await prisma.$transaction(async (tx) => {
    const videoRes = await tx.trackedVideo.updateMany({
      where: { campaignId, status: { not: "removed" }, publishedAt: { gte, lt } },
      data: { campaignId: targetCampaignId },
    });

    const jobRes = await tx.postJob.updateMany({
      where: { campaignId, state: "PUBLISHED", publishedAt: { gte, lt } },
      data: { campaignId: targetCampaignId },
    });

    if (jobRes.count > 0) {
      await tx.campaign.update({
        where: { id: campaignId },
        data: { postedCount: { decrement: jobRes.count } },
      });
      await tx.campaign.update({
        where: { id: targetCampaignId },
        data: { postedCount: { increment: jobRes.count } },
      });
    }
    return { videos: videoRes.count, posts: jobRes.count };
  });

  console.log(
    `[Transfer] Campaign ${campaignId} → ${targetCampaignId} (${from}..${to} IST): ` +
      `${videosMoved.videos} video(s), ${videosMoved.posts} post(s)`
  );

  return {
    videosMoved: videosMoved.videos,
    postsMoved: videosMoved.posts,
    targetCampaignId,
    targetTitle: target!.title,
  };
}
