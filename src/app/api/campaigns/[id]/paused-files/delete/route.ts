export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import prisma from "@/lib/db";
import {
  getPausedFilesDeletionProgress,
  startPausedFilesDeletion,
} from "@/lib/services/campaign-priority";

// POST /api/campaigns/[id]/paused-files/delete — start BACKGROUND removal of
// the Drive files behind the campaign's AVAILABLE jobs (1,000+ files take
// minutes; nginx cuts synchronous requests at 60s). Returns the initial
// progress immediately; poll GET for updates.
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

    const progress = await startPausedFilesDeletion(id);
    return NextResponse.json({ started: true, ...progress });
  } catch (err: any) {
    console.error("[Campaign Paused-Files Delete POST] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to delete paused files" }, { status: 500 });
  }
}

// GET /api/campaigns/[id]/paused-files/delete — poll deletion progress.
export async function GET(
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
  const progress = getPausedFilesDeletionProgress(id);
  return NextResponse.json(progress ?? { status: "idle" });
}
