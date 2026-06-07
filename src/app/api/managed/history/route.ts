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
