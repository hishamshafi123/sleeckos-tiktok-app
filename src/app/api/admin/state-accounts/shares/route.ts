export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  createStateAccountShare,
  listStateAccountShares,
  revokeStateAccountShare,
} from "@/lib/services/state-accounts/client-portal";

// GET /api/admin/state-accounts/shares — list all client portal share links.
export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin")
    return NextResponse.json(
      { error: "Only admins can manage client access links." },
      { status: 403 },
    );
  try {
    const shares = await listStateAccountShares();
    return NextResponse.json({ shares });
  } catch (err) {
    console.error("[State Shares] list error:", err);
    return NextResponse.json(
      { error: "Could not load client share links." },
      { status: 500 },
    );
  }
}

// POST /api/admin/state-accounts/shares — create a new client portal share link.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin")
    return NextResponse.json(
      { error: "Only admins can create client access links." },
      { status: 403 },
    );
  try {
    const body = await req.json().catch(() => ({}));
    const title = typeof body.title === "string" ? body.title : "";
    const label = typeof body.label === "string" ? body.label : undefined;
    const allStates = body.allStates !== false;
    const stateNames = Array.isArray(body.stateNames)
      ? body.stateNames.filter((s: unknown): s is string => typeof s === "string")
      : [];
    const expiresInDays =
      typeof body.expiresInDays === "number" && Number.isFinite(body.expiresInDays)
        ? body.expiresInDays
        : null;

    const share = await createStateAccountShare({
      title,
      label,
      allStates,
      stateNames,
      expiresInDays,
      createdBy: session.email,
    });
    return NextResponse.json({ share });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not create share link." },
      { status: 400 },
    );
  }
}

// DELETE /api/admin/state-accounts/shares — revoke a share link by { id }.
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin")
    return NextResponse.json(
      { error: "Only admins can revoke client access links." },
      { status: 403 },
    );
  try {
    const body = await req.json().catch(() => ({}));
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) {
      return NextResponse.json({ error: "Share ID is required." }, { status: 400 });
    }
    await revokeStateAccountShare(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[State Shares] revoke error:", err);
    return NextResponse.json(
      { error: "Could not revoke share link." },
      { status: 500 },
    );
  }
}
