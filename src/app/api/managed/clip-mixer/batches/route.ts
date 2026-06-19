export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import fs from "fs";
import path from "path";
import { uploadToR2 } from "@/lib/services/storage";
import { generateRecipesForBatch, calculateRecipeFingerprint, renderMix } from "@/lib/services/clip-mixer";

// GET /api/managed/clip-mixer/batches — Get batch history or detailed status of a specific batch
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "clip_mixer"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
            select: { templateName: true, aspectRatio: true },
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
                select: { templateName: true, aspectRatio: true },
              },
              folder: {
                select: { name: true },
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
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "clip_mixer"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const {
      folderId,
      folderIds, // array of folder IDs
      trackId,
      lyricalTemplateIds, // array of template IDs
      targetDuration = 15.0,
      muteAudio = false,
      accountCount = 5,
      videosPerAccount = 3,
      trackStart = 0.0,
      variationStrength = 3, // default strength (Phase 4)
    } = body;

    let selectedFolderIds = folderIds;
    if (!selectedFolderIds && folderId) {
      selectedFolderIds = [folderId];
    }

    if (!selectedFolderIds || !Array.isArray(selectedFolderIds) || selectedFolderIds.length === 0) {
      return NextResponse.json({ error: "Missing folderIds or folderId list" }, { status: 400 });
    }

    const numAccounts = Math.max(1, parseInt(accountCount) || 1);
    const vidsPerAccount = Math.max(1, parseInt(videosPerAccount) || 1);

    const folder = await prisma.clipFolder.findUnique({
      where: { id: selectedFolderIds[0] },
      include: { clips: true },
    });

    if (!folder) {
      return NextResponse.json({ error: "Clip folder not found" }, { status: 404 });
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

    const totalVideos = numAccounts * vidsPerAccount;

    // Create batch record in RENDERING status
    const batch = await prisma.clipMixerBatch.create({
      data: {
        folderId: selectedFolderIds[0],
        trackId,
        lyricalTemplateId: lyricalTemplateIds[0], // primary template to satisfy DB constraint
        targetDuration: parseFloat(targetDuration) || 15.0,
        trackStart: parseFloat(trackStart) || 0.0,
        totalVideos,
        muteAudio,
        status: "RENDERING",
        variationStrength: parseInt(variationStrength) || 3,
      },
    });

    // Generate unique recipes and create items
    try {
      const folderUsedFingerprints: Record<string, Set<string>> = {};
      let templateCounter = 0;

      for (let i = 0; i < totalVideos; i++) {
        const virtualAccIdx = Math.floor(i / vidsPerAccount);
        const account = sectionAccounts[virtualAccIdx % sectionAccounts.length];
        const itemTemplateId = lyricalTemplateIds[templateCounter % lyricalTemplateIds.length];
        const itemFolderId = selectedFolderIds[i % selectedFolderIds.length];
        templateCounter++;

        if (!folderUsedFingerprints[itemFolderId]) {
          folderUsedFingerprints[itemFolderId] = new Set<string>();
        }

        // Call generateRecipesForBatch to get ONE unique recipe for this folder, checking against existing fingerprints
        const [recipe] = await generateRecipesForBatch({
          folderId: itemFolderId,
          count: 1,
          targetDuration: parseFloat(targetDuration) || 15.0,
          variationStrength: parseInt(variationStrength) || 3,
          trackId,
          templateId: itemTemplateId,
          trackStart: parseFloat(trackStart) || 0.0,
          muteAudio,
        });

        // Ensure uniqueness across the folder in this batch
        let attempts = 0;
        let finalRecipe = recipe;
        let fingerprint = calculateRecipeFingerprint(finalRecipe);
        
        while (folderUsedFingerprints[itemFolderId].has(fingerprint) && attempts < 100) {
          const [newRecipe] = await generateRecipesForBatch({
            folderId: itemFolderId,
            count: 1,
            targetDuration: parseFloat(targetDuration) || 15.0,
            variationStrength: parseInt(variationStrength) || 3,
            trackId,
            templateId: itemTemplateId,
            trackStart: parseFloat(trackStart) || 0.0,
            muteAudio,
          });
          finalRecipe = newRecipe;
          fingerprint = calculateRecipeFingerprint(finalRecipe);
          attempts++;
        }

        if (attempts >= 100) {
          throw new Error(`Insufficient clips in folder to generate enough unique video variations without duplicates.`);
        }

        folderUsedFingerprints[itemFolderId].add(fingerprint);

        await prisma.clipMixerItem.create({
          data: {
            batchId: batch.id,
            accountId: account.id,
            lyricalTemplateId: itemTemplateId,
            folderId: itemFolderId,
            status: "PENDING",
            recipeJson: JSON.stringify(finalRecipe),
            fingerprint,
          },
        });
      }
    } catch (genErr: any) {
      // Rollback batch creation if generation fails (e.g. folder too small)
      await prisma.clipMixerBatch.delete({ where: { id: batch.id } });
      return NextResponse.json({ error: genErr.message || "Failed to generate unique variations." }, { status: 400 });
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
  } catch (err: any) {
    console.error("[Clip Mixer Batches POST] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to create batch" }, { status: 500 });
  }
}

// DELETE /api/managed/clip-mixer/batches — Delete a batch, its items, and rendered files
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "clip_mixer"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "clip_mixer"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
        items: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!batch) return;

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
        const renderedVideoUrl = await renderMix(item.id);
        
        await prisma.clipMixerItem.update({
          where: { id: item.id },
          data: {
            status: "RENDERED",
            renderedVideoUrl,
            errorMessage: null,
          },
        });
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
