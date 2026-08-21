export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ForbiddenError, getSpotCheckRunStatus } from "@/lib/services/analytics/spot-check";

// GET /api/admin/account-performance/spot-check/[runId] — poll a running (or
// finished) spot-check: run row with live progress counters + the sample
// re-read from TrackedVideo at poll time, so rows show per-video numbers as
// they land. previousRun comparison included.
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { runId } = await params;
  try {
    const status = await getSpotCheckRunStatus(session.userId, runId);
    if (!status) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    return NextResponse.json(status);
  } catch (err: any) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[AccountPerformance spot-check status] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
