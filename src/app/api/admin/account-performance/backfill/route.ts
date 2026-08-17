export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { backfillAccountDailyStats } from "@/lib/services/analytics/account-stats";

// POST /api/admin/account-performance/backfill — rebuild the full
// AccountDailyStat history from PostJob + VideoStatSnapshot. Admin-only.
// Runs in the background (full history over all accounts can take minutes).
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  (async () => {
    try {
      await backfillAccountDailyStats();
    } catch (err) {
      console.error("[AccountPerformance backfill] Background run failed:", err);
    }
  })();

  return NextResponse.json({ ok: true, started: true });
}
