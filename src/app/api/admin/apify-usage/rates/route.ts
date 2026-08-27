export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ForbiddenError } from "@/lib/services/analytics/account-performance";
import { getApifyRates, setApifyRates } from "@/lib/services/analytics/apify-usage";

// GET /api/admin/apify-usage/rates — current estimated-cost rates.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const rates = await getApifyRates(session.userId);
    return NextResponse.json(rates);
  } catch (err: any) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[ApifyUsage rates GET] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// PUT /api/admin/apify-usage/rates — update rates {costPerCall, costPerResult}.
// Admin-only (the service checks "users_access").
export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const rates = await setApifyRates(session.userId, {
      costPerCall: Number(body?.costPerCall),
      costPerResult: Number(body?.costPerResult),
    });
    return NextResponse.json(rates);
  } catch (err: any) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (err instanceof Error && err.message.startsWith("Rates must be")) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[ApifyUsage rates PUT] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
