import prisma from "@/lib/db";
import { PostStatus } from "@prisma/client";

/**
 * Backfill TrackedVideo rows for posts that were published BEFORE the
 * tracking feature existed. The old Refresh Links flow already resolved
 * TikTok URLs for thousands of ScheduledPosts — this turns those into
 * TrackedVideos (link + existing stats + campaign) without any Apify calls.
 * Stats become current on the next analytics refresh.
 */

const TERMINAL_STATES: PostStatus[] = ["PUBLISHED", "PENDING_DELETION", "DELETED"];
const BATCH = 500;

function videoIdFromUrl(url: string): string | null {
  const m = url.match(/\/video\/(\d+)/);
  return m ? m[1] : null;
}

export async function backfillTrackedVideos(): Promise<{
  scanned: number;
  created: number;
  skippedExisting: number;
  skippedNoVideoId: number;
  skippedNoAccount: number;
}> {
  const result = { scanned: 0, created: 0, skippedExisting: 0, skippedNoVideoId: 0, skippedNoAccount: 0 };

  let cursor: string | undefined;
  for (;;) {
    const posts = await prisma.scheduledPost.findMany({
      where: {
        status: { in: TERMINAL_STATES },
        tiktokPostUrl: { not: null },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: BATCH,
    });
    if (posts.length === 0) break;
    cursor = posts[posts.length - 1].id;
    result.scanned += posts.length;

    // Map publish ids to PostJobs for campaign linkage.
    const publishIds = posts.map((p) => p.tiktokPublishId).filter(Boolean) as string[];
    const jobs = await prisma.postJob.findMany({
      where: { tiktokPublishId: { in: publishIds } },
      select: { id: true, tiktokPublishId: true, campaignId: true },
    });
    const jobByPublishId = new Map(jobs.map((j) => [j.tiktokPublishId, j]));

    for (const post of posts) {
      if (!post.tiktokPostUrl) {
        result.skippedNoAccount++;
        continue;
      }
      const videoId = videoIdFromUrl(post.tiktokPostUrl);
      if (!videoId) {
        result.skippedNoVideoId++;
        continue;
      }

      const existing = await prisma.trackedVideo.findUnique({ where: { tiktokVideoId: videoId } });
      if (existing) {
        result.skippedExisting++;
        continue;
      }

      const job = post.tiktokPublishId ? jobByPublishId.get(post.tiktokPublishId) : undefined;
      try {
        await prisma.trackedVideo.create({
          data: {
            tiktokVideoId: videoId,
            url: post.tiktokPostUrl,
            accountId: post.accountId,
            campaignId: job?.campaignId ?? null,
            postJobId: job?.id ?? null,
            publishedAt: post.publishedAt ?? post.createdAt,
            captureMethod: "backfill",
            confidence: "high",
            status: "captured",
            views: post.viewCount ?? BigInt(0),
            likes: post.likeCount ?? BigInt(0),
            comments: post.commentCount ?? BigInt(0),
            shares: post.shareCount ?? BigInt(0),
            // lastRefreshedAt stays null → the next refresh updates stats.
          },
        });
        result.created++;
      } catch (err: any) {
        // Unique race (two backfill runs) — count as existing.
        if (err?.code === "P2002") result.skippedExisting++;
        else throw err;
      }
    }
  }

  return result;
}
