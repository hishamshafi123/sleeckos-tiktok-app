export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { getCampaignTrackingVideos } from "@/lib/services/analytics/tracking";

function csvCell(v: string | number | null): string {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// GET /api/campaigns/[id]/tracking/csv — CSV export of the tracked video list.
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
    const videos = await getCampaignTrackingVideos(id);
    const header = [
      "id",
      "tiktokVideoId",
      "url",
      "accountUsername",
      "publishedAt",
      "views",
      "likes",
      "comments",
      "shares",
      "lastRefreshedAt",
      "status",
    ];
    const lines = [header.join(",")];
    for (const v of videos) {
      lines.push(
        [
          v.id,
          v.tiktokVideoId,
          v.url,
          v.accountUsername,
          v.publishedAt,
          v.views,
          v.likes,
          v.comments,
          v.shares,
          v.lastRefreshedAt,
          v.status,
        ]
          .map(csvCell)
          .join(",")
      );
    }

    return new NextResponse(lines.join("\n") + "\n", {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="campaign-${id}-tracking.csv"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
