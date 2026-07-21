export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { retryFailedBulkItems } from "@/lib/services/multiplier";

// POST /api/multiplier/batch-jobs/[id]/retry-failed — re-run failed items
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const result = await retryFailedBulkItems(id);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[Multiplier Batch Job Retry API] Error:", err);
    const status = err?.message === "Batch job not found" ? 404 : 500;
    return NextResponse.json({ error: err.message || "Failed to retry failed items" }, { status });
  }
}
