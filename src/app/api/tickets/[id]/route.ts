export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { updateTicket, deleteTicket } from "@/lib/services/tickets";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "tickets"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const body = await req.json();
    const ticket = await updateTicket(id, body);
    return NextResponse.json({ ticket });
  } catch (err: any) {
    console.error("[Ticket PATCH] Error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to update ticket" },
      { status: err.status || 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "tickets"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    await deleteTicket(session.userId, id);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[Ticket DELETE] Error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to delete ticket" },
      { status: err.status || 500 }
    );
  }
}
