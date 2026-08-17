export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  ForbiddenError,
  getAccountPerformance,
  type PerformancePeriod,
} from "@/lib/services/analytics/account-performance";

const PERIODS: PerformancePeriod[] = ["today", "yesterday", "7d", "30d"];

// GET /api/admin/account-performance/accounts?period=7d&campaignId=&flaggedOnly=1&query=
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const periodParam = sp.get("period") ?? "7d";
  const period = (PERIODS as string[]).includes(periodParam)
    ? (periodParam as PerformancePeriod)
    : "7d";

  try {
    const result = await getAccountPerformance(session.userId, {
      period,
      campaignId: sp.get("campaignId") || undefined,
      flaggedOnly: sp.get("flaggedOnly") === "1" || sp.get("flaggedOnly") === "true",
      query: sp.get("query") || undefined,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[AccountPerformance accounts] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
