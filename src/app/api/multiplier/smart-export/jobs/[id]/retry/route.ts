export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { retrySmartExportJob } from "@/lib/services/multiplier-export";

// POST /api/multiplier/smart-export/jobs/[id]/retry
// Requeues the job's failed + stale-uploading assignments as pending, resets
// the job to "pending" (clears failed / paused_quota), and retriggers the
// worker. Used for quota-paused jobs, partial failures, and jobs stuck in
// "pending" from a dead queue.
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
    const result = await retrySmartExportJob(id);
    return NextResponse.json({ success: true, requeued: result.requeued, status: "pending" });
  } catch (err: any) {
    if (err?.message === "Smart Export Job not found") {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err?.message === "Job is currently processing") {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[Smart Export Retry Route] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to retry job" }, { status: 500 });
  }
}
