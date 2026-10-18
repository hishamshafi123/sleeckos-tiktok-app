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
// Manual backfill knobs (cron-secret guarded): ?retryLimit=&accounts=&skipRefresh=1
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

  (async () => {
    try {
      await retryUnresolvedCaptures(retryLimit);
      await reconcileMissingCaptures(accounts);
      if (!skipRefresh) await runAnalyticsRefresh({ type: "daily" });
    } catch (err) {
      console.error("[Cron analytics-refresh] Background pass failed:", err);
    }
  })();

  return NextResponse.json({ ok: true, started: true });
}
