export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { getDriveImportProgress } from "@/lib/services/multiplier-drive-import";

// GET /api/multiplier/drive-import/status?batchId=<id> — poll import progress
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const batchId = req.nextUrl.searchParams.get("batchId") || "";
  if (!batchId) {
    return NextResponse.json({ error: "batchId is required" }, { status: 400 });
  }

  const progress = getDriveImportProgress(batchId);
  if (!progress) {
    return NextResponse.json({ error: "Import not found" }, { status: 404 });
  }

  return NextResponse.json({
    status: progress.status,
    batchId: progress.batchId,
    total: progress.total,
    processed: progress.processed,
    downloaded: progress.downloaded,
    failed: progress.failed,
    failures: progress.failures,
  });
}
