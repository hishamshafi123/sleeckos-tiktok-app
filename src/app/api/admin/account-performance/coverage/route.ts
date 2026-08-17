export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ForbiddenError, getPostingCoverage } from "@/lib/services/analytics/account-performance";

// GET /api/admin/account-performance/coverage — posts-per-day grid + quiet lists.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const coverage = await getPostingCoverage(session.userId, 7);
    return NextResponse.json(coverage);
  } catch (err: any) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[AccountPerformance coverage] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
