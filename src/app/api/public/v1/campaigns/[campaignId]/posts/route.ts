export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import {
  checkTrackRateLimit,
  getClientIp,
  getPublicCampaignPosts,
  validateCampaignAccess,
} from "@/lib/services/track-share";
import { publicCorsPreflight, withPublicCors } from "@/lib/public-cors";

// GET /api/public/v1/campaigns/[campaignId]/posts — PUBLIC client API.
// Auth: `x-api-key: <share code>` header (scoped to the campaign). Returns
// every tracked post with its TikTok link and current stats, newest first.
// All failures return the same 404 (no oracle). Rate limited per IP.
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
    const posts = await getPublicCampaignPosts(campaignId);
    if (!posts) {
      return withPublicCors(NextResponse.json({ error: "Not found" }, { status: 404 }));
    }
    return withPublicCors(NextResponse.json(posts));
  } catch (err: any) {
    console.error("[Public API] posts error:", err);
    return withPublicCors(NextResponse.json({ error: "Internal error" }, { status: 500 }));
  }
}

export async function OPTIONS() {
  return publicCorsPreflight();
}
