export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ForbiddenError } from "@/lib/services/analytics/account-performance";
import { abortCaptureRun } from "@/lib/services/analytics/campaign-activity";

// POST /api/campaigns/[id]/tracking/capture-runs/[runId]/abort
// Ask a running capture run to stop. It exits at the next account boundary
// (the in-flight scrape finishes first), keeping partial results.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, runId } = await params;
  try {
    const aborted = await abortCaptureRun(session.userId, id, runId);
    if (aborted === null) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    if (!aborted) {
      return NextResponse.json({ error: "Run is not running" }, { status: 409 });
    }
    return NextResponse.json({ aborted: true });
  } catch (err: any) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[Campaign capture-runs abort] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
