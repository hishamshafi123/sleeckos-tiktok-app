export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { getAuditHistory } from "@/lib/services/agent/agent";
import prisma from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!(await can(session.userId, "agent"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { role: true },
  });
  const isAdmin = user?.role.key === "admin";
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "50", 10);

  try {
    const history = await getAuditHistory(session.userId, isAdmin, limit);
    return NextResponse.json(history);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
