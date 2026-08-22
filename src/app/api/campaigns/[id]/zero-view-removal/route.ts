export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import {
  previewZeroViewRemoval,
  removeZeroViewVideos,
} from "@/lib/services/analytics/tracking";

// GET  /api/campaigns/[id]/zero-view-removal — preview qualifying rows.
// POST /api/campaigns/[id]/zero-view-removal — set them to status "removed".
// Qualifying = 0 views, posted ≥ ZERO_VIEW_MIN_AGE_DAYS ago, refreshed at
// least once, status captured/dormant. Removed rows drop out of every list,
// total, and refresh path but are kept for history.

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
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const denied = await checkAccess(id);
  if (denied) return denied;

  try {
    const preview = await previewZeroViewRemoval(id);
    return NextResponse.json(preview);
  } catch (error: any) {
    console.error("[ZeroViewRemoval GET] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const denied = await checkAccess(id);
  if (denied) return denied;

  try {
    const result = await removeZeroViewVideos(id);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[ZeroViewRemoval POST] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
