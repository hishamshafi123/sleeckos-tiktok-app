export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ForbiddenError } from "@/lib/services/analytics/account-performance";
import { getRecentApifyCalls } from "@/lib/services/analytics/apify-usage";

// GET /api/admin/apify-usage/recent?limit=50 — newest raw ledger rows.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const limit = Number(req.nextUrl.searchParams.get("limit")) || 50;
    const result = await getRecentApifyCalls(session.userId, limit);
    return NextResponse.json(result);
  } catch (err: any) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[ApifyUsage recent] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
