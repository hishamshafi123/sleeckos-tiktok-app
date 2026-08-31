export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ForbiddenError } from "@/lib/services/analytics/account-performance";
import { getCampaignDayCaptured } from "@/lib/services/analytics/campaign-activity";

// GET /api/campaigns/[id]/tracking/daily-activity/day?date=YYYY-MM-DD
// Captured videos of the campaign whose capturedAt falls inside that org-tz
// day — the "captured" group of a day expansion in the Daily Activity card.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const date = req.nextUrl.searchParams.get("date") ?? "";
    const result = await getCampaignDayCaptured(session.userId, id, date);
    if (!result) return NextResponse.json({ error: "Campaign not found or bad date" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err: any) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[Campaign daily-activity/day] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
