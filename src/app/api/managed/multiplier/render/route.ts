export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import fs from "fs";
import path from "path";

// POST /api/managed/multiplier/render — Start rendering a batch
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { batchId } = await req.json();

    if (!batchId) {
      return NextResponse.json({ error: "Missing batchId" }, { status: 400 });
    }

    const batch = await prisma.multiplierBatch.findUnique({
      where: { id: batchId },
      include: { items: true },
    });

    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    if (batch.status === "RENDERING") {
      return NextResponse.json({ error: "Batch is already rendering" }, { status: 400 });
    }

    // Verify source video exists
    const sourceVideoPath = path.join(process.cwd(), "public", batch.sourceVideoUrl);
    if (!fs.existsSync(sourceVideoPath)) {
      return NextResponse.json({ error: "Source video file not found" }, { status: 400 });
    }

    // Update batch status to RENDERING
    await prisma.multiplierBatch.update({
      where: { id: batchId },
      data: { status: "RENDERING" },
    });

    // Trigger background rendering
    processMultiplierBatch(batchId).catch((err) => {
      console.error(`[Multiplier Render] Background processing failed for batch ${batchId}:`, err);
    });

    return NextResponse.json({ success: true, message: "Rendering started in background" });
  } catch (err) {
    console.error("[Multiplier Render API] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// ─── Background Rendering Loop ───────────────────────────────────────────────

async function processMultiplierBatch(batchId: string) {
  console.log(`[Multiplier Worker] Starting sequential rendering for batch: ${batchId}`);

  try {
    const batch = await prisma.multiplierBatch.findUnique({
      where: { id: batchId },
      include: { items: { orderBy: { createdAt: "asc" } } },
    });

    if (!batch) return;

    const sourceVideoPath = path.join(process.cwd(), "public", batch.sourceVideoUrl);

    // Create renders output directory
    const rendersDir = path.join(process.cwd(), "public", "uploads", "multiplier", "renders");
    if (!fs.existsSync(rendersDir)) {
      fs.mkdirSync(rendersDir, { recursive: true });
    }

    for (const item of batch.items) {
      if (item.status === "RENDERED") continue;

      // Check if batch was cancelled
      const freshBatch = await prisma.multiplierBatch.findUnique({
        where: { id: batchId },
      });
      if (!freshBatch || freshBatch.status === "FAILED") {
        console.log(`[Multiplier Worker] Batch ${batchId} cancelled. Stopping.`);
        break;
      }

      console.log(`[Multiplier Worker] Rendering item ${item.id}: "${item.hookText.substring(0, 50)}..."`);

      try {
        await prisma.multiplierItem.update({
          where: { id: item.id },
          data: { status: "RENDERING" },
        });

        const outputPath = path.join(rendersDir, `multi_${item.id}.mp4`);

        const { composeMultiplierVideo } = await import("@/lib/composer");
        await composeMultiplierVideo({
          inputVideoPath: sourceVideoPath,
          hookText: item.hookText,
          fontFamily: batch.fontFamily,
          fontSize: batch.fontSize,
          fontColor: batch.fontColor,
          textCase: batch.textCase,
          bgStripColor: batch.bgStripColor,
          bgStripOpacity: batch.bgStripOpacity,
          textPosition: batch.textPosition as "TOP" | "BOTTOM",
          stripPaddingY: batch.stripPaddingY,
          positionYPercent: batch.positionYPercent,
          marginX: batch.marginX,
          outputPath,
        });

        await prisma.multiplierItem.update({
          where: { id: item.id },
          data: {
            status: "RENDERED",
            renderedVideoUrl: `/uploads/multiplier/renders/multi_${item.id}.mp4`,
          },
        });

        console.log(`[Multiplier Worker] Item ${item.id} rendered successfully`);
      } catch (itemErr: any) {
        console.error(`[Multiplier Worker] Error rendering item ${item.id}:`, itemErr);

        // Clean up failed output
        const outputPath = path.join(rendersDir, `multi_${item.id}.mp4`);
        if (fs.existsSync(outputPath)) {
          try { fs.unlinkSync(outputPath); } catch {}
        }

        await prisma.multiplierItem.update({
          where: { id: item.id },
          data: {
            status: "FAILED",
            errorMessage: itemErr.message || String(itemErr),
          },
        });
      }
    }

    // Determine final status
    const finalItems = await prisma.multiplierItem.findMany({
      where: { batchId },
    });

    const failedCount = finalItems.filter((i) => i.status === "FAILED").length;
    const completedCount = finalItems.filter((i) => i.status === "RENDERED").length;

    let finalStatus: "COMPLETED" | "FAILED" = "COMPLETED";
    if (failedCount > 0 && completedCount === 0) {
      finalStatus = "FAILED";
    }

    await prisma.multiplierBatch.update({
      where: { id: batchId },
      data: { status: finalStatus },
    });

    console.log(`[Multiplier Worker] Batch ${batchId} finished. Status: ${finalStatus} (${completedCount} rendered, ${failedCount} failed)`);
  } catch (batchErr) {
    console.error(`[Multiplier Worker] Critical error in batch ${batchId}:`, batchErr);
    await prisma.multiplierBatch.update({
      where: { id: batchId },
      data: { status: "FAILED", errorMessage: String(batchErr) },
    });
  }
}
