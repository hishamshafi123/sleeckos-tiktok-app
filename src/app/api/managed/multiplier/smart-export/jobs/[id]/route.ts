import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import prisma from "@/lib/db";

// GET /api/managed/multiplier/smart-export/jobs/[id] - Gets job progress and latest failed assignments
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "multiplier"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const job = await prisma.smartExportJob.findUnique({ where: { id } });

    if (!job) {
      return NextResponse.json({ error: "Smart Export Job not found" }, { status: 404 });
    }

    const [statusCounts, failedAssignments] = await Promise.all([
      prisma.smartExportAssignment.groupBy({
        by: ["status"],
        where: { jobId: id },
        _count: { _all: true },
      }),
      prisma.smartExportAssignment.findMany({
        where: { jobId: id, status: "failed" },
        include: {
          video: {
            select: {
              id: true,
              outputRef: true,
              hook: { select: { text: true } },
              group: { select: { name: true } },
            },
          },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: 100,
      }),
    ]);

    const assignmentCounts = { total: 0, done: 0, failed: 0, pending: 0 };
    for (const row of statusCounts) {
      const count = row._count._all;
      assignmentCounts.total += count;
      if (row.status === "done") assignmentCounts.done += count;
      if (row.status === "failed") assignmentCounts.failed += count;
      if (row.status === "pending" || row.status === "uploading") assignmentCounts.pending += count;
    }

    return NextResponse.json({
      job: { ...job, assignmentCounts, assignments: failedAssignments },
    });
  } catch (err: unknown) {
    console.error("[Smart Export Job Detail Route] Error:", err);
    const message = err instanceof Error ? err.message : "Failed to retrieve job details";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
