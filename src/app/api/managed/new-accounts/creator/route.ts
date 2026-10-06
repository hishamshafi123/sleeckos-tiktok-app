export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { getCreatorDailyBreakdown } from "@/lib/services/new-accounts";

/**
 * GET /api/managed/new-accounts/creator?userId=<id>
 *
 * Drill-down for the "Who's adding accounts" leaderboard: per-day counts and
 * the list of accounts the user added on each day (org timezone). Read-only.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "accounts"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const userId = new URL(req.url).searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  try {
    const result = await getCreatorDailyBreakdown(userId);
    if (!result) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[New Accounts Creator API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to load creator breakdown" }, { status: 500 });
  }
}
