export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getMultiplierDriveClient } from "../drive-helper";

// GET /api/managed/multiplier/google/folders?q=search — List/search Drive folders
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get("q") || "";

  try {
    const drive = await getMultiplierDriveClient();
    if (!drive) {
      return NextResponse.json({ error: "Google Drive not connected. Connect Drive in the Manage section first." }, { status: 400 });
    }

    // Search for folders
    let queryStr = "mimeType='application/vnd.google-apps.folder' and trashed=false";
    if (q.trim()) {
      queryStr += ` and name contains '${q.replace(/'/g, "\\'")}'`;
    }

    const res = await drive.files.list({
      q: queryStr,
      fields: "files(id,name,parents)",
      orderBy: "name",
      pageSize: 50,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const folders = (res.data.files || []).map((f) => ({
      id: f.id,
      name: f.name,
    }));

    return NextResponse.json({ folders });
  } catch (err) {
    console.error("[Multiplier Folders] Error:", err);
    return NextResponse.json({ error: "Failed to list folders" }, { status: 500 });
  }
}
