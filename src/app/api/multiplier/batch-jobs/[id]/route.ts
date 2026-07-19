export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { getBulkBatch } from "@/lib/services/multiplier";

// GET /api/multiplier/batch-jobs/[id] — poll bulk intake job progress
export async function GET(
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
    const job = await getBulkBatch(id);
    if (!job) {
      return NextResponse.json({ error: "Batch job not found" }, { status: 404 });
    }
    return NextResponse.json(job);
  } catch (err: any) {
    console.error("[Multiplier Batch Job GET API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch batch job" }, { status: 500 });
  }
}
