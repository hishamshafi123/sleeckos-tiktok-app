export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSession } from "@/lib/session";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  const { email, password, displayName, bio, nicheTags, disclosureAgreed } = await req.json();
  if (!email || !password || !displayName) return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  if (!disclosureAgreed) return NextResponse.json({ error: "You must agree to the disclosure terms" }, { status: 400 });

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return NextResponse.json({ error: "An account with this email already exists" }, { status: 400 });

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: "CREATOR",
      status: "APPROVED", // auto-approve creators in v1
      creatorProfile: {
        create: {
          displayName,
          bio: bio || "",
          nicheTags: nicheTags || [],
          disclosureAgreedAt: new Date(),
          approvedAt: new Date(),
        },
      },
    },
  });

  await prisma.auditLog.create({
    data: { actorUserId: user.id, action: "CREATOR_SIGNUP", resourceType: "User", resourceId: user.id },
  });

  await createSession({ userId: user.id, email: user.email, role: user.role });
  return NextResponse.json({ userId: user.id });
}
