export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ForbiddenError } from "@/lib/services/analytics/account-performance";
import { HealthScanError, healthEntryAction } from "@/lib/services/account-health";

// POST /api/admin/account-performance/health-scan/entry-action
// { entryId: string, action: "dismiss" | "reopen" | "mark-replaced" }
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.entryId !== "string" || !body.entryId) {
      return NextResponse.json({ error: "entryId is required" }, { status: 400 });
    }
    if (typeof body?.action !== "string" || !body.action) {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }

    const result = await healthEntryAction(session.userId, body.entryId, body.action);
    return NextResponse.json(result);
  } catch (err: any) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (err instanceof HealthScanError) {
      return NextResponse.json({ error: err.message }, { status: err.status ?? 400 });
    }
    console.error("[HealthScan entry-action] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
