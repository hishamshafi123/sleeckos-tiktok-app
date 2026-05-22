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
    // ACTION 1: GENERATE_QUOTES
    // ─────────────────────────────────────────────────────────────────────────
    if (action === "GENERATE_QUOTES") {
      const { accountIds, postsPerAccount, videoLength = 7.0 } = body;

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

      // Generate quotes for each account
      for (const accountId of accountIds) {
        const account = await prisma.managedAccount.findUnique({
          where: { id: accountId },
          include: {
            genreConfigs: { where: { genre: "quote" } },
            backgroundVideos: { where: { genre: "quote" } },
          },
        });

        if (!account) continue;

        // Ensure account has styling/theme configured
        const config = account.genreConfigs[0];
        if (!config || !config.themeText) {
          console.warn(`[Batches API] Account ${account.tiktokUsername} lacks a quote theme configuration`);
          continue;
        }

        // Get account backgrounds loop pool
        const bgs = account.backgroundVideos;
        if (bgs.length === 0) {
          console.warn(`[Batches API] Account ${account.tiktokUsername} has no uploaded background loops`);
          continue;
        }

        // Fetch duplicate check seed (all previous quotes generated for this account)
        const previousItems = await prisma.genreBatchItem.findMany({
          where: { accountId },
          select: { quoteText: true },
        });
        const existingQuotes = previousItems.map(item => item.quoteText);

        // Call Gemini generator
        const quotes = await generateQuotesForTheme(config.themeText, postsPerAccount, existingQuotes);

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
      const { batchId, trackIds, audioReuseMax = 2 } = body;

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
          const matchedTrack = tracks.find(t => t.id === alloc.trackId)!;

          await prisma.genreBatchItem.update({
            where: { id: item.id },
            data: {
              trackId: alloc.trackId,
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

      // Update all items that are not completed (i.e. not UPLOADED) to FAILED
      await prisma.genreBatchItem.updateMany({
        where: {
          batchId,
          status: { not: "UPLOADED" },
        },
        data: {
          status: "FAILED",
          errorMessage: "Cancelled by user",
        },
      });

      console.log(`[Batches API] Batch ${batchId} cancelled by user`);
      return NextResponse.json({ success: true, message: "Batch processing cancelled" });
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

    // 2. Loop sequentially through each pending item to composer & upload
    for (const item of batch.items) {
      if (item.status === "UPLOADED") continue;

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

        // Generate dynamic local output destination in temp_renders
        const tempRendersDir = path.join(process.cwd(), "temp_renders");
        if (!fs.existsSync(tempRendersDir)) {
          fs.mkdirSync(tempRendersDir, { recursive: true });
        }
        const tempOutFile = path.join(tempRendersDir, `render_${item.id}.mp4`);

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
          outputPath: tempOutFile,
          curveText: styleConfig.curveText,
          curvature: styleConfig.curvature,
          positionY: styleConfig.positionY,
        });

        // 3. Deliver to Google Drive folder
        if (!item.account.driveFolderId) {
          throw new Error("Google Drive folder is not linked for this account");
        }

        console.log(`[Batch Worker] Uploading composited clip to Google Drive folder: ${item.account.driveFolderId}`);
        const fileBuffer = fs.readFileSync(tempOutFile);

        const dateStr = new Date().toISOString().slice(0, 10);
        const randStr = Math.random().toString(36).substring(2, 6);
        const driveFileName = `quote_${dateStr}_${randStr}.mp4`;

        const { uploadFileToFolder } = await import("@/lib/google");
        const driveFileId = await uploadFileToFolder(
          item.account.driveFolderId,
          driveFileName,
          fileBuffer,
          "video/mp4"
        );

        // 4. Delete the local temporary output file IMMEDIATELY to prevent disk overflow
        try {
          if (fs.existsSync(tempOutFile)) {
            fs.unlinkSync(tempOutFile);
            console.log(`[Batch Worker] Successfully deleted local temp render: ${tempOutFile}`);
          }
        } catch (cleanErr) {
          console.warn(`[Batch Worker] Clean up local temp file warning: ${tempOutFile}`, cleanErr);
        }

        // Update DB item record
        await prisma.genreBatchItem.update({
          where: { id: item.id },
          data: {
            status: "UPLOADED",
            renderedVideoUrl: `/uploads/renders/${driveFileName}`, // UI reference
            driveFileId,
          },
        });

        console.log(`[Batch Worker] Item ${item.id} fully finished & delivered to Drive!`);
      } catch (itemErr: any) {
        console.error(`[Batch Worker] Error rendering item ${item.id}:`, itemErr);

        // Cleanup temporary render clip on failure
        const tempOutFile = path.join(process.cwd(), "temp_renders", `render_${item.id}.mp4`);
        if (fs.existsSync(tempOutFile)) {
          try { fs.unlinkSync(tempOutFile); } catch {}
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
    const completedCount = remainingItems.filter(i => i.status === "UPLOADED").length;

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
