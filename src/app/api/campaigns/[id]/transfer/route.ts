export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import {
  previewCampaignTransfer,
  executeCampaignTransfer,
} from "@/lib/services/analytics/transfer";

// GET  /api/campaigns/[id]/transfer?from=YYYY-MM-DD&to=YYYY-MM-DD
//      → preview counts (tracked videos + published posts) in the inclusive
//        IST posted-date range.
// POST /api/campaigns/[id]/transfer  { targetCampaignId, from, to }
//      → move those videos/posts to the target campaign.

async function checkAccess(id: string) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "campaigns"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const campaign = await prisma.campaign.findUnique({ where: { id }, select: { id: true } });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const denied = await checkAccess(id);
  if (denied) return denied;

  const from = req.nextUrl.searchParams.get("from") || "";
  const to = req.nextUrl.searchParams.get("to") || "";
  if (!from || !to) {
    return NextResponse.json({ error: "from and to are required (YYYY-MM-DD)" }, { status: 400 });
  }

  try {
    const preview = await previewCampaignTransfer(id, from, to);
    return NextResponse.json(preview);
  } catch (error: any) {
    console.error("[Transfer GET] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const denied = await checkAccess(id);
  if (denied) return denied;

  try {
    const body = await req.json();
    const { targetCampaignId, from, to } = body || {};
    if (!targetCampaignId || !from || !to) {
      return NextResponse.json(
        { error: "targetCampaignId, from and to are required" },
        { status: 400 }
      );
    }
    const result = await executeCampaignTransfer(id, targetCampaignId, from, to);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[Transfer POST] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
