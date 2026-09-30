export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { getCampaignTrackingVideosPage } from "@/lib/services/analytics/tracking";

// GET /api/campaigns/[id]/tracking/videos?page=1&pageSize=50&sort=views&dir=desc&q=account
// Paginated tracked-video list for the tracking table. Sorting and account
// search run in SQL so large campaigns (20k+ rows) stay fast.
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
  const sp = req.nextUrl.searchParams;
  try {
    const result = await getCampaignTrackingVideosPage(id, {
      page: Number(sp.get("page")) || 1,
      pageSize: Number(sp.get("pageSize")) || 50,
      sort: sp.get("sort") || "date",
      dir: sp.get("dir") || "desc",
      q: sp.get("q") || "",
    });
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
