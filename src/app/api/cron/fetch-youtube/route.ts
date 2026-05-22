export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { fetchLatestChannelVideos, fetchPlaylistVideos, getVideoDetails, generateVideoSummary } from "@/lib/youtube";

function verifyCronSecret(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret") || req.nextUrl.searchParams.get("secret");
  return secret === process.env.CRON_SECRET;
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.YOUTUBE_API_KEY) return NextResponse.json({ error: "YOUTUBE_API_KEY not configured" }, { status: 500 });

  const sources = await prisma.youTubeSource.findMany({
    where: { isActive: true },
    include: { niche: { select: { name: true } } },
  });

  if (!sources.length) return NextResponse.json({ ok: true, message: "No active sources", processed: 0 });

  const results: Record<string, string> = {};
  let totalDiscovered = 0;

  for (const source of sources) {
    const key = `${source.niche.name}/${source.title}`;
    try {
      const basicVideos = source.type === "CHANNEL"
        ? await fetchLatestChannelVideos(source.youtubeId, source.maxVideosPerFetch)
        : await fetchPlaylistVideos(source.youtubeId, source.maxVideosPerFetch);

      if (!basicVideos.length) {
        await prisma.youTubeSource.update({ where: { id: source.id }, data: { lastFetchedAt: new Date() } });
        results[key] = "no_new_videos";
        continue;
      }

      const details = await getVideoDetails(basicVideos.map((v) => v.videoId));
      const detailsMap = new Map(details.map((d) => [d.videoId, d]));

      let discovered = 0;
      for (const video of basicVideos) {
        const stats = detailsMap.get(video.videoId);
        try {
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
        } catch { /* skip duplicate */ }
      }

      await prisma.youTubeSource.update({ where: { id: source.id }, data: { lastFetchedAt: new Date() } });
      totalDiscovered += discovered;
      results[key] = `discovered_${discovered}`;
    } catch (err) {
      results[key] = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return NextResponse.json({ ok: true, processed: sources.length, totalDiscovered, results });
}
