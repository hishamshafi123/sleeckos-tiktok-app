export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ForbiddenError } from "@/lib/services/analytics/account-performance";
import { listCaptureRuns } from "@/lib/services/analytics/campaign-activity";

// GET /api/campaigns/[id]/tracking/capture-runs
// Last ~20 manual capture runs for the campaign, newest first.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const runs = await listCaptureRuns(session.userId, id);
    if (!runs) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    return NextResponse.json({ runs });
  } catch (err: any) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[Campaign capture-runs] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
