import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { addColumn, deleteColumn, getFolderPermission, logVaultAction } from "@/lib/services/vault";
import prisma from "@/lib/db";

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

// PATCH: Update column metadata (rename, resize, reorder, type, hidden, pinned, config)
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
    const { columnId } = body;

    if (!columnId) {
      return NextResponse.json({ error: "Missing columnId parameter" }, { status: 400 });
    }

    const sheet = await prisma.sheet.findUnique({ where: { id: sheetId } });
    if (!sheet) {
      return NextResponse.json({ error: "Sheet not found" }, { status: 404 });
    }

    const perm = await getFolderPermission(session.userId, sheet.folderId);
    if (!perm || perm === "view") {
      return NextResponse.json({ error: "Forbidden: edit/manage access required" }, { status: 403 });
    }

    const col = await prisma.sheetColumn.findUnique({ where: { id: columnId } });
    if (!col) {
      return NextResponse.json({ error: "Column not found" }, { status: 404 });
    }

    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name.trim();
    if (body.width !== undefined) updateData.width = body.width;
    if (body.order !== undefined) updateData.order = body.order;
    if (body.hidden !== undefined) updateData.hidden = body.hidden;
    if (body.pinned !== undefined) updateData.pinned = body.pinned;
    if (body.config !== undefined) updateData.config = body.config;
    if (body.trackConfig !== undefined) updateData.trackConfig = body.trackConfig;

    // Handle column type changes and migrate existing cell values
    if (body.type !== undefined && body.type !== col.type) {
      updateData.type = body.type;
      
      const cells = await prisma.sheetCell.findMany({
        where: { columnId },
      });
      
      const { encrypt, decrypt } = require("@/lib/services/vault");
      
      for (const cell of cells) {
        if (body.type === "secret" && col.type !== "secret") {
          // Encrypt raw value
          if (cell.value) {
            const enc = encrypt(cell.value);
            await prisma.sheetCell.update({
              where: { id: cell.id },
              data: {
                valueEncrypted: enc,
                value: null,
              },
            });
          }
        } else if (body.type !== "secret" && col.type === "secret") {
          // Decrypt secret value
          if (cell.valueEncrypted) {
            try {
              const dec = decrypt(cell.valueEncrypted);
              await prisma.sheetCell.update({
                where: { id: cell.id },
                data: {
                  value: dec,
                  valueEncrypted: null,
                },
              });
            } catch (e) {
              console.warn("Failed to decrypt cell during column type migration:", e);
            }
          }
        }
      }
    }

    const updated = await prisma.sheetColumn.update({
      where: { id: columnId },
      data: updateData,
    });

    await logVaultAction(session.userId, "update_column", `Column: "${updated.name}" (${columnId}) updated on Sheet ${sheetId}`);
    return NextResponse.json(updated);
  } catch (err: any) {
    console.error("[Vault Column PATCH] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to update column" }, { status: 500 });
  }
}
