import prisma from "@/lib/db";
import { unlockToolForUser } from "@/lib/services/permissions";

// ─── Course CRUD (Admin) ───────────────────────────────

export async function createCourse(data: {
  title: string;
  description?: string;
  assignedRoles: string[];
  unlocksToolKey?: string;
}) {
  return prisma.course.create({
    data: {
      title: data.title,
      description: data.description || null,
      assignedRoles: data.assignedRoles,
      unlocksToolKey: data.unlocksToolKey || null,
    },
  });
}

export async function updateCourse(
  courseId: string,
  data: {
    title?: string;
    description?: string;
    assignedRoles?: string[];
    unlocksToolKey?: string | null;
    status?: string;
  }
) {
  return prisma.course.update({
    where: { id: courseId },
    data,
  });
}

export async function deleteCourse(courseId: string) {
  return prisma.course.delete({ where: { id: courseId } });
}

export async function getCourses() {
  return prisma.course.findMany({
    include: {
      _count: { select: { lessons: true, enrollments: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getCourseDetails(courseId: string) {
  return prisma.course.findUnique({
    where: { id: courseId },
    include: {
      lessons: {
        orderBy: { order: "asc" },
        include: {
          quizQuestions: true,
          _count: { select: { progress: true } },
        },
      },
      enrollments: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

// ─── Lesson CRUD (Admin) ──────────────────────────────

export async function createLesson(data: {
  courseId: string;
  title: string;
  youtubeUrl: string;
  sopMarkdown: string;
  order?: number;
}) {
  // Auto-assign order if not provided
  let order = data.order;
  if (order === undefined || order === null) {
    const maxLesson = await prisma.lesson.findFirst({
      where: { courseId: data.courseId },
      orderBy: { order: "desc" },
    });
    order = (maxLesson?.order ?? -1) + 1;
  }

  return prisma.lesson.create({
    data: {
      courseId: data.courseId,
      title: data.title,
      youtubeUrl: data.youtubeUrl,
      sopMarkdown: data.sopMarkdown,
      order,
    },
  });
}

export async function updateLesson(
  lessonId: string,
  data: {
    title?: string;
    youtubeUrl?: string;
    sopMarkdown?: string;
    order?: number;
  }
) {
  return prisma.lesson.update({
    where: { id: lessonId },
    data,
  });
}

export async function deleteLesson(lessonId: string) {
  return prisma.lesson.delete({ where: { id: lessonId } });
}

export async function reorderLessons(courseId: string, lessonIds: string[]) {
  const updates = lessonIds.map((id, idx) =>
    prisma.lesson.update({
      where: { id },
      data: { order: idx },
    })
  );
  return prisma.$transaction(updates);
}

export async function getLessonDetails(lessonId: string, userId?: string) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: {
      quizQuestions: { orderBy: { createdAt: "asc" } },
      course: { select: { id: true, title: true } },
    },
  });

  if (!lesson) return null;

  let progress = null;
  if (userId) {
    progress = await prisma.lessonProgress.findUnique({
      where: {
        userId_lessonId: { userId, lessonId },
      },
    });
  }

  return { ...lesson, userProgress: progress };
}

// ─── Quiz CRUD (Admin) ────────────────────────────────

export async function addQuizQuestion(data: {
  lessonId: string;
  prompt: string;
  options: string[];
  correctIndex: number;
}) {
  return prisma.quizQuestion.create({ data });
}

export async function updateQuizQuestion(
  questionId: string,
  data: {
    prompt?: string;
    options?: string[];
    correctIndex?: number;
  }
) {
  return prisma.quizQuestion.update({
    where: { id: questionId },
    data,
  });
}

export async function deleteQuizQuestion(questionId: string) {
  return prisma.quizQuestion.delete({ where: { id: questionId } });
}

// ─── Enrollment & Progress ────────────────────────────

export async function enrollUsersByCourse(courseId: string) {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { assignedRoles: true },
  });

  if (!course) throw new Error("Course not found");

  // Find all users whose role key matches the assignedRoles
  const roles = await prisma.role.findMany({
    where: { key: { in: course.assignedRoles } },
    select: { id: true },
  });
  const roleIds = roles.map((r) => r.id);

  const users = await prisma.user.findMany({
    where: {
      roleId: { in: roleIds },
      status: { not: "DISABLED" },
    },
    select: { id: true },
  });

  let enrolled = 0;
  for (const user of users) {
    const existing = await prisma.courseEnrollment.findUnique({
      where: {
        userId_courseId: { userId: user.id, courseId },
      },
    });
    if (!existing) {
      await prisma.courseEnrollment.create({
        data: { userId: user.id, courseId, status: "assigned" },
      });
      enrolled++;
    }
  }

  return { enrolled, total: users.length };
}

export async function enrollSingleUser(userId: string, courseId: string) {
  return prisma.courseEnrollment.upsert({
    where: {
      userId_courseId: { userId, courseId },
    },
    update: {},
    create: { userId, courseId, status: "assigned" },
  });
}

export async function getMyEnrollments(userId: string) {
  const enrollments = await prisma.courseEnrollment.findMany({
    where: { userId },
    include: {
      course: {
        include: {
          lessons: {
            orderBy: { order: "asc" },
            select: { id: true, title: true, order: true },
          },
          _count: { select: { lessons: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Attach per-lesson completion status
  const lessonProgress = await prisma.lessonProgress.findMany({
    where: { userId },
    select: { lessonId: true },
  });
  const completedLessonIds = new Set(lessonProgress.map((lp) => lp.lessonId));

  return enrollments.map((e) => ({
    ...e,
    completedLessons: e.course.lessons.filter((l) => completedLessonIds.has(l.id)).length,
    totalLessons: e.course._count.lessons,
  }));
}

/**
 * Mark a lesson as complete (no quiz required).
 */
export async function markLessonComplete(userId: string, lessonId: string) {
  // Check if lesson has quiz questions
  const quizCount = await prisma.quizQuestion.count({
    where: { lessonId },
  });

  if (quizCount > 0) {
    throw new Error("This lesson has quiz questions. Submit quiz answers to complete it.");
  }

  const progress = await prisma.lessonProgress.upsert({
    where: {
      userId_lessonId: { userId, lessonId },
    },
    update: { completedAt: new Date() },
    create: { userId, lessonId },
  });

  // Update enrollment status
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { courseId: true },
  });
  if (lesson) {
    await updateEnrollmentStatus(userId, lesson.courseId);
    await checkCourseCompletion(userId, lesson.courseId);
  }

  return progress;
}

/**
 * Submit quiz answers for a lesson. All must be correct to pass.
 */
export async function submitQuizAnswers(
  userId: string,
  lessonId: string,
  answers: number[] // user's selected indexes per question, in order of quizQuestions
) {
  const questions = await prisma.quizQuestion.findMany({
    where: { lessonId },
    orderBy: { createdAt: "asc" },
  });

  if (questions.length === 0) {
    throw new Error("This lesson has no quiz questions.");
  }

  if (answers.length !== questions.length) {
    throw new Error(`Expected ${questions.length} answers, got ${answers.length}.`);
  }

  let correct = 0;
  const results: { questionId: string; correct: boolean; yourAnswer: number; correctAnswer: number }[] = [];

  for (let i = 0; i < questions.length; i++) {
    const isCorrect = answers[i] === questions[i].correctIndex;
    if (isCorrect) correct++;
    results.push({
      questionId: questions[i].id,
      correct: isCorrect,
      yourAnswer: answers[i],
      correctAnswer: questions[i].correctIndex,
    });
  }

  const passed = correct === questions.length;

  if (passed) {
    await prisma.lessonProgress.upsert({
      where: {
        userId_lessonId: { userId, lessonId },
      },
      update: { completedAt: new Date(), quizScore: correct },
      create: { userId, lessonId, quizScore: correct },
    });

    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { courseId: true },
    });
    if (lesson) {
      await updateEnrollmentStatus(userId, lesson.courseId);
      await checkCourseCompletion(userId, lesson.courseId);
    }
  }

  return {
    passed,
    score: correct,
    total: questions.length,
    results,
  };
}

/**
 * Check if all lessons in a course are complete; if so, mark enrollment completed
 * and unlock tool if configured.
 */
async function checkCourseCompletion(userId: string, courseId: string) {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: { lessons: { select: { id: true } } },
  });

  if (!course) return;

  const lessonIds = course.lessons.map((l) => l.id);
  const completedCount = await prisma.lessonProgress.count({
    where: {
      userId,
      lessonId: { in: lessonIds },
    },
  });

  if (completedCount >= lessonIds.length && lessonIds.length > 0) {
    // Mark enrollment as completed
    await prisma.courseEnrollment.update({
      where: {
        userId_courseId: { userId, courseId },
      },
      data: {
        status: "completed",
        completedAt: new Date(),
      },
    });

    // Unlock tool if configured
    if (course.unlocksToolKey) {
      await unlockToolForUser(userId, course.unlocksToolKey, `Completed LMS course: ${course.title}`);
    }
  }
}

/**
 * Update enrollment status to in_progress when at least one lesson is completed.
 */
async function updateEnrollmentStatus(userId: string, courseId: string) {
  const enrollment = await prisma.courseEnrollment.findUnique({
    where: {
      userId_courseId: { userId, courseId },
    },
  });

  if (enrollment && enrollment.status === "assigned") {
    await prisma.courseEnrollment.update({
      where: { id: enrollment.id },
      data: { status: "in_progress" },
    });
  }
}

// ─── Admin Dashboard ──────────────────────────────────

export async function getEnrollmentDashboard() {
  const enrollments = await prisma.courseEnrollment.findMany({
    include: {
      user: { select: { id: true, name: true, email: true, status: true } },
      course: {
        select: {
          id: true,
          title: true,
          unlocksToolKey: true,
          _count: { select: { lessons: true } },
        },
      },
    },
    orderBy: [{ course: { title: "asc" } }, { user: { name: "asc" } }],
  });

  // Batch-fetch all lesson progress for these users
  const userIds = [...new Set(enrollments.map((e) => e.userId))];
  const allProgress = await prisma.lessonProgress.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, lessonId: true, lesson: { select: { courseId: true } } },
  });

  // Build a map: userId -> courseId -> completedCount
  const progressMap = new Map<string, Map<string, number>>();
  for (const p of allProgress) {
    if (!progressMap.has(p.userId)) progressMap.set(p.userId, new Map());
    const userMap = progressMap.get(p.userId)!;
    const courseId = p.lesson.courseId;
    userMap.set(courseId, (userMap.get(courseId) || 0) + 1);
  }

  return enrollments.map((e) => ({
    ...e,
    completedLessons: progressMap.get(e.userId)?.get(e.courseId) || 0,
    totalLessons: e.course._count.lessons,
  }));
}
