export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import fs from "fs";
import path from "path";

// GET /api/managed/genres/accounts — Get accounts configurations list
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "composer"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // Fetch all active accounts with their quote configs and background videos
    const accounts = await prisma.managedAccount.findMany({
      where: { isActive: true },
      select: {
        id: true,
        tiktokUsername: true,
        tiktokDisplayName: true,
        tiktokAvatarUrl: true,
        driveFolderId: true,
        driveFolderName: true,
        driveConnected: true,
        googleRefreshToken: true,
        group: {
          select: {
            id: true,
            name: true,
            slug: true,
            section: {
              select: {
                id: true,
                name: true,
                slug: true,
                color: true,
              }
            }
          },
        },
        genreConfigs: {
          where: { genre: "quote" },
        },
        backgroundVideos: {
          where: { genre: "quote" },
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { tiktokUsername: "asc" },
    });

    const sanitized = accounts.map(a => ({
      ...a,
      googleOAuthConnected: !!a.googleRefreshToken,
      googleRefreshToken: undefined,
    }));

    return NextResponse.json(sanitized);
  } catch (err) {
    console.error("[Genre Accounts API] Error fetching:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST /api/managed/genres/accounts — Save account quote settings / upload background loops
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "composer"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const formData = await req.formData();
    const accountId = formData.get("accountId") as string;
    
    if (!accountId) {
      return NextResponse.json({ error: "Missing accountId" }, { status: 400 });
    }

    // 1. Handle file upload (Background Video loop) if present
    const videoFile = formData.get("videoFile") as File | null;
    let newBgVideo = null;

    if (videoFile) {
      const uploadDir = path.join(process.cwd(), "public", "uploads", "backgrounds");
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const fileExt = path.extname(videoFile.name) || ".mp4";
      const fileName = `bg_${accountId.substring(0, 5)}_${Math.random().toString(36).substring(2, 9)}${fileExt}`;
      const filePath = path.join(uploadDir, fileName);

      const buffer = Buffer.from(await videoFile.arrayBuffer());
      fs.writeFileSync(filePath, buffer);

      const relativeUrl = `/uploads/backgrounds/${fileName}`;

      newBgVideo = await prisma.accountBackgroundVideo.create({
        data: {
          accountId,
          genre: "quote",
          videoUrl: relativeUrl,
        },
      });
      console.log(`[Genre Accounts API] Uploaded new background video for ${accountId}: ${newBgVideo.id}`);
    }

    // 2. Update style configurations & themes if text values are provided
    const themeText = formData.get("themeText") as string | null;
    let configRecord = null;

    if (themeText !== null) {
      const fontFamily = formData.get("fontFamily") as string || "Outfit-Bold";
      const fontSize = parseInt(formData.get("fontSize") as string || "44", 10);
      const fontColor = formData.get("fontColor") as string || "#FFFFFF";
      const textCase = formData.get("textCase") as string || "UPPERCASE";
      const boxColor = formData.get("boxColor") as string || "none";
      const shadowColor = formData.get("shadowColor") as string || "black@0.6";
      const lineSpacing = parseInt(formData.get("lineSpacing") as string || "10", 10);
      const curveText = formData.get("curveText") === "true";
      const curvature = parseInt(formData.get("curvature") as string || "30", 10);
      const positionY = parseInt(formData.get("positionY") as string || "50", 10);
      const savedStyleId = formData.get("savedStyleId") as string | null;

      // Upsert style configuration
      configRecord = await prisma.accountGenreConfig.upsert({
        where: {
          accountId_genre: {
            accountId,
            genre: "quote",
          },
        },
        create: {
          accountId,
          genre: "quote",
          themeText: themeText.trim(),
          fontFamily: fontFamily.trim(),
          fontSize,
          fontColor: fontColor.trim(),
          textCase: textCase.trim(),
          boxColor: boxColor.trim(),
          shadowColor: shadowColor.trim(),
          lineSpacing,
          curveText,
          curvature,
          positionY,
          savedStyleId: savedStyleId ? savedStyleId : null,
        },
        update: {
          themeText: themeText.trim(),
          fontFamily: fontFamily.trim(),
          fontSize,
          fontColor: fontColor.trim(),
          textCase: textCase.trim(),
          boxColor: boxColor.trim(),
          shadowColor: shadowColor.trim(),
          lineSpacing,
          curveText,
          curvature,
          positionY,
          savedStyleId: savedStyleId ? savedStyleId : null,
        },
      });
      console.log(`[Genre Accounts API] Upserted quote configurations for account ${accountId}`);
    }

    return NextResponse.json({
      success: true,
      config: configRecord,
      video: newBgVideo,
    });
  } catch (err) {
    console.error("[Genre Accounts API] Error updating account settings:", err);
    return NextResponse.json({ error: "Failed to update configurations" }, { status: 500 });
  }
}

// DELETE /api/managed/genres/accounts?deleteVideoId=... — Delete a background video loop
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "composer"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const deleteVideoId = searchParams.get("deleteVideoId");

  if (!deleteVideoId) {
    return NextResponse.json({ error: "Missing deleteVideoId" }, { status: 400 });
  }

  try {
    const bgVideo = await prisma.accountBackgroundVideo.findUnique({
      where: { id: deleteVideoId },
    });

    if (!bgVideo) {
      return NextResponse.json({ error: "Video record not found" }, { status: 404 });
    }

    // Try deleting file from file system
    try {
      const filePath = path.join(process.cwd(), "public", bgVideo.videoUrl);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[Genre Accounts API] Deleted local video loop: ${filePath}`);
      }
    } catch (fsErr) {
      console.warn("[Genre Accounts API] File system delete warning:", fsErr);
    }

    // Remove DB entry
    await prisma.accountBackgroundVideo.delete({
      where: { id: deleteVideoId },
    });

    console.log(`[Genre Accounts API] Removed background video DB record: ${deleteVideoId}`);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Genre Accounts API] Error deleting background video:", err);
    return NextResponse.json({ error: "Failed to delete video loop" }, { status: 500 });
  }
}
