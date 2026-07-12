import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { addRow, deleteRow, getFolderPermission } from "@/lib/services/vault";
import prisma from "@/lib/db";

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

// PATCH: Update row metadata (height, color, order)
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
    const { rowId } = body;

    if (!rowId) {
      return NextResponse.json({ error: "Missing rowId parameter" }, { status: 400 });
    }

    const sheet = await prisma.sheet.findUnique({ where: { id: sheetId } });
    if (!sheet) {
      return NextResponse.json({ error: "Sheet not found" }, { status: 404 });
    }

    const perm = await getFolderPermission(session.userId, sheet.folderId);
    if (!perm || perm === "view") {
      return NextResponse.json({ error: "Forbidden: edit/manage access required" }, { status: 403 });
    }

    const row = await prisma.sheetRow.findUnique({ where: { id: rowId } });
    if (!row) {
      return NextResponse.json({ error: "Row not found" }, { status: 404 });
    }

    const updateData: any = {};
    if (body.height !== undefined) updateData.height = body.height;
    if (body.color !== undefined) updateData.color = body.color;
    if (body.order !== undefined) updateData.order = body.order;

    const updated = await prisma.sheetRow.update({
      where: { id: rowId },
      data: updateData,
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    console.error("[Vault Row PATCH] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to update row" }, { status: 500 });
  }
}
