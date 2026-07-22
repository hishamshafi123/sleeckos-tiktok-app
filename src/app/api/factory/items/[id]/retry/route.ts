export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { retryItem } from "@/lib/services/factory";

/**
 * POST /api/factory/items/[id]/retry — re-queue a single FAILED item.
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
    await retryItem(id);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[Factory Item Retry] Error:", err);
    const status = err.message === "Item not found" ? 404 : 400;
    return NextResponse.json({ error: err.message || "Failed to retry item" }, { status });
  }
}
