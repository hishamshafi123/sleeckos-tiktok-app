export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import {
  checkTrackRateLimit,
  getClientIp,
  getPublicCampaignStats,
  validateCampaignAccess,
} from "@/lib/services/track-share";
import { publicCorsPreflight, withPublicCors } from "@/lib/public-cors";

// GET /api/public/v1/campaigns/[campaignId]/stats — PUBLIC client API.
// Auth: `x-api-key: <share code>` header. The key is scoped to the campaign —
// a code created for campaign A cannot read campaign B. Every failure
// (unknown campaign, bad key, wrong campaign) returns the same 404 so the
// API reveals nothing about what exists. Rate limited per IP.
// CORS is open (see src/lib/public-cors.ts) so client platforms can call
// this from browser-side code as well as servers.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  if (!checkTrackRateLimit(getClientIp(req))) {
    return withPublicCors(
      NextResponse.json({ error: "Too many requests — slow down" }, { status: 429 })
    );
  }

  const { campaignId } = await params;
  const apiKey = req.headers.get("x-api-key") || "";
  if (!apiKey.trim() || !(await validateCampaignAccess(campaignId, apiKey))) {
    return withPublicCors(NextResponse.json({ error: "Not found" }, { status: 404 }));
  }

  try {
    const stats = await getPublicCampaignStats(campaignId);
    if (!stats) {
      return withPublicCors(NextResponse.json({ error: "Not found" }, { status: 404 }));
    }
    return withPublicCors(NextResponse.json(stats));
  } catch (err: any) {
    console.error("[Public API] stats error:", err);
    return withPublicCors(NextResponse.json({ error: "Internal error" }, { status: 500 }));
  }
}

export async function OPTIONS() {
  return publicCorsPreflight();
}
