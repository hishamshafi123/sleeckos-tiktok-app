export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { exportPostingHistoryCsv } from "@/lib/services/posting-history";

/**
 * GET /api/managed/posting-history/csv?from=YYYY-MM-DD&to=YYYY-MM-DD&accountIds=a,b&campaignIds=c,d
 *
 * CSV export of the posting history grid (same data as the JSON route).
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "history"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  const accountIds = (params.get("accountIds") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const campaignIds = (params.get("campaignIds") || "").split(",").map((s) => s.trim()).filter(Boolean);

  try {
    const csv = await exportPostingHistoryCsv({
      from,
      to,
      accountIds: accountIds.length ? accountIds : undefined,
      campaignIds: campaignIds.length ? campaignIds : undefined,
    });
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="posting-history_${from}_to_${to}.csv"`,
      },
    });
  } catch (err: any) {
    const message = err.message || "CSV export failed";
    const status = /YYYY-MM-DD|on or before/.test(message) ? 400 : 500;
    if (status === 500) console.error("[Posting History CSV] Error:", err);
    return NextResponse.json({ error: message }, { status });
  }
}
