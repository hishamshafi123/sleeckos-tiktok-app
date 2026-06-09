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
      lyricalTemplateId,
      targetDuration = 15.0,
      muteAudio = false,
      accountIds,
      videosPerAccount = 1,
    } = body;

    if (!folderId || !trackId || !lyricalTemplateId) {
      return NextResponse.json({ error: "Missing folderId, trackId, or lyricalTemplateId" }, { status: 400 });
    }

    if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
      return NextResponse.json({ error: "Please select at least one account" }, { status: 400 });
    }

    if (videosPerAccount <= 0) {
      return NextResponse.json({ error: "Videos per account must be at least 1" }, { status: 400 });
    }

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

    const template = await prisma.trackLyricalTemplate.findUnique({
      where: { id: lyricalTemplateId },
    });

    if (!template) {
      return NextResponse.json({ error: "Lyrical template not found" }, { status: 404 });
    }

    // Validate pre-rendered template overlay exists
    let overlayUrl = template.overlayVideoUrl;
    if (!overlayUrl) {
      const sanitizedName = template.templateName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
      overlayUrl = `/uploads/lyrical/overlays/track_${template.trackId}_${sanitizedName}.webm`;
    }
    const overlayPath = path.join(process.cwd(), "public", overlayUrl);
    const readyPath = overlayPath + ".ready";
    if (!fs.existsSync(overlayPath) || !fs.existsSync(readyPath)) {
      return NextResponse.json({
        error: `Cannot start batch: Template "${template.templateName}" is missing its pre-rendered overlay on disk. Please open the template in the Lyrical editor and click "Pre-render Overlay" first.`,
      }, { status: 400 });
    }

    const totalVideos = accountIds.length * videosPerAccount;

    // Create batch in RENDERING status
    const batch = await prisma.clipMixerBatch.create({
      data: {
        folderId,
        trackId,
        lyricalTemplateId,
        targetDuration: parseFloat(targetDuration) || 15.0,
        totalVideos,
        muteAudio,
        status: "RENDERING",
      },
    });

    // Populate batch items
    for (const accountId of accountIds) {
      for (let i = 0; i < videosPerAccount; i++) {
        await prisma.clipMixerItem.create({
          data: {
            batchId: batch.id,
            accountId,
            status: "PENDING",
          },
        });
      }
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
        lyricalTemplate: true,
        items: {
          include: {
            account: true,
          },
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

      await prisma.clipMixerItem.update({
        where: { id: item.id },
        data: { status: "RENDERING" },
      });

      try {
        const clips = [...batch.folder.clips];
        
        // Target duration computation with random variance (+/- 2 seconds)
        const variance = Math.random() * 4.0 - 2.0;
        let T = batch.targetDuration + variance;
        // Cap target duration at selected song/track duration
        T = Math.min(T, batch.track.duration);
        if (T < 5.0) T = 5.0; // clamp minimum video duration

        const slices: { clipPath: string; start: number; duration: number }[] = [];
        let currentDuration = 0;
        let attempts = 0;

        while (currentDuration < T && attempts < 150) {
          const clip = clips[Math.floor(Math.random() * clips.length)];
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
          attempts++;
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
        let overlayUrl = batch.lyricalTemplate.overlayVideoUrl;
        if (!overlayUrl) {
          const sanitizedName = batch.lyricalTemplate.templateName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
          overlayUrl = `/uploads/lyrical/overlays/track_${batch.lyricalTemplate.trackId}_${sanitizedName}.webm`;
        }
        const overlayPath = path.join(process.cwd(), "public", overlayUrl);
        if (!fs.existsSync(overlayPath)) {
          throw new Error(`Lyrics template overlay not found on disk at: ${overlayPath}`);
        }

        const overlayIdx = slices.length;
        inputs.push(`-c:v libvpx -i "${overlayPath}"`);

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
        for (let i = 0; i < slices.length; i++) {
          filterComplex += `[v${i}]`;
        }
        filterComplex += `concat=n=${slices.length}:v=1:a=0[v_concated];`;

        // Scale lyrics overlay video
        filterComplex += `[${overlayIdx}:v]scale=720:1280[overlay_scaled];`;

        // Composite lyrics overlay onto clips chain
        filterComplex += `[v_concated][overlay_scaled]overlay=0:0:format=auto[v_final]`;

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

        console.log(`[Clip Mixer Worker] Rendering Item ${item.id} with FFmpeg: ${cmd.substring(0, 600)}...`);

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

        await prisma.clipMixerItem.update({
          where: { id: item.id },
          data: {
            status: "RENDERED",
            renderedVideoUrl: `/uploads/clip-mixer-renders/render_${item.id}.mp4`,
          },
        });
        console.log(`[Clip Mixer Worker] Finished rendering item ${item.id}`);

      } catch (itemErr: any) {
        console.error(`[Clip Mixer Worker] Item ${item.id} processing error:`, itemErr);
        await prisma.clipMixerItem.update({
          where: { id: item.id },
          data: {
            status: "FAILED",
            errorMessage: itemErr.message || String(itemErr),
          },
        });
      }
    }

    // Determine final status of batch
    const remainingItems = await prisma.clipMixerItem.findMany({
      where: { batchId },
    });
    const failedCount = remainingItems.filter((i) => i.status === "FAILED").length;
    const completedCount = remainingItems.filter((i) => i.status === "RENDERED" || i.status === "UPLOADED").length;

    let finalStatus: "COMPLETED" | "FAILED" = "COMPLETED";
    if (failedCount > 0 && completedCount === 0) {
      finalStatus = "FAILED";
    }

    await prisma.clipMixerBatch.update({
      where: { id: batchId },
      data: { status: finalStatus },
    });
    console.log(`[Clip Mixer Worker] Finished batch ${batchId}. Status: ${finalStatus}`);

  } catch (err: any) {
    console.error(`[Clip Mixer Worker] Critical batch failure ${batchId}:`, err);
    await prisma.clipMixerBatch.update({
      where: { id: batchId },
      data: { status: "FAILED" },
    });
  }
}
