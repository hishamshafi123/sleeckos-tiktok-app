import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { addColumn, deleteColumn } from "@/lib/services/vault";

export const dynamic = "force-dynamic";

// POST: Add column to sheet
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
    const body = await req.json();
    const { name, type } = body;
    if (!name || !type) {
      return NextResponse.json({ error: "Missing name or type parameters" }, { status: 400 });
    }

    const col = await addColumn(session.userId, sheetId, name, type);
    return NextResponse.json(col);
  } catch (err: any) {
    console.error("[Vault Column POST] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to add column" }, { status: 500 });
  }
}

// DELETE: Delete column from sheet
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
    const columnId = searchParams.get("columnId");
    if (!columnId) {
      return NextResponse.json({ error: "Missing columnId parameter" }, { status: 400 });
    }

    const col = await deleteColumn(session.userId, sheetId, columnId);
    return NextResponse.json(col);
  } catch (err: any) {
    console.error("[Vault Column DELETE] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to delete column" }, { status: 500 });
  }
}
