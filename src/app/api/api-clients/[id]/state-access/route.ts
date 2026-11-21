export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import {
  revokeApiClientStateAccess,
  setApiClientStateAccess,
} from "@/lib/services/api-clients";

// POST /api/api-clients/[id]/state-access — grant or update state accounts access.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await can(session.userId, "campaigns"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const allStates = body.allStates !== false;
  const stateNames = Array.isArray(body.stateNames)
    ? body.stateNames.filter((s: unknown): s is string => typeof s === "string")
    : [];

  try {
    await setApiClientStateAccess(id, { allStates, stateNames });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid state access config" },
      { status: 400 },
    );
  }
}

// DELETE /api/api-clients/[id]/state-access — revoke state accounts access.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await can(session.userId, "campaigns"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  await revokeApiClientStateAccess(id);
  return NextResponse.json({ ok: true });
}
