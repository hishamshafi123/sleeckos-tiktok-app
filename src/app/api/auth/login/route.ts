export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSession } from "@/lib/session";
import { recordLoginEvent } from "@/lib/services/sessions";
import bcrypt from "bcryptjs";

function getClientMeta(req: NextRequest) {
  return {
    ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent") ?? null,
  };
}

export async function POST(req: NextRequest) {
  const { email, password, rememberMe = true } = await req.json();
  if (!email || !password) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

  const meta = getClientMeta(req);

  const user = await prisma.user.findUnique({
    where: { email },
    include: { role: true }
  });
  if (!user || !user.passwordHash || !user.role) {
    await recordLoginEvent({ attemptedUsername: email, success: false, ...meta });
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    await recordLoginEvent({ userId: user.id, attemptedUsername: email, success: false, ...meta });
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (user.status === "DISABLED") {
    await recordLoginEvent({ userId: user.id, attemptedUsername: email, success: false, ...meta });
    return NextResponse.json({ error: "Your account has been suspended." }, { status: 403 });
  }

  await recordLoginEvent({ userId: user.id, attemptedUsername: email, success: true, ...meta });
  await createSession(
    { userId: user.id, email: user.email, role: user.role.key },
    { rememberMe: rememberMe !== false, req }
  );
  return NextResponse.json({ role: user.role.key });
}
