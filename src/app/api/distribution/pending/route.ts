export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { getPendingDeliveries } from "@/lib/services/distribution";

// GET /api/distribution/pending — the daily worklist (manual deliveries
// still awaiting their tick-off), oldest first.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "accounts"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const deliveries = await getPendingDeliveries();
    return NextResponse.json({ deliveries });
  } catch (err: any) {
    console.error("[Distribution Pending GET API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to load pending deliveries" }, { status: 500 });
  }
}
