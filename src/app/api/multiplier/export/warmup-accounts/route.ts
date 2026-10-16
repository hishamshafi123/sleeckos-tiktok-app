export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { getExportWarmupAccounts } from "@/lib/services/multiplier-export";

// GET /api/multiplier/export/warmup-accounts?sectionIds=id1,id2&minAgeDays=0&maxAgeDays=14
// Returns { warmupMinAgeDays, accounts, counts } — warm-up status of newly created
// export accounts (warming / test_due / verified / failed / stalled).
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const sp = req.nextUrl.searchParams;
    const sectionIds = (sp.get("sectionIds") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const minAgeDaysParam = sp.get("minAgeDays");
    const maxAgeDaysParam = sp.get("maxAgeDays");

    const result = await getExportWarmupAccounts({
      sectionIds,
      minAgeDays: minAgeDaysParam ? Math.max(0, parseInt(minAgeDaysParam, 10) || 0) : undefined,
      maxAgeDays: maxAgeDaysParam ? Math.min(60, Math.max(1, parseInt(maxAgeDaysParam, 10) || 14)) : undefined,
      includeGraduated: sp.get("includeGraduated") === "true",
    });
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[Export Warmup Accounts API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to load warmup accounts" }, { status: 500 });
  }
}
