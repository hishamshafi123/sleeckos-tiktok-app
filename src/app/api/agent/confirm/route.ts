export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { confirmAction } from "@/lib/services/agent/agent";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!(await can(session.userId, "agent"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
