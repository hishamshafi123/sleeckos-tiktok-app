export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import {
  getPriorityDailyTargetTotal,
  getPriorityOrder,
  setPriorityOrder,
} from "@/lib/services/campaign-priority";

// GET /api/campaigns/priority-order — the standing priority pool, ordered by
// rank, with today's posts and rank-weighted daily share per campaign.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "campaigns"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const [pool, dailyTargetTotal] = await Promise.all([
      getPriorityOrder(),
      getPriorityDailyTargetTotal(),
    ]);
    return NextResponse.json({ pool, dailyTargetTotal });
  } catch (err: any) {
    console.error("[Campaign Priority Order GET] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to load priority order" }, { status: 500 });
  }
}

// POST /api/campaigns/priority-order — replace the pool with the given
// campaign ids in drag order (index 0 → rank 1); unlisted campaigns leave
// the pool.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "campaigns"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const orderedIds = body?.orderedIds;
    if (
      !Array.isArray(orderedIds) ||
      orderedIds.length > 50 ||
      !orderedIds.every((id) => typeof id === "string")
    ) {
      return NextResponse.json(
        { error: "orderedIds must be an array of up to 50 campaign id strings" },
        { status: 400 }
      );
    }

    const pool = await setPriorityOrder(orderedIds);
    return NextResponse.json({ pool });
  } catch (err: any) {
    console.error("[Campaign Priority Order POST] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to save priority order" }, { status: 500 });
  }
}
