export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";

// POST /api/managed/multiplier/pause — Pause (stop) a rendering batch by setting its status to FAILED
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
    });

    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    if (batch.status !== "RENDERING") {
      return NextResponse.json({ error: "Batch is not currently rendering" }, { status: 400 });
    }

    // Set batch status to FAILED. The sequential background worker checks this
    // before starting each item and will abort when it detects FAILED status.
    const updatedBatch = await prisma.multiplierBatch.update({
      where: { id: batchId },
      data: { 
        status: "FAILED",
        errorMessage: "Paused by administrator"
      },
    });

    console.log(`[Multiplier API] Batch ${batchId} was paused by administrator.`);

    return NextResponse.json({ 
      success: true, 
      message: "Batch paused. Active rendering will stop after the current video finishes.", 
      batch: updatedBatch 
    });
  } catch (err) {
    console.error("[Multiplier Pause API] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
