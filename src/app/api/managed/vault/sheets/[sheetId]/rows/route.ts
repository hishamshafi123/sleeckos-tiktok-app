import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { addRow, deleteRow } from "@/lib/services/vault";

export const dynamic = "force-dynamic";

// POST: Add row to sheet
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sheetId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sheetId } = await params;

  try {
    const row = await addRow(session.userId, sheetId);
    return NextResponse.json(row);
  } catch (err: any) {
    console.error("[Vault Row POST] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to add row" }, { status: 500 });
  }
}

// DELETE: Delete row from sheet
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ sheetId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sheetId } = await params;

  try {
    const { searchParams } = new URL(req.url);
    const rowId = searchParams.get("rowId");
    if (!rowId) {
      return NextResponse.json({ error: "Missing rowId parameter" }, { status: 400 });
    }

    await deleteRow(session.userId, sheetId, rowId);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[Vault Row DELETE] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to delete row" }, { status: 500 });
  }
}
