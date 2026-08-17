export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ForbiddenError, getTrajectory } from "@/lib/services/analytics/account-performance";

// GET /api/admin/account-performance/trajectory — 28d views + projections.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const trajectory = await getTrajectory(session.userId);
    return NextResponse.json(trajectory);
  } catch (err: any) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[AccountPerformance trajectory] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
