import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { addVariation } from "@/lib/services/multiplier";
import { getMultiplierDriveClient } from "@/app/api/managed/multiplier/google/drive-helper";
import prisma from "@/lib/db";
import fs from "fs";
import path from "path";
import os from "os";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: groupId } = await params;

  try {
    const group = await prisma.multiplierGroup.findUnique({
      where: { id: groupId },
    });
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    const formData = await req.formData();
    const files = formData.getAll("file") as File[];

    if (files.length === 0) {
      return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
    }

    const added = [];
    const tempDir = os.tmpdir();

    for (const file of files) {
      const tempPath = path.join(tempDir, `upload_${Date.now()}_${file.name}`);
      const writeStream = fs.createWriteStream(tempPath);
      const readableWebStream = file.stream();
      const nodeReadable = Readable.fromWeb(readableWebStream as any);
      await pipeline(nodeReadable, writeStream);

      const variation = await addVariation(groupId, tempPath, file.name);
      added.push(variation);
    }

    return NextResponse.json({ success: true, variations: added });
  } catch (err: any) {
    console.error("[Multiplier Variations POST API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to upload video variations" }, { status: 500 });
  }
}

async function deleteDriveFileForOutput(outputId: string, folderId: string) {
  try {
    const drive = await getMultiplierDriveClient();
    if (!drive) return;
    
    // Search for the file in the folder by its name containing outputId
    const query = `parents in '${folderId}' and name contains '${outputId}' and trashed = false`;
    const res = await drive.files.list({
      q: query,
      fields: "files(id, name)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const files = res.data.files || [];
    for (const file of files) {
      if (!file.id) continue;
      console.log(`[Delete Variation] Deleting Drive file ${file.name} (${file.id})`);
      await (drive.files.delete as any)({
        fileId: file.id,
        supportsAllDrives: true,
      });
    }
  } catch (err: any) {
    console.error(`[Delete Variation] Failed to delete Drive file for output ${outputId}:`, err.message);
  }
}

// DELETE /api/managed/multiplier/groups/[id]/variations — delete variation video
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: groupId } = await params;
  const { searchParams } = new URL(req.url);
  const variationId = searchParams.get("variationId");

  if (!variationId) {
    return NextResponse.json({ error: "Missing variationId" }, { status: 400 });
  }

  try {
    const group = await prisma.multiplierGroup.findUnique({
      where: { id: groupId },
    });
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    const variation = await prisma.multiplierGroupVariation.findUnique({
      where: { id: variationId },
    });
    if (!variation) {
      return NextResponse.json({ error: "Variation not found" }, { status: 404 });
    }

    // 1. Fetch outputs and clean up files consistently
    const outputs = await prisma.multiplierOutput.findMany({
      where: { variationId },
      select: { id: true, outputRef: true, driveFolderId: true, exportDestinationFolderId: true }
    });

    for (const output of outputs) {
      // Delete local output file
      if (output.outputRef) {
        const localPath = path.join(process.cwd(), "public", output.outputRef);
        if (fs.existsSync(localPath)) {
          try {
            fs.unlinkSync(localPath);
          } catch (err: any) {
            console.error(`[Delete Variation] Failed to delete output file ${localPath}:`, err.message);
          }
        }
      }

      // Delete Google Drive file
      const folderId = output.exportDestinationFolderId || output.driveFolderId;
      if (folderId) {
        await deleteDriveFileForOutput(output.id, folderId);
      }
    }

    // 2. Delete variation original video file
    if (variation.videoRef) {
      const varPath = path.join(process.cwd(), "public", variation.videoRef);
      if (fs.existsSync(varPath)) {
        try {
          fs.unlinkSync(varPath);
        } catch (err: any) {
          console.error(`[Delete Variation] Failed to delete variation file ${varPath}:`, err.message);
        }
      }
    }

    // 3. Delete from DB (onDelete Cascade deletes related MultiplierOutput & SmartExportAssignment records)
    await prisma.multiplierGroupVariation.delete({
      where: { id: variationId },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[Multiplier Variations DELETE API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to delete video variation" }, { status: 500 });
  }
}
