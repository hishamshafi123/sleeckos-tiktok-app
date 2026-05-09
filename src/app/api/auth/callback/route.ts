export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/db";
import { createSession } from "@/lib/session";

export async function GET(request: Request) {
  const url = new URL(request.url);
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
      `${url.protocol}//${url.host}${redirectPath || "/login"}?error=${reason}`
    );

  if (error || !code) {
    const dest = flow === "managed" ? "/admin/accounts" : "/login";
    return errorRedirect("auth_failed", dest);
  }

  // CSRF validation — only enforce when both nonces are present
  if (savedNonce && receivedNonce && receivedNonce !== savedNonce) {
    const dest = flow === "managed" ? "/admin/accounts" : "/login";
    return errorRedirect("invalid_state", dest);
  }

  // Clean up the state cookie
  cookieStore.delete("oauth_state");

  const redirectUri = `${url.protocol}//${url.host}/api/auth/callback`;

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
    const dest = flow === "managed" ? "/admin/accounts" : "/login";
    return errorRedirect("token_failed", dest);
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
        tiktokAccessToken: tokenData.access_token,
        tiktokRefreshToken: tokenData.refresh_token || "",
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
        tiktokAccessToken: tokenData.access_token,
        tiktokRefreshToken: tokenData.refresh_token || "",
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

    await prisma.auditLog.create({
      data: {
        action: "MANAGED_ACCOUNT_ADDED",
        resourceType: "ManagedAccount",
        metadata: {
          openId: tokenData.open_id,
          username,
          groupId: managedGroupId,
          sectionName: group.section.name,
          groupName: group.name,
        },
      },
    });

    // Redirect back to the group page
    return NextResponse.redirect(
      `${url.protocol}//${url.host}/admin/accounts/${group.section.slug}/${group.slug}`
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STANDARD FLOWS — login / signup / connect (existing marketplace logic)
  // ══════════════════════════════════════════════════════════════════════════

  const profilePayload = {
    bioDescription: tiktokUser.bio_description ?? null,
    isVerified: tiktokUser.is_verified ?? false,
    profileWebLink: tiktokUser.profile_web_link ?? null,
    profileDeepLink: tiktokUser.profile_deep_link ?? null,
    followerCount: tiktokUser.follower_count ?? 0,
    followingCount: tiktokUser.following_count ?? 0,
    likesCount: tiktokUser.likes_count ?? 0,
    videoCount: tiktokUser.video_count ?? 0,
    statsUpdatedAt: new Date(),
  };

  const tiktokTokenPayload = {
    openId: tokenData.open_id,
    unionId: tiktokUser.union_id ?? null,
    username,
    displayName: tiktokUser.display_name || "Unknown",
    avatarUrl: tiktokUser.avatar_url || "",
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || "",
    accessTokenExpiresAt: new Date(
      Date.now() + (tokenData.expires_in ?? 86400) * 1000
    ),
    refreshTokenExpiresAt: new Date(
      Date.now() + (tokenData.refresh_expires_in ?? 86400 * 30) * 1000
    ),
    scopes:
      tokenData.scope ||
      "user.info.basic,video.publish,video.upload,user.info.profile,user.info.stats",
    revokedAt: null,
    ...profilePayload,
  };

  // Resolve the user id
  const sessionToken = cookieStore.get("session")?.value;
  let userId: string | null = null;
  let isNewUser = false;

  if (sessionToken) {
    try {
      const { jwtVerify } = await import("jose");
      const key = new TextEncoder().encode(
        process.env.SESSION_SECRET ||
          "super-secret-key-for-sleeckos-ugc-marketplace"
      );
      const { payload } = await jwtVerify(sessionToken, key);
      userId = (payload as { userId: string }).userId;
    } catch (e) {
      console.error("Session verification failed in callback:", e);
    }
  }

  if (!userId) {
    const existingTikTok = await prisma.tiktokAccount.findUnique({
      where: { openId: tokenData.open_id },
    });

    if (existingTikTok) {
      userId = existingTikTok.userId;
    } else {
      isNewUser = true;
      const email = `${tokenData.open_id}@tiktok.local`;
      let dbUser = await prisma.user.findUnique({ where: { email } });

      if (!dbUser) {
        dbUser = await prisma.user.create({
          data: {
            email,
            role: "CREATOR",
            status: "APPROVED",
            creatorProfile: {
              create: {
                displayName: tiktokUser.display_name || username,
                bio: tiktokUser.bio_description || "",
                nicheTags: [],
                contentSampleUrls: [],
                disclosureAgreedAt: null,
                followerCountSnapshot: tiktokUser.follower_count ?? 0,
                followerCountUpdatedAt: new Date(),
              },
            },
          },
        });
      }

      userId = dbUser.id;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    await createSession({
      userId,
      email: user!.email,
      role: (user!.role ?? "CREATOR") as "CREATOR" | "BRAND_OWNER" | "ADMIN",
    });
  }

  // Upsert TikTok account record
  await prisma.tiktokAccount.upsert({
    where: { openId: tokenData.open_id },
    create: { userId, ...tiktokTokenPayload },
    update: { userId, ...tiktokTokenPayload },
  });

  await prisma.creatorProfile.updateMany({
    where: { userId },
    data: {
      followerCountSnapshot: tiktokUser.follower_count ?? 0,
      followerCountUpdatedAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: userId,
      action: isNewUser ? "TIKTOK_LOGIN_SIGNUP" : "TIKTOK_LOGIN",
      resourceType: "TiktokAccount",
      metadata: { openId: tokenData.open_id, username, flow },
    },
  });

  if (flow === "connect") {
    return NextResponse.redirect(`${url.protocol}//${url.host}/c/dashboard`);
  }

  if (isNewUser) {
    return NextResponse.redirect(`${url.protocol}//${url.host}/c/onboarding`);
  }
  return NextResponse.redirect(`${url.protocol}//${url.host}/c/dashboard`);
}
