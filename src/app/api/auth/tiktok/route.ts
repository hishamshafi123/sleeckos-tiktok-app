import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";

export async function GET(request: Request) {
  const state = crypto.randomBytes(16).toString("hex");
  const cookieStore = await cookies();
  cookieStore.set("oauth_state", state, { httpOnly: true, path: "/", maxAge: 60 * 10 });

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const url = new URL(request.url);
  const redirectUri = `${url.protocol}//${url.host}/api/auth/callback`;

  const tiktokAuthUrl = new URL("https://www.tiktok.com/v2/auth/authorize/");
  tiktokAuthUrl.searchParams.set("client_key", clientKey!);
  tiktokAuthUrl.searchParams.set("scope", "user.info.basic,video.publish");
  tiktokAuthUrl.searchParams.set("response_type", "code");
  tiktokAuthUrl.searchParams.set("redirect_uri", redirectUri);
  tiktokAuthUrl.searchParams.set("state", state);

  return NextResponse.redirect(tiktokAuthUrl.toString());
}
