export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";

// POST /api/sourcing/niches/[id]/accounts — add an account to a niche
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "sourcing"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: nicheId } = await params;
  const { accountId } = await req.json();
  if (!accountId) return NextResponse.json({ error: "accountId required" }, { status: 400 });

  try {
    await prisma.sourcingNicheAccount.create({ data: { nicheId, accountId } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Account already in this niche" }, { status: 409 });
  }
}

// DELETE /api/sourcing/niches/[id]/accounts — remove an account from a niche
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "sourcing"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: nicheId } = await params;
  const { accountId } = await req.json();

  await prisma.sourcingNicheAccount.delete({
    where: { nicheId_accountId: { nicheId, accountId } },
  });
  return NextResponse.json({ ok: true });
}
