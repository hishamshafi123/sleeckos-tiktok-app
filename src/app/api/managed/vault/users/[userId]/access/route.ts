import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import prisma from "@/lib/db";
import {
  getUserVaultAccess,
  grantFolderAccess,
  revokeFolderAccess,
  getFolderPermission,
} from "@/lib/services/vault";

export const dynamic = "force-dynamic";

// Helper: Authorize access updates on a folder
async function authorizeAccessManagement(sessionUserId: string, folderId: string): Promise<boolean> {
  const caller = await prisma.user.findUnique({
    where: { id: sessionUserId },
    include: { role: true },
  });
  if (!caller || caller.status === "DISABLED") return false;

  // admin or team_lead bypass
  if (caller.role?.key === "admin" || caller.role?.key === "team_lead") {
    return true;
  }

  // folder manage check
  const perm = await getFolderPermission(sessionUserId, folderId);
  return perm === "manage";
}

// GET: list user folder access config
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId } = await params;

  try {
    const accessList = await getUserVaultAccess(userId);
    return NextResponse.json(accessList);
  } catch (err: any) {
    console.error("[User Vault Access GET] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch user vault access" }, { status: 500 });
  }
}

// POST: grant/update folder access for user
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId } = await params;

  try {
    const body = await req.json();
    const { folderId, permission } = body;
    if (!folderId || !permission) {
      return NextResponse.json({ error: "Missing folderId or permission parameters" }, { status: 400 });
    }

    const isAuthorized = await authorizeAccessManagement(session.userId, folderId);
    if (!isAuthorized) {
      return NextResponse.json({ error: "Forbidden: Access management privileges required" }, { status: 403 });
    }

    const access = await grantFolderAccess(
      session.userId,
      folderId,
      { targetUserId: userId },
      permission
    );

    return NextResponse.json(access);
  } catch (err: any) {
    console.error("[User Vault Access POST] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to update access grant" }, { status: 500 });
  }
}

// DELETE: revoke explicit folder access for user
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId } = await params;

  try {
    const { searchParams } = new URL(req.url);
    const folderId = searchParams.get("folderId");
    if (!folderId) {
      return NextResponse.json({ error: "Missing folderId parameters" }, { status: 400 });
    }

    const isAuthorized = await authorizeAccessManagement(session.userId, folderId);
    if (!isAuthorized) {
      return NextResponse.json({ error: "Forbidden: Access management privileges required" }, { status: 403 });
    }

    // Resolve specific user entry
    const access = await prisma.vaultFolderAccess.findFirst({
      where: { folderId, userId },
    });

    if (!access) {
      return NextResponse.json({ error: "No explicit configuration found for this user/folder" }, { status: 404 });
    }

    await revokeFolderAccess(session.userId, folderId, access.id);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[User Vault Access DELETE] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to revoke access grant" }, { status: 500 });
  }
}
