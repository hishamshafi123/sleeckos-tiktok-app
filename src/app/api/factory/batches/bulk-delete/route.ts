export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { deleteFactoryBatches } from "@/lib/services/factory";

/**
 * POST /api/factory/batches/bulk-delete — delete batches and their local
 * render files. Body: { batchIds: string[] }. Items are removed by the
 * batch→item cascade; R2 offloads are kept.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "composer"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const deletedBatches = await deleteFactoryBatches(
      Array.isArray(body.batchIds) ? body.batchIds.filter((id: unknown) => typeof id === "string") : []
    );
    return NextResponse.json({ success: true, deletedBatches });
  } catch (err: any) {
    console.error("[Factory Batches Bulk-Delete] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to delete batches" }, { status: 400 });
  }
}
