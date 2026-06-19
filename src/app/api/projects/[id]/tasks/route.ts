export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { createTask } from "@/lib/services/projects";
import prisma from "@/lib/db";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "projects"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: projectId } = await params;

  try {
    // Verify project exists and check if user has edit rights
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { members: true },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      include: { role: true },
    });
    const isManagement = user?.role?.key === "admin" || user?.role?.key === "team_lead";
    const isMember = project.members.some((m) => m.userId === session.userId);

    if (!isManagement && !isMember) {
      return NextResponse.json({ error: "Forbidden: Not a member of this project" }, { status: 403 });
    }

    const body = await req.json();
    const { title, description, assigneeId, dueDate, tags, clipMixerBatchId } = body;

    if (!title) {
      return NextResponse.json({ error: "Missing title" }, { status: 400 });
    }

    const task = await createTask(session.userId, projectId, {
      title,
      description,
      assigneeId,
      dueDate,
      tags,
      clipMixerBatchId,
    });

    return NextResponse.json(task, { status: 201 });
  } catch (err: any) {
    console.error("[Tasks POST] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to create task" }, { status: 500 });
  }
}
