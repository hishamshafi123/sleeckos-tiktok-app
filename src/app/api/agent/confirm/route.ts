export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { confirmAction } from "@/lib/services/agent/agent";
import prisma from "@/lib/db";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Only admin/team_lead can confirm agent actions
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { role: true },
  });
  if (user?.role.key !== "admin" && user?.role.key !== "team_lead") {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { auditLogId, approved } = body;

    if (!auditLogId || typeof approved !== "boolean") {
      return NextResponse.json(
        { error: "auditLogId and approved (boolean) are required" },
        { status: 400 }
      );
    }

    const response = await confirmAction(session.userId, auditLogId, approved);
    return NextResponse.json(response);
  } catch (err: any) {
    console.error("[Agent Confirm] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
