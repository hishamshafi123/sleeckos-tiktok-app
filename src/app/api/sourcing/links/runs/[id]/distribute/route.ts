export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { previewDistribution, runDistribution } from "@/lib/services/sourcing";

// POST /api/sourcing/links/runs/[id]/distribute — { accountCounts, allowReuse }
// Computes the plan server-side from the same inputs as /preview (a client-sent
// plan is never trusted), creates assignments and kicks off the upload worker.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "sourcing"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const accountCounts = body.accountCounts;
  if (
    !Array.isArray(accountCounts) ||
    !accountCounts.every((a) => typeof a?.accountId === "string" && typeof a?.count === "number")
  ) {
    return NextResponse.json(
      { error: "accountCounts must be an array of { accountId, count }" },
      { status: 400 }
    );
  }

  try {
    const { plan, feasibility } = await previewDistribution(id, accountCounts, body.allowReuse === true);
    const result = await runDistribution(id, plan);
    return NextResponse.json({ ...result, feasibility });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to start distribution" },
      { status: 400 }
    );
  }
}
