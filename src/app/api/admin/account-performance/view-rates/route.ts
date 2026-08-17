export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  ForbiddenError,
  getActiveAccountViewRates,
} from "@/lib/services/analytics/account-performance";

// GET /api/admin/account-performance/view-rates — per-account estimated
// views/day from recent video performance (accounts active in the last 7d).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const rates = await getActiveAccountViewRates(session.userId);
    return NextResponse.json(rates);
  } catch (err: any) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[AccountPerformance view-rates] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
