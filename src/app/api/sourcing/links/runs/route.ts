export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { getSourcingRuns } from "@/lib/services/sourcing";

// GET /api/sourcing/links/runs?limit= — recent runs with per-status video counts
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "sourcing"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "20", 10) || 20;
  const runs = await getSourcingRuns(limit);
  return NextResponse.json(runs);
}
