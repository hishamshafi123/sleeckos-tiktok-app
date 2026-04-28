export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSession } from "@/lib/session";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  if (!email || !password) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });

  if (user.status === "SUSPENDED") return NextResponse.json({ error: "Your account has been suspended." }, { status: 403 });

  await createSession({ userId: user.id, email: user.email, role: user.role });
  return NextResponse.json({ role: user.role });
}
