export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";

// GET /api/managed/queue — list ALL posts for the queue page
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const filter = url.searchParams.get("filter") || "all";
  const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 500);

  type PostStatus = "QUEUED" | "DOWNLOADING" | "UPLOADING" | "PROCESSING" | "PUBLISHED" | "FAILED" | "SKIPPED";
  let statusFilter: PostStatus[] | undefined;
  if (filter === "active") {
    statusFilter = ["QUEUED", "DOWNLOADING", "UPLOADING", "PROCESSING"];
  } else if (filter === "failed") {
    statusFilter = ["FAILED"];
  } else if (filter === "completed") {
    statusFilter = ["PUBLISHED", "SKIPPED"];
  }
  // "all" = no filter

  const posts = await prisma.scheduledPost.findMany({
    where: statusFilter ? { status: { in: statusFilter } } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
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
