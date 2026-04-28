export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/db";
import { createSession } from "@/lib/session";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const cookieStore = await cookies();
  const savedState = cookieStore.get("oauth_state")?.value;

  if (error || !code) {
    return NextResponse.redirect(`${url.protocol}//${url.host}/c/connect-tiktok?error=auth_failed`);
  }

  if (state && savedState && state !== savedState) {
    return NextResponse.redirect(`${url.protocol}//${url.host}/c/connect-tiktok?error=invalid_state`);
  }

  const redirectUri = `${url.protocol}//${url.host}/api/auth/callback`;

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
    return NextResponse.redirect(`${url.protocol}//${url.host}/c/connect-tiktok?error=token_failed`);
  }

  const userInfoRes = await fetch(
    "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username",
    { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
  );
  const userInfoData = await userInfoRes.json();
  const tiktokUser = userInfoData.data?.user || {};

  // Find which logged-in user this TikTok connect belongs to by session cookie
  const sessionToken = cookieStore.get("session")?.value;
  let userId: string | null = null;

  if (sessionToken) {
    try {
      const { jwtVerify } = await import("jose");
      const key = new TextEncoder().encode(process.env.SESSION_SECRET || "super-secret-key-for-sleeckos-ugc-marketplace");
      const { payload } = await jwtVerify(sessionToken, key);
      userId = (payload as { userId: string }).userId;
    } catch {}
  }

  if (!userId) {
    // Fallback: create a new user (legacy flow)
    const email = `${tokenData.open_id}@tiktok.local`;
    let dbUser = await prisma.user.findUnique({ where: { email } });
    if (!dbUser) {
      dbUser = await prisma.user.create({ data: { email, role: "CREATOR", status: "APPROVED" } });
    }
    userId = dbUser.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    await createSession({ userId, email, role: (user?.role ?? "CREATOR") as "CREATOR" | "BRAND_OWNER" | "ADMIN" });
  }

  await prisma.tiktokAccount.upsert({
    where: { openId: tokenData.open_id },
    create: {
      userId,
      openId: tokenData.open_id,
      unionId: tiktokUser.union_id,
      username: tiktokUser.username || "unknown",
      displayName: tiktokUser.display_name || "Unknown",
      avatarUrl: tiktokUser.avatar_url || "",
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || "",
      accessTokenExpiresAt: new Date(Date.now() + (tokenData.expires_in || 86400) * 1000),
      refreshTokenExpiresAt: new Date(Date.now() + (tokenData.refresh_expires_in || 86400 * 30) * 1000),
      scopes: tokenData.scope || "user.info.basic,video.publish,video.list",
      revokedAt: null,
    },
    update: {
      userId,
      username: tiktokUser.username || "unknown",
      displayName: tiktokUser.display_name || "Unknown",
      avatarUrl: tiktokUser.avatar_url || "",
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || "",
      accessTokenExpiresAt: new Date(Date.now() + (tokenData.expires_in || 86400) * 1000),
      refreshTokenExpiresAt: new Date(Date.now() + (tokenData.refresh_expires_in || 86400 * 30) * 1000),
      scopes: tokenData.scope || "user.info.basic,video.publish,video.list",
      revokedAt: null,
    },
  });

  await prisma.auditLog.create({
    data: { actorUserId: userId, action: "TIKTOK_ACCOUNT_CONNECTED", resourceType: "TiktokAccount", metadata: { openId: tokenData.open_id } },
  });

  return NextResponse.redirect(`${url.protocol}//${url.host}/c/dashboard`);
}
