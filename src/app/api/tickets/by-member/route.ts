export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { getTicketsByMember } from "@/lib/services/tickets";

// GET /api/tickets/by-member — all tickets grouped by assignee (workload view).
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "tickets"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    return NextResponse.json(await getTicketsByMember(session.userId));
  } catch (err: any) {
    console.error("[Tickets by-member GET] Error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to load tickets" },
      { status: err.status || 500 }
    );
  }
}
