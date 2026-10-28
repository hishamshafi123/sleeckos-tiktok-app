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

// Scheduled analytics pass: refresh stats for due tracked videos (12-hour
// cadence) before optional capture maintenance, so slow recovery cannot delay
// the refresh. The daily full pass retries unresolved links (50 accounts) and
// reconciles missing rows (40 accounts). Hourly cron uses ?refreshOnly=1 to
// skip capture work. Runs in the background — a crashed refresh resumes from
// its cursor on the next trigger.
// Manual backfill knobs (cron-secret guarded): ?retryLimit=&accounts=&skipRefresh=1&refreshOnly=1
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const clamp = (v: string | null, dflt: number, max: number) =>
    Math.min(max, Math.max(1, parseInt(v || "", 10) || dflt));
  const retryLimit = clamp(sp.get("retryLimit"), 50, 200);
  const accounts = clamp(sp.get("accounts"), 40, 300);
  const skipRefresh = sp.get("skipRefresh") === "1";
  const refreshOnly = sp.get("refreshOnly") === "1";

  (async () => {
    try {
      if (!skipRefresh) await runAnalyticsRefresh({ type: "daily" });
      if (!refreshOnly) {
        await retryUnresolvedCaptures(retryLimit);
        await reconcileMissingCaptures(accounts);
      }
    } catch (err) {
      console.error("[Cron analytics-refresh] Background pass failed:", err);
    }
  })();

  return NextResponse.json({ ok: true, started: true });
}
