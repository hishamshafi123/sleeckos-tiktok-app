export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";

function verifyCronSecret(req: NextRequest) {
  const secret =
    req.headers.get("x-cron-secret") ||
    req.nextUrl.searchParams.get("secret");
  return secret === process.env.CRON_SECRET;
}

// Sync post metrics from TikTok for PUBLISHED posts (simplified — real TikTok
// video stats require the research/videoList API which needs separate approval)
// For now: take a daily analytics snapshot per account
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  const dateKey = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );

  const accounts = await prisma.managedAccount.findMany({
    where: { revokedAt: null },
    include: {
      _count: {
        select: {
          scheduledPosts: {
            where: {
              status: "PUBLISHED",
              publishedAt: {
                gte: dateKey,
              },
            },
          },
        },
      },
    },
  });

  let snapshotCount = 0;

  for (const account of accounts) {
    // Aggregate today's post views + likes from published posts
    const todayMetrics = await prisma.scheduledPost.aggregate({
      where: {
        accountId: account.id,
        status: "PUBLISHED",
        publishedAt: { gte: dateKey },
      },
      _sum: { viewCount: true, likeCount: true },
    });

    // Upsert daily analytics snapshot
    await prisma.accountDailyAnalytics.upsert({
      where: { accountId_date: { accountId: account.id, date: dateKey } },
      create: {
        accountId: account.id,
        date: dateKey,
        followerCount: account.followerCount,
        followingCount: account.followingCount,
        likesCount: account.likesCount,
        videoCount: account.videoCount,
        postsToday: account._count.scheduledPosts,
        totalViews: todayMetrics._sum.viewCount ?? BigInt(0),
        totalLikes: todayMetrics._sum.likeCount ?? BigInt(0),
      },
      update: {
        followerCount: account.followerCount,
        followingCount: account.followingCount,
        likesCount: account.likesCount,
        videoCount: account.videoCount,
        postsToday: account._count.scheduledPosts,
        totalViews: todayMetrics._sum.viewCount ?? BigInt(0),
        totalLikes: todayMetrics._sum.likeCount ?? BigInt(0),
      },
    });

    snapshotCount++;
  }

  return NextResponse.json({ ok: true, snapshots: snapshotCount });
}
