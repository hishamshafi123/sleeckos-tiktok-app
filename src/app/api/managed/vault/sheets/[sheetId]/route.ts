import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import prisma from "@/lib/db";
import { getFolderPermission, logVaultAction } from "@/lib/services/vault";

export const dynamic = "force-dynamic";

// GET: fetch sheet schemas, columns, rows, and cells
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sheetId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sheetId } = await params;

  try {
    const sheet = await prisma.sheet.findUnique({
      where: { id: sheetId },
      include: {
        folder: {
          select: {
            id: true,
            name: true,
            accessList: true,
          },
        },
        columns: { orderBy: { order: "asc" } },
        rows: {
          orderBy: { order: "asc" },
          include: {
            cells: true,
          },
        },
      },
    });

    if (!sheet) {
      return NextResponse.json({ error: "Sheet not found" }, { status: 404 });
    }

    // Verify folder permissions
    const permission = await getFolderPermission(session.userId, sheet.folderId);
    if (!permission) {
      return NextResponse.json({ error: "Forbidden: No access to folder" }, { status: 403 });
    }

    // Mask secret column cells in the default response JSON
    const sanitizedRows = sheet.rows.map((row) => {
      const sanitizedCells = row.cells.map((cell) => {
        const column = sheet.columns.find((c) => c.id === cell.columnId);
        const isSecret = column?.type === "secret";
        
        return {
          id: cell.id,
          rowId: cell.rowId,
          columnId: cell.columnId,
          value: isSecret && cell.valueEncrypted ? "••••••" : cell.value,
          isSecret,
          hasValue: isSecret ? !!cell.valueEncrypted : !!cell.value,
        };
      });

      return {
        id: row.id,
        order: row.order,
        height: row.height,
        color: row.color,
        cells: sanitizedCells,
      };
    });

    return NextResponse.json({
      id: sheet.id,
      name: sheet.name,
      folderId: sheet.folderId,
      permission,
      folder: sheet.folder,
      columns: sheet.columns,
      rows: sanitizedRows,
      frozenRows: sheet.frozenRows,
      frozenCols: sheet.frozenCols,
      colorRules: sheet.colorRules,
      viewState: sheet.viewState,
    });
  } catch (err: any) {
    console.error("[Vault Sheet GET] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch sheet" }, { status: 500 });
  }
}

// PATCH: update sheet metadata / settings
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
    const sheet = await prisma.sheet.findUnique({
      where: { id: sheetId },
    });
    if (!sheet) {
      return NextResponse.json({ error: "Sheet not found" }, { status: 404 });
    }

    const permission = await getFolderPermission(session.userId, sheet.folderId);
    if (!permission || permission === "view") {
      return NextResponse.json({ error: "Forbidden: edit/manage access required" }, { status: 403 });
    }

    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.frozenRows !== undefined) updateData.frozenRows = body.frozenRows;
    if (body.frozenCols !== undefined) updateData.frozenCols = body.frozenCols;
    if (body.colorRules !== undefined) updateData.colorRules = body.colorRules;
    if (body.viewState !== undefined) updateData.viewState = body.viewState;

    const updated = await prisma.sheet.update({
      where: { id: sheetId },
      data: updateData,
    });

    await logVaultAction(session.userId, "update_sheet_settings", `Sheet: "${updated.name}" (${sheetId})`);
    return NextResponse.json(updated);
  } catch (err: any) {
    console.error("[Vault Sheet PATCH] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to update sheet settings" }, { status: 500 });
  }
}

// DELETE: delete sheet
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
    const sheet = await prisma.sheet.findUnique({
      where: { id: sheetId },
    });
    if (!sheet) {
      return NextResponse.json({ error: "Sheet not found" }, { status: 404 });
    }

    const permission = await getFolderPermission(session.userId, sheet.folderId);
    if (!permission || permission === "view") {
      return NextResponse.json({ error: "Forbidden: edit/manage access required" }, { status: 403 });
    }

    await prisma.sheet.delete({
      where: { id: sheetId },
    });

    await logVaultAction(session.userId, "delete_sheet", `Sheet: "${sheet.name}" (${sheetId})`);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[Vault Sheet DELETE] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to delete sheet" }, { status: 500 });
  }
}
