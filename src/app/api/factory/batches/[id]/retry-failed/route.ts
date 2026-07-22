export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { retryFailedItems } from "@/lib/services/factory";

/**
 * POST /api/factory/batches/[id]/retry-failed — re-queue all FAILED items
 * (the batch itself is reused, never recreated).
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
    const retried = await retryFailedItems(id);
    return NextResponse.json({ retried });
  } catch (err: any) {
    console.error("[Factory Batch Retry-Failed] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to retry items" }, { status: 500 });
  }
}
