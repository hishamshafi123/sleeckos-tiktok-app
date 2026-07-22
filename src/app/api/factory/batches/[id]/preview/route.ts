export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { previewBatch } from "@/lib/services/factory";

/**
 * POST /api/factory/batches/[id]/preview — pre-flight check.
 * Body: { assignments: [{ accountId, videoCount }], trackIds?: string[],
 *         quotes?: string[], allowReuseWhenExhausted?: boolean }
 * Dry-run only: reads the Drive ledger without consuming anything.
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
    const preview = await previewBatch(id, {
      assignments: Array.isArray(body.assignments) ? body.assignments : [],
      trackIds: Array.isArray(body.trackIds) ? body.trackIds : undefined,
      quotes: Array.isArray(body.quotes) ? body.quotes : undefined,
      allowReuseWhenExhausted: !!body.allowReuseWhenExhausted,
    });
    return NextResponse.json({ preview });
  } catch (err: any) {
    console.error("[Factory Batch Preview] Error:", err);
    const status = err.message === "Batch not found" ? 404 : 400;
    return NextResponse.json({ error: err.message || "Preview failed" }, { status });
  }
}
