export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";
import { can } from "@/lib/services/permissions";
import { validatePostPeerAccount } from "@/lib/services/accounts";

// PATCH /api/managed/accounts/[id] — update account settings
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "accounts"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const data: Record<string, unknown> = {};

  const currentAccount = await prisma.managedAccount.findUnique({ where: { id } });
  if (!currentAccount) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  // Schedule settings
  if (body.postTimeHour !== undefined) data.postTimeHour = body.postTimeHour;
  if (body.postTimeMinute !== undefined)
    data.postTimeMinute = body.postTimeMinute;
  if (body.postTimezone !== undefined) data.postTimezone = body.postTimezone;
  if (body.postDays !== undefined) data.postDays = body.postDays;
  if (body.postMode !== undefined) data.postMode = body.postMode;
  if (body.postTimeSlots !== undefined) data.postTimeSlots = body.postTimeSlots;
  
  const newPostPeerId = body.postpeerAccountId?.trim() || null;
  const currentPostPeerId = currentAccount.postpeerAccountId?.trim() || null;

  if (body.postpeerAccountId !== undefined && newPostPeerId !== currentPostPeerId) {
    if (newPostPeerId) {
      const isValid = await validatePostPeerAccount(newPostPeerId);
      if (!isValid) {
        return NextResponse.json(
          { error: `PostPeer Account ID "${body.postpeerAccountId}" could not be verified against PostPeer. Please check the ID and try again.` },
          { status: 400 }
        );
      }
    }
    data.postpeerAccountId = newPostPeerId;
    data.connectionState = newPostPeerId ? "healthy" : "needs_reauth";
  }
  
  if (body.isActive !== undefined) data.isActive = body.isActive;

  // Caption settings
  if (body.defaultCaption !== undefined)
    data.defaultCaption = body.defaultCaption;
  if (body.captionSource !== undefined) data.captionSource = body.captionSource;

  // Drive link
  if (body.driveFolderId !== undefined) {
    data.driveFolderId = body.driveFolderId;
    data.driveFolderName = body.driveFolderName || null;
    data.driveConnected = !!body.driveFolderId;
  }

  // Profile
  if (body.tiktokUsername !== undefined) data.tiktokUsername = body.tiktokUsername.replace(/^@/, "");

  // Group reassignment
  if (body.groupId !== undefined) data.groupId = body.groupId;

  // Account color tag
  if (body.color !== undefined) data.color = body.color;

  const account = await prisma.managedAccount.update({
    where: { id },
    data,
  });

  // If username changed, clear all existing TikTok URLs for this account
  // so "Refresh Links" will reconstruct them with the new username
  if (body.tiktokUsername !== undefined) {
    await prisma.scheduledPost.updateMany({
      where: {
        accountId: id,
        tiktokPostUrl: { not: null },
      },
      data: {
        tiktokPostUrl: null,
      },
    });
  }

  return NextResponse.json(account);
}

// DELETE /api/managed/accounts/[id] — remove managed account
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "accounts"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const account = await prisma.managedAccount.findUnique({ where: { id } });
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  await prisma.managedAccount.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}

// GET /api/managed/accounts/[id] — get account details
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await can(session.userId, "accounts")) && !(await can(session.userId, "data_vault"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const account = await prisma.managedAccount.findUnique({
    where: { id },
    include: {
      group: { include: { section: true } },
      scheduledPosts: {
        orderBy: { scheduledFor: "desc" },
        take: 20,
      },
      dailyAnalytics: {
        orderBy: { date: "desc" },
        take: 30,
      },
    },
  });

  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const serialized = JSON.parse(
    JSON.stringify(account, (key, value) =>
      typeof value === "bigint" ? Number(value) : value
    )
  );

  return NextResponse.json(serialized);
}
