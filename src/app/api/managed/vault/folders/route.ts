import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import prisma from "@/lib/db";
import {
  createFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
  listAccessibleFolders,
  setFolderOwner,
  scaffoldGeneratorFolder,
} from "@/lib/services/vault";

export const dynamic = "force-dynamic";

// GET: list accessible folders
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const folders = await listAccessibleFolders(session.userId);
    return NextResponse.json(folders);
  } catch (err: any) {
    console.error("[Vault Folders GET] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch folders" }, { status: 500 });
  }
}

// POST: create a folder
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { name, parentFolderId } = body;
    if (!name) {
      return NextResponse.json({ error: "Missing folder name" }, { status: 400 });
    }

    const folder = await createFolder(session.userId, name, parentFolderId);

    if (parentFolderId) {
      const parent = await prisma.vaultFolder.findUnique({ where: { id: parentFolderId } });
      if (parent && parent.name === "Acc Generators" && parent.parentFolderId === null) {
        await scaffoldGeneratorFolder(folder.id, session.userId);
      }
    }

    return NextResponse.json(folder);
  } catch (err: any) {
    console.error("[Vault Folders POST] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to create folder" }, { status: 500 });
  }
}

// PATCH: rename, move, or assign owner to a folder
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { folderId, name, parentFolderId, ownerUserId } = body;
    if (!folderId) {
      return NextResponse.json({ error: "Missing folderId" }, { status: 400 });
    }

    let updated;
    if (name !== undefined) {
      updated = await renameFolder(session.userId, folderId, name);
    } else if (parentFolderId !== undefined) {
      updated = await moveFolder(session.userId, folderId, parentFolderId);
    } else if (ownerUserId !== undefined) {
      updated = await setFolderOwner(session.userId, folderId, ownerUserId);
    } else {
      return NextResponse.json({ error: "No update parameters provided" }, { status: 400 });
    }

    return NextResponse.json(updated);
  } catch (err: any) {
    console.error("[Vault Folders PATCH] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to update folder" }, { status: 500 });
  }
}

// DELETE: delete a folder
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const folderId = searchParams.get("folderId");
    if (!folderId) {
      return NextResponse.json({ error: "Missing folderId" }, { status: 400 });
    }

    const folder = await deleteFolder(session.userId, folderId);
    return NextResponse.json(folder);
  } catch (err: any) {
    console.error("[Vault Folders DELETE] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to delete folder" }, { status: 500 });
  }
}
