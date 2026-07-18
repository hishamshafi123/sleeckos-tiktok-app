import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import prisma from "@/lib/db";

// GET /api/managed/multiplier/smart-export/jobs/[id] - Gets job and its assignments details
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
    const job = await prisma.smartExportJob.findUnique({
      where: { id },
      include: {
        assignments: {
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
          orderBy: { id: "asc" },
        },
      },
    });

    if (!job) {
      return NextResponse.json({ error: "Smart Export Job not found" }, { status: 404 });
    }

    return NextResponse.json({ job });
  } catch (err: any) {
    console.error("[Smart Export Job Detail Route] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to retrieve job details" }, { status: 500 });
  }
}
