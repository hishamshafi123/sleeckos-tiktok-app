export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import fs from "fs";
import path from "path";

// GET /api/managed/multiplier/export/debug — Diagnose export failures
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const batchId = searchParams.get("batchId");

  try {
    // If batchId is given, check that specific batch
    if (batchId) {
      const batch = await prisma.multiplierBatch.findUnique({
        where: { id: batchId },
        include: {
          items: {
            where: { status: "RENDERED" },
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!batch) {
        return NextResponse.json({ error: "Batch not found" }, { status: 404 });
      }

      const publicDir = path.join(process.cwd(), "public");
      const itemDiagnostics = batch.items.map((item, i) => {
        const filePath = item.renderedVideoUrl ? path.join(publicDir, item.renderedVideoUrl) : null;
        const fileExists = filePath ? fs.existsSync(filePath) : false;
        const fileSize = fileExists ? fs.statSync(filePath!).size : 0;
        const folderId = item.driveFolderId || batch.driveFolderId;

        return {
          index: i,
          itemId: item.id,
          hookText: item.hookText.substring(0, 50),
          renderedVideoUrl: item.renderedVideoUrl,
          fileExists,
          fileSizeMB: Math.round(fileSize / 1024 / 1024 * 100) / 100,
          driveFolderId: folderId || "NONE",
          itemFolderId: item.driveFolderId || "NONE",
          batchFolderId: batch.driveFolderId || "NONE",
        };
      });

      const issues: string[] = [];
      const missingFiles = itemDiagnostics.filter(d => !d.fileExists);
      const noFolder = itemDiagnostics.filter(d => d.driveFolderId === "NONE");

      if (missingFiles.length > 0) issues.push(`${missingFiles.length} rendered files NOT found on disk`);
      if (noFolder.length > 0) issues.push(`${noFolder.length} items have NO Drive folder assigned`);
      if (!batch.driveFolderId && !batch.items.some(i => i.driveFolderId)) issues.push("Neither batch nor any item has a folder");

      return NextResponse.json({
        batchId: batch.id,
        batchName: batch.name,
        driveExportStatus: batch.driveExportStatus,
        batchFolderId: batch.driveFolderId || "NONE",
        totalRenderedItems: batch.items.length,
        issues,
        items: itemDiagnostics,
      });
    }

    // No batchId — show summary of all failed/stuck batches
    const problemBatches = await prisma.multiplierBatch.findMany({
      where: {
        OR: [
          { driveExportStatus: "FAILED" },
          { driveExportStatus: "EXPORTING" },
        ],
      },
      include: {
        items: {
          where: { status: "RENDERED" },
          select: { id: true, driveFolderId: true, renderedVideoUrl: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const publicDir = path.join(process.cwd(), "public");

    const summary = problemBatches.map(batch => {
      const hasFiles = batch.items.filter(i => {
        if (!i.renderedVideoUrl) return false;
        return fs.existsSync(path.join(publicDir, i.renderedVideoUrl));
      }).length;
      const hasFolders = batch.items.filter(i => i.driveFolderId || batch.driveFolderId).length;

      return {
        batchId: batch.id,
        name: batch.name,
        status: batch.driveExportStatus,
        batchFolderId: batch.driveFolderId || "NONE",
        renderedItems: batch.items.length,
        filesOnDisk: hasFiles,
        withFolders: hasFolders,
        missingFiles: batch.items.length - hasFiles,
        missingFolders: batch.items.length - hasFolders,
      };
    });

    return NextResponse.json({
      totalProblemBatches: problemBatches.length,
      batches: summary,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
