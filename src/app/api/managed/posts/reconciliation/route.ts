export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { getReconciliationReport } from "@/lib/services/posting-pipeline";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "post_queue"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const report = await getReconciliationReport();
    return NextResponse.json(report);
  } catch (err: any) {
    console.error("[Reconciliation API] Error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to generate reconciliation report" },
      { status: 500 }
    );
  }
}
