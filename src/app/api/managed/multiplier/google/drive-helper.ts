import prisma from "@/lib/db";
import { google } from "googleapis";

async function getConnectedAccount() {
  return prisma.managedAccount.findFirst({
    where: { driveConnected: true, googleAccessToken: { not: null } },
    select: {
      id: true,
      tiktokUsername: true,
      googleAccessToken: true,
      googleRefreshToken: true,
      googleTokenExpiresAt: true,
      driveFolderId: true,
      driveFolderName: true,
    },
  });
}

// Mutex to prevent concurrent token refreshes
let refreshPromise: Promise<any> | null = null;

// Helper: get authenticated Drive client from existing ManagedAccount connection
export async function getMultiplierDriveClient() {
  const account = await getConnectedAccount();

  if (!account || !account.googleAccessToken) {
    console.error("[Multiplier Drive] No connected account with access token found");
    return null;
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.APP_URL}/api/managed/accounts/auth/google/callback`
  );

  oauth2Client.setCredentials({
    access_token: account.googleAccessToken,
    refresh_token: account.googleRefreshToken || undefined,
  });

  // Refresh if expired
  const now = new Date();
  const isExpired = !account.googleTokenExpiresAt ||
    new Date(account.googleTokenExpiresAt).getTime() - now.getTime() < 5 * 60 * 1000;

  if (isExpired && account.googleRefreshToken) {
    // Use mutex to prevent multiple concurrent refresh calls
    if (!refreshPromise) {
      refreshPromise = (async () => {
        try {
          console.log("[Multiplier Drive] Token expired, refreshing...");
          const { credentials } = await oauth2Client.refreshAccessToken();
          await prisma.managedAccount.update({
            where: { id: account.id },
            data: {
              googleAccessToken: credentials.access_token || undefined,
              googleTokenExpiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : undefined,
              ...(credentials.refresh_token ? { googleRefreshToken: credentials.refresh_token } : {}),
            },
          });
          console.log("[Multiplier Drive] Token refreshed successfully");
          return credentials;
        } catch (err: any) {
          console.error("[Multiplier Drive] Token refresh failed:", err?.message || err);
          return null;
        } finally {
          refreshPromise = null;
        }
      })();
    }

    const credentials = await refreshPromise;
    if (!credentials) {
      console.error("[Multiplier Drive] Cannot proceed — token refresh failed and token is expired");
      return null; // Don't return a client with an expired token
    }

    oauth2Client.setCredentials({
      access_token: credentials.access_token || undefined,
      refresh_token: credentials.refresh_token || account.googleRefreshToken || undefined,
    });
  } else if (isExpired && !account.googleRefreshToken) {
    console.error("[Multiplier Drive] Token expired but no refresh token available — reconnect Drive");
    return null;
  }

  return google.drive({ version: "v3", auth: oauth2Client });
}
