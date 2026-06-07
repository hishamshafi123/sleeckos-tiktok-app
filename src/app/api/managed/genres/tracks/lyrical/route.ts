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
// Saves template config AND pre-renders a transparent Canvas overlay (WebM VP8 with alpha)
// that matches the Live Studio Preview exactly. The batch renderer composites this overlay.
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
      colorFilter = "none",
      vignette = "none",
      particleFx = "none",
      mirrorBg = false,
      bgSpeed = 1.0,
      animationMode = "highlight",
      bgColor = null,
      textColor = null,
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

    // Build paths
    const sanitizedTemplate = templateName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
    const overlayRelativePath = `/uploads/lyrical/overlays/track_${trackId}_${sanitizedTemplate}.webm`;
    const previewRelativePath = `/uploads/lyrical/previews/track_${trackId}_${sanitizedTemplate}.png`;

    // All template data (caption styling + visual effects)
    const templateData = {
      fontFamily,
      fontSize,
      activeColor,
      strokeWidth,
      strokeColor,
      positionY,
      colorFilter,
      vignette,
      particleFx,
      mirrorBg,
      bgSpeed,
      animationMode,
      bgColor,
      textColor,
      overlayVideoUrl: overlayRelativePath,
      previewImageUrl: previewRelativePath,
    };

    // Upsert Template record — save styling config + visual effects
    const template = await prisma.trackLyricalTemplate.upsert({
      where: {
        trackId_templateName: {
          trackId,
          templateName,
        },
      },
      update: templateData,
      create: {
        trackId,
        templateName,
        ...templateData,
      },
    });

    console.log(`[Lyrical API] Template '${templateName}' saved for track: ${trackId} (effects: filter=${colorFilter}, vignette=${vignette}, particles=${particleFx})`);

    // ── Pre-render Canvas overlay in background ──
    // Don't block the response — render asynchronously
    const overlayAbsolutePath = path.join(process.cwd(), "public", ...overlayRelativePath.split("/").filter(Boolean));
    const previewAbsolutePath = path.join(process.cwd(), "public", ...previewRelativePath.split("/").filter(Boolean));
    const words: { word: string; start: number; end: number }[] = JSON.parse(track.lyricalTranscription);
    const duration = track.duration || 10.0;

    // Generate static preview frame (launches headless browser, takes ~2s)
    const rendererConfig = { fontFamily, fontSize, activeColor, strokeWidth, strokeColor, positionY, colorFilter, vignette, particleFx, animationMode: animationMode as "highlight" | "word_builder", bgColor, textColor };
    try {
      const { renderPreviewFrame } = await import("@/lib/canvas-overlay-renderer");
      await renderPreviewFrame(
        words,
        rendererConfig,
        previewAbsolutePath,
      );
      console.log(`[Lyrical API] Preview frame generated: ${previewRelativePath}`);
    } catch (previewErr) {
      console.error(`[Lyrical API] Preview frame generation failed:`, previewErr);
    }

    // Fire and forget — render WebM overlay asynchronously (slow — hundreds of frames)
    (async () => {
      try {
        const { renderCanvasOverlay } = await import("@/lib/canvas-overlay-renderer");
        console.log(`[Lyrical API] Starting Canvas overlay pre-render for '${templateName}'...`);
        await renderCanvasOverlay(
          words,
          rendererConfig,
          duration,
          overlayAbsolutePath,
        );
        console.log(`[Lyrical API] Canvas overlay pre-render complete: ${overlayRelativePath}`);
      } catch (err) {
        console.error(`[Lyrical API] Canvas overlay pre-render failed for '${templateName}':`, err);
      }
    })();

    return NextResponse.json(template);

  } catch (err: any) {
    console.error("[Lyrical API] Error saving template:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}

// 2.5. PUT /api/managed/genres/tracks/lyrical — Re-render overlay for an existing template
export async function PUT(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { templateId } = body;

    if (!templateId) {
      return NextResponse.json({ error: "Missing templateId" }, { status: 400 });
    }

    const template = await prisma.trackLyricalTemplate.findUnique({
      where: { id: templateId },
      include: { track: true },
    });

    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    if (!template.track.lyricalTranscription) {
      return NextResponse.json({ error: "Track has no Whisper alignment data" }, { status: 400 });
    }

    const words: { word: string; start: number; end: number }[] = JSON.parse(template.track.lyricalTranscription);
    const duration = template.track.duration || 10.0;

    // Resolve overlay path
    let overlayUrl = template.overlayVideoUrl;
    if (!overlayUrl) {
      const sanitizedName = template.templateName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
      overlayUrl = `/uploads/lyrical/overlays/track_${template.trackId}_${sanitizedName}.webm`;
      // Save the resolved path to DB
      await prisma.trackLyricalTemplate.update({
        where: { id: templateId },
        data: { overlayVideoUrl: overlayUrl },
      });
    }

    const overlayAbsolutePath = path.join(process.cwd(), "public", ...overlayUrl.split("/").filter(Boolean));

    // Ensure directory exists
    const outDir = path.dirname(overlayAbsolutePath);
    fs.mkdirSync(outDir, { recursive: true });

    const rendererConfig = {
      fontFamily: template.fontFamily,
      fontSize: template.fontSize,
      activeColor: template.activeColor,
      strokeWidth: template.strokeWidth,
      strokeColor: template.strokeColor,
      positionY: template.positionY,
      colorFilter: template.colorFilter,
      vignette: template.vignette,
      particleFx: template.particleFx,
      animationMode: template.animationMode as "highlight" | "word_builder",
      bgColor: template.bgColor,
      textColor: template.textColor,
    };

    console.log(`[Lyrical API] Re-rendering overlay for template '${template.templateName}' (${templateId})...`);

    // Fire and forget — rendering is slow (30-60s+), we can't block the HTTP response
    (async () => {
      try {
        const { renderCanvasOverlay } = await import("@/lib/canvas-overlay-renderer");
        await renderCanvasOverlay(words, rendererConfig, duration, overlayAbsolutePath);
        console.log(`[Lyrical API] ✅ Re-render COMPLETE for '${template.templateName}': ${overlayUrl}`);
      } catch (err) {
        console.error(`[Lyrical API] ❌ Re-render FAILED for '${template.templateName}':`, err);
      }
    })();

    return NextResponse.json({ 
      success: true, 
      message: `Overlay rendering started for "${template.templateName}". Check Docker logs for progress (30-60s).`,
      overlayUrl,
    });
  } catch (err: any) {
    console.error("[Lyrical API] Error re-rendering overlay:", err);
    return NextResponse.json({ error: err.message || "Overlay re-render failed" }, { status: 500 });
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
