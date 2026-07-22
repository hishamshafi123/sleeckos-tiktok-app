export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { getDistribution, getDistributionSummary } from "@/lib/services/distribution";
import { getOrgTimezone } from "@/lib/services/timezone";

// GET /api/distribution?campaignId=&accountId=&status=&from=&to=
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "accounts"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const from = sp.get("from");
  const to = sp.get("to");

  if (status && !["delivered", "scheduled", "posted"].includes(status)) {
    return NextResponse.json({ error: "Invalid status. Expected delivered | scheduled | posted" }, { status: 400 });
  }

  const filters = {
    campaignId: sp.get("campaignId") || undefined,
    accountId: sp.get("accountId") || undefined,
    status: (status || undefined) as "delivered" | "scheduled" | "posted" | undefined,
    from: from ? new Date(`${from}T00:00:00.000Z`) : undefined,
    to: to ? new Date(`${to}T23:59:59.999Z`) : undefined,
  };
  if (filters.from && isNaN(filters.from.getTime())) {
    return NextResponse.json({ error: "Invalid from date" }, { status: 400 });
  }
  if (filters.to && isNaN(filters.to.getTime())) {
    return NextResponse.json({ error: "Invalid to date" }, { status: 400 });
  }

  try {
    const [deliveries, summary, timezone] = await Promise.all([
      getDistribution(filters),
      getDistributionSummary(filters),
      getOrgTimezone(),
    ]);
    return NextResponse.json({ deliveries, summary, timezone });
  } catch (err: any) {
    console.error("[Distribution GET API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to load distribution" }, { status: 500 });
  }
}
