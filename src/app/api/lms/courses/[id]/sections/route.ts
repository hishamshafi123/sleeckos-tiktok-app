export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import {
  createSection,
  reorderSections,
} from "@/lib/services/lms";
import prisma from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const hasAccess = await can(session.userId, "lms");
  if (!hasAccess) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const { id: courseId } = await params;
  const sections = await prisma.section.findMany({
    where: { courseId },
    orderBy: { order: "asc" },
  });

  return NextResponse.json(sections);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { role: true },
  });
  if (user?.role.key !== "admin" && user?.role.key !== "team_lead") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  try {
    const { id: courseId } = await params;
    const body = await req.json();
    const { action } = body;

    if (action === "REORDER") {
      const { sectionIds } = body;
      if (!Array.isArray(sectionIds)) {
        return NextResponse.json({ error: "sectionIds array required" }, { status: 400 });
      }
      await reorderSections(courseId, sectionIds);
      return NextResponse.json({ success: true });
    }

    const { title, order } = body;
    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const section = await createSection({ courseId, title, order });
    return NextResponse.json(section, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
