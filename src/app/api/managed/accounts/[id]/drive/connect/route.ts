export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { connectAccountDrives } from "@/lib/services/drive-ledger";

// POST /api/managed/accounts/[id]/drive/connect  { inputFolderId }
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
    const inputFolderId = typeof body?.inputFolderId === "string" ? body.inputFolderId : "";
    if (!inputFolderId.trim()) {
      return NextResponse.json({ error: "inputFolderId is required" }, { status: 400 });
    }

    const result = await connectAccountDrives(id, { inputFolderId });
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[Drive Connect] Error:", err);
    const msg = err?.message || "Failed to connect Drive folder";
    const status = msg === "Account not found" ? 404
      : msg.includes("not a Google Drive folder") || msg.includes("in the trash") || msg.includes("required") ? 400
      : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
