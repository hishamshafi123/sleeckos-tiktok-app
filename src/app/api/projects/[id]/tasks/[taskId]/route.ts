export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { updateTask, deleteTask } from "@/lib/services/projects";
import prisma from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "projects"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: projectId, taskId } = await params;

  try {
    // Verify task belongs to project
    const task = await prisma.task.findFirst({
      where: { id: taskId, projectId },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found in this project" }, { status: 404 });
    }

    const body = await req.json();
    const updated = await updateTask(session.userId, taskId, body);

    return NextResponse.json(updated);
  } catch (err: any) {
    console.error("[Task PATCH] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to update task" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "projects"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: projectId, taskId } = await params;

  try {
    const task = await prisma.task.findFirst({
      where: { id: taskId, projectId },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found in this project" }, { status: 404 });
    }

    const deleted = await deleteTask(session.userId, taskId);
    return NextResponse.json(deleted);
  } catch (err: any) {
    console.error("[Task DELETE] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to delete task" }, { status: 500 });
  }
}
