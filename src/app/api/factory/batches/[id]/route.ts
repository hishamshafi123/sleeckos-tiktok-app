export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { getBatch } from "@/lib/services/factory";

/**
 * GET /api/factory/batches/[id] — batch detail with items (account/track/style attached).
 */
export async function GET(
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
    const batch = await getBatch(id);
    return NextResponse.json({ batch });
  } catch (err: any) {
    console.error("[Factory Batch GET] Error:", err);
    const status = err.message === "Batch not found" ? 404 : 500;
    return NextResponse.json({ error: err.message || "Failed to load batch" }, { status });
  }
}
