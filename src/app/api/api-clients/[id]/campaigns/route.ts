export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { grantCampaignAccess, revokeCampaignAccess } from "@/lib/services/api-clients";

// POST /api/api-clients/[id]/campaigns — grant access { campaignId }.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await can(session.userId, "campaigns"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const campaignId = typeof body.campaignId === "string" ? body.campaignId : "";
  if (!campaignId) return NextResponse.json({ error: "campaignId is required" }, { status: 400 });
  await grantCampaignAccess(id, campaignId);
  return NextResponse.json({ ok: true });
}

// DELETE /api/api-clients/[id]/campaigns — revoke access { campaignId }.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await can(session.userId, "campaigns"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const campaignId = typeof body.campaignId === "string" ? body.campaignId : "";
  if (!campaignId) return NextResponse.json({ error: "campaignId is required" }, { status: 400 });
  await revokeCampaignAccess(id, campaignId);
  return NextResponse.json({ ok: true });
}
