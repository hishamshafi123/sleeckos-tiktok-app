export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { google } from "googleapis";
import prisma from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Confirm account exists
  const account = await prisma.managedAccount.findUnique({
    where: { id },
  });
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  // Read section and group slugs to redirect back on callback
  const section = req.nextUrl.searchParams.get("section") || "";
  const group = req.nextUrl.searchParams.get("group") || "";
  const oauthState = `${id}:${section}:${group}`;

  // Check if OAuth Client details are set in environment
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const appUrl = process.env.APP_URL;

  if (!clientId || !clientSecret || !appUrl) {
    return NextResponse.json(
      {
        error:
          "Google OAuth has not been configured on this server. GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and APP_URL environment variables are required.",
      },
      { status: 500 }
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    `${appUrl}/api/managed/accounts/auth/google/callback`
  );

  // Generate the consent screen URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline", // requests a refresh token
    prompt: "consent",      // forces consent to guarantee refresh token is returned
    scope: ["https://www.googleapis.com/auth/drive"],
    state: oauthState,      // pass account ID and slugs through state
  });

  return NextResponse.redirect(authUrl);
}
