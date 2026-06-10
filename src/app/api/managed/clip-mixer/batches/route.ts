export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import fs from "fs";
import path from "path";

// GET /api/managed/clip-mixer/batches — Get batch history or detailed status of a specific batch
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const batchId = searchParams.get("batchId");

  try {
    if (batchId) {
      const batch = await prisma.clipMixerBatch.findUnique({
        where: { id: batchId },
        include: {
          folder: {
            select: { name: true },
          },
          track: {
            select: { title: true, artist: true },
          },
          lyricalTemplate: {
            select: { templateName: true },
          },
          items: {
            include: {
              account: {
                select: {
                  tiktokUsername: true,
                  tiktokDisplayName: true,
                  tiktokAvatarUrl: true,
                },
              },
              lyricalTemplate: {
                select: { templateName: true },
              },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!batch) {
        return NextResponse.json({ error: "Batch not found" }, { status: 404 });
      }

      return NextResponse.json(batch);
    }

    const batches = await prisma.clipMixerBatch.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        folder: {
          select: { name: true },
        },
        track: {
          select: { title: true },
        },
        _count: {
          select: { items: true },
        },
      },
    });

    return NextResponse.json(batches);
  } catch (err) {
    console.error("[Clip Mixer Batches GET] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST /api/managed/clip-mixer/batches — Create batch and kick off rendering
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      folderId,
      trackId,
      lyricalTemplateIds, // array of template IDs
      targetDuration = 15.0,
      muteAudio = false,
      accountCount = 5,
      videosPerAccount = 3,
    } = body;

    if (!folderId || !trackId || !lyricalTemplateIds || !Array.isArray(lyricalTemplateIds) || lyricalTemplateIds.length === 0) {
      return NextResponse.json({ error: "Missing folderId, trackId, or lyricalTemplateIds list" }, { status: 400 });
    }

    const numAccounts = Math.max(1, parseInt(accountCount) || 1);
    const vidsPerAccount = Math.max(1, parseInt(videosPerAccount) || 1);

    const folder = await prisma.clipFolder.findUnique({
      where: { id: folderId },
      include: { clips: true },
    });

    if (!folder) {
      return NextResponse.json({ error: "Clip folder not found" }, { status: 404 });
    }

    if (folder.clips.length === 0) {
      return NextResponse.json({ error: "No clips found in the selected folder. Please upload clips first!" }, { status: 400 });
    }

    const track = await prisma.track.findUnique({
      where: { id: trackId },
    });

    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }

    // Fetch active accounts in this section
    const sectionAccounts = await prisma.managedAccount.findMany({
      where: {
        isActive: true,
        group: {
          sectionId: folder.sectionId,
        },
      },
      orderBy: { tiktokUsername: "asc" },
    });

    if (sectionAccounts.length === 0) {
      // Fallback: fetch any active account in database
      const fallbackAccount = await prisma.managedAccount.findFirst({
        where: { isActive: true },
      });
      if (!fallbackAccount) {
        return NextResponse.json({ error: "No active managed accounts found in the system." }, { status: 400 });
      }
      sectionAccounts.push(fallbackAccount);
    }

    // Pre-rendered overlays will be generated automatically in the background by the sequential worker if missing.
    console.log(`[Clip Mixer Batches POST] Queueing batch: missing overlays will be auto-rendered in the background`);

    const totalVideos = numAccounts * vidsPerAccount;

    // Create batch in RENDERING status
    const batch = await prisma.clipMixerBatch.create({
      data: {
        folderId,
        trackId,
        lyricalTemplateId: lyricalTemplateIds[0], // primary template to satisfy DB constraint
        targetDuration: parseFloat(targetDuration) || 15.0,
        totalVideos,
        muteAudio,
        status: "RENDERING",
      },
    });

    // Populate batch items by cycling through sections, accounts, and templates
    let templateCounter = 0;
    for (let i = 0; i < totalVideos; i++) {
      const virtualAccIdx = Math.floor(i / vidsPerAccount);
      const account = sectionAccounts[virtualAccIdx % sectionAccounts.length];
      const itemTemplateId = lyricalTemplateIds[templateCounter % lyricalTemplateIds.length];
      templateCounter++;

      await prisma.clipMixerItem.create({
        data: {
          batchId: batch.id,
          accountId: account.id,
          lyricalTemplateId: itemTemplateId,
          status: "PENDING",
        },
      });
    }

    // Kick off rendering in the background
    processClipMixerBatch(batch.id).catch((err) => {
      console.error(`[Clip Mixer Queue] Background render runner error for batch ${batch.id}:`, err);
    });

    return NextResponse.json({
      success: true,
      batchId: batch.id,
      message: "Clip Mixer batch generation started in the background",
    });
  } catch (err) {
    console.error("[Clip Mixer Batches POST] Error:", err);
    return NextResponse.json({ error: "Failed to create batch" }, { status: 500 });
  }
}

// DELETE /api/managed/clip-mixer/batches — Delete a batch, its items, and rendered files
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const batchId = searchParams.get("batchId");

  if (!batchId) {
    return NextResponse.json({ error: "Missing batchId" }, { status: 400 });
  }

  try {
    const batch = await prisma.clipMixerBatch.findUnique({
      where: { id: batchId },
      include: { items: true },
    });

    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    // Delete rendered files from disk
    for (const item of batch.items) {
      if (item.renderedVideoUrl) {
        try {
          const filePath = path.join(process.cwd(), "public", item.renderedVideoUrl);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch (fsErr) {
          console.warn("[Clip Mixer Batches DELETE] File delete warning:", fsErr);
        }
      }
    }

    await prisma.clipMixerBatch.delete({
      where: { id: batchId },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Clip Mixer Batches DELETE] Error:", err);
    return NextResponse.json({ error: "Failed to delete batch" }, { status: 500 });
  }
}

// PUT /api/managed/clip-mixer/batches — Re-render specific items or the entire batch
export async function PUT(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { batchId, itemIds } = body;

    if (!batchId || !Array.isArray(itemIds) || itemIds.length === 0) {
      return NextResponse.json({ error: "Missing batchId or itemIds list" }, { status: 400 });
    }

    const batch = await prisma.clipMixerBatch.findUnique({
      where: { id: batchId },
      include: { items: true },
    });

    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    // Delete rendered files from disk
    const itemsToReset = batch.items.filter(item => itemIds.includes(item.id));
    for (const item of itemsToReset) {
      if (item.renderedVideoUrl) {
        try {
          const filePath = path.join(process.cwd(), "public", item.renderedVideoUrl);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch (fsErr) {
          console.warn("[Clip Mixer Batches PUT] File delete warning:", fsErr);
        }
      }
    }

    // Reset status to PENDING
    await prisma.clipMixerItem.updateMany({
      where: {
        id: { in: itemIds },
        batchId,
      },
      data: {
        status: "PENDING",
        errorMessage: null,
      },
    });

    // Reset batch status to RENDERING
    await prisma.clipMixerBatch.update({
      where: { id: batchId },
      data: { status: "RENDERING" },
    });

    // Kick off rendering in the background
    processClipMixerBatch(batchId).catch((err) => {
      console.error(`[Clip Mixer Queue] Background re-render runner error for batch ${batchId}:`, err);
    });

    return NextResponse.json({
      success: true,
      message: "Selected items queued for re-rendering",
    });
  } catch (err) {
    console.error("[Clip Mixer Batches PUT] Error:", err);
    return NextResponse.json({ error: "Failed to queue items for re-rendering" }, { status: 500 });
  }
}

// Sequential batch processing worker logic
async function processClipMixerBatch(batchId: string) {
  console.log(`[Clip Mixer Worker] Sequential queue starting for batch: ${batchId}`);
  try {
    const batch = await prisma.clipMixerBatch.findUnique({
      where: { id: batchId },
      include: {
        folder: {
          include: { clips: true },
        },
        track: true,
        items: {
          include: {
            account: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!batch) return;

    if (batch.folder.clips.length === 0) {
      throw new Error("No clips found in the selected folder.");
    }

    // Process each item sequentially
    for (const item of batch.items) {
      if (item.status === "RENDERED" || item.status === "UPLOADED") continue;

      // Check if batch was cancelled/marked FAILED
      const freshBatch = await prisma.clipMixerBatch.findUnique({
        where: { id: batchId },
      });
      if (!freshBatch || freshBatch.status === "FAILED") {
        console.log(`[Clip Mixer Worker] Batch ${batchId} is marked as FAILED. Aborting.`);
        break;
      }

      try {
        await prisma.clipMixerItem.update({
          where: { id: item.id },
          data: { status: "RENDERING" },
        });
      } catch (err: any) {
        if (err?.code === "P2025") {
          console.log(`[Clip Mixer Worker] Item ${item.id} not found (likely batch was deleted). Aborting loop.`);
          break;
        }
        throw err;
      }

      try {
        // Fetch specific layout template for this item
        const itemTemplateId = item.lyricalTemplateId || batch.lyricalTemplateId;
        const template = await prisma.trackLyricalTemplate.findUnique({
          where: { id: itemTemplateId },
        });

        if (!template) {
          throw new Error(`Lyrics template styling preset not found for queue item ${item.id}`);
        }

        const clips = [...batch.folder.clips];
        
        // Target duration computation with random variance (+/- 2 seconds)
        const variance = Math.random() * 4.0 - 2.0;
        let T = batch.targetDuration + variance;
        // Cap target duration at selected song/track duration
        T = Math.min(T, batch.track.duration);
        if (T < 5.0) T = 5.0; // clamp minimum video duration

        const slices: { clipPath: string; start: number; duration: number }[] = [];
        let currentDuration = 0;

        // Shuffle the clips array to ensure randomized picking order
        const shuffledClips = [...clips].sort(() => Math.random() - 0.5);

        for (const clip of shuffledClips) {
          if (currentDuration >= T) {
            break;
          }

          const remaining = T - currentDuration;

          let sliceDuration = Math.random() * 2.0 + 3.0; // random chunk duration between 3.0s and 5.0s
          if (sliceDuration > clip.duration) {
            sliceDuration = clip.duration;
          }
          if (sliceDuration > remaining) {
            sliceDuration = remaining;
          }

          if (remaining <= 5.0) {
            if (clip.duration >= remaining) {
              sliceDuration = remaining;
            } else {
              sliceDuration = clip.duration;
            }
          }

          const maxStart = Math.max(0, clip.duration - sliceDuration);
          const start = Math.random() * maxStart;

          slices.push({
            clipPath: path.join(process.cwd(), "public", clip.videoUrl),
            start,
            duration: sliceDuration,
          });

          currentDuration += sliceDuration;
        }

        if (slices.length === 0) {
          throw new Error("Could not construct random clip slices for composition.");
        }

        const rendersDir = path.join(process.cwd(), "public", "uploads", "clip-mixer-renders");
        if (!fs.existsSync(rendersDir)) {
          fs.mkdirSync(rendersDir, { recursive: true });
        }
        const localOutFile = path.join(rendersDir, `render_${item.id}.mp4`);

        const inputs: string[] = [];
        for (const slice of slices) {
          inputs.push(`-ss ${slice.start.toFixed(3)} -t ${slice.duration.toFixed(3)} -i "${slice.clipPath}"`);
        }

        // Overlay template VP8 WebM with alpha
        let overlayUrl = template.overlayVideoUrl;
        if (!overlayUrl) {
          const sanitizedName = template.templateName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
          overlayUrl = `/uploads/lyrical/overlays/track_${template.trackId}_${sanitizedName}.webm`;
        }
        const overlayPath = path.join(process.cwd(), "public", overlayUrl);
        const overlayReady = fs.existsSync(overlayPath + ".ready");
        const overlayExists = fs.existsSync(overlayPath);
        let overlaySize = 0;
        if (overlayExists) {
          try { overlaySize = fs.statSync(overlayPath).size; } catch {}
        }
        let hasPreRenderedOverlay = overlayExists && overlayReady && overlaySize > 1024;
        if (!hasPreRenderedOverlay) {
          console.log(`[Clip Mixer Worker] Pre-rendered overlay missing or invalid for template "${template.templateName}". Auto-rendering it now...`);
          try {
            if (!batch.track.lyricalTranscription) {
              throw new Error(`Track "${batch.track.title}" has no Whisper alignment data.`);
            }
            const words = JSON.parse(batch.track.lyricalTranscription);
            const duration = batch.track.duration || 10.0;
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
              textAlign: template.textAlign,
              wordSpacing: template.wordSpacing,
              letterSpacing: template.letterSpacing,
            };
            const { renderCanvasOverlay } = await import("@/lib/ffmpeg-overlay-renderer");
            await renderCanvasOverlay(words, rendererConfig, duration, overlayPath);
            console.log(`[Clip Mixer Worker] Auto-rendered template overlay successfully for template "${template.templateName}"`);
          } catch (autoErr: any) {
            console.error(`[Clip Mixer Worker] Failed to auto-render overlay for template "${template.templateName}":`, autoErr);
            throw new Error(`Lyrics template overlay "${template.templateName}" could not be auto-rendered: ${autoErr.message || autoErr}`);
          }
        }

        const overlayIdx = slices.length;
        inputs.push(`-i "${overlayPath}"`);

        // Audio source mapping
        const audioIdx = overlayIdx + 1;
        const audioPath = path.join(process.cwd(), "public", batch.track.fileUrl);

        if (batch.muteAudio) {
          inputs.push(`-f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100`);
        } else {
          if (!fs.existsSync(audioPath)) {
            throw new Error(`Audio track file not found on disk at: ${audioPath}`);
          }
          inputs.push(`-i "${audioPath}"`);
        }

        // Build scaling/cropping & concat filter complex
        let filterComplex = "";
        for (let i = 0; i < slices.length; i++) {
          // Normalizes clips: force vertical aspect, 720x1280, 30fps, sar=1, color space yuv420p
          filterComplex += `[${i}:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=30,format=yuv420p[v${i}];`;
        }

        let lastVideoLabel = "";
        if (slices.length > 1) {
          for (let i = 0; i < slices.length; i++) {
            filterComplex += `[v${i}]`;
          }
          filterComplex += `concat=n=${slices.length}:v=1:a=0[v_concated];`;
          lastVideoLabel = "v_concated";
        } else {
          lastVideoLabel = "v0";
        }

        // Composite lyrics overlay onto clips chain
        // format=auto is CRITICAL: it preserves the yuva420p alpha channel from the WebM overlay.
        // Without it, FFmpeg defaults to yuv420p which strips alpha, making the transparent
        // background render as solid black and hiding the video behind the lyrics.
        filterComplex += `[${lastVideoLabel}][${overlayIdx}:v]overlay=0:0:shortest=1:format=auto[v_final]`;

        const cmd = [
          `ffmpeg -y`,
          ...inputs,
          `-filter_complex "${filterComplex}"`,
          `-map "[v_final]"`,
          `-map ${audioIdx}:a`,
          `-c:v libx264`,
          `-pix_fmt yuv420p`,
          `-preset superfast`,
          `-c:a aac -b:a 192k`,
          `-t ${currentDuration.toFixed(3)}`, // trim to the final duration
          `"${localOutFile}"`,
        ].join(" ");

        console.log(`[Clip Mixer Worker] Rendering Item ${item.id} (template: ${template.templateName}) with FFmpeg: ${cmd.substring(0, 600)}...`);

        await new Promise<void>((resolve, reject) => {
          const { exec: execCmd } = require("child_process");
          execCmd(cmd, { timeout: 300000 }, (error: any, _stdout: any, stderr: any) => {
            if (error) {
              console.error(`[Clip Mixer Worker] FFmpeg failed for item ${item.id}:`, stderr?.substring(0, 1000));
              reject(new Error(`FFmpeg processing failed: ${error.message}`));
            } else {
              resolve();
            }
          });
        });

        try {
          await prisma.clipMixerItem.update({
            where: { id: item.id },
            data: {
              status: "RENDERED",
              renderedVideoUrl: `/uploads/clip-mixer-renders/render_${item.id}.mp4`,
            },
          });
        } catch (err: any) {
          if (err?.code === "P2025") {
            console.log(`[Clip Mixer Worker] Item ${item.id} not found (likely batch was deleted) when finishing rendering. Aborting loop.`);
            break;
          }
          throw err;
        }
        console.log(`[Clip Mixer Worker] Finished rendering item ${item.id}`);

      } catch (itemErr: any) {
        if (itemErr?.code === "P2025") {
          console.log(`[Clip Mixer Worker] Item ${item.id} not found (likely batch was deleted) during error handling. Aborting loop.`);
          break;
        }
        console.error(`[Clip Mixer Worker] Item ${item.id} processing error:`, itemErr);
        try {
          await prisma.clipMixerItem.update({
            where: { id: item.id },
            data: {
              status: "FAILED",
              errorMessage: itemErr.message || String(itemErr),
            },
          });
        } catch (updateErr: any) {
          if (updateErr?.code === "P2025") {
            console.log(`[Clip Mixer Worker] Item ${item.id} not found (likely batch was deleted) when marking FAILED. Aborting loop.`);
            break;
          }
          console.error(`[Clip Mixer Worker] Failed to update item status to FAILED:`, updateErr);
        }
      }
    }

    // Determine final status of batch
    let remainingItems;
    try {
      remainingItems = await prisma.clipMixerItem.findMany({
        where: { batchId },
      });
    } catch (err: any) {
      if (err?.code === "P2025") {
        console.log(`[Clip Mixer Worker] Items not found for batch ${batchId}. Aborting.`);
        return;
      }
      throw err;
    }
    const failedCount = remainingItems.filter((i) => i.status === "FAILED").length;
    const completedCount = remainingItems.filter((i) => i.status === "RENDERED" || i.status === "UPLOADED").length;

    let finalStatus: "COMPLETED" | "FAILED" = "COMPLETED";
    if (failedCount > 0 && completedCount === 0) {
      finalStatus = "FAILED";
    }

    try {
      await prisma.clipMixerBatch.update({
        where: { id: batchId },
        data: { status: finalStatus },
      });
    } catch (err: any) {
      if (err?.code === "P2025") {
        console.log(`[Clip Mixer Worker] Batch ${batchId} not found (likely deleted) when updating final status.`);
        return;
      }
      throw err;
    }
    console.log(`[Clip Mixer Worker] Finished batch ${batchId}. Status: ${finalStatus}`);

  } catch (err: any) {
    if (err?.code === "P2025") {
      console.log(`[Clip Mixer Worker] Batch ${batchId} not found (likely deleted) during worker execution.`);
      return;
    }
    console.error(`[Clip Mixer Worker] Critical batch failure ${batchId}:`, err);
    try {
      await prisma.clipMixerBatch.update({
        where: { id: batchId },
        data: { status: "FAILED" },
      });
    } catch (updateErr: any) {
      if (updateErr?.code === "P2025") {
        console.log(`[Clip Mixer Worker] Batch ${batchId} not found when trying to mark FAILED.`);
        return;
      }
      console.error(`[Clip Mixer Worker] Failed to mark batch ${batchId} as FAILED:`, updateErr);
    }
  }
}
