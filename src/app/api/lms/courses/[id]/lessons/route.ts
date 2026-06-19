export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import {
  createLesson,
  reorderLessons,
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

  const { id } = await params;
  const lessons = await prisma.lesson.findMany({
    where: { courseId: id },
    orderBy: { order: "asc" },
    include: {
      quizQuestions: { orderBy: { createdAt: "asc" } },
      _count: { select: { progress: true } },
    },
  });

  return NextResponse.json(lessons);
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
    const { id } = await params;
    const body = await req.json();
    const { title, youtubeUrl, sopMarkdown, order } = body;

    if (!title || !youtubeUrl) {
      return NextResponse.json({ error: "Title and YouTube URL are required" }, { status: 400 });
    }

    const lesson = await createLesson({
      courseId: id,
      title,
      youtubeUrl,
      sopMarkdown: sopMarkdown || "",
      order,
    });
    return NextResponse.json(lesson, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH for reordering lessons
export async function PATCH(
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
    const { id } = await params;
    const { lessonIds } = await req.json();

    if (!Array.isArray(lessonIds)) {
      return NextResponse.json({ error: "lessonIds array required" }, { status: 400 });
    }

    await reorderLessons(id, lessonIds);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
