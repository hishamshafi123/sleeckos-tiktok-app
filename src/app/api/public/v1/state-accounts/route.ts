export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/services/track-share";
import { publicCorsPreflight, withPublicCors } from "@/lib/public-cors";
import {
  checkStatePublicRateLimit,
  getPublicStateAccountsSummary,
  validateStateApiAccess,
} from "@/lib/services/state-accounts/client-portal";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/public/v1/state-accounts — PUBLIC client REST API.
// Auth: `x-api-key: <API_KEY or share code>` header.
// Optional query params:
//   - days: 1..90 (default 30)
//   - from / to: YYYY-MM-DD (inclusive reporting dates)
export async function GET(req: NextRequest) {
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
    const payload = await getPublicStateAccountsSummary(scope, {
      days,
      from,
      to,
    });
    return withPublicCors(
      NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } }),
    );
  } catch (err) {
    console.error("[Public API] state-accounts summary error:", err);
    return withPublicCors(
      NextResponse.json({ error: "Internal error" }, { status: 500 }),
    );
  }
}

export async function OPTIONS() {
  return publicCorsPreflight();
}
