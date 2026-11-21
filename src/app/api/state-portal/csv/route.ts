export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/services/track-share";
import {
  checkStatePublicRateLimit,
  findValidStateShare,
  getClientPortalPayload,
  stateAccountsVideosCsv,
} from "@/lib/services/state-accounts/client-portal";

// GET /api/state-portal/csv?code=...&state=... — PUBLIC, auth-by-share-code.
export async function GET(req: NextRequest) {
  if (!checkStatePublicRateLimit(getClientIp(req))) {
    return NextResponse.json(
      { error: "Too many requests — slow down" },
      { status: 429 },
    );
  }

  try {
    const params = req.nextUrl.searchParams;
    const code = params.get("code") || "";
    const stateSlug = (params.get("state") || "").trim().toLowerCase();
    if (!code.trim()) {
      return NextResponse.json({ error: "Missing code" }, { status: 400 });
    }

    const share = await findValidStateShare(code);
    if (!share) {
      return NextResponse.json(
        { error: "Invalid or expired access code" },
        { status: 404 },
      );
    }

    const payload = await getClientPortalPayload({
      source: "share",
      id: share.id,
      title: share.title,
      allStates: share.allStates,
      stateNames: share.stateNames,
    });

    const videos = stateSlug
      ? payload.videos.filter(
          (v) =>
            v.stateSlug === stateSlug ||
            v.accountId.toLowerCase() === stateSlug ||
            (v.stateCode && v.stateCode.toLowerCase() === stateSlug),
        )
      : payload.videos;

    const csv = stateAccountsVideosCsv(videos);
    const baseName = stateSlug
      ? `${share.title}_${stateSlug}`
      : share.title;
    const safeName =
      baseName.replace(/[^a-z0-9-_]+/gi, "_").slice(0, 64) || "state_accounts";

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeName}_results.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[State Portal CSV] Error:", err);
    return NextResponse.json({ error: "CSV export failed" }, { status: 500 });
  }
}
