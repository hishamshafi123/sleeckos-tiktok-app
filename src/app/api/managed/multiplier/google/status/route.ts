export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { google } from "googleapis";

// Helper: get authenticated Drive client for multiplier connection
async function getMultiplierDriveClient() {
  const conn = await prisma.googleDriveConnection.findFirst({
    where: { purpose: "multiplier" },
  });

  if (!conn || !conn.googleAccessToken) {
    return null;
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
      console.error("[Multiplier Drive] Token refresh failed:", err);
    }
  }

  return google.drive({ version: "v3", auth: oauth2Client });
}

// GET /api/managed/multiplier/google/status — Check connection status
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const conn = await prisma.googleDriveConnection.findFirst({
    where: { purpose: "multiplier" },
  });

  if (!conn || !conn.googleAccessToken) {
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({
    connected: true,
    email: conn.googleEmail,
  });
}

// DELETE /api/managed/multiplier/google/status — Disconnect Drive
export async function DELETE() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.googleDriveConnection.deleteMany({
    where: { purpose: "multiplier" },
  });

  return NextResponse.json({ success: true });
}

export { getMultiplierDriveClient };
