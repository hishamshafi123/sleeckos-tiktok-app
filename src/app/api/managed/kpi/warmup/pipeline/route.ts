import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getWarmupPipelineHealth } from "@/lib/services/kpi_system";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check permissions
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { role: true }
  });
  if (user?.role.key !== "admin" && user?.role.key !== "team_lead") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const health = await getWarmupPipelineHealth();
    return NextResponse.json(health);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load pipeline health metrics" }, { status: 500 });
  }
}
