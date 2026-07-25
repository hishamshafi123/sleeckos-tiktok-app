import crypto from "crypto";
import prisma from "@/lib/db";

const DAY_MS = 24 * 60 * 60 * 1000;
// rememberMe sessions live 30 days; unchecked ("browser session") sessions get a
// 24h server-side cap so stale cookies die even though the cookie has no maxAge.
const REMEMBER_ME_TTL_MS = 30 * DAY_MS;
const SHORT_TTL_MS = 24 * 60 * 60 * 1000;
// Rolling expiry: re-extend at most once every 5 minutes.
const ROLLING_EXTENSION_MIN_INTERVAL_MS = 5 * 60 * 1000;
// Presence: update lastSeenAt at most once every 60 seconds.
const PRESENCE_THROTTLE_MS = 60 * 1000;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createSession({
  userId,
  rememberMe,
  ipAddress,
  userAgent,
}: {
  userId: string;
  rememberMe: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + (rememberMe ? REMEMBER_ME_TTL_MS : SHORT_TTL_MS));
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
    },
  });
  return { token, session };
}

export async function validateSessionToken(token: string) {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { role: true } } },
  });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  return { session, user: session.user };
}

// A rememberMe session was minted with a ~30d TTL; short sessions get 24h.
function isRememberMeSession(session: { createdAt: Date; expiresAt: Date }): boolean {
  return session.expiresAt.getTime() - session.createdAt.getTime() > 25 * DAY_MS;
}

export async function touchSession(sessionId: string): Promise<void> {
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session || session.revokedAt) return;

  const now = Date.now();
  const data: { lastExtendedAt?: Date; expiresAt?: Date; lastSeenAt?: Date } = {};

  // (a) Rolling expiry — throttled to one extension per 5 minutes.
  // Only rememberMe sessions roll forward (to max(current expiresAt, now + 30d)).
  if (now - session.lastExtendedAt.getTime() > ROLLING_EXTENSION_MIN_INTERVAL_MS) {
    data.lastExtendedAt = new Date(now);
    if (isRememberMeSession(session)) {
      const target = now + REMEMBER_ME_TTL_MS;
      if (target > session.expiresAt.getTime()) {
        data.expiresAt = new Date(target);
      }
    }
  }

  // (b) Presence — throttled to one write per 60 seconds.
  const presenceDue = now - session.lastSeenAt.getTime() > PRESENCE_THROTTLE_MS;
  if (presenceDue) {
    data.lastSeenAt = new Date(now);
  }

  if (Object.keys(data).length > 0) {
    await prisma.session.update({ where: { id: sessionId }, data });
  }
  if (presenceDue) {
    await prisma.user.update({
      where: { id: session.userId },
      data: { lastSeenAt: new Date(now) },
    });
  }
}

export async function destroySession(sessionId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function destroyAllSessionsForUser(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function recordLoginEvent({
  userId,
  attemptedUsername,
  success,
  ipAddress,
  userAgent,
}: {
  userId?: string | null;
  attemptedUsername?: string | null;
  success: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  await prisma.loginEvent.create({
    data: {
      userId: userId ?? null,
      attemptedUsername: attemptedUsername ?? null,
      success,
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
    },
  });
  if (success && userId) {
    await prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  }
}
