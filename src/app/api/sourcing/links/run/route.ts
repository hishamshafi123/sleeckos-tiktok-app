export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { startSourcingRun } from "@/lib/services/sourcing";

// POST /api/sourcing/links/run — { links: string[] } → { runId }
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "sourcing"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { links } = await req.json().catch(() => ({}));
  if (!Array.isArray(links) || links.length === 0 || !links.every((l) => typeof l === "string")) {
    return NextResponse.json({ error: "links must be a non-empty string array" }, { status: 400 });
  }

  try {
    const result = await startSourcingRun(session.userId, links);
    return NextResponse.json({ runId: result.runId, created: result.created, parse: result.parse }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to start sourcing run" },
      { status: 400 }
    );
  }
}
