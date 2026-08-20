export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ForbiddenError, getSpotCheckCampaigns } from "@/lib/services/analytics/spot-check";

// GET /api/admin/account-performance/spot-check/campaigns
// Campaign list for the spot-check picker. Lives here (not /api/campaigns) so
// it rides on the "analytics" permission like the rest of this page.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const campaigns = await getSpotCheckCampaigns(session.userId);
    return NextResponse.json({ campaigns });
  } catch (err: any) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[AccountPerformance spot-check campaigns] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
