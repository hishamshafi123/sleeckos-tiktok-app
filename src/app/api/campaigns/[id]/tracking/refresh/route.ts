export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { runAnalyticsRefresh } from "@/lib/services/analytics/refresh";

// POST /api/campaigns/[id]/tracking/refresh — manual "refresh now" for one
// campaign (all captured videos, tiers ignored). Runs in the background.
export async function POST(
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
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    // Create the run row up front so the client gets a runId immediately;
    // the background pass resumes/continues this exact run.
    const run = await prisma.analyticsRun.create({ data: { type: "manual" } });

    (async () => {
      try {
        await runAnalyticsRefresh({ type: "manual", campaignId: id, resumeRunId: run.id });
      } catch (err) {
        console.error(`[Tracking] Manual refresh failed for campaign ${id}:`, err);
      }
    })();

    return NextResponse.json({ started: true, runId: run.id });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
