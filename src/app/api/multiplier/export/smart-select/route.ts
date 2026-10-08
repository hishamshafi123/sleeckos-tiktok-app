export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { getSmartSelectAccounts } from "@/lib/services/multiplier-export";

// GET /api/multiplier/export/smart-select?sectionIds=id1,id2&postedWithinDays=10&zeroViewDays=4
// Returns { accountIds, matched, considered } for the Smart Export "Select active & posting" picker.
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
    const postedWithinDaysParam = sp.get("postedWithinDays");
    const zeroViewDaysParam = sp.get("zeroViewDays");

    const result = await getSmartSelectAccounts({
      sectionIds,
      postedWithinDays: postedWithinDaysParam ? parseInt(postedWithinDaysParam, 10) : undefined,
      zeroViewDays: zeroViewDaysParam ? parseInt(zeroViewDaysParam, 10) : undefined,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[Smart Select API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to run smart select" }, { status: 500 });
  }
}
