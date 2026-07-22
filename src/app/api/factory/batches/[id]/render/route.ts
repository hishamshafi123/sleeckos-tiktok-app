export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { startBatchRender } from "@/lib/services/factory";

/**
 * POST /api/factory/batches/[id]/render — plan items, reserve source clips,
 * queue the batch and trigger the background worker.
 * Body: { assignments: [{ accountId, videoCount }], trackIds?: string[],
 *         quotes?: string[], allowReuseWhenExhausted?: boolean }
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
    const result = await startBatchRender(id, {
      assignments: Array.isArray(body.assignments) ? body.assignments : [],
      trackIds: Array.isArray(body.trackIds) ? body.trackIds : undefined,
      quotes: Array.isArray(body.quotes) ? body.quotes : undefined,
      allowReuseWhenExhausted: !!body.allowReuseWhenExhausted,
    });
    return NextResponse.json({ result });
  } catch (err: any) {
    console.error("[Factory Batch Render] Error:", err);
    const status = err.message === "Batch not found" ? 404 : 400;
    return NextResponse.json({ error: err.message || "Failed to start render" }, { status });
  }
}
