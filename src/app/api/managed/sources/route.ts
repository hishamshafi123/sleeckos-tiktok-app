export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { parseYouTubeUrl, resolveChannel, resolvePlaylist } from "@/lib/youtube";

// GET /api/managed/sources?nicheId=xxx
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const nicheId = req.nextUrl.searchParams.get("nicheId");
  if (!nicheId) return NextResponse.json({ error: "nicheId is required" }, { status: 400 });

  const sources = await prisma.youTubeSource.findMany({
    where: { nicheId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { videos: true } } },
  });

  return NextResponse.json(sources);
}

// POST /api/managed/sources — add a YouTube source to a niche
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { nicheId, url } = await req.json();
  if (!nicheId || !url?.trim()) {
    return NextResponse.json({ error: "nicheId and url are required" }, { status: 400 });
  }

  const niche = await prisma.sourcingNiche.findUnique({ where: { id: nicheId } });
  if (!niche) return NextResponse.json({ error: "Niche not found" }, { status: 404 });

  const parsed = parseYouTubeUrl(url.trim());
  if (!parsed) {
    return NextResponse.json({ error: "Invalid YouTube URL. Paste a channel or playlist URL." }, { status: 400 });
  }

  try {
    if (parsed.type === "CHANNEL") {
      const channel = await resolveChannel(parsed);
      const existing = await prisma.youTubeSource.findUnique({
        where: { nicheId_youtubeId: { nicheId, youtubeId: channel.id } },
      });
      if (existing) return NextResponse.json({ error: "This channel is already in this niche" }, { status: 409 });

      const source = await prisma.youTubeSource.create({
        data: { nicheId, type: "CHANNEL", youtubeId: channel.id, url: url.trim(), title: channel.title, thumbnailUrl: channel.thumbnailUrl, subscriberCount: channel.subscriberCount },
      });
      return NextResponse.json(source, { status: 201 });
    } else {
      const playlist = await resolvePlaylist(parsed.id);
      const existing = await prisma.youTubeSource.findUnique({
        where: { nicheId_youtubeId: { nicheId, youtubeId: playlist.id } },
      });
      if (existing) return NextResponse.json({ error: "This playlist is already in this niche" }, { status: 409 });

      const source = await prisma.youTubeSource.create({
        data: { nicheId, type: "PLAYLIST", youtubeId: playlist.id, url: url.trim(), title: playlist.title, thumbnailUrl: playlist.thumbnailUrl, subscriberCount: playlist.itemCount },
      });
      return NextResponse.json(source, { status: 201 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to resolve URL" }, { status: 422 });
  }
}
