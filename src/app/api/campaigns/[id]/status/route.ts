export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import prisma from "@/lib/db";
import { setCampaignStatus } from "@/lib/services/campaign-priority";

// POST /api/campaigns/[id]/status — pause or resume a campaign
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
    const campaign = await prisma.campaign.findUnique({ where: { id }, select: { id: true } });
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const body = await req.json();
    const status = body?.status;
    if (status !== "ACTIVE" && status !== "PAUSED") {
      return NextResponse.json({ error: "status must be \"ACTIVE\" or \"PAUSED\"" }, { status: 400 });
    }

    const updated = await setCampaignStatus(id, status);
    return NextResponse.json({ status: updated.status });
  } catch (err: any) {
    console.error("[Campaign Status POST] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to set status" }, { status: 500 });
  }
}
