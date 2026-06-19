export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import {
  getEnrollmentDashboard,
  getMyEnrollments,
  enrollUsersByCourse,
  enrollSingleUser,
} from "@/lib/services/lms";
import prisma from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const hasAccess = await can(session.userId, "lms");
  if (!hasAccess) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { role: true },
  });
  const isAdmin = user?.role.key === "admin" || user?.role.key === "team_lead";

  if (isAdmin) {
    const dashboard = await getEnrollmentDashboard();
    return NextResponse.json(dashboard);
  } else {
    const enrollments = await getMyEnrollments(session.userId);
    return NextResponse.json(enrollments);
  }
}

export async function POST(req: NextRequest) {
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
    const body = await req.json();
    const { courseId, userId } = body;

    if (!courseId) {
      return NextResponse.json({ error: "courseId is required" }, { status: 400 });
    }

    if (userId) {
      // Enroll a specific user
      const enrollment = await enrollSingleUser(userId, courseId);
      return NextResponse.json(enrollment);
    } else {
      // Auto-enroll all matching role users
      const result = await enrollUsersByCourse(courseId);
      return NextResponse.json(result);
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
