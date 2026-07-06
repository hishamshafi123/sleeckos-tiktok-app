import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { revealCell } from "@/lib/services/vault";

export const dynamic = "force-dynamic";

// POST: Decrypt cell value on-demand (and write to audit log)
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
    const { cellId } = body;
    if (!cellId) {
      return NextResponse.json({ error: "Missing cellId parameter" }, { status: 400 });
    }

    const decryptedValue = await revealCell(session.userId, sheetId, cellId);
    return NextResponse.json({ value: decryptedValue });
  } catch (err: any) {
    console.error("[Vault Cell Reveal POST] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to reveal cell" }, { status: 500 });
  }
}
