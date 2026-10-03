export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { ForbiddenError } from "@/lib/services/analytics/account-performance";
import { HEALTH_VERDICTS, getLatestHealthScan } from "@/lib/services/account-health";

// GET /api/admin/account-performance/health-scan/latest
// ?verdict=SHADOWBANNED,SUSPECT&assigneeId=...&query=...&page=1&pageSize=50
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const verdicts = (sp.get("verdict") ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const invalid = verdicts.filter((v) => !HEALTH_VERDICTS.includes(v as any));
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `Invalid verdict. Must be one of: ${HEALTH_VERDICTS.join(", ")}` },
      { status: 400 }
    );
  }

  const page = sp.get("page") ? Number(sp.get("page")) : undefined;
  const pageSize = sp.get("pageSize") ? Number(sp.get("pageSize")) : undefined;
  if ((page !== undefined && !Number.isFinite(page)) || (pageSize !== undefined && !Number.isFinite(pageSize))) {
    return NextResponse.json({ error: "Invalid page/pageSize" }, { status: 400 });
  }

  try {
    const result = await getLatestHealthScan(session.userId, {
      verdicts: verdicts.length > 0 ? verdicts : undefined,
      assigneeId: sp.get("assigneeId") || undefined,
      query: sp.get("query") || undefined,
      page,
      pageSize,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[HealthScan latest] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
