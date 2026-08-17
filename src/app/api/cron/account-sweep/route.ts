export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { runDailyAccountSweep } from "@/lib/services/analytics/sweep";
import { rollupYesterday } from "@/lib/services/analytics/account-stats";

function verifyCronSecret(req: NextRequest) {
  const secret =
    req.headers.get("x-cron-secret") ||
    req.nextUrl.searchParams.get("secret");
  return secret === process.env.CRON_SECRET;
}

// Daily per-account sweep: one Apify profile call per active account captures
// links for yesterday's posts and refreshes stats of the latest videos —
// replaces the old one-Apify-call-per-post capture. Runs in the background.
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  (async () => {
    try {
      await runDailyAccountSweep();
    } catch (err) {
      console.error("[Cron account-sweep] Background pass failed:", err);
    }
    // Roll up yesterday's (and today's partial) AccountDailyStat after the
    // sweep — a rollup failure must never break the sweep.
    try {
      await rollupYesterday();
    } catch (err) {
      console.error("[Cron account-sweep] AccountDailyStat rollup failed:", err);
    }
  })();

  return NextResponse.json({ ok: true, started: true });
}
