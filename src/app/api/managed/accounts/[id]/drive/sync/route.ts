export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { syncDriveFolder } from "@/lib/services/drive-ledger";

// POST /api/managed/accounts/[id]/drive/sync
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
    const result = await syncDriveFolder(id);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[Drive Sync] Error:", err);
    const msg = err?.message || "Failed to sync Drive folder";
    const status = msg === "Account not found" ? 404
      : msg.includes("no input Drive folder") ? 400
      : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
