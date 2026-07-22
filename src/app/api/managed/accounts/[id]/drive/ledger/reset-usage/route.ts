export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import prisma from "@/lib/db";
import { resetUsage } from "@/lib/services/drive-ledger";

// POST /api/managed/accounts/[id]/drive/ledger/reset-usage
export async function POST(
  _req: NextRequest,
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
    const account = await prisma.managedAccount.findUnique({ where: { id } });
    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const reset = await resetUsage(id);
    return NextResponse.json({ reset });
  } catch (err: any) {
    console.error("[Drive Ledger Reset] Error:", err);
    return NextResponse.json({ error: err?.message || "Failed to reset usage" }, { status: 500 });
  }
}
