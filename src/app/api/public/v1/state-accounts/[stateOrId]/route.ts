export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/services/track-share";
import { publicCorsPreflight, withPublicCors } from "@/lib/public-cors";
import {
  checkStatePublicRateLimit,
  getPublicStateAccountDetail,
  validateStateApiAccess,
} from "@/lib/services/state-accounts/client-portal";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/public/v1/state-accounts/[stateOrId] — PUBLIC client REST API.
// stateOrId can be a state slug (e.g. "georgia", "south-carolina"), 2-letter code ("GA"),
// state name ("Georgia"), or account UUID.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ stateOrId: string }> },
) {
  if (!checkStatePublicRateLimit(getClientIp(req))) {
    return withPublicCors(
      NextResponse.json(
        { error: "Too many requests — slow down" },
        { status: 429 },
      ),
    );
  }

  const apiKey = req.headers.get("x-api-key") || "";
  const scope = apiKey.trim() ? await validateStateApiAccess(apiKey) : null;
  if (!scope) {
    return withPublicCors(
      NextResponse.json({ error: "Not found" }, { status: 404 }),
    );
  }

  const { stateOrId } = await params;
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") || undefined;
  const to = sp.get("to") || undefined;
  const daysRaw = sp.get("days");

  if (
    (from && !DATE_RE.test(from)) ||
    (to && !DATE_RE.test(to)) ||
    (from && to && from > to)
  ) {
    return withPublicCors(
      NextResponse.json(
        {
          error:
            "Invalid date range — use from/to as YYYY-MM-DD, with from on or before to",
        },
        { status: 400 },
      ),
    );
  }

  let days: number | undefined;
  if (daysRaw !== null && daysRaw !== "") {
    const parsed = Number(daysRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 90) {
      return withPublicCors(
        NextResponse.json(
          { error: "Invalid days parameter — use an integer between 1 and 90" },
          { status: 400 },
        ),
      );
    }
    days = parsed;
  }

  try {
    const detail = await getPublicStateAccountDetail(
      scope,
      decodeURIComponent(stateOrId),
      { days, from, to },
    );
    if (!detail) {
      return withPublicCors(
        NextResponse.json({ error: "Not found" }, { status: 404 }),
      );
    }
    return withPublicCors(
      NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } }),
    );
  } catch (err) {
    console.error("[Public API] state-account detail error:", err);
    return withPublicCors(
      NextResponse.json({ error: "Internal error" }, { status: 500 }),
    );
  }
}

export async function OPTIONS() {
  return publicCorsPreflight();
}
