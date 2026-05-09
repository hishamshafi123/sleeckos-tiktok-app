export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";

export async function GET(request: Request) {
  const url = new URL(request.url);
  // flow: "login" | "signup" | "connect" — defaults to "login"
  const flow = url.searchParams.get("flow") || "login";

  const nonce = crypto.randomBytes(16).toString("hex");
  // Encode both nonce and flow in state as "nonce:flow"
  const state = `${nonce}:${flow}`;

  const cookieStore = await cookies();
  cookieStore.set("oauth_state", nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10, // 10 minutes
    path: "/",
  });

  const clientKey = process.env.TIKTOK_CLIENT_KEY!;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const redirectUri = `${proto}://${url.host}/api/auth/callback`;

  // Scopes: Login Kit (user.info.basic) + Content Posting API + User Info API
  const scopes =
    "user.info.basic,video.publish,video.upload,user.info.profile,user.info.stats";

  const tiktokUrl = new URL("https://www.tiktok.com/v2/auth/authorize/");
  tiktokUrl.searchParams.set("client_key", clientKey);
  tiktokUrl.searchParams.set("scope", scopes);
  tiktokUrl.searchParams.set("response_type", "code");
  tiktokUrl.searchParams.set("redirect_uri", redirectUri);
  tiktokUrl.searchParams.set("state", state);

  return NextResponse.redirect(tiktokUrl.toString());
}
