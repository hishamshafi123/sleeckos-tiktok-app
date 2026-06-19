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

function getPostPeerKey(): string | null {
  return process.env.POSTPEER_ACCESS_KEY || null;
}

// Poll PostPeer for PUBLISHED posts missing TikTok URLs
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, string> = {};
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

        // PostPeer response: { success: true, post: { platforms: [...] } }
        const postData = data.post || data;
        const platforms = postData.platforms || [];
        const tiktokPlatform = Array.isArray(platforms)
          ? platforms.find((p: Record<string, unknown>) => p.platform === "tiktok")
          : null;

        // platformPostId format: "v_pub_url~v2-1.7647150213232183318"
        const rawPlatformPostId: string = tiktokPlatform?.platformPostId || "";
        let tiktokVideoId: string | null = null;

        if (rawPlatformPostId.includes(".")) {
          tiktokVideoId = rawPlatformPostId.split(".").pop() || null;
        } else if (/^\d+$/.test(rawPlatformPostId)) {
          tiktokVideoId = rawPlatformPostId;
        }

        if (tiktokVideoId && post.account.tiktokUsername) {
          const finalUrl = `https://www.tiktok.com/@${post.account.tiktokUsername}/video/${tiktokVideoId}`;

          await prisma.scheduledPost.update({
            where: { id: post.id },
            data: {
              tiktokPostUrl: finalUrl,
              tiktokVideoId,
            },
          });
          results[`pp_${postpeerId}`] = `url_updated: ${finalUrl}`;
        } else {
          results[`pp_${postpeerId}`] = `no_video_id (raw: ${rawPlatformPostId})`;
        }
      } catch (err) {
        results[`pp_${postpeerId}`] = `error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    postpeerChecked,
    results,
  });
}

