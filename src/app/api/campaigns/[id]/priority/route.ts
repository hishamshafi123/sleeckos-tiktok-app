export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import prisma from "@/lib/db";
import { setCampaignPriority } from "@/lib/services/campaign-priority";

// POST /api/campaigns/[id]/priority — set or clear the posting priority quota
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
    const quota = body?.quota;
    if (quota !== null && (typeof quota !== "number" || !Number.isFinite(quota) || quota < 0)) {
      return NextResponse.json({ error: "quota must be a non-negative number or null" }, { status: 400 });
    }

    const { priorityQuota, priorityUsed } = await setCampaignPriority(id, quota);
    return NextResponse.json({
      priorityQuota,
      priorityUsed,
      active: priorityQuota !== null && priorityUsed < priorityQuota,
    });
  } catch (err: any) {
    console.error("[Campaign Priority POST] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to set priority" }, { status: 500 });
  }
}
