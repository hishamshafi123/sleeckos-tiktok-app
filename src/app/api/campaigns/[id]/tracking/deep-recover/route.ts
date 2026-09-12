export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { deepRecoverUnresolved } from "@/lib/services/analytics/deep-recover";

// POST /api/campaigns/[id]/tracking/deep-recover — one deep pass (paginated,
// ~150 videos back) over every account holding unresolved links of this
// campaign, then terminally retires still-unresolved links older than 3 days
// as "unavailable" (not publicly visible — suppressed accounts). Runs in the
// background.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "campaigns"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  (async () => {
    try {
      await deepRecoverUnresolved(id);
    } catch (err) {
      console.error("[DeepRecover] Background run failed:", err);
    }
  })();

  return NextResponse.json({ ok: true, started: true });
}
