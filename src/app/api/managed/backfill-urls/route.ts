export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";

/**
 * POST /api/managed/backfill-urls
 * One-time backfill: construct tiktokPostUrl for all PUBLISHED posts
 * that have tiktokVideoId but no tiktokPostUrl.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const posts = await prisma.scheduledPost.findMany({
    where: {
      status: "PUBLISHED",
      tiktokVideoId: { not: null },
      tiktokPostUrl: null,
    },
    include: {
      account: { select: { tiktokUsername: true } },
    },
  });

  let updated = 0;

  for (const post of posts) {
    if (post.tiktokVideoId && post.account.tiktokUsername) {
      const url = `https://www.tiktok.com/@${post.account.tiktokUsername}/video/${post.tiktokVideoId}`;
      await prisma.scheduledPost.update({
        where: { id: post.id },
        data: { tiktokPostUrl: url },
      });
      updated++;
    }
  }

  return NextResponse.json({
    ok: true,
    found: posts.length,
    updated,
  });
}
