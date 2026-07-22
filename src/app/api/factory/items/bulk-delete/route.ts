import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { deleteFactoryItems } from "@/lib/services/factory";

// POST /api/factory/items/bulk-delete
// Body: { itemIds: string[] } — deletes terminal items (COMPLETED/FAILED/CANCELED)
// and their local render files; active items are skipped.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "composer"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { itemIds } = await req.json();
    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return NextResponse.json({ error: "Missing itemIds" }, { status: 400 });
    }

    const result = await deleteFactoryItems(itemIds);
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error("[Factory Items Bulk Delete] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to delete items" }, { status: 500 });
  }
}
