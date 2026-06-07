export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";

/**
 * GET /api/managed/history
 *
 * Returns published/skipped posts with optional filters:
 *   ?section=sectionId   — filter by section
 *   ?status=PUBLISHED    — filter by status (PUBLISHED | SKIPPED | all)
 *   ?hashtag=#fyp        — filter captions containing this hashtag
 *   ?from=YYYY-MM-DD     — start date
 *   ?to=YYYY-MM-DD       — end date
 *   ?limit=200           — max results
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const sectionId = url.searchParams.get("section");
  const statusFilter = url.searchParams.get("status") || "all";
  const hashtag = url.searchParams.get("hashtag");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const limit = Math.min(Number(url.searchParams.get("limit")) || 200, 1000);

  // Build where clause
  const where: Record<string, unknown> = {};

  // Status filter
  if (statusFilter === "PUBLISHED") {
    where.status = "PUBLISHED";
  } else if (statusFilter === "SKIPPED") {
    where.status = "SKIPPED";
  } else if (statusFilter === "FAILED") {
    where.status = "FAILED";
  } else {
    where.status = { in: ["PUBLISHED", "SKIPPED", "FAILED"] };
  }

  // Section filter
  if (sectionId) {
    where.account = { group: { sectionId } };
  }

  // Date filter
  if (from || to) {
    const dateFilter: Record<string, Date> = {};
    if (from) dateFilter.gte = new Date(`${from}T00:00:00Z`);
    if (to) dateFilter.lte = new Date(`${to}T23:59:59Z`);
    where.createdAt = dateFilter;
  }

  // Hashtag filter
  if (hashtag) {
    const tag = hashtag.startsWith("#") ? hashtag : `#${hashtag}`;
    where.caption = { contains: tag, mode: "insensitive" };
  }

  const posts = await prisma.scheduledPost.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: limit,
    include: {
      account: {
        select: {
          tiktokUsername: true,
          tiktokAvatarUrl: true,
          group: { select: { name: true, section: { select: { id: true, name: true } } } },
        },
      },
    },
  });

  // Serialize BigInt fields
  const serialized = posts.map((p) => {
    const videoUrl = p.tiktokPostUrl
      || (p.tiktokVideoId && p.account.tiktokUsername
        ? `https://www.tiktok.com/@${p.account.tiktokUsername}/video/${p.tiktokVideoId}`
        : null);

    return {
      id: p.id,
      status: p.status,
      caption: p.caption,
      driveFileName: p.driveFileName,
      tiktokPostUrl: videoUrl,
      tiktokVideoId: p.tiktokVideoId,
      publishedAt: p.publishedAt,
      createdAt: p.createdAt,
      errorMessage: p.errorMessage,
      viewCount: p.viewCount?.toString() ?? "0",
      likeCount: p.likeCount?.toString() ?? "0",
      commentCount: p.commentCount?.toString() ?? "0",
      shareCount: p.shareCount?.toString() ?? "0",
      account: p.account,
    };
  });

  return NextResponse.json(serialized);
}

/**
 * POST /api/managed/history
 *
 * Fetches TikTok URLs from PostPeer for all PUBLISHED posts missing links.
 * Called from the "Refresh Links" button on the History page.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const POSTPEER_API = "https://api.postpeer.dev/v1";
  const postpeerKey = process.env.POSTPEER_ACCESS_KEY;

  if (!postpeerKey) {
    return NextResponse.json({ error: "POSTPEER_ACCESS_KEY not configured" }, { status: 500 });
  }

  // Find all PUBLISHED posts that have a PostPeer ID but no TikTok URL
  const missingUrlPosts = await prisma.scheduledPost.findMany({
    where: {
      status: "PUBLISHED",
      tiktokPublishId: { not: null },
      tiktokPostUrl: null,
    },
    include: {
      account: { select: { tiktokUsername: true } },
    },
    take: 100,
  });

  const results: { updated: number; noUrl: number; errors: number; details: Record<string, string> } = {
    updated: 0,
    noUrl: 0,
    errors: 0,
    details: {},
  };

  for (const post of missingUrlPosts) {
    const postpeerId = post.tiktokPublishId!;
    try {
      const res = await fetch(`${POSTPEER_API}/posts/${postpeerId}`, {
        headers: { "x-access-key": postpeerKey },
      });

      if (!res.ok) {
        results.errors++;
        results.details[postpeerId] = `api_error_${res.status}`;
        continue;
      }

      const data = await res.json();

      // Log the full response structure for debugging
      console.log(`[RefreshLinks] PostPeer response for ${postpeerId}:`, JSON.stringify(data).substring(0, 1000));

      // Try multiple possible response structures
      const platforms = data.platforms || data.platform_results || data.platformResults || [];
      const tiktokPlatform = Array.isArray(platforms)
        ? platforms.find((p: Record<string, unknown>) =>
            p.platform === "tiktok" || p.platformName === "tiktok" || p.type === "tiktok"
          )
        : null;

      // Try to extract URL from various possible field names
      const platformPostUrl =
        tiktokPlatform?.platformPostUrl ||
        tiktokPlatform?.postUrl ||
        tiktokPlatform?.url ||
        tiktokPlatform?.permalink ||
        data.platformPostUrl ||
        data.postUrl ||
        data.url ||
        null;

      const platformPostId =
        tiktokPlatform?.platformPostId ||
        tiktokPlatform?.externalId ||
        tiktokPlatform?.videoId ||
        data.platformPostId ||
        data.externalId ||
        null;

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
        results.updated++;
        results.details[postpeerId] = `✅ ${finalUrl}`;
      } else {
        results.noUrl++;
        // Store a debug snapshot of what PostPeer returned
        const keys = Object.keys(data).join(", ");
        results.details[postpeerId] = `no_url_found (keys: ${keys})`;
      }
    } catch (err) {
      results.errors++;
      results.details[postpeerId] = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return NextResponse.json({
    ok: true,
    totalChecked: missingUrlPosts.length,
    ...results,
  });
}
