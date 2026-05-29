export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import fs from "fs";
import path from "path";
import { exec } from "child_process";

// 1. POST /api/managed/genres/tracks/lyrical — Designate track as Lyrical and run Whisper alignment
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { trackId, model = "base", device = "cpu" } = body;

    if (!trackId) {
      return NextResponse.json({ error: "Missing trackId" }, { status: 400 });
    }

    const track = await prisma.track.findUnique({
      where: { id: trackId },
    });

    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }

    const trackFilePath = path.join(process.cwd(), "public", track.fileUrl);
    if (!fs.existsSync(trackFilePath)) {
      return NextResponse.json({ error: `Audio file not found on system at: ${track.fileUrl}` }, { status: 404 });
    }

    // Create folders for pre-rendering uploads
    const overlayDir = path.join(process.cwd(), "public", "uploads", "lyrical", "overlays");
    const previewDir = path.join(process.cwd(), "public", "uploads", "lyrical", "previews");
    fs.mkdirSync(overlayDir, { recursive: true });
    fs.mkdirSync(previewDir, { recursive: true });

    const tempJsonPath = path.join(osTempDir(), `transcription_${trackId}.json`);
    const tempPngPath = path.join(previewDir, `preview_init_${trackId}.png`);

    // Propose python run to align track
    const cmd = [
      `./venv/bin/python3 "scripts/lyrical_composer.py"`,
      `-i "${trackFilePath}"`,
      `-o "/dev/null"`, // we don't need a video output for basic alignment
      `--save-json "${tempJsonPath}"`,
      `--preview-frame "${tempPngPath}"`,
      `--model "${model}"`,
      `--device "${device}"`,
    ].join(" ");

    console.log(`[Lyrical API] Spawning transcription process: ${cmd}`);

    return new Promise<NextResponse>((resolve) => {
      exec(cmd, { 
        maxBuffer: 1024 * 1024 * 50, 
        timeout: 300000,
        env: { ...process.env, HF_HOME: process.env.HF_HOME || "/home/nextjs/.cache/huggingface" }
      }, async (error, stdout, stderr) => {
        // Cleanup temp initial preview immediately
        if (fs.existsSync(tempPngPath)) {
          try { fs.unlinkSync(tempPngPath); } catch {}
        }

        if (error) {
          console.error("[Lyrical API] Whisper execution failure:", stderr);
          return resolve(
            NextResponse.json({ error: `Whisper alignment failed: ${error.message}. Stderr: ${stderr}` }, { status: 500 })
          );
        }

        if (!fs.existsSync(tempJsonPath)) {
          return resolve(
            NextResponse.json({ error: "Whisper completed but transcription JSON metadata file was not created." }, { status: 500 })
          );
        }

        try {
          const jsonContent = fs.readFileSync(tempJsonPath, "utf-8");
          const wordList = JSON.parse(jsonContent);
          
          // Cleanup JSON file
          fs.unlinkSync(tempJsonPath);

          // Update Track record
          const updatedTrack = await prisma.track.update({
            where: { id: trackId },
            data: {
              isLyrical: true,
              lyricalTranscription: JSON.stringify(wordList),
            },
          });

          console.log(`[Lyrical API] Successfully aligned Lyrical Track: ${trackId}`);
          return resolve(NextResponse.json(updatedTrack));
        } catch (dbErr: any) {
          console.error("[Lyrical API] Database save error:", dbErr);
          return resolve(NextResponse.json({ error: `Failed to save aligned metadata: ${dbErr.message}` }, { status: 500 }));
        }
      });
    });

  } catch (err: any) {
    console.error("[Lyrical API] Error:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}

// 2. PATCH /api/managed/genres/tracks/lyrical — Save/Update a Lyrical Caption Template
// NOTE: No longer pre-renders overlay MOV via Python (caused OOM on VPS).
// The batch renderer uses FFmpeg ASS subtitle fallback when overlay MOV is missing.
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      trackId,
      templateName,
      fontFamily = "Montserrat-Black",
      fontSize = 48,
      activeColor = "multi",
      strokeWidth = 5,
      strokeColor = "#000000",
      positionY = 0.75,
    } = body;

    if (!trackId || !templateName) {
      return NextResponse.json({ error: "Missing trackId or templateName" }, { status: 400 });
    }

    const track = await prisma.track.findUnique({
      where: { id: trackId },
    });

    if (!track || !track.isLyrical || !track.lyricalTranscription) {
      return NextResponse.json({ error: "Track is not designated as a lyrical aligned track. Run POST alignment first." }, { status: 400 });
    }

    // Build expected paths (overlay MOV is optional — batch renderer uses ASS fallback if missing)
    const sanitizedTemplate = templateName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
    const overlayRelativePath = `/uploads/lyrical/overlays/track_${trackId}_${sanitizedTemplate}.mov`;
    const previewRelativePath = `/uploads/lyrical/previews/track_${trackId}_${sanitizedTemplate}.png`;

    // Check if overlay MOV already exists (may have been pre-rendered locally on a Mac)
    const overlayAbsolutePath = path.join(process.cwd(), "public", ...overlayRelativePath.split("/"));
    const hasExistingOverlay = fs.existsSync(overlayAbsolutePath);

    // Upsert Template record — save styling config without running Python
    const template = await prisma.trackLyricalTemplate.upsert({
      where: {
        trackId_templateName: {
          trackId,
          templateName,
        },
      },
      update: {
        fontFamily,
        fontSize,
        activeColor,
        strokeWidth,
        strokeColor,
        positionY,
        // Only set overlayVideoUrl if the file actually exists
        ...(hasExistingOverlay ? { overlayVideoUrl: overlayRelativePath } : {}),
        previewImageUrl: previewRelativePath,
      },
      create: {
        trackId,
        templateName,
        fontFamily,
        fontSize,
        activeColor,
        strokeWidth,
        strokeColor,
        positionY,
        // Only set overlayVideoUrl if the file actually exists
        ...(hasExistingOverlay ? { overlayVideoUrl: overlayRelativePath } : {}),
        previewImageUrl: previewRelativePath,
      },
    });

    console.log(`[Lyrical API] Template '${templateName}' saved for track: ${trackId} (overlay MOV: ${hasExistingOverlay ? "exists" : "will use ASS fallback at render time"})`);
    return NextResponse.json(template);

  } catch (err: any) {
    console.error("[Lyrical API] Error saving template:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}

// 3. GET /api/managed/genres/tracks/lyrical — Fetch all templates and alignments attached to a track
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const trackId = searchParams.get("trackId");

  if (!trackId) {
    return NextResponse.json({ error: "Missing trackId" }, { status: 400 });
  }

  try {
    const templates = await prisma.trackLyricalTemplate.findMany({
      where: { trackId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(templates);
  } catch (err: any) {
    console.error("[Lyrical API] Error fetching templates:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// 4. DELETE /api/managed/genres/tracks/lyrical — Delete template configuration and pre-rendered overlay/preview assets
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const templateId = searchParams.get("templateId");

    if (!templateId) {
      return NextResponse.json({ error: "Missing templateId" }, { status: 400 });
    }

    // Find template to retrieve asset filepaths for deletion
    const template = await prisma.trackLyricalTemplate.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    // Safely delete pre-rendered MOV overlay video if exists
    if (template.overlayVideoUrl) {
      const videoPath = path.join(process.cwd(), "public", ...template.overlayVideoUrl.split("/"));
      if (fs.existsSync(videoPath)) {
        try {
          fs.unlinkSync(videoPath);
          console.log(`[Lyrical API] Successfully unlinked video: ${videoPath}`);
        } catch (e) {
          console.warn(`[Lyrical API] Failed to unlink video at ${videoPath}:`, e);
        }
      }
    }

    // Safely delete pre-rendered PNG preview frame if exists
    if (template.previewImageUrl) {
      const previewPath = path.join(process.cwd(), "public", ...template.previewImageUrl.split("/"));
      if (fs.existsSync(previewPath)) {
        try {
          fs.unlinkSync(previewPath);
          console.log(`[Lyrical API] Successfully unlinked preview frame: ${previewPath}`);
        } catch (e) {
          console.warn(`[Lyrical API] Failed to unlink preview frame at ${previewPath}:`, e);
        }
      }
    }

    // Delete template database record
    await prisma.trackLyricalTemplate.delete({
      where: { id: templateId },
    });

    console.log(`[Lyrical API] Deleted template record: ${templateId} (${template.templateName})`);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[Lyrical API] Error deleting template:", err);
    return NextResponse.json({ error: err.message || "Failed to delete styling template" }, { status: 500 });
  }
}

// Helper to resolve OS temporary directories
function osTempDir(): string {
  try {
    const os = require("os");
    return os.tmpdir();
  } catch {
    return "/tmp";
  }
}
