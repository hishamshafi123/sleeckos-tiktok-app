export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import {
  previewDriveImport,
  DriveImportInvalidUrlError,
  DriveImportFolderNotFoundError,
} from "@/lib/services/multiplier-drive-import";

// POST /api/multiplier/drive-import/preview — list videos in a Drive folder
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
  const folderUrl = typeof body?.folderUrl === "string" ? body.folderUrl.trim() : "";
  if (!folderUrl) {
    return NextResponse.json({ error: "folderUrl is required" }, { status: 400 });
  }

  try {
    const preview = await previewDriveImport(folderUrl);
    return NextResponse.json(preview);
  } catch (err: any) {
    if (err instanceof DriveImportInvalidUrlError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof DriveImportFolderNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error("[Multiplier Drive Import Preview API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to preview Drive folder" }, { status: 500 });
  }
}
