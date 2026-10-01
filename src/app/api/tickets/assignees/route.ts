export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { listAssignees } from "@/lib/services/tickets";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "tickets"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const users = await listAssignees();
    return NextResponse.json({ users });
  } catch (err: any) {
    console.error("[Ticket Assignees GET] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to load assignees" }, { status: 500 });
  }
}
