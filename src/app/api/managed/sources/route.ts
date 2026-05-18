export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import {
  parseYouTubeUrl,
  resolveChannel,
  resolvePlaylist,
} from "@/lib/youtube";

// GET /api/managed/sources?groupId=xxx — list YouTube sources for a group
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const groupId = req.nextUrl.searchParams.get("groupId");
  if (!groupId) {
    return NextResponse.json(
      { error: "groupId is required" },
      { status: 400 }
    );
  }

  const sources = await prisma.youTubeSource.findMany({
    where: { groupId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { videos: true } },
    },
  });

  return NextResponse.json(sources);
}

// POST /api/managed/sources — add a YouTube source
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { groupId, url } = await req.json();
  if (!groupId || !url?.trim()) {
    return NextResponse.json(
      { error: "groupId and url are required" },
      { status: 400 }
    );
  }

  // Verify group exists
  const group = await prisma.accountGroup.findUnique({
    where: { id: groupId },
    include: {
      section: { select: { maxSources: true } },
      _count: { select: { youtubeSources: true } },
    },
  });
  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  // Enforce maxSources limit per niche section
  if (group._count.youtubeSources >= group.section.maxSources) {
    return NextResponse.json(
      { error: `This niche allows max ${group.section.maxSources} sources per sub-niche. Remove one first.` },
      { status: 400 }
    );
  }

  // Parse the URL
  const parsed = parseYouTubeUrl(url.trim());
  if (!parsed) {
    return NextResponse.json(
      { error: "Invalid YouTube URL. Paste a channel or playlist URL." },
      { status: 400 }
    );
  }

  try {
    if (parsed.type === "CHANNEL") {
      const channel = await resolveChannel(parsed);

      // Check for duplicates
      const existing = await prisma.youTubeSource.findUnique({
        where: { groupId_youtubeId: { groupId, youtubeId: channel.id } },
      });
      if (existing) {
        return NextResponse.json(
          { error: "This channel is already added to this group" },
          { status: 409 }
        );
      }

      const source = await prisma.youTubeSource.create({
        data: {
          groupId,
          type: "CHANNEL",
          youtubeId: channel.id,
          url: url.trim(),
          title: channel.title,
          thumbnailUrl: channel.thumbnailUrl,
          subscriberCount: channel.subscriberCount,
        },
      });

      return NextResponse.json(source, { status: 201 });
    } else {
      // PLAYLIST
      const playlist = await resolvePlaylist(parsed.id);

      const existing = await prisma.youTubeSource.findUnique({
        where: { groupId_youtubeId: { groupId, youtubeId: playlist.id } },
      });
      if (existing) {
        return NextResponse.json(
          { error: "This playlist is already added to this group" },
          { status: 409 }
        );
      }

      const source = await prisma.youTubeSource.create({
        data: {
          groupId,
          type: "PLAYLIST",
          youtubeId: playlist.id,
          url: url.trim(),
          title: playlist.title,
          thumbnailUrl: playlist.thumbnailUrl,
          subscriberCount: playlist.itemCount, // reuse field for item count
        },
      });

      return NextResponse.json(source, { status: 201 });
    }
  } catch (err) {
    console.error("YouTube source add error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to resolve YouTube URL",
      },
      { status: 422 }
    );
  }
}
