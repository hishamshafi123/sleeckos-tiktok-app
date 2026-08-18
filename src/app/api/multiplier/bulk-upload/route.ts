import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { createBulkBatch, appendToBulkBatch, finalizeBulkBatch } from "@/lib/services/multiplier";
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
    // Multi-preset selection: JSON array of preset ids ("" = default style).
    // Only meaningful on batch creation; appends read it from the job row.
    let styleIds: string[] = [];
    const styleIdsRaw = formData.get("styleIds") as string;
    if (styleIdsRaw) {
      try {
        const parsed = JSON.parse(styleIdsRaw);
        if (Array.isArray(parsed)) styleIds = parsed.filter((s) => typeof s === "string");
      } catch {}
    }
    // Append mode: add files to an existing batch; finalize starts processing.
    // Clients upload one file per request to stay under proxy body-size limits.
    const existingJobId = (formData.get("jobId") as string) || null;
    const finalize = formData.get("finalize") === "true";
    const namePrefix = (formData.get("namePrefix") as string) || null;

    if ((!files || files.length === 0) && !finalize) {
      return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
    }

    if (finalize && files.length === 0) {
      // Finalize-only request (e.g. the last file's upload failed client-side)
      if (!existingJobId) {
        return NextResponse.json({ error: "jobId is required to finalize" }, { status: 400 });
      }
      await finalizeBulkBatch(existingJobId);
      return NextResponse.json({ jobId: existingJobId, groupIds: [] });
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

    let jobId: string;
    let groupIds: string[];
    if (existingJobId) {
      groupIds = await appendToBulkBatch(existingJobId, staged);
      jobId = existingJobId;
    } else {
      const created = await createBulkBatch({
        files: staged,
        campaignId,
        styleId,
        styleIds,
        namePrefix,
        createdBy: session.userId,
      });
      jobId = created.jobId;
      groupIds = created.groupIds;
    }

    if (finalize) {
      await finalizeBulkBatch(jobId);
    }

    return NextResponse.json({ jobId, groupIds });
  } catch (err: any) {
    console.error("[Multiplier Bulk Upload API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to create bulk batch" }, { status: 500 });
  }
}
