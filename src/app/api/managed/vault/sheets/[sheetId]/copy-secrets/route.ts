import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import prisma from "@/lib/db";
import { getFolderPermission, logVaultAction, decrypt } from "@/lib/services/vault";

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
  const { cellIds } = body;

  if (!cellIds || !Array.isArray(cellIds) || cellIds.length === 0) {
    return NextResponse.json({ error: "Missing or invalid cellIds parameter" }, { status: 400 });
  }

  try {
    const sheet = await prisma.sheet.findUnique({ where: { id: sheetId } });
    if (!sheet) {
      return NextResponse.json({ error: "Sheet not found" }, { status: 404 });
    }

    const perm = await getFolderPermission(session.userId, sheet.folderId);
    if (!perm || perm === "view") {
      return NextResponse.json({ error: "Forbidden: edit/manage access required" }, { status: 403 });
    }

    const cells = await prisma.sheetCell.findMany({
      where: {
        id: { in: cellIds },
        column: { sheetId },
      },
      include: {
        column: true,
      },
    });

    const decryptedCells: Record<string, string | null> = {};
    let secretsCount = 0;

    for (const cell of cells) {
      if (cell.column.type === "secret") {
        if (cell.valueEncrypted) {
          try {
            decryptedCells[cell.id] = decrypt(cell.valueEncrypted);
            secretsCount++;
          } catch (e) {
            decryptedCells[cell.id] = "ERROR_DECRYPTING";
          }
        } else {
          decryptedCells[cell.id] = null;
        }
      } else {
        decryptedCells[cell.id] = cell.value;
      }
    }

    // Log the audited action
    if (secretsCount > 0) {
      await logVaultAction(
        session.userId,
        "copy_with_secrets",
        `Copied ${secretsCount} decrypted secrets from Sheet "${sheet.name}" (${sheetId})`
      );
    }

    return NextResponse.json({ decryptedCells });
  } catch (err: any) {
    console.error("[Vault Copy Secrets POST] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to decrypt clipboard data" }, { status: 500 });
  }
}
