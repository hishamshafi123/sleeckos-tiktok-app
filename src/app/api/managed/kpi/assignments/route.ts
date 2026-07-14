import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import prisma from "@/lib/db";
import { assignFunction } from "@/lib/services/kpi_system";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId") || undefined;

  try {
    const assignments = await prisma.functionAssignment.findMany({
      where: {
        ...(userId ? { userId } : {})
      },
      include: {
        user: { select: { id: true, name: true, email: true } }
      },
      orderBy: { startDate: "desc" }
    });
    return NextResponse.json(assignments);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load assignments" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check admin/lead permissions
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { role: true }
  });
  if (user?.role.key !== "admin" && user?.role.key !== "team_lead") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { userId, functionType, startDate, endDate } = body;
    if (!userId || !functionType || !startDate) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const assignment = await assignFunction(
      userId,
      functionType,
      new Date(startDate),
      endDate ? new Date(endDate) : null
    );
    return NextResponse.json(assignment);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to assign job function" }, { status: 500 });
  }
}
