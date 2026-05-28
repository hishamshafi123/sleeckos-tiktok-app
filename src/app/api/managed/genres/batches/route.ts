export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import fs from "fs";
import path from "path";
import { generateQuotesForTheme, allocateTracks } from "@/lib/composer";

// GET /api/managed/genres/batches — Get batch history or fetch progress details of a single batch
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const batchId = searchParams.get("batchId");

  try {
    if (batchId) {
      // Get detailed status of a specific batch
      const batch = await prisma.genreBatch.findUnique({
        where: { id: batchId },
        include: {
          items: {
            include: {
              account: {
                select: {
                  tiktokUsername: true,
                  tiktokDisplayName: true,
                  tiktokAvatarUrl: true,
                },
              },
              track: {
                select: {
                  title: true,
                  artist: true,
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

    // List all batches
    const batches = await prisma.genreBatch.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: { items: true },
        },
      },
    });

    return NextResponse.json(batches);
  } catch (err) {
    console.error("[Batches API] Error fetching batches:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST /api/managed/genres/batches — Create batch, generate quotes, or start composition rendering
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { action } = body;

    // ─────────────────────────────────────────────────────────────────────────
    // ACTION 0.5: CREATE_LYRICAL_BATCH
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "CREATE_LYRICAL_BATCH") {
      const { accountIds, postsPerAccount, trackId, lyricalTemplateId, mixupVisuals } = body;

      if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
        return NextResponse.json({ error: "Please select at least one TikTok account" }, { status: 400 });
      }
      if (!postsPerAccount || postsPerAccount <= 0) {
        return NextResponse.json({ error: "Please specify number of posts per account" }, { status: 400 });
      }
      if (!trackId || !lyricalTemplateId) {
        return NextResponse.json({ error: "Please select a Lyrical track and styling template" }, { status: 400 });
      }

      const track = await prisma.track.findUnique({
        where: { id: trackId },
      });

      if (!track) {
        return NextResponse.json({ error: "Lyrical track not found" }, { status: 404 });
      }

      let template = null;
      let templatesPool: any[] = [];

      if (lyricalTemplateId === "mix_all") {
        templatesPool = await prisma.trackLyricalTemplate.findMany({
          where: { trackId },
        });
        if (templatesPool.length === 0) {
          return NextResponse.json({ error: "No pre-rendered caption templates found for this track. Please pre-render at least one template first!" }, { status: 400 });
        }
      } else {
        template = await prisma.trackLyricalTemplate.findUnique({
          where: { id: lyricalTemplateId },
        });
        if (!template) {
          return NextResponse.json({ error: "Caption styling template not found" }, { status: 404 });
        }
      }

      const totalPosts = accountIds.length * postsPerAccount;

      // Create a Lyrical Batch directly in RENDERING status
      const batch = await prisma.genreBatch.create({
        data: {
          genre: "lyrical",
          status: "RENDERING",
          totalPosts,
          postsPerAccount,
          videoLength: track.duration,
        },
      });

      const filterOptions = ["none", "cyberpunk", "cinema", "vhs", "monochrome", "emerald", "polaroid", "midnight"];
      const particleOptions = ["none", "gold_dust.mp4", "bokeh.mp4", "fireflies.mp4", "snow.mp4"];
      const vignetteOptions = ["none", "bottom_fade", "radial_vignette", "sunset_glow", "emerald_fade"];

      let mutationCounter = 0;

      // Populate batch items with pre-rendered template overlays
      for (const accountId of accountIds) {
        const account = await prisma.managedAccount.findUnique({
          where: { id: accountId },
          include: {
            backgroundVideos: true, // vertical loops
          },
        });

        if (!account) continue;

        const bgs = account.backgroundVideos;
        if (bgs.length === 0) {
          console.warn(`[Batches API] Account ${account.tiktokUsername} has no vertical background loops uploaded`);
          continue;
        }

        for (let i = 0; i < postsPerAccount; i++) {
          const randomBg = bgs[i % bgs.length];

          let colorFilter = "none";
          let particleFx = "none";
          let vignette = "none";
          let mirrorBg = false;
          let bgSpeed = 1.0;

          if (mixupVisuals === true) {
            colorFilter = filterOptions[mutationCounter % filterOptions.length];
            particleFx = particleOptions[mutationCounter % particleOptions.length];
            vignette = vignetteOptions[mutationCounter % vignetteOptions.length];
            
            // Transformation mutations
            mirrorBg = mutationCounter % 2 === 1;
            const speedOptions = [0.95, 1.0, 1.05];
            bgSpeed = speedOptions[mutationCounter % speedOptions.length];
          }

          // Cycle through templates sequentially from the pool or use the single selected template
          const currentTemplate = lyricalTemplateId === "mix_all"
            ? templatesPool[mutationCounter % templatesPool.length]
            : template;

          mutationCounter++;

          const serializedMetadata = JSON.stringify({
            title: `Lyrical - ${track.title} (${currentTemplate.templateName})`,
            colorFilter,
            particleFx,
            vignette,
            mirrorBg,
            bgSpeed
          });

          await prisma.genreBatchItem.create({
            data: {
              batchId: batch.id,
              accountId,
              quoteText: serializedMetadata,
              quoteAuthor: track.artist,
              trackId: track.id,
              trackStart: 0.0,
              backgroundVideoUrl: randomBg.videoUrl,
              lyricalTemplateId: currentTemplate.id,
              status: "PENDING",
            },
          });
        }
      }

      // Kick off background rendering immediately (no manual start rendering required!)
      processBatchRendering(batch.id).catch(err => {
        console.error(`[Batches API] Lyrical bulk background render queue failure for batch ${batch.id}:`, err);
      });

      return NextResponse.json({ success: true, batchId: batch.id, message: "Lyrical video composition started in the background" });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACTION 1: GENERATE_QUOTES
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "GENERATE_QUOTES") {
      const { accountIds, postsPerAccount, videoLength = 7.0, csvQuotes } = body;

      if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
        return NextResponse.json({ error: "Please select at least one TikTok account" }, { status: 400 });
      }
      if (!postsPerAccount || postsPerAccount <= 0) {
        return NextResponse.json({ error: "Please specify number of posts per account" }, { status: 400 });
      }

      const totalPosts = accountIds.length * postsPerAccount;

      // Create a Draft Batch
      const batch = await prisma.genreBatch.create({
        data: {
          genre: "quote",
          status: "QUOTES_GENERATING",
          totalPosts,
          postsPerAccount,
          videoLength,
        },
      });

      // Generate/assign quotes for each account
      for (const accountId of accountIds) {
        const account = await prisma.managedAccount.findUnique({
          where: { id: accountId },
          include: {
            genreConfigs: { where: { genre: "quote" } },
            backgroundVideos: { where: { genre: "quote" } },
          },
        });

        if (!account) continue;

        // Ensure account has styling configured
        const config = account.genreConfigs[0];
        if (!config) {
          console.warn(`[Batches API] Account ${account.tiktokUsername} lacks a quote style configuration`);
          continue;
        }

        // Get account backgrounds loop pool
        const bgs = account.backgroundVideos;
        if (bgs.length === 0) {
          console.warn(`[Batches API] Account ${account.tiktokUsername} has no uploaded background loops`);
          continue;
        }

        let quotes: { text: string; author: string | null }[] = [];

        if (csvQuotes && Array.isArray(csvQuotes) && csvQuotes.length > 0) {
          // Sequentially assign quotes from CSV list, cycling if there are fewer quotes than total needed
          const accIdx = accountIds.indexOf(accountId);
          for (let i = 0; i < postsPerAccount; i++) {
            const quoteIdx = (accIdx * postsPerAccount + i) % csvQuotes.length;
            const q = csvQuotes[quoteIdx];
            quotes.push({
              text: q.text || q.quoteText || "",
              author: q.author || q.quoteAuthor || null
            });
          }
        } else {
          // Gemini AI Generation
          // Fetch duplicate check seed (all previous quotes generated globally)
          const previousItems = await prisma.genreBatchItem.findMany({
            select: { quoteText: true },
          });
          const existingQuotes = Array.from(
            new Set(previousItems.map(item => item.quoteText.trim()).filter(Boolean))
          );

          const theme = (!config.themeText || config.themeText === "__DISABLED__") 
            ? "Daily motivational and inspiring wisdom" 
            : config.themeText;

          quotes = await generateQuotesForTheme(theme, postsPerAccount, existingQuotes);
        }

        // Fetch first track to act as placeholder until allocation
        const defaultTrack = await prisma.track.findFirst();
        if (!defaultTrack) {
          return NextResponse.json({ error: "No music tracks uploaded in the library. Please upload tracks first." }, { status: 400 });
        }

        // Create item records
        for (let i = 0; i < quotes.length; i++) {
          const q = quotes[i];
          const randomBg = bgs[Math.floor(Math.random() * bgs.length)];

          await prisma.genreBatchItem.create({
            data: {
              batchId: batch.id,
              accountId,
              quoteText: q.text,
              quoteAuthor: q.author,
              trackId: defaultTrack.id, // placeholder
              trackStart: defaultTrack.defaultStart,
              backgroundVideoUrl: randomBg.videoUrl,
              status: "PENDING",
            },
          });
        }
      }

      // Update status to QUOTES_REVIEW
      const updatedBatch = await prisma.genreBatch.update({
        where: { id: batch.id },
        data: { status: "QUOTES_REVIEW" },
        include: {
          items: {
            include: {
              account: {
                select: {
                  tiktokUsername: true,
                  tiktokAvatarUrl: true,
                },
              },
            },
          },
        },
      });

      console.log(`[Batches API] Successfully generated quote batch: ${batch.id}`);
      return NextResponse.json(updatedBatch);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACTION 2: UPDATE_QUOTES (Save user edits before starting rendering)
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "UPDATE_QUOTES") {
      const { batchId, items } = body;
      if (!batchId || !Array.isArray(items)) {
        return NextResponse.json({ error: "Missing batchId or items" }, { status: 400 });
      }

      for (const editItem of items) {
        await prisma.genreBatchItem.update({
          where: { id: editItem.id, batchId },
          data: {
            quoteText: editItem.quoteText.trim(),
            quoteAuthor: editItem.quoteAuthor ? editItem.quoteAuthor.trim() : null,
          },
        });
      }

      return NextResponse.json({ success: true });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACTION 3: START_RENDERING
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "START_RENDERING") {
      const { batchId, trackIds } = body;
      const audioReuseMax = body.audioReuseMax !== undefined ? Math.round(Number(body.audioReuseMax)) : 2;

      if (!batchId) {
        return NextResponse.json({ error: "Missing batchId" }, { status: 400 });
      }
      if (!trackIds || !Array.isArray(trackIds) || trackIds.length === 0) {
        return NextResponse.json({ error: "Please select at least one track for the audio pool" }, { status: 400 });
      }

      const batch = await prisma.genreBatch.findUnique({
        where: { id: batchId },
        include: {
          items: {
            include: {
              account: true,
            },
          },
        },
      });

      if (!batch) {
        return NextResponse.json({ error: "Batch not found" }, { status: 404 });
      }

      // 1. Group items by account and perform round-robin audio allocation
      const tracks = await prisma.track.findMany({
        where: { id: { in: trackIds } },
      });

      if (tracks.length === 0) {
        return NextResponse.json({ error: "Selected tracks not found in library" }, { status: 400 });
      }

      // Group batch items by accountId
      const accountGroups: Record<string, typeof batch.items> = {};
      for (const item of batch.items) {
        if (!accountGroups[item.accountId]) {
          accountGroups[item.accountId] = [];
        }
        accountGroups[item.accountId].push(item);
      }

      // Allocate audio tracks for each account group
      for (const accountId of Object.keys(accountGroups)) {
        const groupItems = accountGroups[accountId];
        const allocations = allocateTracks(groupItems.length, tracks, audioReuseMax);

        for (let i = 0; i < groupItems.length; i++) {
          const item = groupItems[i];
          const alloc = allocations[i];
          const matchedTrack = tracks.find(t => t.id === alloc.trackId) || tracks[0];

          await prisma.genreBatchItem.update({
            where: { id: item.id },
            data: {
              trackId: matchedTrack.id,
              trackStart: matchedTrack.defaultStart,
            },
          });
        }
      }

      // Update batch reuse settings
      await prisma.genreBatch.update({
        where: { id: batchId },
        data: { audioReuseMax },
      });

      // 2. Trigger asynchronous rendering loop in the background!
      // This is completely non-blocking for Next.js, allowing the route to respond immediately.
      processBatchRendering(batchId).catch(err => {
        console.error(`[Batches API] Render process background failure for batch ${batchId}:`, err);
      });

      return NextResponse.json({ success: true, message: "Compositing rendering queue started in the background" });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACTION 4: CANCEL_BATCH
    // ─────────────────────────────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────
    // ACTION 3.5: UPLOAD_TO_DRIVE
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "UPLOAD_TO_DRIVE") {
      const { batchId, itemId } = body;
      
      if (!batchId && !itemId) {
        return NextResponse.json({ error: "Missing batchId or itemId" }, { status: 400 });
      }

      // Fetch items to upload
      const itemsToUpload = await prisma.genreBatchItem.findMany({
        where: {
          ...(itemId ? { id: itemId } : { batchId }),
          status: "RENDERED",
        },
        include: {
          account: true,
        },
      });

      if (itemsToUpload.length === 0) {
        return NextResponse.json({ error: "No rendered items found to upload" }, { status: 400 });
      }

      const results = [];
      const errors = [];

      for (const item of itemsToUpload) {
        try {
          if (!item.account.driveFolderId) {
            throw new Error(`Google Drive folder is not linked for account @${item.account.tiktokUsername}`);
          }

          // Resolve absolute path to local render
          if (!item.renderedVideoUrl) {
            throw new Error("Rendered video URL is missing");
          }
          const localPath = path.join(process.cwd(), "public", item.renderedVideoUrl);
          if (!fs.existsSync(localPath)) {
            throw new Error(`Rendered video file not found locally at: ${localPath}`);
          }

          console.log(`[Manual Uploader] Uploading item ${item.id} (${item.account.tiktokUsername}) to Drive`);
          const fileBuffer = fs.readFileSync(localPath);

          const dateStr = new Date().toISOString().slice(0, 10);
          const randStr = Math.random().toString(36).substring(2, 6);
          const driveFileName = `quote_${dateStr}_${randStr}.mp4`;

          const { uploadFileToFolder } = await import("@/lib/google");
          const driveFileId = await uploadFileToFolder(
            item.account.driveFolderId,
            driveFileName,
            fileBuffer,
            "video/mp4",
            item.accountId
          );

          // Delete local file to prevent disk bloat
          try {
            if (fs.existsSync(localPath)) {
              fs.unlinkSync(localPath);
              console.log(`[Manual Uploader] Deleted local rendered file: ${localPath}`);
            }
          } catch (cleanErr) {
            console.warn(`[Manual Uploader] Clean up local file warning: ${localPath}`, cleanErr);
          }

          // Update item in database
          await prisma.genreBatchItem.update({
            where: { id: item.id },
            data: {
              status: "UPLOADED",
              driveFileId,
            },
          });

          results.push({ id: item.id, driveFileId });
        } catch (itemErr: any) {
          console.error(`[Manual Uploader] Error uploading item ${item.id}:`, itemErr);
          errors.push({ id: item.id, error: itemErr.message || String(itemErr) });
          
          await prisma.genreBatchItem.update({
            where: { id: item.id },
            data: {
              status: "FAILED",
              errorMessage: `Upload failed: ${itemErr.message || String(itemErr)}`,
            },
          });
        }
      }

      // Check if this action completed a batch
      if (batchId) {
        const remainingPending = await prisma.genreBatchItem.count({
          where: {
            batchId,
            status: { in: ["PENDING", "RENDERING", "RENDERED"] },
          },
        });
        if (remainingPending === 0) {
          await prisma.genreBatch.update({
            where: { id: batchId },
            data: { status: "COMPLETED" },
          });
        }
      }

      return NextResponse.json({
        success: errors.length === 0,
        uploadedCount: results.length,
        failedCount: errors.length,
        errors,
      });
    }

    if (action === "CANCEL_BATCH") {
      const { batchId } = body;
      if (!batchId) {
        return NextResponse.json({ error: "Missing batchId" }, { status: 400 });
      }

      // Update the parent batch status to FAILED
      await prisma.genreBatch.update({
        where: { id: batchId },
        data: { status: "FAILED" },
      });

      // Update all items that are not completed (i.e. not UPLOADED and not RENDERED) to FAILED
      await prisma.genreBatchItem.updateMany({
        where: {
          batchId,
          status: { notIn: ["UPLOADED", "RENDERED"] },
        },
        data: {
          status: "FAILED",
          errorMessage: "Cancelled by user",
        },
      });

      console.log(`[Batches API] Batch ${batchId} cancelled by user`);
      return NextResponse.json({ success: true, message: "Batch processing cancelled" });
    }

    if (action === "RETRY_FAILED") {
      const { batchId, itemId } = body;
      if (!batchId) {
        return NextResponse.json({ error: "Missing batchId" }, { status: 400 });
      }

      const batch = await prisma.genreBatch.findUnique({
        where: { id: batchId },
        include: { items: true },
      });

      if (!batch) {
        return NextResponse.json({ error: "Batch not found" }, { status: 404 });
      }

      if (itemId) {
        // Single item retry
        const item = batch.items.find(i => i.id === itemId);
        if (!item) {
          return NextResponse.json({ error: "Batch item not found" }, { status: 404 });
        }
        if (item.status !== "FAILED") {
          return NextResponse.json({ error: "This item did not fail" }, { status: 400 });
        }

        await prisma.genreBatchItem.update({
          where: { id: itemId },
          data: {
            status: "PENDING",
            errorMessage: null,
          },
        });
      } else {
        // Bulk retry on all failed items
        const failedItems = batch.items.filter(item => item.status === "FAILED");
        if (failedItems.length === 0) {
          return NextResponse.json({ error: "No failed items to retry in this batch" }, { status: 400 });
        }

        await prisma.genreBatchItem.updateMany({
          where: {
            batchId: batchId,
            status: "FAILED",
          },
          data: {
            status: "PENDING",
            errorMessage: null,
          },
        });
      }

      // Reset batch status to RENDERING
      await prisma.genreBatch.update({
        where: { id: batchId },
        data: {
          status: "RENDERING",
        },
      });

      // Trigger asynchronous rendering loop in the background!
      processBatchRendering(batchId).catch(err => {
        console.error(`[Batches API] Retry render process background failure for batch ${batchId}:`, err);
      });

      return NextResponse.json({ success: true, message: "Retrying failed renders started in the background" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("[Batches API] Error handling batch action:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// DELETE /api/managed/genres/batches?batchId=... — Delete a batch history from database
export async function DELETE(req: Request) {
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
    await prisma.genreBatch.delete({ where: { id: batchId } });
    console.log(`[Batches API] Deleted batch history: ${batchId}`);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Batches API] Error deleting batch:", err);
    return NextResponse.json({ error: "Failed to delete batch history" }, { status: 500 });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Sequential Background Video Composition and Google Drive Uploader Loop
// ──────────────────────────────────────────────────────────────────────────────
async function processBatchRendering(batchId: string) {
  console.log(`[Batch Worker] Starting sequential rendering queue for batch: ${batchId}`);
  
  try {
    // 1. Fetch batch info and pending items
    const batch = await prisma.genreBatch.findUnique({
      where: { id: batchId },
      include: {
        items: {
          include: {
            account: true,
            track: true,
            lyricalTemplate: true,
          },
        },
      },
    });

    if (!batch) return;

    // Update batch status to RENDERING
    await prisma.genreBatch.update({
      where: { id: batchId },
      data: { status: "RENDERING" },
    });

    // 2. Loop sequentially through each pending item to composer
    for (const item of batch.items) {
      if (item.status === "UPLOADED" || item.status === "RENDERED") continue;

      // Check if batch has been cancelled
      const freshBatch = await prisma.genreBatch.findUnique({
        where: { id: batchId },
      });
      if (!freshBatch || freshBatch.status === "FAILED") {
        console.log(`[Batch Worker] Batch ${batchId} is marked as FAILED/CANCELLED. Aborting rendering loop.`);
        break;
      }

      console.log(`[Batch Worker] Processing item ${item.id} (${item.account.tiktokUsername})`);

      try {
        await prisma.genreBatchItem.update({
          where: { id: item.id },
          data: { status: "RENDERING" },
        });

        // Resolve absolute background video file path
        const bgPath = path.join(process.cwd(), "public", item.backgroundVideoUrl);
        if (!fs.existsSync(bgPath)) {
          throw new Error(`Background video loop not found at: ${bgPath}`);
        }

        // Resolve absolute audio file path
        const audioPath = path.join(process.cwd(), "public", item.track.fileUrl);
        if (!fs.existsSync(audioPath)) {
          throw new Error(`Audio file not found at: ${audioPath}`);
        }

        // Generate dynamic local output destination in public/uploads/renders
        const rendersDir = path.join(process.cwd(), "public", "uploads", "renders");
        if (!fs.existsSync(rendersDir)) {
          fs.mkdirSync(rendersDir, { recursive: true });
        }
        const localOutFile = path.join(rendersDir, `render_${item.id}.mp4`);

        if (item.lyricalTemplateId && item.lyricalTemplate) {
          // Bypassing quote drawing entirely!
          // We will run an ultra-fast FFmpeg command that overlays the pre-rendered transparent overlay MOV onto the account's background video.
          let overlayUrl = item.lyricalTemplate.overlayVideoUrl;
          if (!overlayUrl) {
            // Auto-generate the expected URL path from template name
            const sanitizedName = item.lyricalTemplate.templateName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
            overlayUrl = `/uploads/lyrical/overlays/track_${item.lyricalTemplate.trackId}_${sanitizedName}.mov`;
          }
          let overlayPath = path.join(process.cwd(), "public", overlayUrl);

          // ── SELF-HEALING: Auto-compile missing overlay on-the-fly ──
          if (!fs.existsSync(overlayPath)) {
            console.log(`[Batch Worker Lyrical] Overlay missing at ${overlayPath}. Auto-compiling on-the-fly...`);

            // Verify we have the raw ingredients
            const trackAudioPath = path.join(process.cwd(), "public", item.track.fileUrl);
            if (!fs.existsSync(trackAudioPath)) {
              throw new Error(`Cannot auto-compile overlay: audio source file missing at ${trackAudioPath}`);
            }
            if (!item.track.lyricalTranscription) {
              throw new Error(`Cannot auto-compile overlay: track ${item.track.title} has no Whisper transcription data. Run alignment first.`);
            }

            // Ensure overlay directory exists
            fs.mkdirSync(path.dirname(overlayPath), { recursive: true });

            const tpl = item.lyricalTemplate;

            // Use spawnSync with argument array to avoid ALL shell escaping issues with JSON
            // IMPORTANT: Do NOT pass --preview-frame here! The Python script treats it as
            // Mode A (instant PNG preview) which returns BEFORE Mode B (overlay MOV) runs.
            // We only need the overlay MOV for batch rendering.
            const { spawnSync } = require("child_process");
            const pyArgs = [
              "scripts/lyrical_composer.py",
              "-i", trackAudioPath,
              "-o", overlayPath,
              "--only-overlay",
              "--transcription-json", item.track.lyricalTranscription,
              "--font", tpl.fontFamily,
              "--font-size", String(tpl.fontSize),
              "--active-color", tpl.activeColor,
              "--stroke-width", String(tpl.strokeWidth),
              "--stroke-color", tpl.strokeColor,
              "--position-y", String(tpl.positionY),
              "--fps", "60",
            ];

            console.log(`[Batch Worker Lyrical] Spawning auto-compile for template '${tpl.templateName}'...`);

            const pyResult = spawnSync("./venv/bin/python3", pyArgs, {
              cwd: process.cwd(),
              timeout: 300000, // 5 min max
              env: { ...process.env, HF_HOME: process.env.HF_HOME || "/home/nextjs/.cache/huggingface" },
              stdio: ["pipe", "pipe", "pipe"],
            });

            const pyStdout = pyResult.stdout?.toString() || "";
            const pyStderr = pyResult.stderr?.toString() || "";
            if (pyStdout) console.log(`[Batch Worker Lyrical] Python stdout:\n${pyStdout}`);
            if (pyStderr) console.warn(`[Batch Worker Lyrical] Python stderr:\n${pyStderr}`);

            if (pyResult.error) {
              throw new Error(`Python process failed to start: ${pyResult.error.message}`);
            }
            if (pyResult.status !== 0) {
              throw new Error(`Python pre-renderer exited with code ${pyResult.status}: ${pyStderr.substring(0, 500)}`);
            }

            // Update DB record with the new overlay path
            if (fs.existsSync(overlayPath)) {
              console.log(`[Batch Worker Lyrical] ✅ Auto-compiled overlay successfully at: ${overlayPath}`);
              await prisma.trackLyricalTemplate.update({
                where: { id: tpl.id },
                data: {
                  overlayVideoUrl: overlayUrl,
                },
              });
            } else {
              throw new Error(`Auto-compilation completed but overlay file was not created at: ${overlayPath}`);
            }
          }

          const duration = batch.videoLength || item.track.duration || 7.0;

          // Run Pillow generator dynamic self-healing asset check
          try {
            const { execSync } = require("child_process");
            execSync(`./venv/bin/python3 scripts/effects_generator.py`, { timeout: 10000 });
          } catch (e) {
            console.warn("[Batch Worker Lyrical] Self-healing effects builder skipped:", e);
          }

          // Parse metadata for filters, particle overlays, and vignettes
          let colorFilter = "none";
          let particleFx = "none";
          let vignette = "none";
          let mirrorBg = false;
          let bgSpeed = 1.0;

          if (item.quoteText && item.quoteText.startsWith("{")) {
            try {
              const meta = JSON.parse(item.quoteText);
              colorFilter = meta.colorFilter || "none";
              particleFx = meta.particleFx || "none";
              vignette = meta.vignette || "none";
              mirrorBg = meta.mirrorBg === true;
              bgSpeed = typeof meta.bgSpeed === "number" ? meta.bgSpeed : 1.0;
            } catch (e) {
              console.warn("[Batch Worker Lyrical] Failed to parse item quoteText metadata:", e);
            }
          }

          const inputs: string[] = [];
          inputs.push(`-stream_loop -1 -i "${bgPath}"`); // index 0 (Background)

          let filterComplex = "";
          let lastLabel = "0:v";
          let currentInputIdx = 1;

          // A. Apply Background Transformations (Horizontal Mirroring & Speed Shifting)
          const transformFilters: string[] = [];
          if (mirrorBg) {
            transformFilters.push("hflip");
          }
          if (bgSpeed !== 1.0) {
            transformFilters.push(`setpts=${(1.0 / bgSpeed).toFixed(3)}*PTS`);
          }
          if (transformFilters.length > 0) {
            filterComplex += `[0:v]${transformFilters.join(",")}[transformed_bg];`;
            lastLabel = "transformed_bg";
          }

          // B. Apply built-in FFmpeg Color Balance and Eq filters
          if (colorFilter !== "none") {
            let filterString = "";
            if (colorFilter === "cyberpunk") {
              filterString = "colorbalance=rs=0.15:gs=-0.05:bs=0.35:rm=0.1:gm=-0.05:bm=0.25";
            } else if (colorFilter === "cinema") {
              filterString = "colorbalance=rs=0.12:gs=0.04:bs=-0.12:rm=0.08:gm=0.02:bm=-0.08";
            } else if (colorFilter === "monochrome") {
              filterString = "colorchannelmixer=.3:.4:.3:0:.3:.4:.3:0:.3:.4:.3:0";
            } else if (colorFilter === "vhs") {
              filterString = "noise=alls=12:allf=t+u,hue=s=0.7";
            } else if (colorFilter === "emerald") {
              filterString = "colorbalance=rs=-0.1:gs=0.12:bs=-0.1:rm=-0.08:gm=0.1:bm=-0.08";
            } else if (colorFilter === "polaroid") {
              filterString = "eq=contrast=0.95:brightness=0.02:saturation=1.1,colorbalance=rs=0.08:gs=0.04:bs=-0.08:rm=0.04:gm=0.02:bm=-0.04";
            } else if (colorFilter === "midnight") {
              filterString = "colorbalance=rs=-0.12:gs=-0.05:bs=0.2:rm=-0.08:gm=-0.02:bm=0.15";
            }

            if (filterString) {
              filterComplex += `[${lastLabel}]${filterString}[color_bg];`;
              lastLabel = "color_bg";
            }
          }

          // C. Parse transcription for line start timestamps to construct beat-responsive brightness flashes
          let lineStartTimes: number[] = [];
          if (item.track.lyricalTranscription) {
            try {
              const wordsList = JSON.parse(item.track.lyricalTranscription);
              if (Array.isArray(wordsList) && wordsList.length > 0) {
                let currentChunkStart = wordsList[0].start;
                lineStartTimes.push(currentChunkStart);
                let wordCount = 1;
                let lastEnd = wordsList[0].end;
                for (let idx = 1; idx < wordsList.length; idx++) {
                  const w = wordsList[idx];
                  const gap = w.start - lastEnd;
                  if (wordCount >= 3 || gap > 1.5) {
                    lineStartTimes.push(w.start);
                    currentChunkStart = w.start;
                    wordCount = 1;
                  } else {
                    wordCount++;
                  }
                  lastEnd = w.end;
                }
              }
            } catch (e) {
              console.warn("[Batch Worker Lyrical] Failed to parse transcription for flash transitions:", e);
            }
          }

          let flashFilterString = "";
          if (lineStartTimes.length > 0) {
            let expr = "0";
            for (const t of lineStartTimes) {
              expr = `if(between(t\\,${t.toFixed(2)}\\,${(t + 0.25).toFixed(2)})\\,0.15\\,${expr})`;
            }
            flashFilterString = `eq=brightness='${expr}'`;
          }

          if (flashFilterString) {
            filterComplex += `[${lastLabel}]${flashFilterString}[flashed_bg];`;
            lastLabel = "flashed_bg";
          }

          // D. Apply Bottom Gradient / Circle Vignette overlay PNGs
          let vignetteInputIdx = -1;
          if (vignette !== "none") {
            const vigPath = path.join(process.cwd(), "public", "uploads", "effects", `${vignette}.png`);
            if (fs.existsSync(vigPath)) {
              vignetteInputIdx = currentInputIdx++;
              inputs.push(`-i "${vigPath}"`);
              filterComplex += `[${lastLabel}][${vignetteInputIdx}:v]overlay=0:0[vignetted];`;
              lastLabel = "vignetted";
            }
          }

          // E. Dynamically generate and overlay glassmorphic account watermark badge
          let watermarkInputIdx = -1;
          const accountHandle = item.account.tiktokUsername || "sleeckos";
          const watermarkPath = path.join(process.cwd(), "public", "uploads", "effects", `watermark_${item.accountId}.png`);
          try {
            const { execSync } = require("child_process");
            execSync(`./venv/bin/python3 scripts/watermark_generator.py --handle "@${accountHandle.replace("@", "")}" --output "${watermarkPath}"`, { timeout: 10000 });
          } catch (e) {
            console.warn("[Batch Worker Lyrical] Watermark generation failed:", e);
          }

          if (fs.existsSync(watermarkPath)) {
            watermarkInputIdx = currentInputIdx++;
            inputs.push(`-i "${watermarkPath}"`);
            filterComplex += `[${lastLabel}][${watermarkInputIdx}:v]overlay=W-w-30:H-h-120[watermarked];`;
            lastLabel = "watermarked";
          }

          // F. Screen-blend high-efficiency black background MP4 particle loop overlays
          let particleInputIdx = -1;
          if (particleFx !== "none") {
            const pPath = path.join(process.cwd(), "public", "uploads", "effects", particleFx);
            if (fs.existsSync(pPath)) {
              particleInputIdx = currentInputIdx++;
              inputs.push(`-stream_loop -1 -i "${pPath}"`);
              filterComplex += `[${lastLabel}][${particleInputIdx}:v]blend=all_mode='screen':all_opacity=0.6[layered];`;
              lastLabel = "layered";
            }
          }

          // G. Overlay silent lossless MOV typography subtitles overlay
          const captionInputIdx = currentInputIdx++;
          inputs.push(`-i "${overlayPath}"`);
          filterComplex += `[${lastLabel}][${captionInputIdx}:v]overlay=0:0[v]`;

          const cmd = [
            `ffmpeg -y`,
            ...inputs,
            `-filter_complex "${filterComplex}"`,
            `-map "[v]"`,
            `-map ${captionInputIdx}:a`, // extract synced audio track from subtitles MOV
            `-c:v libx264`,
            `-pix_fmt yuv420p`,
            `-preset superfast`,
            `-c:a copy`,
            `-t ${duration}`,
            `"${localOutFile}"`,
          ].join(" ");

          console.log(`[Batch Worker Lyrical] Spawning FFmpeg overlay merge: ${cmd}`);

          await new Promise<void>((resolvePromise, rejectPromise) => {
            const { exec: execCmd } = require("child_process");
            execCmd(cmd, { timeout: 120000 }, (error: any, stdout: any, stderr: any) => {
              if (error) {
                console.error("[Batch Worker Lyrical] FFmpeg execution error:", stderr);
                rejectPromise(new Error(`FFmpeg composition failed: ${error.message}`));
              } else {
                resolvePromise();
              }
            });
          });

        } else {
          // Resolve account quote styling configurations
          const styleConfig = await prisma.accountGenreConfig.findUnique({
            where: {
              accountId_genre: {
                accountId: item.accountId,
                genre: "quote",
              },
            },
          });

          if (!styleConfig) {
            throw new Error("TikTok account has no Quote typography configuration saved. Please configure it first.");
          }

          // Trigger visual composition via FFmpeg
          const { composeVideo } = await import("@/lib/composer");
          await composeVideo({
            bgVideoPath: bgPath,
            audioPath: audioPath,
            quoteText: item.quoteText,
            quoteAuthor: item.quoteAuthor,
            fontFamily: styleConfig.fontFamily,
            fontSize: styleConfig.fontSize,
            fontColor: styleConfig.fontColor,
            textCase: styleConfig.textCase,
            boxColor: styleConfig.boxColor,
            shadowColor: styleConfig.shadowColor,
            lineSpacing: styleConfig.lineSpacing,
            videoLength: batch.videoLength,
            trackStart: item.trackStart,
            outputPath: localOutFile,
            curveText: styleConfig.curveText,
            curvature: styleConfig.curvature,
            positionY: styleConfig.positionY,
          });
        }

        // Update DB item record to RENDERED with local URL path
        await prisma.genreBatchItem.update({
          where: { id: item.id },
          data: {
            status: "RENDERED",
            renderedVideoUrl: `/uploads/renders/render_${item.id}.mp4`,
          },
        });

        console.log(`[Batch Worker] Item ${item.id} successfully rendered locally!`);
      } catch (itemErr: any) {
        console.error(`[Batch Worker] Error rendering item ${item.id}:`, itemErr);

        // Cleanup temporary render clip on failure
        const localOutFile = path.join(process.cwd(), "public", "uploads", "renders", `render_${item.id}.mp4`);
        if (fs.existsSync(localOutFile)) {
          try { fs.unlinkSync(localOutFile); } catch {}
        }

        await prisma.genreBatchItem.update({
          where: { id: item.id },
          data: {
            status: "FAILED",
            errorMessage: itemErr.message || String(itemErr),
          },
        });
      }
    }

    // 3. Determine final status of the batch
    const remainingItems = await prisma.genreBatchItem.findMany({
      where: { batchId },
    });

    const failedCount = remainingItems.filter(i => i.status === "FAILED").length;
    const completedCount = remainingItems.filter(i => i.status === "RENDERED" || i.status === "UPLOADED").length;

    let finalStatus: "COMPLETED" | "FAILED" = "COMPLETED";
    if (failedCount > 0 && completedCount === 0) {
      finalStatus = "FAILED";
    }

    await prisma.genreBatch.update({
      where: { id: batchId },
      data: { status: finalStatus },
    });

    console.log(`[Batch Worker] Finished processing batch ${batchId}. Final status: ${finalStatus}`);
  } catch (batchErr) {
    console.error(`[Batch Worker] Critical error in batch ${batchId} queue:`, batchErr);
    await prisma.genreBatch.update({
      where: { id: batchId },
      data: { status: "FAILED" },
    });
  }
}
