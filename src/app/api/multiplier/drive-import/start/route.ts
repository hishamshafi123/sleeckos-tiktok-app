export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import {
  startDriveImport,
  DriveImportInvalidUrlError,
} from "@/lib/services/multiplier-drive-import";

// POST /api/multiplier/drive-import/start — background-import selected Drive
// videos into a new bulk batch; poll /api/multiplier/drive-import/status.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const files = Array.isArray(body?.files)
    ? body.files.filter(
        (f: any) => f && typeof f.id === "string" && typeof f.name === "string"
      )
    : [];
  if (files.length === 0) {
    return NextResponse.json({ error: "files must be a non-empty array of { id, name }" }, { status: 400 });
  }

  const campaignId = typeof body?.campaignId === "string" && body.campaignId ? body.campaignId : null;
  const styleIds = Array.isArray(body?.styleIds)
    ? body.styleIds.filter((s: any) => typeof s === "string")
    : [];
  const namePrefix = typeof body?.namePrefix === "string" ? body.namePrefix : "";
  const hooksEnabled = typeof body?.hooksEnabled === "boolean" ? body.hooksEnabled : true;
  const hookCount = Number(body?.hookCount);

  try {
    const progress = await startDriveImport({
      files,
      campaignId,
      styleIds,
      namePrefix,
      hooksEnabled,
      hookCount,
      createdBy: session.userId,
    });
    return NextResponse.json({ started: true, batchId: progress.batchId, total: progress.total });
  } catch (err: any) {
    if (err instanceof DriveImportInvalidUrlError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[Multiplier Drive Import Start API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to start Drive import" }, { status: 500 });
  }
}
