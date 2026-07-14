import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { completeWarmupTask } from "@/lib/services/kpi_system";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { enrollmentId } = body;
    if (!enrollmentId) {
      return NextResponse.json({ error: "Missing enrollmentId parameter" }, { status: 400 });
    }

    const updated = await completeWarmupTask(enrollmentId, session.userId);
    return NextResponse.json(updated);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to complete warmup checklist task" }, { status: 500 });
  }
}
