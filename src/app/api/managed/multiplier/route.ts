export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import fs from "fs";
import path from "path";

// GET /api/managed/multiplier — List all multiplier batches
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const batches = await prisma.multiplierBatch.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { items: true } },
        items: {
          select: {
            id: true,
            hookText: true,
            status: true,
            renderedVideoUrl: true,
            errorMessage: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    return NextResponse.json(batches);
  } catch (err) {
    console.error("[Multiplier API] Error fetching batches:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST /api/managed/multiplier — Upload video + CSV, create batch
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await req.formData();

    const videoFile = formData.get("video") as File | null;
    const csvFile = formData.get("csv") as File | null;
    const batchName = (formData.get("name") as string) || "";

    // Styling options
    const fontFamily = (formData.get("fontFamily") as string) || "Outfit-Bold";
    const fontSize = parseInt(formData.get("fontSize") as string) || 42;
    const fontColor = (formData.get("fontColor") as string) || "#FFFFFF";
    const textCase = (formData.get("textCase") as string) || "UPPERCASE";
    const bgStripColor = (formData.get("bgStripColor") as string) || "#000000";
    const bgStripOpacity = parseFloat(formData.get("bgStripOpacity") as string) || 1.0;
    const textPosition = (formData.get("textPosition") as string) || "TOP";
    const stripPaddingY = parseInt(formData.get("stripPaddingY") as string) || 20;
    const positionYPercent = parseInt(formData.get("positionYPercent") as string) || 5;
    const marginX = parseInt(formData.get("marginX") as string) || 0;

    if (!videoFile) {
      return NextResponse.json({ error: "Please upload a video file" }, { status: 400 });
    }
    if (!csvFile) {
      return NextResponse.json({ error: "Please upload a CSV file with text hooks" }, { status: 400 });
    }

    // 1. Save the video file
    const uploadsDir = path.join(process.cwd(), "public", "uploads", "multiplier");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const videoExt = path.extname(videoFile.name) || ".mp4";
    const videoFileName = `source_${Date.now()}${videoExt}`;
    const videoLocalPath = path.join(uploadsDir, videoFileName);
    const videoBuffer = Buffer.from(await videoFile.arrayBuffer());
    fs.writeFileSync(videoLocalPath, videoBuffer);

    const videoUrl = `/uploads/multiplier/${videoFileName}`;

    // 2. Parse the CSV file
    const csvText = await csvFile.text();
    const hooks = parseCSVHooks(csvText);

    if (hooks.length === 0) {
      // Clean up uploaded video
      try { fs.unlinkSync(videoLocalPath); } catch {}
      return NextResponse.json({ error: "No text hooks found in the CSV file. Ensure at least one non-empty row." }, { status: 400 });
    }

    // 3. Create batch + items
    const batch = await prisma.multiplierBatch.create({
      data: {
        name: batchName,
        sourceVideoUrl: videoUrl,
        totalItems: hooks.length,
        status: "READY",
        fontFamily,
        fontSize,
        fontColor,
        textCase,
        bgStripColor,
        bgStripOpacity,
        textPosition,
        stripPaddingY,
        positionYPercent,
        marginX,
        items: {
          create: hooks.map((hook) => ({
            hookText: hook,
            status: "PENDING",
          })),
        },
      },
      include: {
        items: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    console.log(`[Multiplier API] Created batch ${batch.id} with ${hooks.length} items`);
    return NextResponse.json(batch);
  } catch (err) {
    console.error("[Multiplier API] Error creating batch:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// DELETE /api/managed/multiplier?batchId=...
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
    const batch = await prisma.multiplierBatch.findUnique({
      where: { id: batchId },
      include: { items: true },
    });

    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    // Clean up files
    const uploadsDir = path.join(process.cwd(), "public");

    // Delete source video
    const sourcePath = path.join(uploadsDir, batch.sourceVideoUrl);
    if (fs.existsSync(sourcePath)) {
      try { fs.unlinkSync(sourcePath); } catch {}
    }

    // Delete rendered videos
    for (const item of batch.items) {
      if (item.renderedVideoUrl) {
        const renderPath = path.join(uploadsDir, item.renderedVideoUrl);
        if (fs.existsSync(renderPath)) {
          try { fs.unlinkSync(renderPath); } catch {}
        }
      }
    }

    // Delete from DB (cascade deletes items)
    await prisma.multiplierBatch.delete({ where: { id: batchId } });

    console.log(`[Multiplier API] Deleted batch ${batchId}`);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Multiplier API] Error deleting batch:", err);
    return NextResponse.json({ error: "Failed to delete batch" }, { status: 500 });
  }
}

// ─── CSV Parser ──────────────────────────────────────────────────────────────

function parseCSVHooks(csvText: string): string[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  // Detect if first line is a header (common patterns)
  const firstLine = lines[0].toLowerCase();
  const isHeader =
    firstLine === "hook" ||
    firstLine === "text" ||
    firstLine === "hooks" ||
    firstLine === "hook_text" ||
    firstLine === "hooktext" ||
    firstLine === "caption" ||
    firstLine === "title" ||
    firstLine.includes("hook") ||
    firstLine.includes("text");

  const dataLines = isHeader ? lines.slice(1) : lines;

  return dataLines
    .map((line) => {
      // Handle quoted CSV values: "some text, with commas"
      if (line.startsWith('"') && line.endsWith('"')) {
        return line.slice(1, -1).replace(/""/g, '"');
      }
      // If the line has commas, take the first column
      if (line.includes(",")) {
        const first = line.split(",")[0].trim();
        if (first.startsWith('"') && first.endsWith('"')) {
          return first.slice(1, -1).replace(/""/g, '"');
        }
        return first;
      }
      return line;
    })
    .filter((hook) => hook.length > 0);
}
