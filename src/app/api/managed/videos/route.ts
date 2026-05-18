export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";

// GET /api/managed/videos?nicheId=xxx&status=NEW&sortBy=recent
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const nicheId = req.nextUrl.searchParams.get("nicheId");
  const status = req.nextUrl.searchParams.get("status");
  const sortBy = req.nextUrl.searchParams.get("sortBy") || "discovered";
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") || "50", 10), 100);
  const offset = parseInt(req.nextUrl.searchParams.get("offset") || "0", 10);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (nicheId) where.nicheId = nicheId;
  if (status) where.status = status;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let orderBy: any;
  switch (sortBy) {
    case "recent": orderBy = { publishedAt: "desc" }; break;
    case "views": orderBy = { viewCount: "desc" }; break;
    case "likes": orderBy = { likeCount: "desc" }; break;
    default: orderBy = { discoveredAt: "desc" };
  }

  const [videos, total] = await Promise.all([
    prisma.sourcedVideo.findMany({
      where, orderBy, take: limit, skip: offset,
      include: {
        source: { select: { title: true, type: true } },
        niche: { select: { name: true, color: true } },
      },
    }),
    prisma.sourcedVideo.count({ where }),
  ]);

  return NextResponse.json({ videos, total, limit, offset });
}
