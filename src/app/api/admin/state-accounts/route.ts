import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  getStateDashboard,
  stateAccess,
  updateStateConfig,
} from "@/lib/services/state-accounts/data";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await stateAccess(session.userId, session.role)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const data = await getStateDashboard(session.role === "admin");
    return NextResponse.json(
      JSON.parse(
        JSON.stringify(data, (_, value) =>
          typeof value === "bigint" ? value.toString() : value,
        ),
      ),
    );
  } catch (error) {
    console.error("[State accounts] Dashboard failed", error);
    return NextResponse.json(
      { error: "Could not load state accounts. Please try again." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin")
    return NextResponse.json(
      { error: "Only admins can manage teams and KPIs." },
      { status: 403 },
    );
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    await updateStateConfig(body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "P2002")
      return NextResponse.json(
        { error: "That team name or Guardian phone is already assigned." },
        { status: 409 },
      );
    if (code === "P2025")
      return NextResponse.json(
        { error: "The selected team or account no longer exists." },
        { status: 404 },
      );
    if (code) {
      console.error("[State accounts] Update failed", error);
      return NextResponse.json(
        { error: "Could not save changes." },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request." },
      { status: 400 },
    );
  }
}
