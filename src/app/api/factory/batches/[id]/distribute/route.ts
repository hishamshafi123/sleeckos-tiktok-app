export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { distributeBatch } from "@/lib/services/factory";

/**
 * POST /api/factory/batches/[id]/distribute — deal the batch's render pool to
 * accounts (fair round-robin, bucketed by style), upload assigned videos to
 * each account's OUTPUT driveFolderId, then record a Delivery per account.
 * Body: { assignments: [{ accountId, videoCount }], allowRedistribute?: boolean }
 */
export async function POST(
  req: NextRequest,
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
    const body = await req.json();
    const result = await distributeBatch(id, {
      assignments: Array.isArray(body.assignments) ? body.assignments : [],
      allowRedistribute: !!body.allowRedistribute,
    });
    return NextResponse.json({ result });
  } catch (err: any) {
    console.error("[Factory Batch Distribute] Error:", err);
    const status = err.message === "Batch not found" ? 404 : 400;
    return NextResponse.json({ error: err.message || "Failed to distribute batch" }, { status });
  }
}
