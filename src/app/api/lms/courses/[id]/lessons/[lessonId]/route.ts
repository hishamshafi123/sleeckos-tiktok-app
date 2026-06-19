export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import {
  getLessonDetails,
  updateLesson,
  deleteLesson,
  markLessonComplete,
  submitQuizAnswers,
  addQuizQuestion,
  updateQuizQuestion,
  deleteQuizQuestion,
} from "@/lib/services/lms";
import prisma from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; lessonId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const hasAccess = await can(session.userId, "lms");
  if (!hasAccess) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const { lessonId } = await params;
  const lesson = await getLessonDetails(lessonId, session.userId);
  if (!lesson) return NextResponse.json({ error: "Lesson not found" }, { status: 404 });

  return NextResponse.json(lesson);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; lessonId: string }> }
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
    const { lessonId } = await params;
    const body = await req.json();
    const { action } = body;

    // Quiz question management actions
    if (action === "ADD_QUIZ") {
      const { prompt, options, correctIndex } = body;
      if (!prompt || !Array.isArray(options) || correctIndex === undefined) {
        return NextResponse.json({ error: "prompt, options[], and correctIndex required" }, { status: 400 });
      }
      const question = await addQuizQuestion({ lessonId, prompt, options, correctIndex });
      return NextResponse.json(question);
    }

    if (action === "UPDATE_QUIZ") {
      const { questionId, ...data } = body;
      if (!questionId) return NextResponse.json({ error: "questionId required" }, { status: 400 });
      const question = await updateQuizQuestion(questionId, data);
      return NextResponse.json(question);
    }

    if (action === "DELETE_QUIZ") {
      const { questionId } = body;
      if (!questionId) return NextResponse.json({ error: "questionId required" }, { status: 400 });
      await deleteQuizQuestion(questionId);
      return NextResponse.json({ success: true });
    }

    // Default: update lesson content
    const updated = await updateLesson(lessonId, body);
    return NextResponse.json(updated);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; lessonId: string }> }
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
    const { lessonId } = await params;
    await deleteLesson(lessonId);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST: mark lesson complete or submit quiz
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; lessonId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const hasAccess = await can(session.userId, "lms");
  if (!hasAccess) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  try {
    const { lessonId } = await params;
    const body = await req.json();
    const { action, answers } = body;

    if (action === "SUBMIT_QUIZ") {
      if (!Array.isArray(answers)) {
        return NextResponse.json({ error: "answers[] required" }, { status: 400 });
      }
      const result = await submitQuizAnswers(session.userId, lessonId, answers);
      return NextResponse.json(result);
    }

    // Default: mark complete
    const progress = await markLessonComplete(session.userId, lessonId);
    return NextResponse.json(progress);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
