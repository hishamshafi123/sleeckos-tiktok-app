export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { listTickets, createTicket, TicketView } from "@/lib/services/tickets";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "tickets"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const viewParam = searchParams.get("view");
    const view: TicketView =
      viewParam === "created" || viewParam === "all" ? viewParam : "mine";

    const statusParam = searchParams.get("status");
    const statusFilter = statusParam
      ? statusParam.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

    const tickets = await listTickets(session.userId, view, statusFilter);
    return NextResponse.json({ tickets });
  } catch (err: any) {
    console.error("[Tickets GET] Error:", err);
    return NextResponse.json({ error: err.message || "Failed to load tickets" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "tickets"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const ticket = await createTicket(session.userId, body);
    return NextResponse.json({ ticket }, { status: 201 });
  } catch (err: any) {
    console.error("[Tickets POST] Error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to create ticket" },
      { status: err.status || 500 }
    );
  }
}
