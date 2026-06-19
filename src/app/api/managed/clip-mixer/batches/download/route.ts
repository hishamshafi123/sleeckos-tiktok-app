export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { exportBatchArchive } from "@/lib/services/clip-mixer";

// POST /api/managed/clip-mixer/batches/download — Creates a folderized smart download archive
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "clip_mixer"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { batchId } = body;

    if (!batchId) {
      return NextResponse.json(
        { error: "Missing required fields: batchId" },
        { status: 400 }
      );
    }

    console.log(`[Clip Mixer Smart Download] Calling service layer for batch=${batchId}`);
    const archiveInfo = await exportBatchArchive(batchId);

    return NextResponse.json({
      status: "COMPLETED",
      downloadUrl: archiveInfo.downloadUrl,
      size: archiveInfo.size,
      message: `${archiveInfo.accountsCount} accounts, ${archiveInfo.totalVideos} videos`,
    });
  } catch (err: any) {
    console.error("[Clip Mixer Smart Download Route] Error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
