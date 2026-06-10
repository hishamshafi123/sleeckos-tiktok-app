export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import fs from "fs";
import path from "path";

// GET /api/managed/genres/tracks — List all music tracks with campaign metrics
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const tracks = await prisma.track.findMany({
      orderBy: { createdAt: "desc" },
    });

    const enrichedTracks = await Promise.all(tracks.map(async (track) => {
      if (!track.campaignOn || !track.campaignActiveAt) {
        return {
          ...track,
          videosPosted: 0,
          totalViews: 0
        };
      }

      // Fetch batch items with driveFileIds
      const batchItems = await prisma.genreBatchItem.findMany({
        where: {
          trackId: track.id,
          driveFileId: { not: null }
        },
        select: {
          driveFileId: true
        }
      });

      const driveFileIds = batchItems.map(item => item.driveFileId).filter(Boolean) as string[];

      if (driveFileIds.length === 0) {
        return {
          ...track,
          videosPosted: 0,
          totalViews: 0
        };
      }

      // Query published ScheduledPost records after campaignActiveAt
      const posts = await prisma.scheduledPost.findMany({
        where: {
          driveFileId: { in: driveFileIds },
          status: "PUBLISHED",
          publishedAt: {
            gte: track.campaignActiveAt
          }
        },
        select: {
          viewCount: true
        }
      });

      const videosPosted = posts.length;
      const totalViews = posts.reduce((sum, post) => sum + Number(post.viewCount || 0), 0);

      return {
        ...track,
        videosPosted,
        totalViews
      };
    }));

    return NextResponse.json(enrichedTracks);
  } catch (err) {
    console.error("[Tracks API] Error fetching tracks:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST /api/managed/genres/tracks — Upload audio track and save metadata
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("audioFile") as File | null;
    const title = formData.get("title") as string | null;
    const artist = formData.get("artist") as string | null;
    const defaultStart = parseFloat(formData.get("defaultStart") as string || "0");
    const defaultDuration = parseFloat(formData.get("defaultDuration") as string || "7");
    const passedDuration = parseFloat(formData.get("duration") as string || "0");
    const genre = formData.get("genre") as string | null;
    const musician = formData.get("musician") as string | null;

    if (!file || !title || !artist) {
      return NextResponse.json({ error: "Missing required fields (audioFile, title, artist)" }, { status: 400 });
    }

    // Save audio file locally to public/uploads/tracks/
    const uploadDir = path.join(process.cwd(), "public", "uploads", "tracks");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const fileExt = path.extname(file.name) || ".mp3";
    const fileName = `track_${Math.random().toString(36).substring(2, 11)}${fileExt}`;
    const filePath = path.join(uploadDir, fileName);

    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    const relativeUrl = `/uploads/tracks/${fileName}`;

    // Create db record
    const track = await prisma.track.create({
      data: {
        title: title.trim(),
        artist: artist.trim(),
        fileUrl: relativeUrl,
        duration: passedDuration > 0 ? passedDuration : 30.0, // default if duration not read
        defaultStart,
        defaultDuration,
        genre: genre ? genre.trim() : null,
        musician: musician ? musician.trim() : null,
      },
    });

    console.log(`[Tracks API] Successfully uploaded and created track: ${track.id}`);
    return NextResponse.json(track);
  } catch (err) {
    console.error("[Tracks API] Upload error:", err);
    return NextResponse.json({ error: "Failed to upload track" }, { status: 500 });
  }
}

// PATCH /api/managed/genres/tracks — Toggle campaign status or edit track details
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { id, genre, musician, campaignOn, lyricalTranscription } = body;

    if (!id) {
      return NextResponse.json({ error: "Missing track ID" }, { status: 400 });
    }

    const track = await prisma.track.findUnique({ where: { id } });
    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }

    const updateData: any = {};
    if (genre !== undefined) updateData.genre = genre ? genre.trim() : null;
    if (musician !== undefined) updateData.musician = musician ? musician.trim() : null;
    if (lyricalTranscription !== undefined) {
      updateData.lyricalTranscription = lyricalTranscription;
    }
    
    if (campaignOn !== undefined) {
      updateData.campaignOn = !!campaignOn;
      if (campaignOn) {
        updateData.campaignActiveAt = new Date();
      } else {
        updateData.campaignActiveAt = null;
      }
    }

    const updatedTrack = await prisma.track.update({
      where: { id },
      data: updateData,
    });

    console.log(`[Tracks API] Updated track ${id}:`, updateData);
    return NextResponse.json(updatedTrack);
  } catch (err) {
    console.error("[Tracks API] Error updating track:", err);
    return NextResponse.json({ error: "Failed to update track" }, { status: 500 });
  }
}

// DELETE /api/managed/genres/tracks?id=... — Delete a track from DB and file system
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing track ID" }, { status: 400 });
  }

  try {
    const track = await prisma.track.findUnique({ where: { id } });
    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }

    // Attempt file system delete
    try {
      const filePath = path.join(process.cwd(), "public", track.fileUrl);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[Tracks API] Deleted local audio file at ${filePath}`);
      }
    } catch (fsErr) {
      console.warn("[Tracks API] Failed to delete track file from filesystem:", fsErr);
    }

    // Delete DB record
    await prisma.track.delete({ where: { id } });
    
    console.log(`[Tracks API] Deleted track record: ${id}`);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Tracks API] Error deleting track:", err);
    return NextResponse.json({ error: "Failed to delete track" }, { status: 500 });
  }
}
