export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { getRenderQueueState } from "@/lib/services/multiplier";
import { getMultiplierPerformanceState } from "@/lib/services/multiplier-performance";
import prisma from "@/lib/db";

// GET /api/multiplier/queue — active renders plus groups finished in the last 24h
export async function GET() {
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

    const [staleRendering, performance] = await Promise.all([
      prisma.multiplierOutput.count({
        where: { status: "RENDERING", updatedAt: { lt: new Date(Date.now() - 2 * 60 * 1000) } },
      }),
      getMultiplierPerformanceState(),
    ]);

    return NextResponse.json({
      groups: queue,
      state: { ...getRenderQueueState(), staleRendering, performance },
    });
  } catch (err: unknown) {
    console.error("[Multiplier Queue GET API] Error:", err);
    const message = err instanceof Error ? err.message : "Failed to fetch render queue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
