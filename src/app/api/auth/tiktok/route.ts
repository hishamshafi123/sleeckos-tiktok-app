export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = crypto.randomBytes(16).toString("hex");
  const cookieStore = await cookies();
  
  cookieStore.set("oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10, // 10 minutes
    path: "/",
  });

  const clientKey = process.env.TIKTOK_CLIENT_KEY!;
  const redirectUri = `${url.protocol}//${url.host}/api/auth/callback`;
  
  // Scopes required for marketplace: Login Kit + Content Posting API + User Info API
  const scopes = "user.info.basic,video.publish,video.upload,user.info.profile,user.info.stats";

  const tiktokUrl = new URL("https://www.tiktok.com/v2/auth/authorize/");
  tiktokUrl.searchParams.set("client_key", clientKey);
  tiktokUrl.searchParams.set("scope", scopes);
  tiktokUrl.searchParams.set("response_type", "code");
  tiktokUrl.searchParams.set("redirect_uri", redirectUri);
  tiktokUrl.searchParams.set("state", state);

  return NextResponse.redirect(tiktokUrl.toString());
}
