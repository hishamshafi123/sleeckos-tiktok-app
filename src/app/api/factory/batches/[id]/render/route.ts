export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { startBatchRender } from "@/lib/services/factory";

/**
 * POST /api/factory/batches/[id]/render — plan account-less pool items, reserve
 * source clips from the batch's source folder, queue the batch and trigger the
 * background worker. Renders go to the local/R2 pool — distribution to
 * accounts happens afterwards via /distribute.
 * Body: { totalVideos: number, allowReuseWhenExhausted?: boolean }
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
    const body = await req.json().catch(() => ({}));
    const result = await startBatchRender(id, {
      totalVideos: Number(body.totalVideos),
      allowReuseWhenExhausted: !!body.allowReuseWhenExhausted,
    });
    return NextResponse.json({ result });
  } catch (err: any) {
    console.error("[Factory Batch Render] Error:", err);
    const status = err.message === "Batch not found" ? 404 : 400;
    return NextResponse.json({ error: err.message || "Failed to start render" }, { status });
  }
}
