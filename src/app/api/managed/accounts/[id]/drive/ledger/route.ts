export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import prisma from "@/lib/db";
import { getLedgerStats, listLedgerFiles, serializeDriveFile } from "@/lib/services/drive-ledger";

// GET /api/managed/accounts/[id]/drive/ledger?status=unused|used|missing
export async function GET(
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
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || undefined;
  if (status && !["unused", "used", "missing"].includes(status)) {
    return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
  }

  try {
    const account = await prisma.managedAccount.findUnique({ where: { id } });
    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const [stats, files] = await Promise.all([
      getLedgerStats(id),
      listLedgerFiles(id, { status }),
    ]);

    return NextResponse.json({
      stats,
      inputDriveFolderId: account.inputDriveFolderId,
      lastDriveSyncAt: account.lastDriveSyncAt,
      files: files.map(serializeDriveFile),
    });
  } catch (err: any) {
    console.error("[Drive Ledger] Error:", err);
    return NextResponse.json({ error: err?.message || "Failed to load ledger" }, { status: 500 });
  }
}
