export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ForbiddenError, getSpotCheckHistory } from "@/lib/services/analytics/spot-check";

// GET /api/admin/account-performance/spot-check/history?campaignId=
// Last ~20 spot-check runs, newest first; campaignId filters to runs that
// included that campaign.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const campaignId = req.nextUrl.searchParams.get("campaignId") || undefined;
    const history = await getSpotCheckHistory(session.userId, campaignId);
    return NextResponse.json({ runs: history });
  } catch (err: any) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[AccountPerformance spot-check history] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
