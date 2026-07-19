export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import prisma from "@/lib/db";

// GET /api/multiplier/queue — active renders plus groups finished in the last 24h
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const groups = await prisma.multiplierGroup.findMany({
      where: {
        OR: [
          { status: { in: ["QUEUED", "RENDERING"] } },
          { status: { in: ["COMPLETED", "FAILED"] }, updatedAt: { gte: since } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      include: {
        outputs: { select: { status: true } },
      },
    });

    const queue = groups.map((g) => ({
      id: g.id,
      name: g.name,
      status: g.status,
      errorMessage: g.errorMessage,
      updatedAt: g.updatedAt,
      outputCounts: {
        pending: g.outputs.filter((o) => o.status === "PENDING").length,
        rendering: g.outputs.filter((o) => o.status === "RENDERING").length,
        completed: g.outputs.filter((o) => o.status === "COMPLETED").length,
        failed: g.outputs.filter((o) => o.status === "FAILED").length,
      },
    }));

    return NextResponse.json({ groups: queue });
  } catch (err: any) {
    console.error("[Multiplier Queue GET API] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch render queue" }, { status: 500 });
  }
}
