export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { resumeSmartExportJob } from "@/lib/services/multiplier-export";

// POST /api/managed/multiplier/smart-export/jobs/[id]/resume
// Requeues the job's failed + stale-uploading assignments as pending and
// retriggers the worker ("Resume remaining"). Per-assignment retry stays at
// /assignments/[id]/retry.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const result = await resumeSmartExportJob(id);
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    if (err?.message === "Smart Export Job not found") {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error("[Smart Export Resume Route] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to resume job" }, { status: 500 });
  }
}
