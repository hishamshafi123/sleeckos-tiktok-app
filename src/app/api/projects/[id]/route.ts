export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { addProjectMember, removeProjectMember } from "@/lib/services/projects";
import prisma from "@/lib/db";

export async function GET(
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
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        campaign: { select: { id: true, title: true } },
        members: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
        tasks: {
          include: {
            assignee: { select: { id: true, name: true, email: true } },
            clipMixerBatch: { select: { id: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        activityLogs: {
          include: {
            actor: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Verify membership if not Admin/Team Lead
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      include: { role: true },
    });
    const isManagement = user?.role?.key === "admin" || user?.role?.key === "team_lead";

    if (!isManagement) {
      const isMember = project.members.some((m) => m.userId === session.userId);
      if (!isMember) {
        return NextResponse.json({ error: "Forbidden: Not a member of this project" }, { status: 403 });
      }
    }

    return NextResponse.json(project);
  } catch (err: any) {
    console.error("[Project GET] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to load project details" }, { status: 500 });
  }
}

export async function PATCH(
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
    // Only Admin/Lead can modify project details or manage members
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      include: { role: true },
    });
    const isManagement = user?.role?.key === "admin" || user?.role?.key === "team_lead";

    const projectMember = await prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: session.userId,
        },
      },
    });

    const canModify = isManagement || projectMember?.projectRole === "LEAD";
    if (!canModify) {
      return NextResponse.json({ error: "Forbidden: Lead access required to modify project" }, { status: 403 });
    }

    const body = await req.json();
    const { action, name, status, memberUserId, projectRole } = body;

    if (action === "ADD_MEMBER") {
      if (!memberUserId || !projectRole) {
        return NextResponse.json({ error: "Missing memberUserId or projectRole" }, { status: 400 });
      }
      const member = await addProjectMember(session.userId, projectId, memberUserId, projectRole);
      return NextResponse.json(member);
    }

    if (action === "REMOVE_MEMBER") {
      if (!memberUserId) {
        return NextResponse.json({ error: "Missing memberUserId" }, { status: 400 });
      }
      const member = await removeProjectMember(session.userId, projectId, memberUserId);
      return NextResponse.json(member);
    }

    // Default metadata update action
    const data: any = {};
    if (name !== undefined) data.name = name.trim();
    if (status !== undefined) data.status = status;

    const updatedProject = await prisma.project.update({
      where: { id: projectId },
      data,
    });

    return NextResponse.json(updatedProject);
  } catch (err: any) {
    console.error("[Project PATCH] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to update project" }, { status: 500 });
  }
}

export async function DELETE(
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
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      include: { role: true },
    });
    const isManagement = user?.role?.key === "admin" || user?.role?.key === "team_lead";

    const projectMember = await prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: session.userId,
        },
      },
    });

    const canDelete = isManagement || projectMember?.projectRole === "LEAD";
    if (!canDelete) {
      return NextResponse.json({ error: "Forbidden: Lead access required to delete project" }, { status: 403 });
    }

    await prisma.project.delete({
      where: { id: projectId },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[Project DELETE] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to delete project" }, { status: 500 });
  }
}
