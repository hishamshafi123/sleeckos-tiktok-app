export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { google } from "googleapis";

// GET /api/managed/multiplier/google/folders?q=search — List/search Drive folders
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get("q") || "";

  try {
    const conn = await prisma.googleDriveConnection.findFirst({
      where: { purpose: "multiplier" },
    });

    if (!conn || !conn.googleAccessToken) {
      return NextResponse.json({ error: "Google Drive not connected" }, { status: 400 });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.APP_URL}/api/managed/multiplier/google/callback`
    );

    oauth2Client.setCredentials({
      access_token: conn.googleAccessToken,
      refresh_token: conn.googleRefreshToken || undefined,
    });

    // Refresh if expired
    const now = new Date();
    const isExpired = !conn.googleTokenExpiresAt ||
      new Date(conn.googleTokenExpiresAt).getTime() - now.getTime() < 5 * 60 * 1000;

    if (isExpired && conn.googleRefreshToken) {
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        await prisma.googleDriveConnection.update({
          where: { id: conn.id },
          data: {
            googleAccessToken: credentials.access_token || undefined,
            googleTokenExpiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : undefined,
            ...(credentials.refresh_token ? { googleRefreshToken: credentials.refresh_token } : {}),
          },
        });
        oauth2Client.setCredentials({
          access_token: credentials.access_token || undefined,
          refresh_token: credentials.refresh_token || conn.googleRefreshToken || undefined,
        });
      } catch (err) {
        console.error("[Multiplier Folders] Token refresh failed:", err);
      }
    }

    const drive = google.drive({ version: "v3", auth: oauth2Client });

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
