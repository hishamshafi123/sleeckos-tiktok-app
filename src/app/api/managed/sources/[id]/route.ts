export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { fetchLatestChannelVideos, fetchPlaylistVideos, getVideoDetails, generateVideoSummary } from "@/lib/youtube";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await can(session.userId, "sourcing"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  await prisma.youTubeSource.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await can(session.userId, "sourcing"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const updates: Record<string, unknown> = {};
  if (typeof body.isActive === "boolean") updates.isActive = body.isActive;
  if (typeof body.maxVideosPerFetch === "number") updates.maxVideosPerFetch = Math.max(1, Math.min(50, body.maxVideosPerFetch));

  const source = await prisma.youTubeSource.update({ where: { id }, data: updates });
  return NextResponse.json(source);
}

// POST — manual "Fetch Now"
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await can(session.userId, "sourcing"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const source = await prisma.youTubeSource.findUnique({ where: { id } });
  if (!source) return NextResponse.json({ error: "Source not found" }, { status: 404 });

  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Clean up older videos (status NEW or SKIPPED) that are older than 24 hours
    await prisma.sourcedVideo.deleteMany({
      where: {
        status: { in: ["NEW", "SKIPPED"] },
        OR: [
          { publishedAt: { lt: twentyFourHoursAgo } },
          { discoveredAt: { lt: twentyFourHoursAgo } },
        ],
      },
    });

    const basicVideos = source.type === "CHANNEL"
      ? await fetchLatestChannelVideos(source.youtubeId, source.maxVideosPerFetch)
      : await fetchPlaylistVideos(source.youtubeId, source.maxVideosPerFetch);

    // Only process videos published in the last 24 hours
    const freshVideos = basicVideos.filter(
      (v) => new Date(v.publishedAt).getTime() >= twentyFourHoursAgo.getTime()
    );

    if (freshVideos.length === 0) {
      await prisma.youTubeSource.update({ where: { id }, data: { lastFetchedAt: new Date() } });
      return NextResponse.json({ ok: true, discovered: 0, message: "No new videos found in the last 24 hours" });
    }

    const details = await getVideoDetails(freshVideos.map((v) => v.videoId));
    const detailsMap = new Map(details.map((d) => [d.videoId, d]));

    let discovered = 0;
    for (const video of freshVideos) {
      const stats = detailsMap.get(video.videoId);
      const summaryText = await generateVideoSummary(video.title, video.description || "");
      await prisma.sourcedVideo.upsert({
        where: { sourceId_youtubeVideoId: { sourceId: source.id, youtubeVideoId: video.videoId } },
        create: {
          sourceId: source.id, nicheId: source.nicheId,
          youtubeVideoId: video.videoId, title: video.title, description: video.description,
          thumbnailUrl: video.thumbnailUrl, channelTitle: video.channelTitle,
          publishedAt: new Date(video.publishedAt), duration: stats?.duration || "PT0S",
          viewCount: stats?.viewCount || 0, likeCount: stats?.likeCount || 0, commentCount: stats?.commentCount || 0,
          summary: summaryText,
        },
        update: {
          title: video.title, thumbnailUrl: video.thumbnailUrl,
          viewCount: stats?.viewCount || 0, likeCount: stats?.likeCount || 0,
          commentCount: stats?.commentCount || 0, duration: stats?.duration || "PT0S", fetchedAt: new Date(),
          summary: summaryText,
        },
      });
      discovered++;
    }

    await prisma.youTubeSource.update({ where: { id }, data: { lastFetchedAt: new Date() } });
    return NextResponse.json({ ok: true, discovered });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Fetch failed" }, { status: 500 });
  }
}
