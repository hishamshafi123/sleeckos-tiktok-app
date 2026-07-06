import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { exportCsv, importCsv } from "@/lib/services/vault";

export const dynamic = "force-dynamic";

// GET: Export CSV representation of spreadsheet
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sheetId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sheetId } = await params;
  const { searchParams } = new URL(req.url);
  const includeSecrets = searchParams.get("includeSecrets") === "true";

  try {
    const csvContent = await exportCsv(session.userId, sheetId, { includeSecrets });
    
    // Return standard attachment headers for CSV download
    return new Response(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="export_${sheetId}.csv"`,
      },
    });
  } catch (err: any) {
    console.error("[Vault CSV Export GET] Error:", err);
    return NextResponse.json({ error: err.message || "CSV Export failed" }, { status: 500 });
  }
}

// POST: Import CSV lines mapping
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
    const { csvData, columnMapping, mode } = body;
    if (!csvData || !columnMapping || !mode) {
      return NextResponse.json({ error: "Missing csvData, columnMapping, or mode parameters" }, { status: 400 });
    }

    const result = await importCsv(session.userId, sheetId, csvData, columnMapping, mode);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[Vault CSV Import POST] Error:", err);
    return NextResponse.json({ error: err.message || "CSV Import failed" }, { status: 500 });
  }
}
