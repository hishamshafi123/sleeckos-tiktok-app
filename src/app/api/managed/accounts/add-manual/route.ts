export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";

// POST /api/managed/accounts/add-manual — add account without TikTok OAuth
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { groupId, tiktokUsername, postpeerAccountId } = body as {
    groupId: string;
    tiktokUsername: string;
    postpeerAccountId?: string;
  };

  if (!groupId || !tiktokUsername?.trim()) {
    return NextResponse.json(
      { error: "Group ID and TikTok username are required." },
      { status: 400 }
    );
  }

  // Verify group exists
  const group = await prisma.accountGroup.findUnique({
    where: { id: groupId },
    include: { section: true },
  });
  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  // Check for duplicate username in this group
  const existing = await prisma.managedAccount.findFirst({
    where: { tiktokUsername: tiktokUsername.trim().replace(/^@/, "") },
  });
  if (existing) {
    return NextResponse.json(
      { error: `@${tiktokUsername} is already added.` },
      { status: 400 }
    );
  }

  const username = tiktokUsername.trim().replace(/^@/, "");

  const account = await prisma.managedAccount.create({
    data: {
      groupId,
      tiktokUsername: username,
      tiktokDisplayName: username,
      postpeerAccountId: postpeerAccountId?.trim() || null,
    },
  });

  return NextResponse.json({
    ok: true,
    account: {
      id: account.id,
      tiktokUsername: account.tiktokUsername,
      postpeerAccountId: account.postpeerAccountId,
    },
  });
}
