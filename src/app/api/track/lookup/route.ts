export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import {
  checkTrackRateLimit,
  findValidShare,
  getClientIp,
  getPublicTrackingPayload,
} from "@/lib/services/track-share";

// POST /api/track/lookup — PUBLIC, auth-by-code.
// The share code is the credential; returns read-only campaign tracking stats.
// No session required. 404 for unknown / revoked / expired codes (no oracle).
export async function POST(req: NextRequest) {
  if (!checkTrackRateLimit(getClientIp(req))) {
    return NextResponse.json({ error: "Too many requests — slow down" }, { status: 429 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const code = typeof body.code === "string" ? body.code : "";
    if (!code.trim()) {
      return NextResponse.json({ error: "Missing code" }, { status: 400 });
    }

    const share = await findValidShare(code);
    if (!share) {
      return NextResponse.json({ error: "Invalid or expired tracking code" }, { status: 404 });
    }

    const payload = await getPublicTrackingPayload(share.campaignId);
    if (!payload) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    return NextResponse.json(payload);
  } catch (err: any) {
    console.error("[Track Lookup] Error:", err);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
}
