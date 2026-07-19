import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { previewSmartExportAccounts, runSmartExport } from "@/lib/services/multiplier-export";

// POST /api/multiplier/smart-export/run
// Body: { groupIds: string[], accounts: { driveFolderId: string, name?: string, count: number }[], days?: number = 1, includeExported?: boolean }
// Computes the feasible plan server-side, then starts the export job.
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

    // Only fully fulfillable folders make it into the run
    const unfulfillableIds = new Set(preview.unfulfillable.map((u) => u.driveFolderId));
    const plan = preview.assignments.filter(
      (a) => !unfulfillableIds.has(a.driveFolderId) && a.videoIds.length > 0
    );

    if (plan.length === 0) {
      return NextResponse.json(
        { error: "No fulfillable account allocations — nothing to export", budget: preview.videoBudget, unfulfillable: preview.unfulfillable },
        { status: 400 }
      );
    }

    const job = await runSmartExport(session.userId, groupIds, plan, preview.days);

    return NextResponse.json({
      jobId: job.id,
      budget: preview.videoBudget,
      unfulfillable: preview.unfulfillable,
    });
  } catch (err: any) {
    console.error("[Smart Export Run API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to launch smart export" }, { status: 500 });
  }
}
