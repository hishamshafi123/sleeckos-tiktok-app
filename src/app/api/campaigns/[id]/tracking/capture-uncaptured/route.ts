export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ForbiddenError } from "@/lib/services/analytics/account-performance";
import { startCaptureRun } from "@/lib/services/analytics/campaign-activity";

// POST /api/campaigns/[id]/tracking/capture-uncaptured
// Body: { date?: "YYYY-MM-DD" } — start a CaptureRun for every uncaptured
// post of the campaign (optionally one org-tz day). Processing runs in the
// background; the client polls GET tracking/capture-runs/[runId] for progress.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const date = typeof body?.date === "string" ? body.date : undefined;
    const run = await startCaptureRun(session.userId, id, { date });
    if (!run) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    return NextResponse.json(run);
  } catch (err: any) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[Campaign capture-uncaptured] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
