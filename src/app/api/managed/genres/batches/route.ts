export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import fs from "fs";
import path from "path";
import { generateQuotesForTheme, allocateTracks } from "@/lib/composer";

// Version marker — check Docker logs to verify latest code is deployed
const BUILD_VERSION = "v4-canvas-overlay-20260529";

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

      // Note: templates will be automatically pre-rendered by the worker if they don't exist.
      console.log(`[Genres Batches API] Queueing lyrical batch: missing overlays will be auto-rendered in the background`);

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
              muteAudio: currentTemplate.muteAudio,
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

    if (action === "RE_RENDER_ITEMS") {
      const { batchId, itemIds } = body;
      if (!batchId || !Array.isArray(itemIds) || itemIds.length === 0) {
        return NextResponse.json({ error: "Missing batchId or itemIds" }, { status: 400 });
      }

      const batch = await prisma.genreBatch.findUnique({
        where: { id: batchId },
        include: { items: true },
      });

      if (!batch) {
        return NextResponse.json({ error: "Batch not found" }, { status: 404 });
      }

      const itemsToReset = batch.items.filter(item => itemIds.includes(item.id));

      // Delete rendered video files from disk
      for (const item of itemsToReset) {
        if (item.renderedVideoUrl) {
          try {
            const filePath = path.join(process.cwd(), "public", item.renderedVideoUrl);
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          } catch (fsErr) {
            console.warn(`[Batches API RE_RENDER_ITEMS] Clean up file warning: ${item.renderedVideoUrl}`, fsErr);
          }
        }
      }

      // Reset status to PENDING
      await prisma.genreBatchItem.updateMany({
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
      await prisma.genreBatch.update({
        where: { id: batchId },
        data: { status: "RENDERING" },
      });

      // Trigger background rendering loop
      processBatchRendering(batchId).catch(err => {
        console.error(`[Batches API] Re-render process background failure for batch ${batchId}:`, err);
      });

      return NextResponse.json({ success: true, message: "Selected videos queued for re-rendering" });
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
        try {
          await prisma.genreBatchItem.update({
            where: { id: item.id },
            data: { status: "RENDERING" },
          });
        } catch (err: any) {
          if (err?.code === "P2025") {
            console.log(`[Batch Worker] Item ${item.id} not found (likely batch was deleted). Aborting loop.`);
            break;
          }
          throw err;
        }

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
          // Check for Canvas pre-rendered overlay (WebM VP8 with alpha)
          let overlayUrl = item.lyricalTemplate.overlayVideoUrl;
          if (!overlayUrl) {
            const sanitizedName = item.lyricalTemplate.templateName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
            overlayUrl = `/uploads/lyrical/overlays/track_${item.lyricalTemplate.trackId}_${sanitizedName}.webm`;
          }
          const overlayPath = path.join(process.cwd(), "public", overlayUrl);
          // Validate overlay: must exist + .ready sentinel + minimum 1KB
          const overlayReady = fs.existsSync(overlayPath + ".ready");
          const overlayExists = fs.existsSync(overlayPath);
          let overlaySize = 0;
          if (overlayExists) {
            try { overlaySize = fs.statSync(overlayPath).size; } catch {}
          }
          let hasPreRenderedOverlay = overlayExists && overlayReady && overlaySize > 1024;
          if (!hasPreRenderedOverlay) {
            console.log(`[Batch Worker] Pre-rendered overlay missing or invalid for template "${item.lyricalTemplate.templateName}". Auto-rendering it now...`);
            try {
              if (!item.track.lyricalTranscription) {
                throw new Error(`Track "${item.track.title}" has no Whisper alignment data.`);
              }
              const words = JSON.parse(item.track.lyricalTranscription);
              const duration = batch.videoLength || item.track.duration || 7.0;
              const rendererConfig = {
                fontFamily: item.lyricalTemplate.fontFamily,
                fontSize: item.lyricalTemplate.fontSize,
                activeColor: item.lyricalTemplate.activeColor,
                strokeWidth: item.lyricalTemplate.strokeWidth,
                strokeColor: item.lyricalTemplate.strokeColor,
                positionY: item.lyricalTemplate.positionY,
                colorFilter: item.lyricalTemplate.colorFilter,
                vignette: item.lyricalTemplate.vignette,
                particleFx: item.lyricalTemplate.particleFx,
                animationMode: item.lyricalTemplate.animationMode as "highlight" | "word_builder",
                bgColor: item.lyricalTemplate.bgColor,
                textColor: item.lyricalTemplate.textColor,
                textAlign: item.lyricalTemplate.textAlign,
                wordSpacing: item.lyricalTemplate.wordSpacing,
                letterSpacing: item.lyricalTemplate.letterSpacing,
              };
              const { renderCanvasOverlay } = await import("@/lib/ffmpeg-overlay-renderer");
              await renderCanvasOverlay(words, rendererConfig, duration, overlayPath);
              hasPreRenderedOverlay = true;
              console.log(`[Batch Worker] Auto-rendered template overlay successfully for template "${item.lyricalTemplate.templateName}"`);
            } catch (autoErr: any) {
              console.error(`[Batch Worker] Failed to auto-render overlay for template "${item.lyricalTemplate.templateName}":`, autoErr);
            }
          }

          const duration = batch.videoLength || item.track.duration || 7.0;
          const audioPath = path.join(process.cwd(), "public", item.track.fileUrl);

          // Read background transforms from template
          const colorFilter = item.lyricalTemplate?.colorFilter || "none";
          const mirrorBg = item.lyricalTemplate?.mirrorBg === true;
          const bgSpeed = typeof item.lyricalTemplate?.bgSpeed === "number" ? item.lyricalTemplate.bgSpeed : 1.0;

          console.log(`[Batch Worker DEBUG] BUILD=${BUILD_VERSION}`);
          console.log(`[Batch Worker DEBUG] Template: '${item.lyricalTemplate?.templateName}' (ID: ${item.lyricalTemplateId})`);
          console.log(`[Batch Worker DEBUG] Has Canvas overlay: ${hasPreRenderedOverlay} (path: ${overlayUrl})`);
          console.log(`[Batch Worker DEBUG] Template effects: filter=${colorFilter}, mirror=${mirrorBg}, speed=${bgSpeed}`);

          let cmd: string;

          // Check if this template uses a solid background color (e.g. Word Builder)
          // In this case the overlay WebM IS the full video — no background needed
          const hasSolidBg = !!item.lyricalTemplate?.bgColor &&
            item.lyricalTemplate.bgColor !== "none" &&
            item.lyricalTemplate.bgColor !== "transparent" &&
            item.lyricalTemplate.bgColor !== "null";

          if (hasPreRenderedOverlay && hasSolidBg) {
            // ═══════════════════════════════════════════════════════════════
            // G0: SOLID BACKGROUND PATH (Word Builder)
            // The WebM overlay IS the full video (opaque, with solid bg baked in)
            // FFmpeg only needs to mux: overlay_video + audio
            // ═══════════════════════════════════════════════════════════════
            console.log(`[Batch Worker Lyrical] Solid bg template — using overlay as full video`);

            const finalAudioInput = item.muteAudio
              ? `-f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100`
              : `-i "${audioPath}"`;

            cmd = [
              `ffmpeg -y`,
              `-i "${overlayPath}"`,
              finalAudioInput,
              `-c:v libx264`,
              `-pix_fmt yuv420p`,
              `-preset superfast`,
              `-c:a aac -b:a 192k`,
              `-t ${duration}`,
              `"${localOutFile}"`,
            ].join(" ");

            console.log(`[Batch Worker Lyrical] FFmpeg cmd (solid bg): ${cmd.substring(0, 500)}...`);

          } else if (hasPreRenderedOverlay) {
            // ═══════════════════════════════════════════════════════════════
            // G1: CANVAS OVERLAY PATH (WYSIWYG)
            // The WebM overlay contains: captions + vignette + particles + dark overlay
            // FFmpeg only handles: bg scale → mirror/speed → color_filter → overlay → audio
            // ═══════════════════════════════════════════════════════════════
            console.log(`[Batch Worker Lyrical] Using Canvas overlay (WYSIWYG path)`);

            const inputs: string[] = [];
            inputs.push(`-stream_loop -1 -i "${bgPath}"`);
            inputs.push(`-i "${overlayPath}"`);
            if (item.muteAudio) {
              inputs.push(`-f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100`);
            } else {
              inputs.push(`-i "${audioPath}"`);
            }

            let filterComplex = "";

            // 1. Scale background
            filterComplex += `[0:v]scale=720:1280:force_original_aspect_ratio=disable,setsar=1[scaled_bg];`;
            let lastLabel = "scaled_bg";

            // 2. Background transforms (mirror, speed)
            const transformFilters: string[] = [];
            if (mirrorBg) transformFilters.push("hflip");
            if (bgSpeed !== 1.0) transformFilters.push(`setpts=${(1.0 / bgSpeed).toFixed(3)}*PTS`);
            if (transformFilters.length > 0) {
              filterComplex += `[${lastLabel}]${transformFilters.join(",")}[transformed_bg];`;
              lastLabel = "transformed_bg";
            }

            // 2b. Background darkening — matches CSS preview's bg-black/45 overlay
            filterComplex += `[${lastLabel}]eq=brightness=-0.25[darkened_bg];`;
            lastLabel = "darkened_bg";

            // 3. Color filter (applied to background only)
            if (colorFilter !== "none") {
              let filterString = "";
              if (colorFilter === "cyberpunk") filterString = "eq=contrast=1.2:brightness=-0.05:saturation=1.3,hue=h=320";
              else if (colorFilter === "cinema") filterString = "eq=contrast=1.1:brightness=-0.05:saturation=1.2,colorbalance=rs=0.04:gs=0.02:bs=-0.03:rm=0.03:gm=0.01:bm=-0.02";
              else if (colorFilter === "monochrome") filterString = "eq=contrast=1.3:brightness=-0.1:saturation=0";
              else if (colorFilter === "vhs") filterString = "eq=contrast=1.1:brightness=-0.05:saturation=0.85,noise=alls=8:allf=t+u";
              else if (colorFilter === "emerald") filterString = "eq=contrast=1.15:brightness=-0.1:saturation=0.7,hue=h=80";
              else if (colorFilter === "polaroid") filterString = "eq=contrast=0.95:brightness=0.02:saturation=1.1,colorbalance=rs=0.03:gs=0.02:bs=-0.02";
              else if (colorFilter === "midnight") filterString = "eq=contrast=1.1:brightness=-0.15:saturation=1.15,hue=h=190";
              else if (colorFilter === "golden_hour") filterString = "eq=contrast=1.05:brightness=0.05:saturation=1.3,colorbalance=rs=0.05:gs=0.03:bs=-0.04,hue=h=-10";
              else if (colorFilter === "arctic") filterString = "eq=contrast=1.1:brightness=0.05:saturation=0.6,hue=h=180";
              else if (colorFilter === "neon_noir") filterString = "eq=contrast=1.4:brightness=-0.25:saturation=1.5,hue=h=280";
              else if (colorFilter === "rose_tint") filterString = "eq=contrast=1.05:brightness=0.0:saturation=1.2,hue=h=330,colorbalance=rs=0.04:gs=-0.02:bs=-0.01";
              else if (colorFilter === "vintage_film") filterString = "eq=contrast=0.9:brightness=-0.05:saturation=0.8,colorbalance=rs=0.06:gs=0.04:bs=-0.05";
              else if (colorFilter === "tropical") filterString = "eq=contrast=1.1:brightness=0.05:saturation=1.5,hue=h=60";
              if (filterString) {
                filterComplex += `[${lastLabel}]${filterString}[color_bg];`;
                lastLabel = "color_bg";
              }
            }

            // 4. Overlay the Canvas WebM (contains all visual effects + captions)
            // shortest=1 ensures the overlay doesn't extend past the background
            // format=auto is CRITICAL: preserves yuva420p alpha from the WebM overlay
            filterComplex += `[${lastLabel}][1:v]overlay=0:0:shortest=1:format=auto[v]`;

            cmd = [
              `ffmpeg -y`,
              ...inputs,
              `-filter_complex "${filterComplex}"`,
              `-map "[v]"`,
              `-map 2:a`,
              `-c:v libx264`,
              `-pix_fmt yuv420p`,
              `-preset superfast`,
              `-c:a aac -b:a 192k`,
              `-t ${duration}`,
              `"${localOutFile}"`,
            ].join(" ");

            console.log(`[Batch Worker Lyrical] FFmpeg FULL filter_complex:\n${filterComplex}`);
            console.log(`[Batch Worker Lyrical] FFmpeg cmd: ${cmd.substring(0, 500)}...`);

          } else {
            // ═══════════════════════════════════════════════════════════════
            // G2: ASS SUBTITLE FALLBACK (when Canvas overlay hasn't been generated yet)
            // This path uses FFmpeg for ALL effects — less accurate than preview
            // ═══════════════════════════════════════════════════════════════
            console.log(`[Batch Worker Lyrical] Canvas overlay missing. Using ASS subtitle fallback.`);

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
            const strokeWidth = tpl.strokeWidth ?? 3;
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

            const fmtTime = (t: number): string => {
              const h = Math.floor(t / 3600);
              const m = Math.floor((t % 3600) / 60);
              const s = Math.floor(t % 60);
              const cs = Math.round((t % 1) * 100);
              return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
            };

            const glowShadow = strokeWidth === 0 ? 3 : 1;
            const glowBlur = strokeWidth === 0 ? 4 : 2;
            const glowColorBGR = activeColorBGR.replace("&H00", "&H40");

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
                    text += `{\\c${activeColorBGR}\\blur${glowBlur + 1}\\bord${Math.max(strokeWidth, 2)}}${chunk[j].word.toUpperCase()}{\\c&H00FFFFFF&\\blur${glowBlur}\\bord${strokeWidth}}`;
                  } else {
                    text += chunk[j].word.toUpperCase();
                  }
                  if (j < chunk.length - 1) text += " ";
                }
                assLines.push(`Dialogue: 0,${fmtTime(segStart)},${fmtTime(segEnd)},Default,,0,0,0,,{\\blur${glowBlur}}${text}`);
              }
            }

            const assSubtitlePath = `/tmp/lyrical_${item.id}.ass`;
            fs.writeFileSync(assSubtitlePath, assLines.join("\n"), "utf-8");
            console.log(`[Batch Worker Lyrical] Generated ASS subtitle (${chunks.length} chunks, ${words.length} words)`);

            // Build FFmpeg with ALL effects (fallback path)
            const vignette = item.lyricalTemplate?.vignette || "none";
            const particleFx = item.lyricalTemplate?.particleFx || "none";

            // Run effects asset generator
            try {
              const { execSync: execSyncFn } = require("child_process");
              execSyncFn(`./venv/bin/python3 scripts/effects_generator.py`, { timeout: 10000 });
            } catch (e) {
              console.warn("[Batch Worker Lyrical] Self-healing effects builder skipped:", e);
            }

            const inputs: string[] = [];
            inputs.push(`-stream_loop -1 -i "${bgPath}"`);
            let filterComplex = "";
            let lastLabel = "0:v";
            let currentInputIdx = 1;

            filterComplex += `[0:v]scale=720:1280:force_original_aspect_ratio=disable,setsar=1[scaled_bg];`;
            lastLabel = "scaled_bg";

            // Transforms
            const transformFilters: string[] = [];
            if (mirrorBg) transformFilters.push("hflip");
            if (bgSpeed !== 1.0) transformFilters.push(`setpts=${(1.0 / bgSpeed).toFixed(3)}*PTS`);
            if (transformFilters.length > 0) {
              filterComplex += `[${lastLabel}]${transformFilters.join(",")}[transformed_bg];`;
              lastLabel = "transformed_bg";
            }

            // Darkening
            filterComplex += `[${lastLabel}]eq=brightness=-0.25[darkened_bg];`;
            lastLabel = "darkened_bg";

            // Color filter
            if (colorFilter !== "none") {
              let filterString = "";
              if (colorFilter === "cyberpunk") filterString = "eq=contrast=1.2:brightness=-0.05:saturation=1.3,hue=h=320";
              else if (colorFilter === "cinema") filterString = "eq=contrast=1.1:brightness=-0.05:saturation=1.2,colorbalance=rs=0.04:gs=0.02:bs=-0.03:rm=0.03:gm=0.01:bm=-0.02";
              else if (colorFilter === "monochrome") filterString = "eq=contrast=1.3:brightness=-0.1:saturation=0";
              else if (colorFilter === "vhs") filterString = "eq=contrast=1.1:brightness=-0.05:saturation=0.85,noise=alls=8:allf=t+u";
              else if (colorFilter === "emerald") filterString = "eq=contrast=1.15:brightness=-0.1:saturation=0.7,hue=h=80";
              else if (colorFilter === "polaroid") filterString = "eq=contrast=0.95:brightness=0.02:saturation=1.1,colorbalance=rs=0.03:gs=0.02:bs=-0.02";
              else if (colorFilter === "midnight") filterString = "eq=contrast=1.1:brightness=-0.15:saturation=1.15,hue=h=190";
              else if (colorFilter === "golden_hour") filterString = "eq=contrast=1.05:brightness=0.05:saturation=1.3,colorbalance=rs=0.05:gs=0.03:bs=-0.04,hue=h=-10";
              else if (colorFilter === "arctic") filterString = "eq=contrast=1.1:brightness=0.05:saturation=0.6,hue=h=180";
              else if (colorFilter === "neon_noir") filterString = "eq=contrast=1.4:brightness=-0.25:saturation=1.5,hue=h=280";
              else if (colorFilter === "rose_tint") filterString = "eq=contrast=1.05:brightness=0.0:saturation=1.2,hue=h=330,colorbalance=rs=0.04:gs=-0.02:bs=-0.01";
              else if (colorFilter === "vintage_film") filterString = "eq=contrast=0.9:brightness=-0.05:saturation=0.8,colorbalance=rs=0.06:gs=0.04:bs=-0.05";
              else if (colorFilter === "tropical") filterString = "eq=contrast=1.1:brightness=0.05:saturation=1.5,hue=h=60";
              if (filterString) {
                filterComplex += `[${lastLabel}]${filterString}[color_bg];`;
                lastLabel = "color_bg";
              }
            }

            // Vignette
            if (vignette !== "none") {
              const vigPath = path.join(process.cwd(), "public", "uploads", "effects", `${vignette}.png`);
              if (fs.existsSync(vigPath)) {
                const vigIdx = currentInputIdx++;
                inputs.push(`-i "${vigPath}"`);
                filterComplex += `[${lastLabel}][${vigIdx}:v]overlay=0:0[vignetted];`;
                lastLabel = "vignetted";
              }
            }

            // Particles
            if (particleFx !== "none") {
              const pPath = path.join(process.cwd(), "public", "uploads", "effects", particleFx);
              if (fs.existsSync(pPath)) {
                const pIdx = currentInputIdx++;
                inputs.push(`-stream_loop -1 -i "${pPath}"`);
                filterComplex += `[${pIdx}:v]colorkey=color=0x000000:similarity=0.15:blend=0.1[particles_keyed];`;
                filterComplex += `[${lastLabel}][particles_keyed]overlay=0:0:format=auto[layered];`;
                lastLabel = "layered";
              }
            }

            // ASS subtitles
            const audioIdx = currentInputIdx++;
            if (item.muteAudio) {
              inputs.push(`-f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100`);
            } else {
              inputs.push(`-i "${audioPath}"`);
            }
            const escapedAss = assSubtitlePath.replace(/\\/g, "/").replace(/:/g, "\\\\:");
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

            console.log(`[Batch Worker Lyrical] FFmpeg FULL filter_complex:\n${filterComplex}`);
            console.log(`[Batch Worker Lyrical] FFmpeg cmd: ${cmd.substring(0, 500)}...`);
          }

          await new Promise<void>((resolvePromise, rejectPromise) => {
            const { exec: execCmd } = require("child_process");
            execCmd(cmd, { timeout: 180000, maxBuffer: 1024 * 1024 * 10 }, (error: any, _stdout: any, stderr: any) => {
              // Cleanup temp ASS file if it was created (G2 fallback path only)
              try { fs.unlinkSync(`/tmp/lyrical_${item.id}.ass`); } catch {}
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

        try {
          await prisma.genreBatchItem.update({
            where: { id: item.id },
            data: {
              status: "RENDERED",
              renderedVideoUrl: `/uploads/renders/render_${item.id}.mp4`,
            },
          });
        } catch (err: any) {
          if (err?.code === "P2025") {
            console.log(`[Batch Worker] Item ${item.id} not found (likely batch was deleted) when finishing rendering. Aborting loop.`);
            break;
          }
          throw err;
        }

        console.log(`[Batch Worker] Item ${item.id} successfully rendered locally!`);
      } catch (itemErr: any) {
        if (itemErr?.code === "P2025") {
          console.log(`[Batch Worker] Item ${item.id} not found (likely batch was deleted) during error handling. Aborting loop.`);
          break;
        }
        console.error(`[Batch Worker] Error rendering item ${item.id}:`, itemErr);

        // Cleanup temporary render clip on failure
        const localOutFile = path.join(process.cwd(), "public", "uploads", "renders", `render_${item.id}.mp4`);
        if (fs.existsSync(localOutFile)) {
          try { fs.unlinkSync(localOutFile); } catch {}
        }

        try {
          await prisma.genreBatchItem.update({
            where: { id: item.id },
            data: {
              status: "FAILED",
              errorMessage: itemErr.message || String(itemErr),
            },
          });
        } catch (updateErr: any) {
          if (updateErr?.code === "P2025") {
            console.log(`[Batch Worker] Item ${item.id} not found (likely batch was deleted) when marking FAILED. Aborting loop.`);
            break;
          }
          console.error(`[Batch Worker] Failed to update item status to FAILED:`, updateErr);
        }
      }
    }

    // 3. Determine final status of the batch
    let remainingItems;
    try {
      remainingItems = await prisma.genreBatchItem.findMany({
        where: { batchId },
      });
    } catch (err: any) {
      if (err?.code === "P2025") {
        console.log(`[Batch Worker] Items not found for batch ${batchId}. Aborting.`);
        return;
      }
      throw err;
    }

    const failedCount = remainingItems.filter(i => i.status === "FAILED").length;
    const completedCount = remainingItems.filter(i => i.status === "RENDERED" || i.status === "UPLOADED").length;

    let finalStatus: "COMPLETED" | "FAILED" = "COMPLETED";
    if (failedCount > 0 && completedCount === 0) {
      finalStatus = "FAILED";
    }

    try {
      await prisma.genreBatch.update({
        where: { id: batchId },
        data: { status: finalStatus },
      });
    } catch (err: any) {
      if (err?.code === "P2025") {
        console.log(`[Batch Worker] Batch ${batchId} not found (likely deleted) when updating final status.`);
        return;
      }
      throw err;
    }

    console.log(`[Batch Worker] Finished processing batch ${batchId}. Final status: ${finalStatus}`);
  } catch (batchErr: any) {
    if (batchErr?.code === "P2025") {
      console.log(`[Batch Worker] Batch ${batchId} not found (likely deleted) during worker execution.`);
      return;
    }
    console.error(`[Batch Worker] Critical error in batch ${batchId} queue:`, batchErr);
    try {
      await prisma.genreBatch.update({
        where: { id: batchId },
        data: { status: "FAILED" },
      });
    } catch (updateErr: any) {
      if (updateErr?.code === "P2025") {
        console.log(`[Batch Worker] Batch ${batchId} not found when trying to mark FAILED.`);
        return;
      }
      console.error(`[Batch Worker] Failed to mark batch ${batchId} as FAILED:`, updateErr);
    }
  }
}
