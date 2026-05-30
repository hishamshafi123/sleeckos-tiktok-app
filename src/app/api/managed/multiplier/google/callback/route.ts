export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import prisma from "@/lib/db";

// GET /api/managed/multiplier/google/callback — OAuth callback
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const appUrl = process.env.APP_URL || "https://sleeckos.com";
  const redirectUrl = `${appUrl}/admin/multiplier`;

  if (error) {
    console.error("[Multiplier Google Callback] Error:", error);
    return NextResponse.redirect(`${redirectUrl}?google_error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return NextResponse.redirect(`${redirectUrl}?google_error=Missing+authorization+code`);
  }

  try {
    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;

    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      `${appUrl}/api/managed/multiplier/google/callback`
    );

    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.access_token) {
      throw new Error("No access token received from Google");
    }

    // Get user email
    oauth2Client.setCredentials(tokens);
    const drive = google.drive({ version: "v3", auth: oauth2Client });
    let email = "";
    try {
      const about = await drive.about.get({ fields: "user(emailAddress)" });
      email = about.data.user?.emailAddress || "";
    } catch {}

    // Upsert connection (only one multiplier connection at a time)
    const existing = await prisma.googleDriveConnection.findFirst({
      where: { purpose: "multiplier" },
    });

    if (existing) {
      await prisma.googleDriveConnection.update({
        where: { id: existing.id },
        data: {
          googleEmail: email,
          googleAccessToken: tokens.access_token,
          ...(tokens.refresh_token ? { googleRefreshToken: tokens.refresh_token } : {}),
          googleTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        },
      });
    } else {
      await prisma.googleDriveConnection.create({
        data: {
          purpose: "multiplier",
          googleEmail: email,
          googleAccessToken: tokens.access_token,
          googleRefreshToken: tokens.refresh_token || null,
          googleTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        },
      });
    }

    console.log(`[Multiplier Google Callback] Connected Drive for ${email}`);
    return NextResponse.redirect(`${redirectUrl}?google_success=true`);
  } catch (err: any) {
    console.error("[Multiplier Google Callback] Error:", err);
    return NextResponse.redirect(`${redirectUrl}?google_error=${encodeURIComponent(err.message || String(err))}`);
  }
}
