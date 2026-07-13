import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { updateCell } from "@/lib/services/vault";

export const dynamic = "force-dynamic";

// PATCH: Update cell contents
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ sheetId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sheetId } = await params;

  try {
    const body = await req.json();
    const { rowId, columnId, value, managedAccountId } = body;
    if (!rowId || !columnId) {
      return NextResponse.json({ error: "Missing rowId or columnId parameters" }, { status: 400 });
    }

    const cell = await updateCell(session.userId, sheetId, rowId, columnId, value === undefined ? null : value, managedAccountId);
    return NextResponse.json(cell);
  } catch (err: any) {
    console.error("[Vault Cell PATCH] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to update cell" }, { status: 500 });
  }
}
