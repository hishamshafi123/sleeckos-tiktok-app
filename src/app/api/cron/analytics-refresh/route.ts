export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { reconcileMissingCaptures, retryUnresolvedCaptures } from "@/lib/services/analytics/capture";
import { runAnalyticsRefresh } from "@/lib/services/analytics/refresh";

function verifyCronSecret(req: NextRequest) {
  const secret =
    req.headers.get("x-cron-secret") ||
    req.nextUrl.searchParams.get("secret");
  return secret === process.env.CRON_SECRET;
}

// Daily Apify analytics pass: retry unresolved link captures (50 accounts),
// reconcile published jobs that have no capture row at all (40 accounts —
// covers captures that died at the provider call before writing a row),
// then refresh stats for due tracked videos (tiered 24h/72h/7d). Runs in the
// background — a crashed pass resumes from its cursor on the next trigger.
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  (async () => {
    try {
      await retryUnresolvedCaptures(50);
      await reconcileMissingCaptures(40);
      await runAnalyticsRefresh({ type: "daily" });
    } catch (err) {
      console.error("[Cron analytics-refresh] Background pass failed:", err);
    }
  })();

  return NextResponse.json({ ok: true, started: true });
}
