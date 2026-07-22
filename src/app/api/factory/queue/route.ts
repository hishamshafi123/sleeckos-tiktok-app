export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { getFactoryQueueOverview } from "@/lib/services/factory";

/**
 * GET /api/factory/queue — queue state for the operator UI:
 * { paused, processing, staleRendering }
 * (staleRendering = items stuck in RENDERING for more than 2 minutes)
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "composer"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const state = await getFactoryQueueOverview();
    return NextResponse.json(state);
  } catch (err: any) {
    console.error("[Factory Queue GET] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to load queue state" }, { status: 500 });
  }
}
