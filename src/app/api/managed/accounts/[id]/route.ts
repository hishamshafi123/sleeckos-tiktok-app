export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/session";

// PATCH /api/managed/accounts/[id] — update account settings
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const data: Record<string, unknown> = {};

  // Schedule settings
  if (body.postTimeHour !== undefined) data.postTimeHour = body.postTimeHour;
  if (body.postTimeMinute !== undefined)
    data.postTimeMinute = body.postTimeMinute;
  if (body.postTimezone !== undefined) data.postTimezone = body.postTimezone;
  if (body.postDays !== undefined) data.postDays = body.postDays;
  if (body.postMode !== undefined) data.postMode = body.postMode;
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

  // Group reassignment
  if (body.groupId !== undefined) data.groupId = body.groupId;

  const account = await prisma.managedAccount.update({
    where: { id },
    data,
  });

  return NextResponse.json(account);
}

// DELETE /api/managed/accounts/[id] — remove managed account
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const account = await prisma.managedAccount.findUnique({ where: { id } });
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  await prisma.managedAccount.delete({ where: { id } });

  await prisma.auditLog.create({
    data: {
      action: "MANAGED_ACCOUNT_REMOVED",
      resourceType: "ManagedAccount",
      metadata: {
        openId: account.tiktokOpenId,
        username: account.tiktokUsername,
      },
    },
  });

  return NextResponse.json({ ok: true });
}

// GET /api/managed/accounts/[id] — get account details
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  return NextResponse.json(account);
}
