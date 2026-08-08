export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import prisma from "@/lib/db";
import { deletePausedCampaignFiles } from "@/lib/services/campaign-priority";

// POST /api/campaigns/[id]/paused-files/delete — remove Drive files behind
// the campaign's AVAILABLE jobs and retire those jobs.
export async function POST(
  _req: NextRequest,
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
    const campaign = await prisma.campaign.findUnique({ where: { id }, select: { id: true } });
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const result = await deletePausedCampaignFiles(id);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[Campaign Paused-Files Delete POST] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to delete paused files" }, { status: 500 });
  }
}
