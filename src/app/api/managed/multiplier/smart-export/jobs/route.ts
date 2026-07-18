export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { runSmartExport } from "@/lib/services/multiplier-export";
import prisma from "@/lib/db";

// POST /api/managed/multiplier/smart-export - Starts a new smart export job
// Body: { groupIds: string[], plan: { driveFolderId: string, driveFolderName: string, videoIds: string[] }[] }
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { groupIds, plan } = body;

    if (!groupIds || !Array.isArray(groupIds) || groupIds.length === 0) {
      return NextResponse.json({ error: "Missing selected Group IDs" }, { status: 400 });
    }
    if (!plan || !Array.isArray(plan) || plan.length === 0) {
      return NextResponse.json({ error: "Missing export assignment plan" }, { status: 400 });
    }

    const job = await runSmartExport(session.userId, groupIds, plan);
    return NextResponse.json({ success: true, jobId: job.id });
  } catch (err: any) {
    console.error("[Smart Export Run Route] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to launch smart export" }, { status: 500 });
  }
}

// GET /api/managed/multiplier/smart-export/jobs - Lists past smart export jobs
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const jobs = await prisma.smartExportJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return NextResponse.json({ jobs });
  } catch (err: any) {
    console.error("[Smart Export Jobs Route] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to list jobs" }, { status: 500 });
  }
}
