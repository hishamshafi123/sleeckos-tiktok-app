export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import prisma from "@/lib/db";
import { getOAuth2ClientForAccount } from "@/lib/google";
import { google } from "googleapis";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "accounts"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search");

  try {
    const account = await prisma.managedAccount.findUnique({
      where: { id },
    });

    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    // Try to get Google Drive Client using OAuth (individual or master fallback)
    let auth;
    if (account.googleAccessToken && account.googleRefreshToken) {
      auth = await getOAuth2ClientForAccount(account);
    } else {
      // Fallback: master OAuth account
      const masterAccount = await prisma.managedAccount.findFirst({
        where: { googleRefreshToken: { not: null } },
      });
      if (masterAccount) {
        auth = await getOAuth2ClientForAccount(masterAccount);
      }
    }

    if (!auth) {
      return NextResponse.json({ error: "Google OAuth is not connected. Please connect your Google Drive account first." }, { status: 400 });
    }

    const drive = google.drive({ version: "v3", auth });

    let query = "mimeType = 'application/vnd.google-apps.folder' and trashed = false";
    if (search && search.trim()) {
      const escapedSearch = search.trim().replace(/'/g, "\\'");
      query += ` and name contains '${escapedSearch}'`;
    }

    // List folders in user's Google Drive matching the query
    const response = await drive.files.list({
      q: query,
      orderBy: "name",
      fields: "files(id, name)",
      pageSize: 150,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    return NextResponse.json({ folders: response.data.files || [] });
  } catch (err: any) {
    console.error("[Google Drive Folders API] Error fetching folders:", err);
    return NextResponse.json({ error: err.message || "Failed to retrieve Google Drive folders" }, { status: 500 });
  }
}
