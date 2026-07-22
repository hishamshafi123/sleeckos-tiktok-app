export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { getFactoryDownloadStatus } from "@/lib/services/factory";

/**
 * Smart Download for a factory batch (multiplier download pattern):
 * GET  /api/factory/batches/[id]/download          — status JSON; starts the
 *        background tar prep when missing/stale, polls while PREPARING.
 * POST /api/factory/batches/[id]/download          — force re-preparation.
 * Completed status carries { downloadUrl, size }.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "composer"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const status = await getFactoryDownloadStatus(id, false);
    return NextResponse.json(status);
  } catch (err: any) {
    console.error("[Factory Batch Download GET] Error:", err);
    const status = err.message === "Batch not found" ? 404 : 400;
    return NextResponse.json({ error: err.message || "Download status failed" }, { status });
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "composer"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const status = await getFactoryDownloadStatus(id, true);
    return NextResponse.json(status);
  } catch (err: any) {
    console.error("[Factory Batch Download POST] Error:", err);
    const status = err.message === "Batch not found" ? 404 : 400;
    return NextResponse.json({ error: err.message || "Download preparation failed" }, { status });
  }
}
