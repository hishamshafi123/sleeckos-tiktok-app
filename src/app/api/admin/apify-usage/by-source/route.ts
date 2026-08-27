export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ForbiddenError } from "@/lib/services/analytics/account-performance";
import { getApifyUsageBySource } from "@/lib/services/analytics/apify-usage";

// GET /api/admin/apify-usage/by-source?days=30 — per-source cost breakdown.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const days = Number(req.nextUrl.searchParams.get("days")) || 30;
    const result = await getApifyUsageBySource(session.userId, days);
    return NextResponse.json(result);
  } catch (err: any) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[ApifyUsage by-source] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
