import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import {
  createSession as createDbSession,
  validateSessionToken,
  touchSession,
  destroySession,
} from "@/lib/services/sessions";

export type SessionPayload = {
  userId: string;
  email: string;
  role: string;
};

export async function createSession(
  payload: SessionPayload,
  opts?: { rememberMe?: boolean; req?: NextRequest }
) {
  const rememberMe = opts?.rememberMe ?? true;
  const ipAddress = opts?.req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = opts?.req?.headers.get("user-agent") ?? null;

  const { token } = await createDbSession({
    userId: payload.userId,
    rememberMe,
    ipAddress,
    userAgent,
  });

  // The cookie carries only the opaque token — no JWT, no user data.
  // rememberMe → persistent 30d cookie; unchecked → browser-session cookie (no maxAge).
  const cookieStore = await cookies();
  cookieStore.set("session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    ...(rememberMe ? { maxAge: 60 * 60 * 24 * 30 } : {}),
  });
}

export async function getSession(): Promise<SessionPayload | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("session")?.value;
    if (!token) return null;

    const result = await validateSessionToken(token);
    if (!result || !result.user.role) return null;

    await touchSession(result.session.id);
    return {
      userId: result.user.id,
      email: result.user.email,
      role: result.user.role.key,
    };
  } catch {
    return null;
  }
}

export async function deleteSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  if (token) {
    const result = await validateSessionToken(token);
    if (result) await destroySession(result.session.id);
  }
  cookieStore.delete("session");
}
