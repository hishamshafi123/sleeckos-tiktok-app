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

    // Update batch status to RENDERING and clear errorMessage
    await prisma.multiplierBatch.update({
      where: { id: batchId },
      data: { status: "RENDERING", errorMessage: null },
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

        // Look up design template if assigned
        let tmpl: any = null;
        if (item.templateId) {
          tmpl = await prisma.multiplierTemplate.findUnique({ where: { id: item.templateId } });
        }

        const { composeMultiplierVideo } = await import("@/lib/composer");
        const composeOpts = {
          inputVideoPath: sourceVideoPath,
          hookText: item.hookText,
          // Use template styling if available, fallback to batch defaults
          fontFamily: tmpl?.fontFamily || batch.fontFamily,
          fontSize: tmpl?.fontSize ?? batch.fontSize,
          fontColor: tmpl?.fontColor || batch.fontColor,
          textCase: tmpl?.textCase || batch.textCase,
          bgStripColor: tmpl?.bgStripColor || batch.bgStripColor,
          bgStripOpacity: tmpl?.bgStripOpacity ?? batch.bgStripOpacity,
          textPosition: batch.textPosition as "TOP" | "BOTTOM",
          stripPaddingY: tmpl?.paddingY ?? batch.stripPaddingY,
          positionYPercent: tmpl?.positionYPercent ?? batch.positionYPercent,
          marginX: tmpl?.marginX ?? batch.marginX,
          borderRadius: tmpl?.borderRadius ?? batch.borderRadius,
          outputPath,
          // Design template fields
          paddingX: tmpl?.paddingX,
          textAlign: tmpl?.textAlign,
          lineHeight: tmpl?.lineHeight,
          letterSpacing: tmpl?.letterSpacing,
          strokeEnabled: tmpl?.strokeEnabled ?? false,
          strokeColor: tmpl?.strokeColor,
          strokeWidth: tmpl?.strokeWidth,
          shadowEnabled: tmpl?.shadowEnabled ?? false,
          shadowColor: tmpl?.shadowColor,
          shadowX: tmpl?.shadowX,
          shadowY: tmpl?.shadowY,
          glowEnabled: tmpl?.glowEnabled ?? false,
          glowColor: tmpl?.glowColor,
          glowIntensity: tmpl?.glowIntensity,
          stripBorderEnabled: tmpl?.stripBorderEnabled ?? false,
          stripBorderColor: tmpl?.stripBorderColor,
          stripBorderWidth: tmpl?.stripBorderWidth,
          stripShadowEnabled: tmpl?.stripShadowEnabled ?? false,
          stripShadowColor: tmpl?.stripShadowColor,
          stripShadowOffset: tmpl?.stripShadowOffset,
          // Advanced template fields
          stripGradientEnabled: tmpl?.stripGradientEnabled ?? false,
          stripGradientColor2: tmpl?.stripGradientColor2,
          stripGradientAngle: tmpl?.stripGradientAngle,
          stripShape: tmpl?.stripShape || "FULL",
          animationType: tmpl?.animationType || "NONE",
          animationDuration: tmpl?.animationDuration ?? 0.5,
          backdropBlurEnabled: tmpl?.backdropBlurEnabled ?? false,
          backdropBlurRadius: tmpl?.backdropBlurRadius,
          textGradientEnabled: tmpl?.textGradientEnabled ?? false,
          textGradientColor1: tmpl?.textGradientColor1,
          textGradientColor2: tmpl?.textGradientColor2,
          textGradientAngle: tmpl?.textGradientAngle,
          doubleTextEnabled: tmpl?.doubleTextEnabled ?? false,
          doubleTextOutlineColor: tmpl?.doubleTextOutlineColor,
          doubleTextOutlineWidth: tmpl?.doubleTextOutlineWidth,
        };

        try {
          await composeMultiplierVideo(composeOpts);
        } catch (firstErr: any) {
          console.warn(`[Multiplier Worker] First attempt failed for item ${item.id}, retrying with ASCII-only text...`);
          // Clean up failed output before retry
          if (fs.existsSync(outputPath)) {
            try { fs.unlinkSync(outputPath); } catch {}
          }
          // Retry with ultra-aggressive ASCII-only hook text
          const asciiOnlyHook = item.hookText.replace(/[^\x20-\x7E]/g, "").trim();
          await composeMultiplierVideo({ ...composeOpts, hookText: asciiOnlyHook || "Untitled" });
        }

        await prisma.multiplierItem.update({
          where: { id: item.id },
          data: {
            status: "RENDERED",
            renderedVideoUrl: `/uploads/multiplier/renders/multi_${item.id}.mp4`,
          },
        });

        console.log(`[Multiplier Worker] Item ${item.id} rendered successfully`);
      } catch (itemErr: any) {
        const errMsg = (itemErr.message || String(itemErr)).substring(0, 1000);
        console.error(`[Multiplier Worker] Error rendering item ${item.id}:`, errMsg);

        // Clean up failed output
        const outputPath = path.join(rendersDir, `multi_${item.id}.mp4`);
        if (fs.existsSync(outputPath)) {
          try { fs.unlinkSync(outputPath); } catch {}
        }

        await prisma.multiplierItem.update({
          where: { id: item.id },
          data: {
            status: "FAILED",
            errorMessage: errMsg,
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
