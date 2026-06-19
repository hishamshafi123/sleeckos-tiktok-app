export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { createProject } from "@/lib/services/projects";
import prisma from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "projects"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      include: { role: true },
    });
    const isManagement = user?.role?.key === "admin" || user?.role?.key === "team_lead";

    const projects = await prisma.project.findMany({
      where: isManagement
        ? {}
        : {
            members: {
              some: { userId: session.userId },
            },
          },
      include: {
        campaign: { select: { id: true, title: true } },
        members: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
        _count: {
          select: { tasks: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(projects);
  } catch (err: any) {
    console.error("[Projects GET] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to load projects" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "projects"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { name, campaignId } = body;

    if (!name || !campaignId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const project = await createProject(session.userId, name, campaignId);
    return NextResponse.json(project, { status: 201 });
  } catch (err: any) {
    console.error("[Projects POST] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to create project" }, { status: 500 });
  }
}
