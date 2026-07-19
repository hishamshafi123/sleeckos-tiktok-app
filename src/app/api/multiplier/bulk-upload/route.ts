import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { createBulkBatch } from "@/lib/services/multiplier";
import fs from "fs";
import path from "path";
import os from "os";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

// POST /api/multiplier/bulk-upload — upload many videos, one MultiplierGroup per file
// multipart/form-data: files (multiple), campaignId?, styleId?
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const formData = await req.formData();
    const files = formData.getAll("files") as File[];
    const campaignId = (formData.get("campaignId") as string) || null;
    const styleId = (formData.get("styleId") as string) || null;

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
    }

    const tempDir = os.tmpdir();
    const staged: { tempPath: string; fileName: string }[] = [];

    for (const file of files) {
      const tempPath = path.join(tempDir, `bulk_${Date.now()}_${Math.random().toString(36).slice(2)}_${file.name}`);
      const writeStream = fs.createWriteStream(tempPath);
      const readableWebStream = file.stream();
      const nodeReadable = Readable.fromWeb(readableWebStream as any);
      await pipeline(nodeReadable, writeStream);
      staged.push({ tempPath, fileName: file.name });
    }

    const { jobId, groupIds } = await createBulkBatch({
      files: staged,
      campaignId,
      styleId,
      createdBy: session.userId,
    });

    return NextResponse.json({ jobId, groupIds });
  } catch (err: any) {
    console.error("[Multiplier Bulk Upload API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to create bulk batch" }, { status: 500 });
  }
}
