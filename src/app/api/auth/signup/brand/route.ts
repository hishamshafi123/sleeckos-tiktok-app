export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  const { email, password, legalName, tradeName, website, category, contactEmail, tiktokHandle, policyAcknowledged } = await req.json();
  if (!email || !password || !legalName || !website || !category) return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  if (!policyAcknowledged) return NextResponse.json({ error: "You must acknowledge the Branded Content Policy" }, { status: 400 });

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return NextResponse.json({ error: "An account with this email already exists" }, { status: 400 });

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: "BRAND_OWNER",
      status: "PENDING", // brands always need manual approval
      brandOwnership: {
        create: {
          legalName,
          tradeName: tradeName || legalName,
          website,
          category,
          contactEmail: contactEmail || email,
          tiktokHandle: tiktokHandle || null,
          bannedCategoriesAcknowledged: true,
          status: "PENDING",
        },
      },
    },
  });

  await prisma.auditLog.create({
    data: { actorUserId: user.id, action: "BRAND_SIGNUP", resourceType: "User", resourceId: user.id },
  });

  return NextResponse.json({ userId: user.id });
}
