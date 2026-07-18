import prisma from "@/lib/db";
import { encrypt, decrypt } from "./vault";

const POSTPEER_API = "https://api.postpeer.dev/v1";

function getPostPeerKey(): string {
  const key = process.env.POSTPEER_ACCESS_KEY;
  if (!key) throw new Error("POSTPEER_ACCESS_KEY env var not set");
  return key;
}

/**
 * Reversible encryption helper that handles plain text gracefully for migration.
 */
export function safeEncrypt(val: string | null | undefined): string {
  if (!val) return "";
  // If it matches the encrypted format "iv:authTag:encryptedText", return as is
  if (val.includes(":") && val.split(":").length === 3) {
    return val;
  }
  try {
    return encrypt(val);
  } catch (err: any) {
    console.error("[Accounts Service] safeEncrypt failed, returning plain text:", err.message);
    return val;
  }
}

/**
 * Reversible decryption helper that returns plain text if not encrypted.
 */
export function safeDecrypt(val: string | null | undefined): string {
  if (!val) return "";
  // Check if it is encrypted
  if (val.includes(":") && val.split(":").length === 3) {
    try {
      return decrypt(val);
    } catch (err: any) {
      console.error("[Accounts Service] safeDecrypt failed, returning original:", err.message);
      return val;
    }
  }
  return val;
}

/**
 * Fetches all connected integrations from PostPeer.
 */
export async function getPostPeerIntegrations(): Promise<any[]> {
  const apiKey = getPostPeerKey();
  const url = `${POSTPEER_API}/connect/integrations`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "x-access-key": apiKey,
      },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(`PostPeer integrations query failed (${res.status}): ${JSON.stringify(data)}`);
    }
    const data = await res.json();
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.integrations)) return data.integrations;
    return [];
  } catch (err: any) {
    console.error("[Accounts Service] Failed to fetch PostPeer integrations:", err.message);
    throw err;
  }
}

/**
 * Validates whether a PostPeer Account ID resolves against PostPeer.
 */
export async function validatePostPeerAccount(postPeerId: string | null | undefined): Promise<boolean> {
  if (!postPeerId?.trim()) return false;
  try {
    const integrations = await getPostPeerIntegrations();
    return integrations.some((item: any) => item.id === postPeerId.trim());
  } catch (err) {
    console.error("[Accounts Service] validatePostPeerAccount error:", err);
    return false;
  }
}

/**
 * Syncs account details from the direct TikTok OAuth profile info endpoint.
 */
export async function syncTikTokProfileStats(accountId: string, decryptedAccessToken: string): Promise<boolean> {
  try {
    const userInfoRes = await fetch(
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username,is_verified,follower_count,following_count,likes_count,video_count",
      { headers: { Authorization: `Bearer ${decryptedAccessToken}` } }
    );
    if (!userInfoRes.ok) {
      const data = await userInfoRes.json().catch(() => ({}));
      console.warn(`[Accounts Service] TikTok Profile sync failed (${userInfoRes.status}):`, data);
      return false;
    }
    const userInfoData = await userInfoRes.json();
    const tiktokUser = userInfoData.data?.user;
    if (!tiktokUser) return false;

    await prisma.managedAccount.update({
      where: { id: accountId },
      data: {
        tiktokDisplayName: tiktokUser.display_name || undefined,
        tiktokAvatarUrl: tiktokUser.avatar_url || undefined,
        followerCount: tiktokUser.follower_count ?? undefined,
        followingCount: tiktokUser.following_count ?? undefined,
        likesCount: tiktokUser.likes_count ?? undefined,
        videoCount: tiktokUser.video_count ?? undefined,
        isVerified: tiktokUser.is_verified ?? undefined,
        statsUpdatedAt: new Date(),
      },
    });
    return true;
  } catch (err: any) {
    console.error(`[Accounts Service] Profile stats sync exception for account ${accountId}:`, err.message);
    return false;
  }
}

/**
 * Performs a TikTok OAuth token refresh, updating the tokens in DB encrypted at rest.
 */
export async function refreshAccountToken(accountId: string): Promise<boolean> {
  const account = await prisma.managedAccount.findUnique({ where: { id: accountId } });
  if (!account) return false;

  const rawRefreshToken = safeDecrypt(account.tiktokRefreshToken);
  if (!rawRefreshToken) {
    console.warn(`[Accounts Service] No refresh token found for account @${account.tiktokUsername}`);
    await prisma.managedAccount.update({
      where: { id: accountId },
      data: {
        connectionState: "needs_reauth",
        lastError: "No refresh token available",
        lastCheckedAt: new Date(),
      },
    });
    return false;
  }

  console.log(`[Accounts Service] Refreshing TikTok OAuth token for @${account.tiktokUsername}...`);
  try {
    const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY!,
        client_secret: process.env.TIKTOK_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: rawRefreshToken,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.access_token) {
      console.error(`[Accounts Service] TikTok token refresh failed for @${account.tiktokUsername}:`, data);
      await prisma.managedAccount.update({
        where: { id: accountId },
        data: {
          connectionState: "needs_reauth",
          lastError: data.error_description || data.error || "Token refresh request failed",
          lastCheckedAt: new Date(),
        },
      });
      return false;
    }

    // Encrypt the new tokens
    const encryptedAccessToken = safeEncrypt(data.access_token);
    const encryptedRefreshToken = safeEncrypt(data.refresh_token || rawRefreshToken);

    await prisma.managedAccount.update({
      where: { id: accountId },
      data: {
        tiktokAccessToken: encryptedAccessToken,
        tiktokRefreshToken: encryptedRefreshToken,
        tokenExpiresAt: new Date(Date.now() + (data.expires_in ?? 86400) * 1000),
        refreshTokenExpiresAt: new Date(Date.now() + (data.refresh_expires_in ?? 86400 * 30) * 1000),
        connectionState: "healthy",
        lastError: null,
        lastCheckedAt: new Date(),
      },
    });

    console.log(`[Accounts Service] Successfully refreshed token for @${account.tiktokUsername}. Syncing stats...`);
    await syncTikTokProfileStats(accountId, data.access_token);
    return true;
  } catch (err: any) {
    console.error(`[Accounts Service] Error refreshing token for @${account.tiktokUsername}:`, err.message);
    await prisma.managedAccount.update({
      where: { id: accountId },
      data: {
        connectionState: "needs_reauth",
        lastError: err.message || "TikTok API request failed",
        lastCheckedAt: new Date(),
      },
    });
    return false;
  }
}

/**
 * Checks the connection state and token health of a specific account.
 */
export async function checkAccountHealth(accountId: string): Promise<string> {
  const account = await prisma.managedAccount.findUnique({ where: { id: accountId } });
  if (!account) return "not_found";

  try {
    // 1. If the account is connected via TikTok OAuth directly on SleeckOS
    if (account.tiktokRefreshToken && account.tiktokRefreshToken !== "") {
      const now = new Date();
      const expiresAt = new Date(account.tokenExpiresAt);
      const diffHours = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);

      // If token is expired or expires in less than 2 hours, proactively refresh it
      if (diffHours <= 2) {
        const success = await refreshAccountToken(accountId);
        return success ? "healthy" : "needs_reauth";
      }

      // If token should still be valid, perform a quick verification call to TikTok User Info API
      const decryptedAccess = safeDecrypt(account.tiktokAccessToken);
      const synced = await syncTikTokProfileStats(accountId, decryptedAccess);
      if (!synced) {
        // Verification failed (maybe token revoked manually). Try refresh.
        const success = await refreshAccountToken(accountId);
        return success ? "healthy" : "needs_reauth";
      }

      // Sync was successful, ensure status is marked healthy
      await prisma.managedAccount.update({
        where: { id: accountId },
        data: {
          connectionState: "healthy",
          lastError: null,
          lastCheckedAt: new Date(),
        },
      });
      return "healthy";
    }

    // 2. If it is a manual integration, validate it has a PostPeer Account ID and is in the list
    if (account.postpeerAccountId) {
      const isValid = await validatePostPeerAccount(account.postpeerAccountId);
      if (!isValid) {
        await prisma.managedAccount.update({
          where: { id: accountId },
          data: {
            connectionState: "not_found",
            lastError: `PostPeer Account ID ${account.postpeerAccountId} not found in integrations.`,
            lastCheckedAt: new Date(),
          },
        });
        return "not_found";
      }

      // Integration exists, sync simple details from integrations list
      const integrations = await getPostPeerIntegrations();
      const matched = integrations.find((i: any) => i.id === account.postpeerAccountId);
      if (matched) {
        await prisma.managedAccount.update({
          where: { id: accountId },
          data: {
            tiktokDisplayName: matched.displayName || undefined,
            tiktokAvatarUrl: matched.imageUrl || undefined,
            connectionState: "healthy",
            lastError: null,
            lastCheckedAt: new Date(),
          },
        });
      }
      return "healthy";
    }

    // 3. No connection mechanism
    await prisma.managedAccount.update({
      where: { id: accountId },
      data: {
        connectionState: "needs_reauth",
        lastError: "Neither TikTok OAuth nor PostPeer Account ID is linked.",
        lastCheckedAt: new Date(),
      },
    });
    return "needs_reauth";
  } catch (err: any) {
    console.error(`[Accounts Service] Health check crashed for @${account.tiktokUsername}:`, err.message);
    // Transient network issues should not immediately transition connectionState to permanent errors,
    // but we log the attempt and update the timestamp.
    await prisma.managedAccount.update({
      where: { id: accountId },
      data: {
        lastCheckedAt: new Date(),
      },
    });
    return account.connectionState; // Keep the last state
  }
}

/**
 * Checks all managed accounts' connection/token status.
 */
export async function checkAllAccountsHealth(): Promise<Record<string, string>> {
  const accounts = await prisma.managedAccount.findMany({
    where: { revokedAt: null },
    select: { id: true, tiktokUsername: true },
  });

  console.log(`[Accounts Service] Starting connection health check for ${accounts.length} accounts...`);
  const results: Record<string, string> = {};

  for (const account of accounts) {
    // Transition to checking state first
    await prisma.managedAccount.update({
      where: { id: account.id },
      data: { connectionState: "checking" },
    });

    const status = await checkAccountHealth(account.id);
    results[account.tiktokUsername] = status;
    console.log(`[Accounts Service] Account @${account.tiktokUsername} health status: ${status}`);
  }

  return results;
}
