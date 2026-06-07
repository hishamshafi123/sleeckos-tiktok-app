export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { checkPublishStatus } from "@/lib/tiktok-managed";

function verifyCronSecret(req: NextRequest) {
  const secret =
    req.headers.get("x-cron-secret") ||
    req.nextUrl.searchParams.get("secret");
  return secret === process.env.CRON_SECRET;
}

// Poll TikTok for publish status of all PROCESSING posts
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const processingPosts = await prisma.scheduledPost.findMany({
    where: { status: "PROCESSING", tiktokPublishId: { not: null } },
    include: { account: { select: { tiktokAccessToken: true, tiktokUsername: true } } },
    take: 50,
  });

  const results: Record<string, string> = {};

  for (const post of processingPosts) {
    try {
      const data = await checkPublishStatus(
        post.account.tiktokAccessToken,
        post.tiktokPublishId!
      );

      const status = data.data?.status;
      const publishId = post.tiktokPublishId!;

      if (status === "PUBLISH_COMPLETE") {
        const videoId = data.data?.publicaly_available_post_id?.[0] || null;
        const postUrl = videoId && post.account.tiktokUsername
          ? `https://www.tiktok.com/@${post.account.tiktokUsername}/video/${videoId}`
          : null;

        await prisma.scheduledPost.update({
          where: { id: post.id },
          data: {
            status: "PUBLISHED",
            publishedAt: new Date(),
            tiktokVideoId: videoId,
            tiktokPostUrl: postUrl,
          },
        });
        results[publishId] = `published${postUrl ? ` → ${postUrl}` : ""}`;
      } else if (status === "FAILED") {
        const reason =
          data.data?.fail_reason || "TikTok reported processing failure";
        await prisma.scheduledPost.update({
          where: { id: post.id },
          data: { status: "FAILED", errorMessage: reason },
        });
        results[publishId] = `failed: ${reason}`;
      } else {
        // Still processing — leave as-is
        results[publishId] = `still_processing: ${status}`;
      }
    } catch (err) {
      results[post.tiktokPublishId!] = `error: ${
        err instanceof Error ? err.message : err
      }`;
    }
  }

  return NextResponse.json({
    ok: true,
    checked: processingPosts.length,
    results,
  });
}
