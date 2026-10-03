export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ForbiddenError } from "@/lib/services/analytics/account-performance";
import { HealthScanError, assignHealthEntries } from "@/lib/services/account-health";
import { TicketError } from "@/lib/services/tickets";

// POST /api/admin/account-performance/health-scan/assign
// { entryIds: string[], assigneeId: string } — marks the entries ASSIGNED and
// creates one replacement ticket for the assignee.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const entryIds = Array.isArray(body?.entryIds)
      ? body.entryIds.filter((x: unknown): x is string => typeof x === "string")
      : [];
    if (entryIds.length === 0 || entryIds.length > 500) {
      return NextResponse.json(
        { error: "entryIds must be a non-empty array of at most 500 ids" },
        { status: 400 }
      );
    }
    if (typeof body?.assigneeId !== "string" || !body.assigneeId) {
      return NextResponse.json({ error: "assigneeId is required" }, { status: 400 });
    }

    const result = await assignHealthEntries(session.userId, entryIds, body.assigneeId);
    return NextResponse.json(result);
  } catch (err: any) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (err instanceof HealthScanError || err instanceof TicketError) {
      return NextResponse.json({ error: err.message }, { status: err.status ?? 400 });
    }
    console.error("[HealthScan assign] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
