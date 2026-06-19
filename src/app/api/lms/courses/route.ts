export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import {
  getCourses,
  createCourse,
  getMyEnrollments,
} from "@/lib/services/lms";
import prisma from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const hasAccess = await can(session.userId, "lms");
  if (!hasAccess) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  // Check if user is admin/team_lead for full view
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { role: true },
  });
  const isAdmin = user?.role.key === "admin" || user?.role.key === "team_lead";

  if (isAdmin) {
    const courses = await getCourses();
    return NextResponse.json(courses);
  } else {
    // Trainee: return enrolled courses with progress
    const enrollments = await getMyEnrollments(session.userId);
    return NextResponse.json(enrollments);
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const hasAccess = await can(session.userId, "lms");
  if (!hasAccess) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  // Only admin/team_lead can create courses
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { role: true },
  });
  if (user?.role.key !== "admin" && user?.role.key !== "team_lead") {
    return NextResponse.json({ error: "Only admins can create courses" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { title, description, assignedRoles, unlocksToolKey } = body;

    if (!title || !assignedRoles || !Array.isArray(assignedRoles)) {
      return NextResponse.json({ error: "Title and assignedRoles are required" }, { status: 400 });
    }

    const course = await createCourse({ title, description, assignedRoles, unlocksToolKey });
    return NextResponse.json(course, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
