export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/session";
import crypto from "crypto";

// GET /api/managed/tiktok/auth?sectionId=X
// Initiates TikTok OAuth for adding a managed account to a specific section
export async function GET(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const url = new URL(request.url);
  const sectionId = url.searchParams.get("sectionId");
  if (!sectionId) {
    return NextResponse.json({ error: "sectionId is required" }, { status: 400 });
  }

  const nonce = crypto.randomBytes(16).toString("hex");
  // State format: "nonce:managed:sectionId"
  const state = `${nonce}:managed:${sectionId}`;

  const cookieStore = await cookies();
  cookieStore.set("oauth_state", nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10,
    path: "/",
  });

  const clientKey = process.env.TIKTOK_CLIENT_KEY!;
  // Behind nginx/Docker, url.host is the internal address (127.0.0.1:3000).
  // Use APP_URL env var if set, otherwise fall back to x-forwarded-host header.
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = process.env.APP_URL
    ? new URL(process.env.APP_URL).host
    : (request.headers.get("x-forwarded-host") ?? url.host);
  const redirectUri = `${process.env.APP_URL ?? `${proto}://${host}`}/api/auth/callback`;

  // Scopes for managed accounts: Login Kit + Content Posting + User Info
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
