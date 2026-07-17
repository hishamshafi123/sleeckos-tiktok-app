export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/db";
import { safeEncrypt } from "@/lib/services/accounts";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  // Behind nginx/Docker, url.host is the internal address (127.0.0.1:3000).
  // Use APP_URL env var if set, otherwise fall back to x-forwarded-host.
  const baseUrl = process.env.APP_URL
    ?? `${proto}://${request.headers.get("x-forwarded-host") ?? url.host}`;
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state") ?? "";
  const error = url.searchParams.get("error");

  const cookieStore = await cookies();
  const savedNonce = cookieStore.get("oauth_state")?.value;

  // Parse state: "nonce:flow" or "nonce:managed:groupId"
  const stateParts = stateParam.split(":");
  const receivedNonce = stateParts[0] || "";
  const flow = stateParts[1] || "login";
  const managedGroupId = flow === "managed" ? stateParts[2] : null;

  const errorRedirect = (reason: string, redirectPath?: string) =>
    NextResponse.redirect(
      `${baseUrl}${redirectPath || "/admin/accounts"}?error=${reason}`
    );

  if (error || !code) {
    return errorRedirect("auth_failed", "/admin/accounts");
  }

  // CSRF validation — only enforce when both nonces are present
  if (savedNonce && receivedNonce && receivedNonce !== savedNonce) {
    return errorRedirect("invalid_state", "/admin/accounts");
  }

  // Clean up the state cookie
  cookieStore.delete("oauth_state");

  const redirectUri = `${baseUrl}/api/auth/callback`;

  // ── Exchange code for tokens ──────────────────────────────────────────────
  const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      client_secret: process.env.TIKTOK_CLIENT_SECRET!,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  const tokenData = await tokenRes.json();

  if (!tokenData.access_token) {
    console.error("TikTok token exchange failed:", tokenData);
    return errorRedirect("token_failed", "/admin/accounts");
  }

  // ── Fetch TikTok user profile ─────────────────────────────────────────────
  const userInfoRes = await fetch(
    "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username,profile_web_link,profile_deep_link,bio_description,is_verified,follower_count,following_count,likes_count,video_count",
    { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
  );
  const userInfoData = await userInfoRes.json();
  console.log("TikTok User Info:", JSON.stringify(userInfoData));

  const tiktokUser = userInfoData.data?.user ?? {};
  const username =
    tiktokUser.username ||
    tiktokUser.display_name?.toLowerCase().replace(/\s+/g, "_") ||
    "unknown";

  // ══════════════════════════════════════════════════════════════════════════
  // MANAGED FLOW — adding a TikTok account to the management panel
  // ══════════════════════════════════════════════════════════════════════════
  if (flow === "managed" && managedGroupId) {
    // Verify the group exists
    const group = await prisma.accountGroup.findUnique({
      where: { id: managedGroupId },
      include: { section: true },
    });

    if (!group) {
      return errorRedirect("group_not_found", "/admin/accounts");
    }

    // Upsert the managed account
    await prisma.managedAccount.upsert({
      where: { tiktokOpenId: tokenData.open_id },
      create: {
        groupId: managedGroupId,
        tiktokOpenId: tokenData.open_id,
        tiktokUnionId: tiktokUser.union_id ?? null,
        tiktokUsername: username,
        tiktokDisplayName: tiktokUser.display_name || "Unknown",
        tiktokAvatarUrl: tiktokUser.avatar_url || "",
        tiktokAccessToken: safeEncrypt(tokenData.access_token),
        tiktokRefreshToken: safeEncrypt(tokenData.refresh_token || ""),
        tokenExpiresAt: new Date(
          Date.now() + (tokenData.expires_in ?? 86400) * 1000
        ),
        refreshTokenExpiresAt: new Date(
          Date.now() + (tokenData.refresh_expires_in ?? 86400 * 30) * 1000
        ),
        tiktokScopes:
          tokenData.scope ||
          "user.info.basic,video.publish,video.upload,user.info.profile,user.info.stats",
        followerCount: tiktokUser.follower_count ?? 0,
        followingCount: tiktokUser.following_count ?? 0,
        likesCount: tiktokUser.likes_count ?? 0,
        videoCount: tiktokUser.video_count ?? 0,
        isVerified: tiktokUser.is_verified ?? false,
        statsUpdatedAt: new Date(),
      },
      update: {
        groupId: managedGroupId,
        tiktokUsername: username,
        tiktokDisplayName: tiktokUser.display_name || "Unknown",
        tiktokAvatarUrl: tiktokUser.avatar_url || "",
        tiktokAccessToken: safeEncrypt(tokenData.access_token),
        tiktokRefreshToken: safeEncrypt(tokenData.refresh_token || ""),
        tokenExpiresAt: new Date(
          Date.now() + (tokenData.expires_in ?? 86400) * 1000
        ),
        refreshTokenExpiresAt: new Date(
          Date.now() + (tokenData.refresh_expires_in ?? 86400 * 30) * 1000
        ),
        tiktokScopes:
          tokenData.scope ||
          "user.info.basic,video.publish,video.upload,user.info.profile,user.info.stats",
        followerCount: tiktokUser.follower_count ?? 0,
        followingCount: tiktokUser.following_count ?? 0,
        likesCount: tiktokUser.likes_count ?? 0,
        videoCount: tiktokUser.video_count ?? 0,
        isVerified: tiktokUser.is_verified ?? false,
        statsUpdatedAt: new Date(),
        revokedAt: null,
      },
    });

    // Redirect back to the group page
    return NextResponse.redirect(
      `${baseUrl}/admin/accounts/${group.section.slug}/${group.slug}`
    );
  }

  return errorRedirect("invalid_flow", "/admin/accounts");
}
