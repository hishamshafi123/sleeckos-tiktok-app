export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";

/**
 * Reuses the Google Drive connection from the first connected ManagedAccount
 * instead of maintaining a separate GoogleDriveConnection table.
 * This avoids redirect_uri_mismatch errors since the ManagedAccount OAuth flow
 * uses the already-registered callback URL.
 */
async function getConnectedAccount() {
  return prisma.managedAccount.findFirst({
    where: { driveConnected: true, googleAccessToken: { not: null } },
    select: {
      id: true,
      tiktokUsername: true,
      googleAccessToken: true,
      googleRefreshToken: true,
      googleTokenExpiresAt: true,
      driveFolderId: true,
      driveFolderName: true,
    },
  });
}

// GET /api/managed/multiplier/google/status — Check if ANY ManagedAccount has Drive connected
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const account = await getConnectedAccount();

  if (!account || !account.googleAccessToken) {
    return NextResponse.json({ connected: false });
  }

  // Get email from folder name or username
  const email = account.driveFolderName
    ? account.driveFolderName.replace(/^Sleeckos Videos \(/, "").replace(/\)$/, "")
    : `@${account.tiktokUsername}`;

  return NextResponse.json({
    connected: true,
    email,
  });
}

// DELETE /api/managed/multiplier/google/status — No-op (don't disconnect the ManagedAccount's Drive)
export async function DELETE() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Don't actually disconnect — the ManagedAccount's Drive is shared with posting.
  // Just return success.
  return NextResponse.json({ success: true });
}
