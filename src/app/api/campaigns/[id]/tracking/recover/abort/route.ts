export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { abortRecoveryRun } from "@/lib/services/analytics/recover";

// POST /api/campaigns/[id]/tracking/recover/abort  { runId? }
// Ask a running caption-match recovery to stop. It exits at the next account
// boundary (the in-flight provider call finishes first), keeping links it
// already recovered. Without a runId, aborts the campaign's latest running
// recovery.
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
    const body = await req.json().catch(() => ({}));
    let runId: string | undefined = body?.runId;

    if (!runId) {
      const latest = await prisma.analyticsRun.findFirst({
        where: { type: "recovery", cursor: id, status: "running" },
        orderBy: { startedAt: "desc" },
        select: { id: true },
      });
      if (!latest) {
        return NextResponse.json({ error: "No recovery is running" }, { status: 409 });
      }
      runId = latest.id;
    }

    const aborted = await abortRecoveryRun(runId, id);
    if (!aborted) {
      return NextResponse.json({ error: "Run is not running" }, { status: 409 });
    }
    return NextResponse.json({ aborted: true });
  } catch (error: any) {
    console.error("[Recover abort] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
