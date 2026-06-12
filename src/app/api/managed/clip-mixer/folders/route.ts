export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

async function getVideoDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    );
    const duration = parseFloat(stdout.trim());
    if (isNaN(duration)) return 0;
    return duration;
  } catch (err) {
    console.error(`[Clip Mixer] ffprobe error for ${filePath}:`, err);
    return 0;
  }
}

// GET /api/managed/clip-mixer/folders — List folders or get a single folder with details
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const sectionId = searchParams.get("sectionId");
  const folderId = searchParams.get("folderId");

  try {
    if (folderId) {
      const folder = await prisma.clipFolder.findUnique({
        where: { id: folderId },
        include: {
          clips: {
            orderBy: { createdAt: "desc" },
          },
        },
      });
      if (!folder) {
        return NextResponse.json({ error: "Folder not found" }, { status: 404 });
      }
      return NextResponse.json(folder);
    }

    const folders = await prisma.clipFolder.findMany({
      where: sectionId ? { sectionId } : {},
      include: {
        clips: {
          orderBy: { createdAt: "desc" },
        },
        _count: {
          select: { clips: true },
        },
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json(folders);
  } catch (err) {
    console.error("[Clip Mixer Folders GET] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST /api/managed/clip-mixer/folders — Create a folder or upload clips to a folder
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const contentType = req.headers.get("content-type") || "";

    // Case 1: JSON payload for creating folders
    if (contentType.includes("application/json")) {
      const body = await req.json();
      const { action, sectionId, name, parentId } = body;

      if (action === "CREATE_FOLDER") {
        if (!sectionId || !name) {
          return NextResponse.json({ error: "Missing sectionId or name" }, { status: 400 });
        }

        const existing = await prisma.clipFolder.findFirst({
          where: {
            sectionId,
            name: name.trim(),
            parentId: parentId || null,
          },
        });

        if (existing) {
          return NextResponse.json({ error: "Folder with this name already exists in this folder" }, { status: 400 });
        }

        const folder = await prisma.clipFolder.create({
          data: {
            sectionId,
            name: name.trim(),
            parentId: parentId || null,
          },
        });

        return NextResponse.json(folder);
      }

      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    // Case 2: Multipart Form Data for uploading clips
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const folderId = formData.get("folderId") as string;
      const files = formData.getAll("clipFile") as File[];

      if (!folderId) {
        return NextResponse.json({ error: "Missing folderId" }, { status: 400 });
      }

      const folder = await prisma.clipFolder.findUnique({
        where: { id: folderId },
      });

      if (!folder) {
        return NextResponse.json({ error: "Folder not found" }, { status: 404 });
      }

      if (files.length === 0) {
        return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
      }

      const uploadDir = path.join(process.cwd(), "public", "uploads", "clip-mixer", folderId);
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const uploadedClips = [];

      for (const file of files) {
        const fileExt = path.extname(file.name) || ".mp4";
        const sanitizedOriginal = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}_${sanitizedOriginal}`;
        const filePath = path.join(uploadDir, fileName);

        const buffer = Buffer.from(await file.arrayBuffer());
        fs.writeFileSync(filePath, buffer);

        const relativeUrl = `/uploads/clip-mixer/${folderId}/${fileName}`;
        const duration = await getVideoDuration(filePath);

        const clip = await prisma.clipVideo.create({
          data: {
            folderId,
            videoUrl: relativeUrl,
            duration: duration > 0 ? duration : 5.0, // fallback if unable to probe
          },
        });

        uploadedClips.push(clip);
      }

      return NextResponse.json({ success: true, clips: uploadedClips });
    }

    return NextResponse.json({ error: "Unsupported content type" }, { status: 400 });
  } catch (err) {
    console.error("[Clip Mixer Folders POST] Error:", err);
    return NextResponse.json({ error: "Failed to process request" }, { status: 500 });
  }
}

// PATCH /api/managed/clip-mixer/folders — Rename or move a folder
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { action, folderId, name, parentId } = body;

    if (!folderId) {
      return NextResponse.json({ error: "Missing folderId" }, { status: 400 });
    }

    if (action === "RENAME_FOLDER") {
      if (!name || !name.trim()) {
        return NextResponse.json({ error: "Missing name" }, { status: 400 });
      }

      // Check if folder exists
      const folder = await prisma.clipFolder.findUnique({ where: { id: folderId } });
      if (!folder) {
        return NextResponse.json({ error: "Folder not found" }, { status: 404 });
      }

      // Check name uniqueness in same parent
      const existing = await prisma.clipFolder.findFirst({
        where: {
          sectionId: folder.sectionId,
          name: name.trim(),
          parentId: folder.parentId,
          id: { not: folderId },
        },
      });

      if (existing) {
        return NextResponse.json({ error: "Another folder with this name already exists in the same folder" }, { status: 400 });
      }

      const updated = await prisma.clipFolder.update({
        where: { id: folderId },
        data: { name: name.trim() },
      });

      return NextResponse.json(updated);
    }

    if (action === "MOVE_FOLDER") {
      const targetParentId = parentId === "" || parentId === "root" || parentId === null ? null : parentId;
      
      if (targetParentId === folderId) {
        return NextResponse.json({ error: "Cannot move folder into itself" }, { status: 400 });
      }

      // Check if folder exists
      const folder = await prisma.clipFolder.findUnique({ where: { id: folderId } });
      if (!folder) {
        return NextResponse.json({ error: "Folder not found" }, { status: 404 });
      }

      // Prevent moving a folder into its own descendants to avoid loops
      if (targetParentId) {
        let currentParentId: string | null = targetParentId;
        while (currentParentId) {
          if (currentParentId === folderId) {
            return NextResponse.json({ error: "Cannot move a folder into its own subfolder" }, { status: 400 });
          }
          const parentFolder: { parentId: string | null } | null = await prisma.clipFolder.findUnique({
            where: { id: currentParentId },
            select: { parentId: true },
          });
          currentParentId = parentFolder?.parentId || null;
        }
      }

      // Check name uniqueness in new parent
      const existing = await prisma.clipFolder.findFirst({
        where: {
          sectionId: folder.sectionId,
          name: folder.name,
          parentId: targetParentId,
          id: { not: folderId },
        },
      });

      if (existing) {
        return NextResponse.json({ error: "A folder with the same name already exists in the destination folder" }, { status: 400 });
      }

      const updated = await prisma.clipFolder.update({
        where: { id: folderId },
        data: { parentId: targetParentId },
      });

      return NextResponse.json(updated);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    console.error("[Clip Folder PATCH] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to update folder" }, { status: 500 });
  }
}

// DELETE /api/managed/clip-mixer/folders — Delete folder or a single video clip
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const folderId = searchParams.get("folderId");
  const clipId = searchParams.get("clipId");

  try {
    if (clipId) {
      const clip = await prisma.clipVideo.findUnique({
        where: { id: clipId },
      });

      if (!clip) {
        return NextResponse.json({ error: "Clip not found" }, { status: 404 });
      }

      // Try deleting local file
      try {
        const filePath = path.join(process.cwd(), "public", clip.videoUrl);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (fsErr) {
        console.warn("[Clip Mixer Folders DELETE] File system error:", fsErr);
      }

      await prisma.clipVideo.delete({
        where: { id: clipId },
      });

      return NextResponse.json({ success: true });
    }

    if (folderId) {
      const folder = await prisma.clipFolder.findUnique({
        where: { id: folderId },
        include: { clips: true },
      });

      if (!folder) {
        return NextResponse.json({ error: "Folder not found" }, { status: 404 });
      }

      // Delete files of all clips in this folder
      for (const clip of folder.clips) {
        try {
          const filePath = path.join(process.cwd(), "public", clip.videoUrl);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch (fsErr) {
          console.warn("[Clip Mixer Folders DELETE] File system error on clip:", fsErr);
        }
      }

      // Try deleting folder directory
      try {
        const folderDir = path.join(process.cwd(), "public", "uploads", "clip-mixer", folderId);
        if (fs.existsSync(folderDir)) {
          fs.rmSync(folderDir, { recursive: true, force: true });
        }
      } catch (dirErr) {
        console.warn("[Clip Mixer Folders DELETE] Folder directory removal error:", dirErr);
      }

      await prisma.clipFolder.delete({
        where: { id: folderId },
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Missing folderId or clipId" }, { status: 400 });
  } catch (err) {
    console.error("[Clip Mixer Folders DELETE] Error:", err);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
