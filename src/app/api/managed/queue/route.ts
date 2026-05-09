export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";

// GET /api/managed/queue — list active posts for the queue page
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const posts = await prisma.scheduledPost.findMany({
    where: {
      status: {
        in: ["QUEUED", "DOWNLOADING", "UPLOADING", "PROCESSING", "FAILED"],
      },
    },
    orderBy: { scheduledFor: "asc" },
    take: 100,
    include: {
      account: {
        select: {
          tiktokUsername: true,
          tiktokAvatarUrl: true,
          group: {
            select: {
              name: true,
              section: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  return NextResponse.json(posts);
}
