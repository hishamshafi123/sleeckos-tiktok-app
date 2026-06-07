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

const POSTPEER_API = "https://api.postpeer.dev/v1";

function getPostPeerKey(): string | null {
  return process.env.POSTPEER_ACCESS_KEY || null;
}

// Poll TikTok for publish status of all PROCESSING posts
// AND poll PostPeer for PUBLISHED posts missing TikTok URLs
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, string> = {};

  // ── Part 1: Poll TikTok for PROCESSING posts ──────────────────────────
  const processingPosts = await prisma.scheduledPost.findMany({
    where: { status: "PROCESSING", tiktokPublishId: { not: null } },
    include: { account: { select: { tiktokAccessToken: true, tiktokUsername: true } } },
    take: 50,
  });

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

  // ── Part 2: Poll PostPeer for PUBLISHED posts missing TikTok URLs ─────
  const postpeerKey = getPostPeerKey();
  let postpeerChecked = 0;

  if (postpeerKey) {
    const missingUrlPosts = await prisma.scheduledPost.findMany({
      where: {
        status: "PUBLISHED",
        tiktokPublishId: { not: null },
        tiktokPostUrl: null,
      },
      include: {
        account: { select: { tiktokUsername: true } },
      },
      take: 50,
    });

    postpeerChecked = missingUrlPosts.length;

    for (const post of missingUrlPosts) {
      const postpeerId = post.tiktokPublishId!;
      try {
        const res = await fetch(`${POSTPEER_API}/posts/${postpeerId}`, {
          headers: { "x-access-key": postpeerKey },
        });

        if (!res.ok) {
          results[`pp_${postpeerId}`] = `postpeer_api_error_${res.status}`;
          continue;
        }

        const data = await res.json();

        // Extract platform URL from PostPeer response
        const platforms = data.platforms || data.platform_results || [];
        const tiktokPlatform = Array.isArray(platforms)
          ? platforms.find((p: Record<string, unknown>) => p.platform === "tiktok" || p.platformName === "tiktok")
          : null;

        const platformPostUrl = tiktokPlatform?.platformPostUrl || tiktokPlatform?.postUrl || data.platformPostUrl || null;
        const platformPostId = tiktokPlatform?.platformPostId || tiktokPlatform?.postId || data.platformPostId || null;

        if (platformPostUrl || platformPostId) {
          const finalUrl = platformPostUrl
            || (platformPostId && post.account.tiktokUsername
              ? `https://www.tiktok.com/@${post.account.tiktokUsername}/video/${platformPostId}`
              : null);

          await prisma.scheduledPost.update({
            where: { id: post.id },
            data: {
              tiktokPostUrl: finalUrl,
              tiktokVideoId: platformPostId || post.tiktokVideoId,
            },
          });
          results[`pp_${postpeerId}`] = `url_updated: ${finalUrl}`;
        } else {
          results[`pp_${postpeerId}`] = "no_url_yet";
        }
      } catch (err) {
        results[`pp_${postpeerId}`] = `error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    checked: processingPosts.length,
    postpeerChecked,
    results,
  });
}

