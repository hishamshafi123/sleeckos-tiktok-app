export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";

function verifyCronSecret(req: NextRequest) {
  const secret =
    req.headers.get("x-cron-secret") ||
    req.nextUrl.searchParams.get("secret");
  return secret === process.env.CRON_SECRET;
}

const POSTPEER_API = "https://api.postpeer.dev/v1";

function getAccessKey(): string {
  const key = process.env.POSTPEER_ACCESS_KEY;
  if (!key) throw new Error("POSTPEER_ACCESS_KEY env var not set");
  return key;
}

/**
 * GET /api/cron/poll-postpeer
 *
 * Polls PostPeer for published posts that don't have a TikTok URL yet.
 * PostPeer may return platformPostUrl/platformPostId after TikTok finishes processing.
 */
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Find PUBLISHED posts that have a PostPeer ID but no TikTok URL
  const posts = await prisma.scheduledPost.findMany({
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

  const results: Record<string, string> = {};

  for (const post of posts) {
    const postpeerId = post.tiktokPublishId!;
    try {
      const res = await fetch(`${POSTPEER_API}/posts/${postpeerId}`, {
        headers: {
          "x-access-key": getAccessKey(),
        },
      });

      if (!res.ok) {
        results[postpeerId] = `api_error_${res.status}`;
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
        // Construct URL if we have postId but no URL
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
        results[postpeerId] = `updated: ${finalUrl}`;
      } else {
        results[postpeerId] = "no_url_yet";
      }
    } catch (err) {
      results[postpeerId] = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return NextResponse.json({
    ok: true,
    checked: posts.length,
    results,
  });
}
