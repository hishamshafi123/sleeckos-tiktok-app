export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import {
  checkTrackRateLimit,
  findValidShare,
  getClientIp,
  getPublicTrackingPayload,
  publicTrackingCsv,
} from "@/lib/services/track-share";

// GET /api/track/csv?code=... — PUBLIC, auth-by-code.
// CSV of tracked links + stats for the campaign the code belongs to.
export async function GET(req: NextRequest) {
  if (!checkTrackRateLimit(getClientIp(req))) {
    return NextResponse.json({ error: "Too many requests — slow down" }, { status: 429 });
  }

  try {
    const code = new URL(req.url).searchParams.get("code") || "";
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

    const csv = publicTrackingCsv(payload);
    const safeTitle = payload.campaign.title.replace(/[^a-z0-9-_]+/gi, "_").slice(0, 60) || "campaign";

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeTitle}_tracking.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("[Track CSV] Error:", err);
    return NextResponse.json({ error: "CSV export failed" }, { status: 500 });
  }
}
