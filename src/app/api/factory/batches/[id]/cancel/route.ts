export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { cancelFactoryBatch } from "@/lib/services/factory";

/**
 * POST /api/factory/batches/[id]/cancel — cancel a QUEUED/RENDERING batch.
 * PENDING items become CANCELED; an item already mid-render finishes, then the
 * batch settles as FAILED with errorMessage "Canceled by operator".
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "composer"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const canceled = await cancelFactoryBatch(id);
    return NextResponse.json({ success: true, canceled });
  } catch (err: any) {
    console.error("[Factory Batch Cancel] Error:", err);
    const status = err.message === "Batch not found" ? 404 : 400;
    return NextResponse.json({ error: err.message || "Failed to cancel batch" }, { status });
  }
}
