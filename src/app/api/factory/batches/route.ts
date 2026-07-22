export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { createBatch, listBatches } from "@/lib/services/factory";

/**
 * GET /api/factory/batches — list batches (newest first) with per-status item counts.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "composer"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const batches = await listBatches();
    return NextResponse.json({ batches });
  } catch (err: any) {
    console.error("[Factory Batches GET] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to list batches" }, { status: 500 });
  }
}

/**
 * POST /api/factory/batches — create a DRAFT batch.
 * Body: { name, mode: "lyric"|"quote", mixingEnabled, variationStrength (1-5),
 *         targetDuration, campaignId?, styleIds: string[] }
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "composer"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const batch = await createBatch({
      name: body.name,
      mode: body.mode,
      mixingEnabled: !!body.mixingEnabled,
      variationStrength: Number(body.variationStrength ?? 3),
      targetDuration: Number(body.targetDuration ?? 30),
      campaignId: body.campaignId ?? null,
      styleIds: Array.isArray(body.styleIds) ? body.styleIds : [],
      createdBy: session.userId,
    });
    return NextResponse.json({ batch }, { status: 201 });
  } catch (err: any) {
    console.error("[Factory Batches POST] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to create batch" }, { status: 400 });
  }
}
