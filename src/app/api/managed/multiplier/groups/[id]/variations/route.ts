import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { addVariation } from "@/lib/services/multiplier";
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
