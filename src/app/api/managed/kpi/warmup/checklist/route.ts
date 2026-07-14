import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getWarmupChecklist } from "@/lib/services/kpi_system";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  let warmerId = searchParams.get("warmerId") || undefined;

  // Normal employees should only see their own checklist
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { role: true }
  });
  const isManager = user?.role.key === "admin" || user?.role.key === "team_lead";
  if (!isManager) {
    warmerId = session.userId;
  }

  try {
    const checklist = await getWarmupChecklist(warmerId);
    return NextResponse.json(checklist);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load warmup checklist" }, { status: 500 });
  }
}
