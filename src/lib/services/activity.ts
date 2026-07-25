import { fromZonedTime } from "date-fns-tz";
import prisma from "@/lib/db";
import { getOrgTimezone } from "@/lib/services/timezone";

const DAY_MS = 24 * 60 * 60 * 1000;

export type PresenceStatus = "online" | "idle" | "offline";

/**
 * Tiny dependency-free user-agent parser → short "Chrome · macOS" style label.
 */
export function parseUserAgent(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown device";
  const ua = userAgent;

  let os = "Unknown OS";
  if (/Windows NT/i.test(ua)) os = "Windows";
  else if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/CrOS/i.test(ua)) os = "ChromeOS";
  else if (/Linux/i.test(ua)) os = "Linux";

  let browser = "Unknown browser";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(ua)) browser = "Opera";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = "Chrome";
  else if (/Chromium/i.test(ua)) browser = "Chromium";
  else if (/Safari\//i.test(ua)) browser = "Safari";

  return `${browser} · ${os}`;
}

function computeStatus(
  lastSeenAt: Date | null,
  onlineWindowMinutes: number,
  idleWindowMinutes: number
): PresenceStatus {
  if (!lastSeenAt) return "offline";
  const ageMs = Date.now() - lastSeenAt.getTime();
  if (ageMs <= onlineWindowMinutes * 60 * 1000) return "online";
  if (ageMs <= idleWindowMinutes * 60 * 1000) return "idle";
  return "offline";
}

export interface OnlineUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
  lastSeenAt: Date | null;
  activeSessionCount: number;
  deviceSummary: string;
}

export async function getOnlineUsers({
  onlineWindowMinutes = 5,
}: {
  onlineWindowMinutes?: number;
  idleWindowMinutes?: number;
} = {}): Promise<OnlineUser[]> {
  const threshold = new Date(Date.now() - onlineWindowMinutes * 60 * 1000);
  const users = await prisma.user.findMany({
    where: { lastSeenAt: { gte: threshold } },
    include: {
      role: true,
      sessions: {
        where: { revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { lastSeenAt: "desc" },
      },
    },
    orderBy: { lastSeenAt: "desc" },
  });

  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role.key,
    lastSeenAt: u.lastSeenAt,
    activeSessionCount: u.sessions.length,
    deviceSummary: parseUserAgent(u.sessions[0]?.userAgent),
  }));
}

export interface UserActivityRow {
  id: string;
  name: string | null;
  email: string;
  role: string;
  status: PresenceStatus;
  lastLoginAt: Date | null;
  lastSeenAt: Date | null;
}

export async function getUserActivity({
  role,
  status,
  onlineWindowMinutes = 5,
  idleWindowMinutes = 30,
}: {
  role?: string;
  status?: PresenceStatus;
  onlineWindowMinutes?: number;
  idleWindowMinutes?: number;
} = {}): Promise<UserActivityRow[]> {
  const users = await prisma.user.findMany({
    where: role ? { role: { key: role } } : undefined,
    include: { role: true },
    orderBy: { name: "asc" },
  });

  const rows: UserActivityRow[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role.key,
    status: computeStatus(u.lastSeenAt, onlineWindowMinutes, idleWindowMinutes),
    lastLoginAt: u.lastLoginAt,
    lastSeenAt: u.lastSeenAt,
  }));

  return status ? rows.filter((r) => r.status === status) : rows;
}

export interface AbsentUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
  lastLoginAt: Date | null;
}

export interface UsersWithoutLoginResult {
  loggedInCount: number;
  totalUsers: number;
  notLoggedIn: AbsentUser[];
}

/**
 * from/to are YYYY-MM-DD dates in the org timezone. Day boundaries are
 * computed as org-tz midnights converted back to UTC instants.
 */
export async function getUsersWithoutLogin({
  from,
  to,
}: {
  from: string;
  to: string;
}): Promise<UsersWithoutLoginResult> {
  const tz = await getOrgTimezone();
  const fromStart = fromZonedTime(`${from}T00:00:00`, tz);
  const toEnd = new Date(fromZonedTime(`${to}T00:00:00`, tz).getTime() + DAY_MS);

  const [users, logins] = await Promise.all([
    prisma.user.findMany({ include: { role: true }, orderBy: { name: "asc" } }),
    prisma.loginEvent.findMany({
      where: { success: true, createdAt: { gte: fromStart, lt: toEnd }, userId: { not: null } },
      select: { userId: true },
    }),
  ]);

  const loggedInIds = new Set(logins.map((l) => l.userId as string));
  const notLoggedIn: AbsentUser[] = [];
  let loggedInCount = 0;

  for (const u of users) {
    if (loggedInIds.has(u.id)) {
      loggedInCount++;
    } else {
      notLoggedIn.push({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role.key,
        lastLoginAt: u.lastLoginAt,
      });
    }
  }

  return { loggedInCount, totalUsers: users.length, notLoggedIn };
}

export interface UserSessionInfo {
  id: string;
  deviceSummary: string;
  ipAddress: string | null;
  createdAt: Date;
  lastSeenAt: Date;
}

export async function getUserSessions(userId: string): Promise<UserSessionInfo[]> {
  const sessions = await prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
  });
  return sessions.map((s) => ({
    id: s.id,
    deviceSummary: parseUserAgent(s.userAgent),
    ipAddress: s.ipAddress,
    createdAt: s.createdAt,
    lastSeenAt: s.lastSeenAt,
  }));
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllSessionsForUser(userId: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export interface LoginEventRow {
  id: string;
  userId: string | null;
  userName: string | null;
  attemptedUsername: string | null;
  success: boolean;
  createdAt: Date;
  ipAddress: string | null;
  deviceSummary: string;
}

export async function getLoginEvents({
  userId,
  limit = 50,
}: {
  userId?: string;
  limit?: number;
} = {}): Promise<LoginEventRow[]> {
  const events = await prisma.loginEvent.findMany({
    where: userId ? { userId } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const userIds = [...new Set(events.map((e) => e.userId).filter((id): id is string => !!id))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.name ?? u.email]));
  return events.map((e) => ({
    id: e.id,
    userId: e.userId,
    userName: e.userId ? nameById.get(e.userId) ?? null : null,
    attemptedUsername: e.attemptedUsername,
    success: e.success,
    createdAt: e.createdAt,
    ipAddress: e.ipAddress,
    deviceSummary: parseUserAgent(e.userAgent),
  }));
}
