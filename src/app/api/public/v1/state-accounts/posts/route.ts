export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/services/track-share";
import { publicCorsPreflight, withPublicCors } from "@/lib/public-cors";
import {
  checkStatePublicRateLimit,
  getPublicStateAccountPosts,
  validateStateApiAccess,
} from "@/lib/services/state-accounts/client-portal";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_SORTS = new Set(["publishedAt", "views", "likes"]);

// GET /api/public/v1/state-accounts/posts — PUBLIC client REST API.
// Auth: `x-api-key` header.
// Optional query params: state, from, to, sort (publishedAt|views|likes), limit (1..500), offset.
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
  const state = sp.get("state") || undefined;
  const from = sp.get("from") || undefined;
  const to = sp.get("to") || undefined;
  const sort = sp.get("sort") || "publishedAt";
  const limitRaw = sp.get("limit");
  const offsetRaw = sp.get("offset");

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

  if (!VALID_SORTS.has(sort)) {
    return withPublicCors(
      NextResponse.json(
        { error: "Invalid sort — use publishedAt, views, or likes" },
        { status: 400 },
      ),
    );
  }

  let limit = 100;
  if (limitRaw !== null && limitRaw !== "") {
    const parsed = Number(limitRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
      return withPublicCors(
        NextResponse.json(
          { error: "Invalid limit — use an integer between 1 and 500" },
          { status: 400 },
        ),
      );
    }
    limit = parsed;
  }

  let offset = 0;
  if (offsetRaw !== null && offsetRaw !== "") {
    const parsed = Number(offsetRaw);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 50000) {
      return withPublicCors(
        NextResponse.json(
          { error: "Invalid offset — use a non-negative integer" },
          { status: 400 },
        ),
      );
    }
    offset = parsed;
  }

  try {
    const payload = await getPublicStateAccountPosts(scope, {
      state,
      from,
      to,
      sort: sort as "publishedAt" | "views" | "likes",
      limit,
      offset,
    });
    if (!payload) {
      return withPublicCors(
        NextResponse.json({ error: "Not found" }, { status: 404 }),
      );
    }
    return withPublicCors(
      NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } }),
    );
  } catch (err) {
    console.error("[Public API] state-accounts posts error:", err);
    return withPublicCors(
      NextResponse.json({ error: "Internal error" }, { status: 500 }),
    );
  }
}

export async function OPTIONS() {
  return publicCorsPreflight();
}
