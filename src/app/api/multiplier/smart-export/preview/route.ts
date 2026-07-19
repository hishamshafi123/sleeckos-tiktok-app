import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { previewSmartExportAccounts } from "@/lib/services/multiplier-export";

// POST /api/multiplier/smart-export/preview
// Body: { groupIds: string[], accounts: { driveFolderId: string, name?: string, count: number }[], days?: number = 1, includeExported?: boolean }
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { groupIds, accounts, days = 1, includeExported } = body;

    if (!groupIds || !Array.isArray(groupIds) || groupIds.length === 0) {
      return NextResponse.json({ error: "Missing selected Group IDs" }, { status: 400 });
    }
    if (!accounts || !Array.isArray(accounts)) {
      return NextResponse.json({ error: "Missing account allocations" }, { status: 400 });
    }

    const preview = await previewSmartExportAccounts({
      groupIds,
      accounts,
      days,
      includeExported: !!includeExported,
    });
    return NextResponse.json(preview);
  } catch (err: any) {
    console.error("[Smart Export Preview API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to generate preview" }, { status: 500 });
  }
}
