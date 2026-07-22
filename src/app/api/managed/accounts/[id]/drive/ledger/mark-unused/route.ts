export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import prisma from "@/lib/db";
import { markFileUnused } from "@/lib/services/drive-ledger";

// POST /api/managed/accounts/[id]/drive/ledger/mark-unused  { fileId }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "accounts"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const body = await req.json();
    const fileId = typeof body?.fileId === "string" ? body.fileId : "";
    if (!fileId) {
      return NextResponse.json({ error: "fileId is required" }, { status: 400 });
    }

    // Ensure the ledger row belongs to this account
    const row = await prisma.driveFile.findFirst({ where: { id: fileId, accountId: id } });
    if (!row) {
      return NextResponse.json({ error: "Ledger file not found" }, { status: 404 });
    }

    await markFileUnused(row.id);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[Drive Ledger Mark Unused] Error:", err);
    return NextResponse.json({ error: err?.message || "Failed to mark file unused" }, { status: 500 });
  }
}
