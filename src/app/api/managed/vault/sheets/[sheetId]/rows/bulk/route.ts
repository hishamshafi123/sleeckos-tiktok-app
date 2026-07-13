import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import prisma from "@/lib/db";
import { getFolderPermission, logVaultAction, encrypt, recordOutcome } from "@/lib/services/vault";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sheetId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sheetId } = await params;
  const body = await req.json();

  try {
    const sheet = await prisma.sheet.findUnique({ where: { id: sheetId } });
    if (!sheet) {
      return NextResponse.json({ error: "Sheet not found" }, { status: 404 });
    }

    const perm = await getFolderPermission(session.userId, sheet.folderId);
    if (!perm || perm === "view") {
      return NextResponse.json({ error: "Forbidden: edit/manage access required" }, { status: 403 });
    }

    // 1. Bulk Delete Rows
    if (body.deleteRowIds && Array.isArray(body.deleteRowIds) && body.deleteRowIds.length > 0) {
      await prisma.sheetRow.deleteMany({
        where: {
          id: { in: body.deleteRowIds },
          sheetId,
        },
      });
      await logVaultAction(session.userId, "bulk_delete_rows", `Deleted ${body.deleteRowIds.length} rows from Sheet ${sheetId}`);
    }

    // 2. Bulk Add Rows
    if (body.addRowsCount && typeof body.addRowsCount === "number" && body.addRowsCount > 0) {
      const maxRowOrder = await prisma.sheetRow.aggregate({
        where: { sheetId },
        _max: { order: true },
      });
      let nextOrder = (maxRowOrder._max.order ?? -1) + 1;

      for (let i = 0; i < body.addRowsCount; i++) {
        await prisma.sheetRow.create({
          data: {
            sheetId,
            order: nextOrder++,
          },
        });
      }
      await logVaultAction(session.userId, "bulk_add_rows", `Added ${body.addRowsCount} rows to Sheet ${sheetId}`);
    }

    // 3. Bulk Edit/Upsert Cells
    if (body.updates && Array.isArray(body.updates) && body.updates.length > 0) {
      // Find all sheet columns first to identify if any cell value needs encryption
      const columns = await prisma.sheetColumn.findMany({
        where: { sheetId },
      });
      for (const update of body.updates) {
        const { rowId, columnId, value, managedAccountId } = update;
        const col = columns.find((c) => c.id === columnId);
        if (!col) continue;

        const isSecret = col.type === "secret";
        const isAccountLink = col.type === "account_link";
        const valEncrypted = isSecret ? encrypt(value || "") : null;
        const valPlain = isSecret ? null : value;

        await prisma.sheetCell.upsert({
          where: {
            rowId_columnId: { rowId, columnId },
          },
          update: {
            value: valPlain,
            valueEncrypted: valEncrypted,
            managedAccountId: isAccountLink ? (managedAccountId || null) : null,
          },
          create: {
            rowId,
            columnId,
            value: valPlain,
            valueEncrypted: valEncrypted,
            managedAccountId: isAccountLink ? (managedAccountId || null) : null,
          },
        });

        await recordOutcome(session.userId, sheetId, rowId, columnId, value);
      }
      await logVaultAction(session.userId, "bulk_edit_cells", `Updated ${body.updates.length} cells in Sheet ${sheetId}`);
    }

    // Fetch updated sheet details
    const updatedSheet = await prisma.sheet.findUnique({
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
            cells: {
              include: {
                managedAccount: {
                  select: {
                    id: true,
                    tiktokUsername: true,
                    tiktokDisplayName: true,
                    tiktokAvatarUrl: true,
                    isActive: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!updatedSheet) {
      return NextResponse.json({ error: "Sheet not found" }, { status: 404 });
    }

    const permission = await getFolderPermission(session.userId, updatedSheet.folderId);
    
    const sanitizedRows = updatedSheet.rows.map((row) => {
      const sanitizedCells = row.cells.map((cell) => {
        const column = updatedSheet.columns.find((c) => c.id === cell.columnId);
        const isSecret = column?.type === "secret";
        const isAccountLink = column?.type === "account_link";
        
        const cellValue = isSecret && cell.valueEncrypted
          ? "••••••"
          : (isAccountLink
              ? (cell.managedAccount ? `@${cell.managedAccount.tiktokUsername}` : "")
              : cell.value);

        return {
          id: cell.id,
          rowId: cell.rowId,
          columnId: cell.columnId,
          value: cellValue,
          isSecret,
          hasValue: isSecret ? !!cell.valueEncrypted : (isAccountLink ? !!cell.managedAccountId : !!cell.value),
          managedAccountId: cell.managedAccountId,
          managedAccount: cell.managedAccount,
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
      id: updatedSheet.id,
      name: updatedSheet.name,
      folderId: updatedSheet.folderId,
      permission,
      folder: updatedSheet.folder,
      columns: updatedSheet.columns,
      rows: sanitizedRows,
      frozenRows: updatedSheet.frozenRows,
      frozenCols: updatedSheet.frozenCols,
      colorRules: updatedSheet.colorRules,
      viewState: updatedSheet.viewState,
    });
  } catch (err: any) {
    console.error("[Vault Bulk POST] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to process bulk actions" }, { status: 500 });
  }
}
