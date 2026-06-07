export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";

/**
 * GET /api/managed/sections/[id]/video-links
 *
 * Returns published video links for a section, with optional filters:
 *   ?from=YYYY-MM-DD   — start date (publishedAt)
 *   ?to=YYYY-MM-DD     — end date (publishedAt)
 *   ?hashtag=#fyp       — filter captions containing this hashtag
 *   ?limit=500          — max results (default 500)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: sectionId } = await params;
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const hashtag = url.searchParams.get("hashtag");
  const limit = Math.min(Number(url.searchParams.get("limit")) || 500, 2000);

  // Verify section exists
  const section = await prisma.accountSection.findUnique({
    where: { id: sectionId },
    select: { id: true, name: true },
  });
  if (!section) {
    return NextResponse.json({ error: "Section not found" }, { status: 404 });
  }

  // Build where clause
  const where: Record<string, unknown> = {
    status: "PUBLISHED",
    tiktokPostUrl: { not: null },
    account: {
      group: {
        sectionId,
      },
    },
  };

  // Date range filter on publishedAt
  if (from || to) {
    const dateFilter: Record<string, Date> = {};
    if (from) dateFilter.gte = new Date(`${from}T00:00:00Z`);
    if (to) dateFilter.lte = new Date(`${to}T23:59:59Z`);
    where.publishedAt = dateFilter;
  }

  // Hashtag filter — case-insensitive contains on caption
  if (hashtag) {
    const tag = hashtag.startsWith("#") ? hashtag : `#${hashtag}`;
    where.caption = { contains: tag, mode: "insensitive" };
  }

  const posts = await prisma.scheduledPost.findMany({
    where,
    orderBy: { publishedAt: "desc" },
    take: limit,
    select: {
      id: true,
      tiktokPostUrl: true,
      tiktokVideoId: true,
      caption: true,
      publishedAt: true,
      account: {
        select: {
          tiktokUsername: true,
          tiktokAvatarUrl: true,
          group: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  });

  return NextResponse.json({
    section: section.name,
    count: posts.length,
    videos: posts.map((p) => ({
      id: p.id,
      url: p.tiktokPostUrl,
      videoId: p.tiktokVideoId,
      caption: p.caption,
      publishedAt: p.publishedAt,
      username: p.account.tiktokUsername,
      avatarUrl: p.account.tiktokAvatarUrl,
      groupName: p.account.group.name,
    })),
  });
}
