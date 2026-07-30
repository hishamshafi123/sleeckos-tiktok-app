export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { getPostingHistory } from "@/lib/services/posting-history";

/**
 * GET /api/managed/posting-history?from=YYYY-MM-DD&to=YYYY-MM-DD&accountIds=a,b&campaignIds=c,d
 *
 * Spreadsheet-style accounts × campaigns grid of post counts for the range
 * (inclusive, org-timezone day boundaries). Read-only aggregation over PostJob.
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
    const result = await getPostingHistory({
      from,
      to,
      accountIds: accountIds.length ? accountIds : undefined,
      campaignIds: campaignIds.length ? campaignIds : undefined,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    const message = err.message || "Failed to load posting history";
    const status = /YYYY-MM-DD|on or before/.test(message) ? 400 : 500;
    if (status === 500) console.error("[Posting History API] Error:", err);
    return NextResponse.json({ error: message }, { status });
  }
}
