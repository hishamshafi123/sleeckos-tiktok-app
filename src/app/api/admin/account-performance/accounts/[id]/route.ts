export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ForbiddenError, getAccountDetail } from "@/lib/services/analytics/account-performance";

// GET /api/admin/account-performance/accounts/[id] — drill-down data.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const detail = await getAccountDetail(session.userId, id, 30);
    if (!detail) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (err: any) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[AccountPerformance account detail] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
