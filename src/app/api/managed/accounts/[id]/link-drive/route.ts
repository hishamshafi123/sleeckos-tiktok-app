export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { parseDriveFolderId, getFolderMeta } from "@/lib/google";
import prisma from "@/lib/db";

// POST /api/managed/accounts/[id]/link-drive
// Body: { folderUrl: string }  — paste any Google Drive folder URL
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
  const { folderUrl } = await req.json();

  if (!folderUrl?.trim()) {
    return NextResponse.json(
      { error: "folderUrl is required" },
      { status: 400 }
    );
  }

  // Parse the folder ID from URL or raw ID
  const folderId = parseDriveFolderId(folderUrl.trim());
  if (!folderId) {
    return NextResponse.json(
      {
        error:
          "Could not extract folder ID. Paste the full Drive folder URL or just the folder ID.",
      },
      { status: 400 }
    );
  }

  // Verify we can access it with the service account
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    // If no service account configured yet, just save the folder ID anyway
    const account = await prisma.managedAccount.update({
      where: { id },
      data: {
        driveFolderId: folderId,
        driveFolderName: "Drive Folder",
        driveConnected: true,
      },
    });
    return NextResponse.json({
      ok: true,
      folderId,
      folderName: "Drive Folder",
      warning:
        "GOOGLE_SERVICE_ACCOUNT_JSON not set — folder saved but files cannot be accessed until the service account is configured.",
    });
  }

  let folderName = "Drive Folder";
  try {
    const meta = await getFolderMeta(folderId, id);
    const ownerEmail = (meta as any).owners?.[0]?.emailAddress;
    folderName = ownerEmail ? `${meta.name || "Drive Folder"} (${ownerEmail})` : (meta.name || "Drive Folder");
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error(`[Link Drive] Verification failed for folder ${folderId} on account ${id}:`, err);
    return NextResponse.json(
      {
        error: `Could not access this folder: ${msg}. Make sure the folder exists and is shared/accessible by your Google OAuth account or the Service Account.`,
      },
      { status: 400 }
    );
  }

  const account = await prisma.managedAccount.update({
    where: { id },
    data: {
      driveFolderId: folderId,
      driveFolderName: folderName,
      driveConnected: true,
    },
  });

  return NextResponse.json({ ok: true, folderId, folderName });
}

// DELETE /api/managed/accounts/[id]/link-drive — unlink drive folder
export async function DELETE(
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
  const { searchParams } = new URL(_req.url);
  const disconnectGoogle = searchParams.get("disconnectGoogle") === "true";

  if (disconnectGoogle) {
    await prisma.managedAccount.update({
      where: { id },
      data: {
        driveFolderId: null,
        driveFolderName: null,
        driveConnected: false,
        googleAccessToken: null,
        googleRefreshToken: null,
        googleTokenExpiresAt: null,
      },
    });
  } else {
    // Just unlink the folder, preserve Google OAuth tokens!
    await prisma.managedAccount.update({
      where: { id },
      data: {
        driveFolderId: null,
        driveFolderName: null,
        driveConnected: false,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
