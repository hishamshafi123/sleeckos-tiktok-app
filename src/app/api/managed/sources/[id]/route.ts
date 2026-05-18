export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import {
  fetchLatestChannelVideos,
  fetchPlaylistVideos,
  getVideoDetails,
} from "@/lib/youtube";

// DELETE /api/managed/sources/[id] — remove a source
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  await prisma.youTubeSource.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

// PATCH /api/managed/sources/[id] — toggle active, update settings
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const updates: Record<string, unknown> = {};

  if (typeof body.isActive === "boolean") updates.isActive = body.isActive;
  if (typeof body.maxVideosPerFetch === "number") updates.maxVideosPerFetch = Math.max(1, Math.min(50, body.maxVideosPerFetch));

  const source = await prisma.youTubeSource.update({
    where: { id },
    data: updates,
  });

  return NextResponse.json(source);
}

// POST /api/managed/sources/[id] — manual "Fetch Now" trigger
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const source = await prisma.youTubeSource.findUnique({ where: { id } });
  if (!source) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  try {
    let basicVideos;

    if (source.type === "CHANNEL") {
      basicVideos = await fetchLatestChannelVideos(source.youtubeId, source.maxVideosPerFetch);
    } else {
      basicVideos = await fetchPlaylistVideos(source.youtubeId, source.maxVideosPerFetch);
    }

    if (basicVideos.length === 0) {
      await prisma.youTubeSource.update({
        where: { id },
        data: { lastFetchedAt: new Date() },
      });
      return NextResponse.json({ ok: true, discovered: 0, message: "No new videos found" });
    }

    // Get detailed stats
    const videoIds = basicVideos.map((v) => v.videoId);
    const details = await getVideoDetails(videoIds);
    const detailsMap = new Map(details.map((d) => [d.videoId, d]));

    // Upsert videos
    let discovered = 0;
    for (const video of basicVideos) {
      const stats = detailsMap.get(video.videoId);

      await prisma.sourcedVideo.upsert({
        where: {
          sourceId_youtubeVideoId: {
            sourceId: source.id,
            youtubeVideoId: video.videoId,
          },
        },
        create: {
          sourceId: source.id,
          groupId: source.groupId,
          youtubeVideoId: video.videoId,
          title: video.title,
          description: video.description,
          thumbnailUrl: video.thumbnailUrl,
          channelTitle: video.channelTitle,
          publishedAt: new Date(video.publishedAt),
          duration: stats?.duration || "PT0S",
          viewCount: stats?.viewCount || 0,
          likeCount: stats?.likeCount || 0,
          commentCount: stats?.commentCount || 0,
        },
        update: {
          title: video.title,
          thumbnailUrl: video.thumbnailUrl,
          viewCount: stats?.viewCount || 0,
          likeCount: stats?.likeCount || 0,
          commentCount: stats?.commentCount || 0,
          duration: stats?.duration || "PT0S",
          fetchedAt: new Date(),
        },
      });
      discovered++;
    }

    await prisma.youTubeSource.update({
      where: { id },
      data: { lastFetchedAt: new Date() },
    });

    return NextResponse.json({ ok: true, discovered });
  } catch (err) {
    console.error("Fetch YouTube videos error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Fetch failed" },
      { status: 500 }
    );
  }
}
