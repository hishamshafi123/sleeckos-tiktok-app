export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";

// GET /api/managed/videos?groupId=xxx — list sourced videos for a group
//   Optional query params: status, sortBy (views|recent|likes), limit, offset
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const groupId = req.nextUrl.searchParams.get("groupId");
  const sectionId = req.nextUrl.searchParams.get("sectionId");
  const status = req.nextUrl.searchParams.get("status");
  const sortBy = req.nextUrl.searchParams.get("sortBy") || "views";
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") || "50", 10), 100);
  const offset = parseInt(req.nextUrl.searchParams.get("offset") || "0", 10);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  if (groupId) {
    where.groupId = groupId;
  } else if (sectionId) {
    where.group = { sectionId };
  }

  if (status) {
    where.status = status;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let orderBy: any;
  switch (sortBy) {
    case "recent":
      orderBy = { publishedAt: "desc" };
      break;
    case "likes":
      orderBy = { likeCount: "desc" };
      break;
    case "discovered":
      orderBy = { discoveredAt: "desc" };
      break;
    default:
      orderBy = { viewCount: "desc" };
  }

  const [videos, total] = await Promise.all([
    prisma.sourcedVideo.findMany({
      where,
      orderBy,
      take: limit,
      skip: offset,
      include: {
        source: {
          select: { title: true, type: true, youtubeId: true },
        },
        group: {
          select: {
            name: true,
            slug: true,
            section: { select: { name: true, slug: true } },
          },
        },
      },
    }),
    prisma.sourcedVideo.count({ where }),
  ]);

  return NextResponse.json({ videos, total, limit, offset });
}
