export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { getMultiplierDriveClient } from "../drive-helper";
import { naturalCompare } from "@/lib/utils/sorting";
import prisma from "@/lib/db";

// GET /api/managed/multiplier/google/folders?q=search — List/search Drive folders
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const q = req.nextUrl.searchParams.get("q") || "";

  try {
    const drive = await getMultiplierDriveClient();
    if (!drive) {
      return NextResponse.json({ error: "Google Drive not connected. Connect Drive in the Manage section first." }, { status: 400 });
    }

    // Search for folders. Drive's orderBy:"name" is lexicographic ("POL ACC
    // 50" before "POL ACC 7") and Drive returns pages in no guaranteed order,
    // so paginate the ENTIRE match set, natural-sort numerically, then cap —
    // any earlier cutoff would silently drop low-numbered folders (sorting
    // can't bring back folders that were never fetched).
    let queryStr = "mimeType='application/vnd.google-apps.folder' and trashed=false";
    if (q.trim()) {
      queryStr += ` and name contains '${q.replace(/'/g, "\\'")}'`;
    }

    const allFolders: { id: string; name: string }[] = [];
    let pageToken: string | undefined = undefined;
    do {
      const res: any = await drive.files.list({
        q: queryStr,
        fields: "nextPageToken, files(id,name,parents)",
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      if (res.data.files) {
        allFolders.push(...res.data.files.map((f: any) => ({ id: f.id, name: f.name })));
      }
      pageToken = res.data.nextPageToken || undefined;
    } while (pageToken);

    allFolders.sort((a, b) => naturalCompare(a.name || "", b.name || ""));
    const folders = allFolders.slice(0, 50);

    const account = await prisma.managedAccount.findFirst({
      where: { driveConnected: true, googleAccessToken: { not: null } },
      select: { driveFolderName: true, tiktokUsername: true }
    });

    const googleEmail = account?.driveFolderName
      ? account.driveFolderName.replace(/^Sleeckos Videos \(/, "").replace(/\)$/, "")
      : (account?.tiktokUsername ? `@${account.tiktokUsername}` : null);

    return NextResponse.json({ folders, googleEmail });
  } catch (err) {
    console.error("[Multiplier Folders] Error:", err);
    return NextResponse.json({ error: "Failed to list folders" }, { status: 500 });
  }
}
