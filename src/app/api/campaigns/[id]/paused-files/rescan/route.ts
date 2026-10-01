export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import prisma from "@/lib/db";
import {
  getPausedFilesRescanProgress,
  startPausedFilesRescan,
} from "@/lib/services/campaign-priority";

// POST /api/campaigns/[id]/paused-files/rescan — background rescan that
// resurrects paused-removal jobs whose Drive file still exists (happens when
// a deletion ran while Drive credentials were broken: jobs were retired but
// the files were never actually removed). Poll GET for progress.
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

    const progress = await startPausedFilesRescan(id);
    return NextResponse.json({ started: true, ...progress });
  } catch (err: any) {
    console.error("[Campaign Paused-Files Rescan POST] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to start rescan" }, { status: 500 });
  }
}

// GET /api/campaigns/[id]/paused-files/rescan — poll rescan progress.
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
  const progress = getPausedFilesRescanProgress(id);
  return NextResponse.json(progress ?? { status: "idle" });
}
