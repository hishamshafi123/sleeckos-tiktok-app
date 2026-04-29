export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

// Fetch live metrics from TikTok and store them
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const deliverable = await prisma.deliverable.findUnique({
      where: { id },
      include: { creatorUser: { include: { tiktokAccount: true } } }
    });

    if (!deliverable) return NextResponse.json({ error: "Deliverable not found" }, { status: 404 });
    if (deliverable.creatorUserId !== session.userId && session.role !== "ADMIN" && session.role !== "BRAND_OWNER") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const tiktokAccount = deliverable.creatorUser.tiktokAccount;
    if (!tiktokAccount || !deliverable.tiktokVideoId) {
      return NextResponse.json({ error: "No TikTok video linked to this deliverable" }, { status: 400 });
    }

    // Call TikTok Video Query API
    const tiktokRes = await fetch(
      `https://open.tiktokapis.com/v2/video/query/?fields=id,like_count,comment_count,share_count,view_count`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${tiktokAccount.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filters: { video_ids: [deliverable.tiktokVideoId] }
        }),
      }
    );

    const tiktokData = await tiktokRes.json();
    const video = tiktokData?.data?.videos?.[0];

    if (!video) {
      return NextResponse.json({ error: "Video not found on TikTok", raw: tiktokData }, { status: 404 });
    }

    // Store metric snapshot
    const metric = await prisma.postMetric.create({
      data: {
        deliverableId: id,
        viewCount: BigInt(video.view_count ?? 0),
        likeCount: BigInt(video.like_count ?? 0),
        commentCount: BigInt(video.comment_count ?? 0),
        shareCount: BigInt(video.share_count ?? 0),
      }
    });

    return NextResponse.json({
      viewCount: Number(metric.viewCount),
      likeCount: Number(metric.likeCount),
      commentCount: Number(metric.commentCount),
      shareCount: Number(metric.shareCount),
      fetchedAt: metric.fetchedAt,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
