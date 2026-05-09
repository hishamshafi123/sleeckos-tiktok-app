export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { refreshTikTokToken } from "@/lib/tiktok-managed";

function verifyCronSecret(req: NextRequest) {
  const secret =
    req.headers.get("x-cron-secret") ||
    req.nextUrl.searchParams.get("secret");
  return secret === process.env.CRON_SECRET;
}

// Refresh TikTok tokens expiring within 24 hours
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const expiresThreshold = new Date(Date.now() + 24 * 3600_000);

  const accounts = await prisma.managedAccount.findMany({
    where: {
      revokedAt: null,
      tokenExpiresAt: { lte: expiresThreshold },
    },
  });

  const results: Record<string, string> = {};

  for (const account of accounts) {
    try {
      const data = await refreshTikTokToken(account.tiktokRefreshToken);
      if (data.access_token) {
        await prisma.managedAccount.update({
          where: { id: account.id },
          data: {
            tiktokAccessToken: data.access_token,
            tiktokRefreshToken: data.refresh_token || account.tiktokRefreshToken,
            tokenExpiresAt: new Date(
              Date.now() + (data.expires_in ?? 86400) * 1000
            ),
            refreshTokenExpiresAt: new Date(
              Date.now() + (data.refresh_expires_in ?? 86400 * 30) * 1000
            ),
          },
        });
        results[`@${account.tiktokUsername}`] = "refreshed";
      } else {
        // Refresh token also expired — mark account as needing re-auth
        await prisma.managedAccount.update({
          where: { id: account.id },
          data: { revokedAt: new Date() },
        });
        results[`@${account.tiktokUsername}`] = `failed: ${JSON.stringify(
          data.error
        )}`;
      }
    } catch (err) {
      results[`@${account.tiktokUsername}`] = `error: ${
        err instanceof Error ? err.message : err
      }`;
    }
  }

  return NextResponse.json({
    ok: true,
    processed: accounts.length,
    results,
  });
}
