export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ForbiddenError, getPerformanceOverview } from "@/lib/services/analytics/account-performance";

// GET /api/admin/account-performance/overview — KPI strip data.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const overview = await getPerformanceOverview(session.userId);
    return NextResponse.json(overview);
  } catch (err: any) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[AccountPerformance overview] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
