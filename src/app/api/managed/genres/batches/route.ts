export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import fs from "fs";
import path from "path";
import { generateQuotesForTheme, allocateTracks } from "@/lib/composer";

// Version marker — check Docker logs to verify latest code is deployed
const BUILD_VERSION = "v3-template-effects-only-20260529";

// GET /api/managed/genres/batches — Get batch history or fetch progress details of a single batch
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const batchId = searchParams.get("batchId");
  const checkVersion = searchParams.get("version");

  // Quick version check — hit ?version=1 to confirm deployed build
  if (checkVersion) {
    return NextResponse.json({ build: BUILD_VERSION, timestamp: new Date().toISOString() });
  }

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

          // Cycle through templates sequentially from the pool or use the single selected template
          const currentTemplate = lyricalTemplateId === "mix_all"
            ? templatesPool[mutationCounter % templatesPool.length]
            : template;

          mutationCounter++;

          // quoteText stores display metadata only — visual effects come from the template
          const serializedMetadata = JSON.stringify({
            title: `Lyrical - ${track.title} (${currentTemplate.templateName})`,
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

// DELETE /api/managed/genres/batches?batchId=...&itemId=... — Delete a batch or individual item
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const batchId = searchParams.get("batchId");
  const itemId = searchParams.get("itemId");

  if (!batchId) {
    return NextResponse.json({ error: "Missing batchId" }, { status: 400 });
  }

  try {
    // Delete a single item from the batch
    if (itemId) {
      const item = await prisma.genreBatchItem.findUnique({ where: { id: itemId } });
      if (item?.renderedVideoUrl) {
        const filePath = path.join(process.cwd(), "public", item.renderedVideoUrl);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`[Batches API] Deleted rendered video file: ${filePath}`);
        }
      }
      await prisma.genreBatchItem.delete({ where: { id: itemId } });
      console.log(`[Batches API] Deleted batch item: ${itemId} from batch: ${batchId}`);

      // Update batch totalPosts count
      const remaining = await prisma.genreBatchItem.count({ where: { batchId } });
      await prisma.genreBatch.update({
        where: { id: batchId },
        data: { totalPosts: remaining },
      });

      return NextResponse.json({ success: true, remainingItems: remaining });
    }

    // Delete entire batch
    await prisma.genreBatch.delete({ where: { id: batchId } });
    console.log(`[Batches API] Deleted batch history: ${batchId}`);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Batches API] Error deleting:", err);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Sequential Background Video Composition and Google Drive Uploader Loop
// ──────────────────────────────────────────────────────────────────────────────
async function processBatchRendering(batchId: string) {
  console.log(`[Batch Worker] ======== BUILD: ${BUILD_VERSION} ========`);
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
          // Use pre-rendered overlay MOV if available, or generate ASS subtitles on-the-fly (zero RAM).
          let overlayUrl = item.lyricalTemplate.overlayVideoUrl;
          if (!overlayUrl) {
            const sanitizedName = item.lyricalTemplate.templateName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
            overlayUrl = `/uploads/lyrical/overlays/track_${item.lyricalTemplate.trackId}_${sanitizedName}.mov`;
          }
          const overlayPath = path.join(process.cwd(), "public", overlayUrl);
          const hasPreRenderedOverlay = fs.existsSync(overlayPath);

          // ── ASS SUBTITLE FALLBACK when overlay MOV is missing ──
          let assSubtitlePath: string | null = null;
          if (!hasPreRenderedOverlay) {
            console.log(`[Batch Worker Lyrical] Overlay missing. Using ASS subtitle fallback (zero RAM).`);
            if (!item.track.lyricalTranscription) {
              throw new Error(`Cannot render: track ${item.track.title} has no Whisper transcription data.`);
            }

            const tpl = item.lyricalTemplate;
            const words: { word: string; start: number; end: number }[] = JSON.parse(item.track.lyricalTranscription);

            // Convert hex (#RRGGBB) to ASS BGR (&H00BBGGRR&)
            const hexToAssBGR = (hex: string): string => {
              const c = hex.replace("#", "");
              return `&H00${c.substring(4, 6)}${c.substring(2, 4)}${c.substring(0, 2)}&`.toUpperCase();
            };

            const activeColorBGR = hexToAssBGR(tpl.activeColor || "#FFFF00");
            const strokeColorBGR = hexToAssBGR(tpl.strokeColor || "#000000");
            const fontSize = tpl.fontSize || 48;
            const strokeWidth = tpl.strokeWidth ?? 3; // respect 0 if user set it
            const fontName = tpl.fontFamily || "Outfit";
            const yPos = Math.round(tpl.positionY * 1280);

            // Group words into display chunks of ~4 words
            const chunks: typeof words[] = [];
            let curChunk: typeof words = [];
            let lastE = 0;
            for (const w of words) {
              if (curChunk.length >= 4 || (curChunk.length > 0 && w.start - lastE > 1.5)) {
                chunks.push(curChunk);
                curChunk = [];
              }
              curChunk.push(w);
              lastE = w.end;
            }
            if (curChunk.length > 0) chunks.push(curChunk);

            // Format time as H:MM:SS.CC for ASS
            const fmtTime = (t: number): string => {
              const h = Math.floor(t / 3600);
              const m = Math.floor((t % 3600) / 60);
              const s = Math.floor(t % 60);
              const cs = Math.round((t % 1) * 100);
              return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
            };

            // Neon glow: use shadow + blur for glow effect matching the browser preview
            const glowShadow = strokeWidth === 0 ? 3 : 1; // stronger glow when no outline
            const glowBlur = strokeWidth === 0 ? 4 : 2;
            // BackColour for glow uses the active color with partial transparency
            const glowColorBGR = activeColorBGR.replace("&H00", "&H40"); // 25% transparent glow

            // Build ASS subtitle file
            const assLines: string[] = [];
            assLines.push("[Script Info]");
            assLines.push("Title: Lyrical Captions");
            assLines.push("ScriptType: v4.00+");
            assLines.push("PlayResX: 720");
            assLines.push("PlayResY: 1280");
            assLines.push("WrapStyle: 0");
            assLines.push("");
            assLines.push("[V4+ Styles]");
            assLines.push("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding");
            assLines.push(`Style: Default,${fontName},${fontSize},&H00FFFFFF&,&H00FFFFFF&,${strokeColorBGR},${glowColorBGR},1,0,0,0,100,100,0,0,1,${strokeWidth},${glowShadow},2,20,20,${1280 - yPos},0`);
            assLines.push("");
            assLines.push("[Events]");
            assLines.push("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text");

            for (const chunk of chunks) {
              for (let ai = 0; ai < chunk.length; ai++) {
                const segStart = chunk[ai].start;
                const segEnd = ai < chunk.length - 1 ? chunk[ai + 1].start : chunk[ai].end;
                let text = "";
                for (let j = 0; j < chunk.length; j++) {
                  if (j === ai) {
                    // Active word: colored + blur glow for neon effect
                    text += `{\\c${activeColorBGR}\\blur${glowBlur + 1}\\bord${Math.max(strokeWidth, 2)}}${chunk[j].word.toUpperCase()}{\\c&H00FFFFFF&\\blur${glowBlur}\\bord${strokeWidth}}`;
                  } else {
                    text += chunk[j].word.toUpperCase();
                  }
                  if (j < chunk.length - 1) text += " ";
                }
                assLines.push(`Dialogue: 0,${fmtTime(segStart)},${fmtTime(segEnd)},Default,,0,0,0,,{\\blur${glowBlur}}${text}`);
              }
            }

            assSubtitlePath = `/tmp/lyrical_${item.id}.ass`;
            fs.writeFileSync(assSubtitlePath, assLines.join("\n"), "utf-8");
            console.log(`[Batch Worker Lyrical] Generated ASS subtitle (${chunks.length} chunks, ${words.length} words)`);
          }

          const duration = batch.videoLength || item.track.duration || 7.0;

          // Run Pillow generator dynamic self-healing asset check
          try {
            const { execSync } = require("child_process");
            execSync(`./venv/bin/python3 scripts/effects_generator.py`, { timeout: 10000 });
          } catch (e) {
            console.warn("[Batch Worker Lyrical] Self-healing effects builder skipped:", e);
          }

          // Read visual effects from the template — single source of truth
          const colorFilter = item.lyricalTemplate?.colorFilter || "none";
          const particleFx = item.lyricalTemplate?.particleFx || "none";
          const vignette = item.lyricalTemplate?.vignette || "none";
          const mirrorBg = item.lyricalTemplate?.mirrorBg === true;
          const bgSpeed = typeof item.lyricalTemplate?.bgSpeed === "number" ? item.lyricalTemplate.bgSpeed : 1.0;

          console.log(`[Batch Worker DEBUG] BUILD=${BUILD_VERSION}`);
          console.log(`[Batch Worker DEBUG] Template ID: ${item.lyricalTemplateId}`);
          console.log(`[Batch Worker DEBUG] Template name: ${item.lyricalTemplate?.templateName}`);
          console.log(`[Batch Worker DEBUG] Template raw colorFilter: '${item.lyricalTemplate?.colorFilter}'`);
          console.log(`[Batch Worker DEBUG] Template raw vignette: '${item.lyricalTemplate?.vignette}'`);
          console.log(`[Batch Worker DEBUG] Template raw particleFx: '${item.lyricalTemplate?.particleFx}'`);
          console.log(`[Batch Worker DEBUG] Resolved effects → filter=${colorFilter}, vignette=${vignette}, particles=${particleFx}, mirror=${mirrorBg}, speed=${bgSpeed}`);
          console.log(`[Batch Worker DEBUG] quoteText: ${item.quoteText?.substring(0, 200)}`);

          console.log(`[Batch Worker Lyrical] Effects from template: filter=${colorFilter}, vignette=${vignette}, particles=${particleFx}, mirror=${mirrorBg}, speed=${bgSpeed}`);

          const inputs: string[] = [];
          inputs.push(`-stream_loop -1 -i "${bgPath}"`);

          let filterComplex = "";
          let lastLabel = "0:v";
          let currentInputIdx = 1;

          // 0. Normalize background to 720x1280 (TikTok standard) so all overlays/effects match
          filterComplex += `[0:v]scale=720:1280:force_original_aspect_ratio=disable,setsar=1[scaled_bg];`;
          lastLabel = "scaled_bg";

          // A. Background transforms
          const transformFilters: string[] = [];
          if (mirrorBg) transformFilters.push("hflip");
          if (bgSpeed !== 1.0) transformFilters.push(`setpts=${(1.0 / bgSpeed).toFixed(3)}*PTS`);
          if (transformFilters.length > 0) {
            filterComplex += `[${lastLabel}]${transformFilters.join(",")}[transformed_bg];`;
            lastLabel = "transformed_bg";
          }

          // A2. Background darkening — matches CSS preview's bg-black/45 overlay
          // The preview applies a semi-transparent black layer for text legibility
          filterComplex += `[${lastLabel}]eq=brightness=-0.25[darkened_bg];`;
          lastLabel = "darkened_bg";

          // B. Color filters — matched to CSS preview filters
          //    CSS: contrast() saturate() sepia/hue-rotate() brightness()
          //    FFmpeg: eq (contrast/brightness/saturation) + hue (rotation) + subtle colorbalance
          if (colorFilter !== "none") {
            let filterString = "";
            if (colorFilter === "cyberpunk") {
              // CSS: contrast(1.2) saturate(1.3) hue-rotate(320deg) brightness(0.95)
              filterString = "eq=contrast=1.2:brightness=-0.05:saturation=1.3,hue=h=320";
            } else if (colorFilter === "cinema") {
              // CSS: sepia(0.2) contrast(1.1) saturate(1.2) brightness(0.95)
              filterString = "eq=contrast=1.1:brightness=-0.05:saturation=1.2,colorbalance=rs=0.04:gs=0.02:bs=-0.03:rm=0.03:gm=0.01:bm=-0.02";
            } else if (colorFilter === "monochrome") {
              // CSS: grayscale(1) contrast(1.3) brightness(0.9)
              filterString = "eq=contrast=1.3:brightness=-0.1:saturation=0";
            } else if (colorFilter === "vhs") {
              // CSS: contrast(1.1) saturate(0.85) sepia(0.1) brightness(0.95)
              filterString = "eq=contrast=1.1:brightness=-0.05:saturation=0.85,noise=alls=8:allf=t+u";
            } else if (colorFilter === "emerald") {
              // CSS: contrast(1.15) saturate(0.7) sepia(0.1) hue-rotate(80deg) brightness(0.9)
              filterString = "eq=contrast=1.15:brightness=-0.1:saturation=0.7,hue=h=80";
            } else if (colorFilter === "polaroid") {
              // CSS: contrast(0.95) saturate(1.1) sepia(0.15) brightness(1.02)
              filterString = "eq=contrast=0.95:brightness=0.02:saturation=1.1,colorbalance=rs=0.03:gs=0.02:bs=-0.02";
            } else if (colorFilter === "midnight") {
              // CSS: contrast(1.1) saturate(1.15) hue-rotate(190deg) brightness(0.85)
              filterString = "eq=contrast=1.1:brightness=-0.15:saturation=1.15,hue=h=190";
            }
            if (filterString) {
              filterComplex += `[${lastLabel}]${filterString}[color_bg];`;
              lastLabel = "color_bg";
            }
          }

          // C. Beat-responsive brightness flashes
          let lineStartTimes: number[] = [];
          if (item.track.lyricalTranscription) {
            try {
              const wordsList = JSON.parse(item.track.lyricalTranscription);
              if (Array.isArray(wordsList) && wordsList.length > 0) {
                lineStartTimes.push(wordsList[0].start);
                let wordCount = 1;
                let lastEnd = wordsList[0].end;
                for (let idx = 1; idx < wordsList.length; idx++) {
                  const w = wordsList[idx];
                  if (wordCount >= 3 || w.start - lastEnd > 1.5) {
                    lineStartTimes.push(w.start);
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
          if (lineStartTimes.length > 0) {
            let expr = "0";
            for (const t of lineStartTimes) {
              expr = `if(between(t\\\\,${t.toFixed(2)}\\\\,${(t + 0.25).toFixed(2)})\\\\,0.15\\\\,${expr})`;
            }
            filterComplex += `[${lastLabel}]eq=brightness='${expr}'[flashed_bg];`;
            lastLabel = "flashed_bg";
          }

          // D. Vignette overlay
          if (vignette !== "none") {
            const vigPath = path.join(process.cwd(), "public", "uploads", "effects", `${vignette}.png`);
            if (fs.existsSync(vigPath)) {
              const vigIdx = currentInputIdx++;
              inputs.push(`-i "${vigPath}"`);
              filterComplex += `[${lastLabel}][${vigIdx}:v]overlay=0:0[vignetted];`;
              lastLabel = "vignetted";
            }
          }

          // E. Account watermark badge — DISABLED (user preference)
          // To re-enable, uncomment the block below.

          // F. Particle effects — subtle overlay (screen blend, low opacity to match CSS preview)
          if (particleFx !== "none") {
            const pPath = path.join(process.cwd(), "public", "uploads", "effects", particleFx);
            if (fs.existsSync(pPath)) {
              const pIdx = currentInputIdx++;
              inputs.push(`-stream_loop -1 -i "${pPath}"`);
              filterComplex += `[${lastLabel}][${pIdx}:v]blend=all_mode='screen':all_opacity=0.25[layered];`;
              lastLabel = "layered";
            }
          }

          // G. Captions — overlay MOV or ASS subtitle filter
          let cmd: string;
          if (hasPreRenderedOverlay) {
            // G1: Overlay pre-rendered transparent MOV
            const captionIdx = currentInputIdx++;
            inputs.push(`-i "${overlayPath}"`);
            filterComplex += `[${lastLabel}][${captionIdx}:v]overlay=0:0[v]`;
            cmd = [
              `ffmpeg -y`,
              ...inputs,
              `-filter_complex "${filterComplex}"`,
              `-map "[v]"`,
              `-map ${captionIdx}:a`,
              `-c:v libx264`,
              `-pix_fmt yuv420p`,
              `-preset superfast`,
              `-c:a copy`,
              `-t ${duration}`,
              `"${localOutFile}"`,
            ].join(" ");
          } else {
            // G2: Burn ASS subtitles directly via FFmpeg (zero extra RAM)
            const audioIdx = currentInputIdx++;
            inputs.push(`-i "${audioPath}"`);
            const escapedAss = assSubtitlePath!.replace(/\\/g, "/").replace(/:/g, "\\\\:");
            filterComplex += `[${lastLabel}]ass='${escapedAss}'[v]`;
            cmd = [
              `ffmpeg -y`,
              ...inputs,
              `-filter_complex "${filterComplex}"`,
              `-map "[v]"`,
              `-map ${audioIdx}:a`,
              `-c:v libx264`,
              `-pix_fmt yuv420p`,
              `-preset superfast`,
              `-c:a aac -b:a 192k`,
              `-t ${duration}`,
              `"${localOutFile}"`,
            ].join(" ");
          }

          console.log(`[Batch Worker Lyrical] FFmpeg FULL filter_complex:\n${filterComplex}`);
          console.log(`[Batch Worker Lyrical] FFmpeg cmd: ${cmd.substring(0, 500)}...`);

          await new Promise<void>((resolvePromise, rejectPromise) => {
            const { exec: execCmd } = require("child_process");
            execCmd(cmd, { timeout: 180000, maxBuffer: 1024 * 1024 * 10 }, (error: any, _stdout: any, stderr: any) => {
              if (assSubtitlePath) try { fs.unlinkSync(assSubtitlePath); } catch {}
              if (error) {
                console.error("[Batch Worker Lyrical] FFmpeg error:", stderr?.substring(0, 500));
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
