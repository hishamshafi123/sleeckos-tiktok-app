export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { parseDriveFolderId, getFolderMeta } from "@/lib/google";
import prisma from "@/lib/db";

// POST /api/managed/accounts/[id]/link-drive
// Body: { folderUrl: string }  — paste any Google Drive folder URL
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    const meta = await getFolderMeta(folderId);
    folderName = meta.name || "Drive Folder";
  } catch (err) {
    return NextResponse.json(
      {
        error:
          "Could not access this folder. Make sure you shared it with the service account email and the service account has Viewer access.",
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
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  await prisma.managedAccount.update({
    where: { id },
    data: { driveFolderId: null, driveFolderName: null, driveConnected: false },
  });

  return NextResponse.json({ ok: true });
}
