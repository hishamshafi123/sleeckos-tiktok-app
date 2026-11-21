export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/services/track-share";
import {
  checkStatePublicRateLimit,
  findValidStateShare,
  getClientPortalPayload,
} from "@/lib/services/state-accounts/client-portal";

// POST /api/state-portal/lookup — PUBLIC, auth-by-share-code.
// Returns read-only state account performance payload for the client dashboard.
export async function POST(req: NextRequest) {
  if (!checkStatePublicRateLimit(getClientIp(req))) {
    return NextResponse.json(
      { error: "Too many requests — please wait a minute and try again." },
      { status: 429 },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const code = typeof body.code === "string" ? body.code : "";
    if (!code.trim()) {
      return NextResponse.json({ error: "Missing access code" }, { status: 400 });
    }

    const share = await findValidStateShare(code);
    if (!share) {
      return NextResponse.json(
        { error: "Invalid, revoked, or expired access code" },
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

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[State Portal Lookup] Error:", err);
    return NextResponse.json(
      { error: "Could not load state account data" },
      { status: 500 },
    );
  }
}
