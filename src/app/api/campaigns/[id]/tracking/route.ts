export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { getCampaignTracking } from "@/lib/services/analytics/tracking";

// GET /api/campaigns/[id]/tracking — campaign link-capture analytics payload
// (public UI contract — keep the response shape stable).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "campaigns"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  try {
    const tracking = await getCampaignTracking(id);
    if (!tracking) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    return NextResponse.json(tracking);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
