export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";

const ACTIVE_STATUSES = ["QUEUED", "RENDERING"];
const SETTLE_WINDOW_MS = 10 * 60 * 1000;

// GET /api/managed/multiplier/status — Lightweight render-poll payload.
// Returns only groups that are active (QUEUED/RENDERING/TRANSCRIBING) or were
// updated in the last 10 minutes (so clients can detect a group that just
// settled), with per-output status. No transcripts, campaign, or legacy data.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const cutoff = new Date(Date.now() - SETTLE_WINDOW_MS);
    const groups = await prisma.multiplierGroup.findMany({
      where: {
        OR: [
          { status: { in: ACTIVE_STATUSES } },
          { transcriptStatus: "TRANSCRIBING" },
          { updatedAt: { gte: cutoff } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        status: true,
        transcriptStatus: true,
        errorMessage: true,
        updatedAt: true,
        outputs: {
          select: {
            id: true,
            variationId: true,
            hookId: true,
            status: true,
            errorMessage: true,
          },
        },
      },
    });

    return NextResponse.json(
      { groups, serverTime: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    console.error("[Multiplier Status GET API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch status" }, { status: 500 });
  }
}
