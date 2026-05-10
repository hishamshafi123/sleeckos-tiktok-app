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

  try {
    const url = new URL(req.url);
    const filter = url.searchParams.get("filter") || "all";
    const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 500);

    // Build where clause
    const where: Record<string, unknown> = {};
    if (filter === "active") {
      where.status = { in: ["QUEUED", "DOWNLOADING", "UPLOADING", "PROCESSING"] };
    } else if (filter === "failed") {
      where.status = "FAILED";
    } else if (filter === "completed") {
      where.status = { in: ["PUBLISHED", "SKIPPED"] };
    }

    const posts = await prisma.scheduledPost.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
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

    // Serialize BigInt fields to strings for JSON
    const serialized = posts.map((p) => ({
      ...p,
      viewCount: p.viewCount?.toString() ?? "0",
      likeCount: p.likeCount?.toString() ?? "0",
      commentCount: p.commentCount?.toString() ?? "0",
      shareCount: p.shareCount?.toString() ?? "0",
    }));

    return NextResponse.json(serialized);
  } catch (err) {
    console.error("Queue API error:", err);
    return NextResponse.json(
      { error: `Failed to fetch posts: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
