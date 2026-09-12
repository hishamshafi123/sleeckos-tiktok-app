export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ForbiddenError } from "@/lib/services/analytics/account-performance";
import { getFailedProfileCalls } from "@/lib/services/analytics/apify-usage";

// GET /api/admin/apify-usage/failed-profiles?day=YYYY-MM-DD — profile fetches
// that failed on that (org-tz) day, newest first.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const day = req.nextUrl.searchParams.get("day") ?? undefined;
    const result = await getFailedProfileCalls(session.userId, day);
    return NextResponse.json(result);
  } catch (err: any) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[ApifyUsage failed-profiles] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
