export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/db";
import { setSession } from "@/lib/session";


export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const cookieStore = await cookies();
  const savedState = cookieStore.get("oauth_state")?.value;

  if (error || !code) {
    return NextResponse.redirect(`${url.protocol}//${url.host}/login?error=auth_failed`);
  }

  if (state !== savedState) {
    return NextResponse.redirect(`${url.protocol}//${url.host}/login?error=invalid_state`);
  }

  const redirectUri = `${url.protocol}//${url.host}/api/auth/callback`;

  const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
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
    return NextResponse.redirect(`${url.protocol}//${url.host}/login?error=token_failed`);
  }

  // Fetch basic info
  const userInfoRes = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
    },
  });

  const userInfoData = await userInfoRes.json();
  const user = userInfoData.data?.user || {};

  // Create or update user
  // Strictly one account per user
  const email = `${tokenData.open_id}@tiktok.local`;

  let dbUser = await prisma.user.findUnique({ where: { email } });
  if (!dbUser) {
    dbUser = await prisma.user.create({
      data: { email },
    });
  }

  await prisma.tiktokAccount.upsert({
    where: { openId: tokenData.open_id },
    create: {
      userId: dbUser.id,
      openId: tokenData.open_id,
      unionId: user.union_id,
      username: user.username || "unknown",
      displayName: user.display_name || "Unknown",
      avatarUrl: user.avatar_url || "",
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      accessTokenExpiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
      refreshTokenExpiresAt: new Date(Date.now() + tokenData.refresh_expires_in * 1000),
      scopes: tokenData.scope || "user.info.basic,video.publish",
      revokedAt: null,
    },
    update: {
      userId: dbUser.id,
      username: user.username || "unknown",
      displayName: user.display_name || "Unknown",
      avatarUrl: user.avatar_url || "",
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      accessTokenExpiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
      refreshTokenExpiresAt: new Date(Date.now() + tokenData.refresh_expires_in * 1000),
      scopes: tokenData.scope || "user.info.basic,video.publish",
      revokedAt: null,
    },
  });

  await setSession(dbUser.id);

  return NextResponse.redirect(`${url.protocol}//${url.host}/dashboard`);
}
