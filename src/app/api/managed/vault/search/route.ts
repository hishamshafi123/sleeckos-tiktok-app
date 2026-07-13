import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import prisma from "@/lib/db";
import { getFolderPermission } from "@/lib/services/vault";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q")?.trim() || "";

  if (!query) {
    return NextResponse.json({ results: [] });
  }

  try {
    // 1. Fetch all sheets with folder context
    const sheets = await prisma.sheet.findMany({
      include: {
        folder: true,
      },
    });

    // 2. Filter sheets based on folder ACL permissions
    const accessibleSheetsMap = new Map<string, typeof sheets[0]>();
    for (const sheet of sheets) {
      const permission = await getFolderPermission(session.userId, sheet.folderId);
      if (permission) {
        accessibleSheetsMap.set(sheet.id, sheet);
      }
    }

    const accessibleSheetIds = Array.from(accessibleSheetsMap.keys());
    if (accessibleSheetIds.length === 0) {
      return NextResponse.json({ results: [] });
    }

    const results: any[] = [];
    const queryLower = query.toLowerCase();

    // 3. Match sheet names
    for (const sheet of Array.from(accessibleSheetsMap.values())) {
      if (sheet.name.toLowerCase().includes(queryLower)) {
        results.push({
          type: "sheet",
          sheetId: sheet.id,
          sheetName: sheet.name,
          folderName: sheet.folder.name,
          matchType: "Sheet Title",
          snippet: `Sheet named "${sheet.name}"`,
        });
      }
    }

    // 4. Match column headers
    const matchingColumns = await prisma.sheetColumn.findMany({
      where: {
        sheetId: { in: accessibleSheetIds },
        name: { contains: query, mode: "insensitive" },
      },
    });

    for (const col of matchingColumns) {
      const sheet = accessibleSheetsMap.get(col.sheetId);
      if (sheet) {
        results.push({
          type: "column",
          sheetId: sheet.id,
          sheetName: sheet.name,
          folderName: sheet.folder.name,
          matchType: "Column Header",
          snippet: `Column header "${col.name}"`,
        });
      }
    }

    // Find column options that match the query
    const columnsWithMatchingTags = await prisma.sheetColumn.findMany({
      where: {
        sheetId: { in: accessibleSheetIds },
        type: "tags",
      },
    });

    const matchingTagColumnIds: string[] = [];
    for (const col of columnsWithMatchingTags) {
      const config = col.config as any;
      const matchingOptions = config?.options?.filter((opt: any) =>
        opt.label.toLowerCase().includes(queryLower)
      );
      if (matchingOptions && matchingOptions.length > 0) {
        matchingTagColumnIds.push(col.id);
      }
    }

    // 5. Match non-secret cell values (including tags and account links)
    const matchingCells = await prisma.sheetCell.findMany({
      where: {
        column: {
          sheetId: { in: accessibleSheetIds },
          type: { not: "secret" },
        },
        OR: [
          { value: { contains: query, mode: "insensitive" } },
          { columnId: { in: matchingTagColumnIds } },
          {
            managedAccount: {
              OR: [
                { tiktokUsername: { contains: query, mode: "insensitive" } },
                { tiktokDisplayName: { contains: query, mode: "insensitive" } },
              ],
            },
          },
        ],
      },
      include: {
        row: true,
        column: true,
        managedAccount: true,
      },
    });

    for (const cell of matchingCells) {
      const sheet = accessibleSheetsMap.get(cell.column.sheetId);
      if (sheet) {
        let displayVal = cell.value || "";
        if (cell.column.type === "account_link" && cell.managedAccount) {
          displayVal = `@${cell.managedAccount.tiktokUsername}`;
        } else if (cell.column.type === "tags" && cell.value) {
          const config = cell.column.config as any;
          const selectedIds = cell.value.split(",").map((s) => s.trim()).filter(Boolean);
          const labels = selectedIds
            .map((id) => config?.options?.find((opt: any) => opt.id === id)?.label)
            .filter(Boolean);
          displayVal = labels.join(", ");

          // Validate that it actually has the matched tag
          const hasMatchingTag = selectedIds.some((id) => {
            const label = config?.options?.find((opt: any) => opt.id === id)?.label || "";
            return label.toLowerCase().includes(queryLower);
          });
          if (!hasMatchingTag && !displayVal.toLowerCase().includes(queryLower)) {
            continue;
          }
        }

        results.push({
          type: "cell",
          sheetId: sheet.id,
          sheetName: sheet.name,
          folderName: sheet.folder.name,
          matchType: "Cell Value",
          snippet: `Row #${cell.row.order + 1}, Column "${cell.column.name}": "${displayVal}"`,
          rowId: cell.rowId,
          columnId: cell.columnId,
        });
      }
    }

    return NextResponse.json({ results });
  } catch (err: any) {
    console.error("[Vault Search GET] Error:", err);
    return NextResponse.json({ error: err.message || "Search failed" }, { status: 500 });
  }
}
