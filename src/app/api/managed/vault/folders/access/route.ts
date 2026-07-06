import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { grantFolderAccess, revokeFolderAccess } from "@/lib/services/vault";

export const dynamic = "force-dynamic";

// POST: grant sharing parameters
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { folderId, userId, roleKey, permission } = body;
    if (!folderId || !permission) {
      return NextResponse.json({ error: "Missing folderId or permission parameters" }, { status: 400 });
    }

    if (!userId && !roleKey) {
      return NextResponse.json({ error: "Must define a userId or roleKey target" }, { status: 400 });
    }

    const access = await grantFolderAccess(
      session.userId,
      folderId,
      { targetUserId: userId, roleKey },
      permission
    );

    return NextResponse.json(access);
  } catch (err: any) {
    console.error("[Vault Folder Access POST] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to grant folder access" }, { status: 500 });
  }
}

// DELETE: revoke sharing rules
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const folderId = searchParams.get("folderId");
    const accessId = searchParams.get("accessId");
    
    if (!folderId || !accessId) {
      return NextResponse.json({ error: "Missing folderId or accessId parameters" }, { status: 400 });
    }

    await revokeFolderAccess(session.userId, folderId, accessId);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[Vault Folder Access DELETE] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to revoke folder access" }, { status: 500 });
  }
}
