import { NextResponse } from "next/server";

/**
 * CORS for the PUBLIC client API (/api/public/v1/*). These endpoints are
 * key-authenticated read-only campaign stats meant to be pulled by client
 * platforms — including browser-side fetches — so cross-origin GETs are
 * allowed from anywhere. No credentials (cookies) are involved.
 */
export const PUBLIC_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "x-api-key, content-type",
  "Access-Control-Max-Age": "86400",
};

export function withPublicCors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(PUBLIC_CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

export function publicCorsPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}
