export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import {
  fetchLatestChannelVideos,
  fetchPlaylistVideos,
  getVideoDetails,
} from "@/lib/youtube";

function verifyCronSecret(req: NextRequest) {
  const secret =
    req.headers.get("x-cron-secret") ||
    req.nextUrl.searchParams.get("secret");
  return secret === process.env.CRON_SECRET;
}

/**
 * GET /api/cron/fetch-youtube?secret=xxx
 *
 * Daily cron job that fetches top videos from all active YouTube sources.
 * Designed to be called once or twice daily via host crontab:
 *   0 2 * * * curl -s "http://127.0.0.1:3000/api/cron/fetch-youtube?secret=YOUR_SECRET"
 */
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.YOUTUBE_API_KEY) {
    return NextResponse.json(
      { error: "YOUTUBE_API_KEY not configured" },
      { status: 500 }
    );
  }

  const sources = await prisma.youTubeSource.findMany({
    where: { isActive: true },
    include: {
      group: {
        select: { name: true, section: { select: { name: true } } },
      },
    },
  });

  if (sources.length === 0) {
    return NextResponse.json({
      ok: true,
      message: "No active YouTube sources",
      processed: 0,
    });
  }

  const results: Record<string, string> = {};
  let totalDiscovered = 0;

  for (const source of sources) {
    const key = `${source.group.section.name}/${source.group.name}/${source.title}`;
    try {
      let basicVideos;

      if (source.type === "CHANNEL") {
        basicVideos = await fetchLatestChannelVideos(source.youtubeId, source.maxVideosPerFetch);
      } else {
        basicVideos = await fetchPlaylistVideos(source.youtubeId, source.maxVideosPerFetch);
      }

      if (basicVideos.length === 0) {
        results[key] = "no_new_videos";
        await prisma.youTubeSource.update({
          where: { id: source.id },
          data: { lastFetchedAt: new Date() },
        });
        continue;
      }

      // Get detailed stats for all videos
      const videoIds = basicVideos.map((v) => v.videoId);
      const details = await getVideoDetails(videoIds);
      const detailsMap = new Map(details.map((d) => [d.videoId, d]));

      let discovered = 0;
      for (const video of basicVideos) {
        const stats = detailsMap.get(video.videoId);

        try {
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
        } catch (err) {
          // Skip individual video errors (e.g. constraint violations)
          console.error(`Error upserting video ${video.videoId}:`, err);
        }
      }

      await prisma.youTubeSource.update({
        where: { id: source.id },
        data: { lastFetchedAt: new Date() },
      });

      totalDiscovered += discovered;
      results[key] = `discovered_${discovered}_videos`;
    } catch (err) {
      results[key] = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return NextResponse.json({
    ok: true,
    processed: sources.length,
    totalDiscovered,
    results,
  });
}
