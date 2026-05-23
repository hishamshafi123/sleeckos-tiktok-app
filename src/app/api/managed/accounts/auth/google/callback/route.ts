export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import prisma from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const appUrl = process.env.APP_URL || "https://sleeckos.com";

  // Parse state (accountId:sectionSlug:groupSlug)
  const [accountId, section, group] = (state || "").split(":");

  // Build the original dashboard redirect URL to send users back on errors/successes
  let dashboardUrl = `${appUrl}/admin/accounts`;
  if (section && group) {
    dashboardUrl = `${appUrl}/admin/accounts/${section}/${group}`;
  }

  if (error) {
    console.error("[Google OAuth Callback] Error query received from Google:", error);
    return NextResponse.redirect(`${dashboardUrl}?google_error=${encodeURIComponent(error)}`);
  }

  if (!code || !accountId) {
    console.error("[Google OAuth Callback] Missing authorization code or account ID state");
    return NextResponse.redirect(
      `${dashboardUrl}?google_error=${encodeURIComponent("Missing authorization code or state parameter.")}`
    );
  }

  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET environment variable is missing.");
    }

    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      `${appUrl}/api/managed/accounts/auth/google/callback`
    );

    // Exchange auth code for tokens
    console.log(`[Google OAuth Callback] Exchanging code for account ID: ${accountId}`);
    const { tokens } = await oauth2Client.getToken(code);
    
    if (!tokens.access_token) {
      throw new Error("Did not receive an access token from Google.");
    }

    // Set credentials on oauth client to perform folder setup
    oauth2Client.setCredentials(tokens);
    const drive = google.drive({ version: "v3", auth: oauth2Client });

    // Fetch the account to get its name (for logging/redirection)
    const account = await prisma.managedAccount.findUnique({
      where: { id: accountId },
    });
    if (!account) {
      throw new Error("Managed TikTok account not found in database.");
    }

    // ── AUTOMATED FOLDER CREATION ────────────────────────────────────────────
    console.log(`[Google OAuth Callback] Creating 'Sleeckos Videos' folder in Google Drive for @${account.tiktokUsername}`);
    const folderResponse = await drive.files.create({
      requestBody: {
        name: "Sleeckos Videos",
        mimeType: "application/vnd.google-apps.folder",
      },
      fields: "id",
    });

    const folderId = folderResponse.data.id;
    if (!folderId) {
      throw new Error("Failed to create 'Sleeckos Videos' folder in Google Drive.");
    }
    console.log(`[Google OAuth Callback] Folder created successfully with ID: ${folderId}`);

    // Check if refresh token is present
    if (!tokens.refresh_token) {
      console.warn(
        `[Google OAuth Callback] Warning: No refresh token returned for @${account.tiktokUsername}. Direct authorization might expire without prompt=consent.`
      );
    }

    // Fetch the authenticated user's email for visual diagnostics
    let userEmail = "";
    try {
      const about = await drive.about.get({ fields: "user(emailAddress)" });
      userEmail = about.data.user?.emailAddress || "";
    } catch (aboutErr) {
      console.warn("[Google OAuth Callback] Failed to fetch user info:", aboutErr);
    }

    // ── DATABASE PERSISTENCE ──────────────────────────────────────────────────
    await prisma.managedAccount.update({
      where: { id: accountId },
      data: {
        googleAccessToken: tokens.access_token,
        // Only update refresh token if Google returned one (Google only returns it when prompt=consent or on first authorization)
        ...(tokens.refresh_token ? { googleRefreshToken: tokens.refresh_token } : {}),
        googleTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        driveFolderId: folderId,
        driveFolderName: userEmail ? `Sleeckos Videos (${userEmail})` : "Sleeckos Videos",
        driveConnected: true,
      },
    });

    console.log(`[Google OAuth Callback] Successfully linked Google Drive for @${account.tiktokUsername}`);

    // Redirect to dashboard with success parameter
    return NextResponse.redirect(
      `${dashboardUrl}?google_success=true&username=${encodeURIComponent(account.tiktokUsername)}`
    );
  } catch (err: any) {
    console.error("[Google OAuth Callback] Exception caught during exchange:", err);
    return NextResponse.redirect(
      `${dashboardUrl}?google_error=${encodeURIComponent(err.message || String(err))}`
    );
  }
}
