export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";

/**
 * GET /api/managed/history
 *
 * Returns published/skipped/failed posts plus aggregate summary:
 *   ?section=sectionId   — filter by section
 *   ?accountId=accountId — filter by managed account
 *   ?status=PUBLISHED    — filter by status (PUBLISHED | SKIPPED | FAILED | all)
 *   ?hashtag=#fyp        — filter captions containing this hashtag
 *   ?from=YYYY-MM-DD     — start date
 *   ?to=YYYY-MM-DD       — end date
 *   ?limit=200           — max results
 *
 * Response: { posts: [...], summary: { published, failed, skipped, withLinks, successRate, views, likes, comments, shares } }
 * "published" counts PUBLISHED + PENDING_DELETION + DELETED (post-publish lifecycle states).
 * Summary respects every active filter.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "history"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const sectionId = url.searchParams.get("section");
  const accountId = url.searchParams.get("accountId");
  const statusFilter = url.searchParams.get("status") || "all";
  const hashtag = url.searchParams.get("hashtag");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const limit = Math.min(Number(url.searchParams.get("limit")) || 200, 1000);

  const PUBLISHED_STATES = ["PUBLISHED", "PENDING_DELETION", "DELETED"];

  // Build where clause
  const where: Record<string, unknown> = {};

  // Status filter
  if (statusFilter === "PUBLISHED") {
    where.status = { in: PUBLISHED_STATES };
  } else if (statusFilter === "SKIPPED") {
    where.status = "SKIPPED";
  } else if (statusFilter === "FAILED") {
    where.status = "FAILED";
  } else {
    where.status = { in: [...PUBLISHED_STATES, "SKIPPED", "FAILED"] };
  }

  // Section / account filters
  if (sectionId) {
    where.account = { group: { sectionId } };
  }
  if (accountId) {
    where.accountId = accountId;
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

  const [posts, statusGroups, metricSums, linksCount] = await Promise.all([
    prisma.scheduledPost.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: limit,
      include: {
        account: {
          select: {
            id: true,
            tiktokUsername: true,
            tiktokAvatarUrl: true,
            driveFolderId: true,
            driveFolderName: true,
            group: { select: { name: true, section: { select: { id: true, name: true } } } },
          },
        },
      },
    }),
    prisma.scheduledPost.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
    prisma.scheduledPost.aggregate({
      where,
      _sum: { viewCount: true, likeCount: true, commentCount: true, shareCount: true },
    }),
    prisma.scheduledPost.count({ where: { ...where, tiktokPostUrl: { not: null } } }),
  ]);

  // Normalize lifecycle states: PUBLISHED/PENDING_DELETION/DELETED all mean published
  let published = 0;
  let failed = 0;
  let skipped = 0;
  for (const g of statusGroups) {
    if (PUBLISHED_STATES.includes(g.status)) published += g._count._all;
    else if (g.status === "FAILED") failed += g._count._all;
    else if (g.status === "SKIPPED") skipped += g._count._all;
  }
  const attempts = published + failed;

  const summary = {
    published,
    failed,
    skipped,
    withLinks: linksCount,
    successRate: attempts > 0 ? Math.round((published / attempts) * 100) : 0,
    views: metricSums._sum.viewCount?.toString() ?? "0",
    likes: metricSums._sum.likeCount?.toString() ?? "0",
    comments: metricSums._sum.commentCount?.toString() ?? "0",
    shares: metricSums._sum.shareCount?.toString() ?? "0",
  };

  // Serialize BigInt fields + derive display fields
  const serialized = posts.map((p) => {
    const videoUrl = p.tiktokPostUrl
      || (p.tiktokVideoId && p.account.tiktokUsername
        ? `https://www.tiktok.com/@${p.account.tiktokUsername}/video/${p.tiktokVideoId}`
        : null);
    const campaignMatch = p.driveFileName?.match(/^\(([^)]+)\)/);

    return {
      id: p.id,
      // Normalized status for display: lifecycle states collapse into PUBLISHED
      status: PUBLISHED_STATES.includes(p.status) ? "PUBLISHED" : p.status,
      rawStatus: p.status,
      caption: p.caption,
      driveFileName: p.driveFileName,
      campaign: campaignMatch ? campaignMatch[1].trim() : null,
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

  return NextResponse.json({ posts: serialized, summary });
}

/**
 * POST /api/managed/history
 *
 * Fetches TikTok URLs from PostPeer for all PUBLISHED posts missing links.
 * Called from the "Refresh Links" button on the History page.
 */
export async function POST(req: NextRequest) {
  console.log("[RefreshLinks] POST /api/managed/history called");
  const session = await getSession();
  console.log("[RefreshLinks] Session:", session ? `role=${session.role}` : "null");
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "accounts"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const POSTPEER_API = "https://api.postpeer.dev/v1";
  const postpeerKey = process.env.POSTPEER_ACCESS_KEY;

  if (!postpeerKey) {
    return NextResponse.json({ error: "POSTPEER_ACCESS_KEY not configured" }, { status: 500 });
  }

  const results: { updated: number; noUrl: number; errors: number; details: Record<string, string> } = {
    updated: 0,
    noUrl: 0,
    errors: 0,
    details: {},
  };
  // === CLEANUP: Clear incorrectly-stored URLs that were constructed from publish_id ===
  // The platformPostId from PostPeer is TikTok's publish_id, NOT the video_id.
  // Any tiktokPostUrl that was constructed from these is WRONG.
  // Clear them so Refresh Links can re-populate correctly from PostPeer's platformPostUrl.
  const cleanedUp = await prisma.scheduledPost.updateMany({
    where: {
      status: { in: ["PUBLISHED", "PENDING_DELETION", "DELETED"] },
      tiktokPostUrl: { not: null },
      tiktokVideoId: { not: null },
      // These were ALL incorrectly constructed - clear them
    },
    data: {
      tiktokPostUrl: null,
      tiktokVideoId: null,
    },
  });
  if (cleanedUp.count > 0) {
    console.log(`[RefreshLinks] Cleaned up ${cleanedUp.count} incorrectly-stored URLs`);
  }

  // === Tier 1: DISABLED — tiktokVideoId values were wrong (publish_id, not video_id) ===
  // Previously rebuilt URLs from stored tiktokVideoId, but those IDs were incorrect.
  // These can be rebuilt instantly without calling PostPeer
  const rebuildablePosts = await prisma.scheduledPost.findMany({
    where: {
      status: { in: ["PUBLISHED", "PENDING_DELETION", "DELETED"] },
      tiktokVideoId: { not: null },
      tiktokPostUrl: null,
    },
    include: {
      account: { select: { tiktokUsername: true } },
    },
    take: 200,
  });

  console.log(`[RefreshLinks] Tier 1: ${rebuildablePosts.length} posts with videoId but no URL`);

  for (const post of rebuildablePosts) {
    if (post.tiktokVideoId && post.account.tiktokUsername) {
      const url = `https://www.tiktok.com/@${post.account.tiktokUsername}/video/${post.tiktokVideoId}`;
      await prisma.scheduledPost.update({
        where: { id: post.id },
        data: { tiktokPostUrl: url },
      });
      results.updated++;
      results.details[post.id] = `✅ rebuilt: ${url}`;
    }
  }

  // === Tier 2: Posts with PostPeer ID but no video ID — need to fetch from PostPeer ===
  const missingUrlPosts = await prisma.scheduledPost.findMany({
    where: {
      status: { in: ["PUBLISHED", "PENDING_DELETION", "DELETED"] },
      tiktokPublishId: { not: null },
      tiktokPostUrl: null,
    },
    include: {
      account: { select: { tiktokUsername: true } },
    },
    take: 20,
  });

  console.log(`[RefreshLinks] Tier 2: ${missingUrlPosts.length} posts need PostPeer fetch`);

  for (let i = 0; i < missingUrlPosts.length; i++) {
    // Rate limit: 500ms between requests to avoid PostPeer 500 errors
    if (i > 0) await new Promise(r => setTimeout(r, 500));
    const post = missingUrlPosts[i];
    const postpeerId = post.tiktokPublishId!;
    console.log(`[RefreshLinks] Tier 2 [${i+1}/${missingUrlPosts.length}] Fetching PostPeer post ${postpeerId}...`);
    try {
      const res = await fetch(`${POSTPEER_API}/posts/${postpeerId}`, {
        headers: { "x-access-key": postpeerKey },
      });

      if (!res.ok) {
        console.log(`[RefreshLinks] PostPeer API error ${res.status} for ${postpeerId}`);
        results.errors++;
        results.details[postpeerId] = `api_error_${res.status}`;
        continue;
      }

      const data = await res.json();

      // PostPeer response structure: { success: true, post: { platforms: [...] } }
      const postData = data.post || data;
      const platforms = postData.platforms || [];
      const tiktokPlatform = Array.isArray(platforms)
        ? platforms.find((p: Record<string, unknown>) => p.platform === "tiktok")
        : null;

      if (!tiktokPlatform) {
        console.log(`[RefreshLinks] No tiktok platform in response for ${postpeerId}, keys: ${Object.keys(postData).join(",")}`);
        results.noUrl++;
        results.details[postpeerId] = "no_tiktok_platform_in_response";
        continue;
      }

      // Log the full platform object so we can see ALL available fields
      console.log(`[RefreshLinks] PostPeer ${postpeerId} platform:`, JSON.stringify(tiktokPlatform));

      // PRIORITY 1: Use platformPostUrl directly from PostPeer (the actual TikTok URL)
      const directUrl: string | null = tiktokPlatform.platformPostUrl || null;

      if (directUrl) {
        // PostPeer gave us the actual URL — use it directly
        // Extract video ID from URL for our records: https://www.tiktok.com/@user/video/XXXXX
        const videoIdMatch = directUrl.match(/\/video\/(\d+)/);
        const tiktokVideoId = videoIdMatch ? videoIdMatch[1] : null;

        await prisma.scheduledPost.update({
          where: { id: post.id },
          data: {
            tiktokPostUrl: directUrl,
            tiktokVideoId,
          },
        });
        results.updated++;
        results.details[postpeerId] = `✅ direct: ${directUrl}`;
        console.log(`[RefreshLinks] ✅ Direct URL from PostPeer: ${directUrl}`);
        continue;
      }

      // PRIORITY 2: platformPostUrl is null — PostPeer hasn't populated it yet
      // The platformPostId contains TikTok's publish_id, NOT the video_id
      // We CANNOT construct a valid URL from it
      const rawPlatformPostId: string = tiktokPlatform.platformPostId || "";
      results.noUrl++;
      results.details[postpeerId] = `waiting (platformPostUrl=null, publishId=${rawPlatformPostId}, username=${post.account.tiktokUsername})`;
    } catch (err) {
      console.log(`[RefreshLinks] Error for ${postpeerId}: ${err instanceof Error ? err.message : String(err)}`);
      results.errors++;
      results.details[postpeerId] = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  console.log(`[RefreshLinks] DONE: updated=${results.updated}, noUrl=${results.noUrl}, errors=${results.errors}`);

  return NextResponse.json({
    ok: true,
    totalChecked: rebuildablePosts.length + missingUrlPosts.length,
    ...results,
  });
}
