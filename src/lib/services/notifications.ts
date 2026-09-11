/**
 * Admin notifications — persistent operational alerts shown in the admin
 * top-bar bell. Written by background services (analytics provider failures,
 * analytics run failures); read state is global (mark-all-read).
 *
 * Dedupe: an alert with the same source+title is suppressed while an
 * identical one from the last `dedupeMinutes` is still recent, so a flapping
 * provider doesn't flood the bell. Never throws — alerting must never break
 * the operation it reports on.
 */

import prisma from "@/lib/db";

export type NotificationLevel = "info" | "warning" | "error";

export interface NotifyInput {
  level: NotificationLevel;
  title: string;
  body: string;
  source: string;
  /** Suppress duplicates of the same source+title within this window. */
  dedupeMinutes?: number;
}

export async function notifyAdmin(input: NotifyInput): Promise<void> {
  try {
    const dedupeMinutes = input.dedupeMinutes ?? 30;
    const since = new Date(Date.now() - dedupeMinutes * 60 * 1000);
    const existing = await prisma.adminNotification.findFirst({
      where: { source: input.source, title: input.title, createdAt: { gte: since } },
      select: { id: true },
    });
    if (existing) return;

    await prisma.adminNotification.create({
      data: {
        level: input.level,
        title: input.title.slice(0, 200),
        body: input.body.slice(0, 2000),
        source: input.source,
      },
    });
  } catch (err: any) {
    console.warn(`[Notifications] Failed to write admin notification: ${err?.message || err}`);
  }
}

export interface AdminNotificationRow {
  id: string;
  createdAt: string;
  level: string;
  title: string;
  body: string;
  source: string;
  read: boolean;
}

/** Latest notifications + unread count for the bell. */
export async function getAdminNotifications(
  limit = 30
): Promise<{ unreadCount: number; rows: AdminNotificationRow[] }> {
  const take = Math.min(Math.max(1, Math.trunc(limit)), 100);
  const [rows, unreadCount] = await Promise.all([
    prisma.adminNotification.findMany({ orderBy: { createdAt: "desc" }, take }),
    prisma.adminNotification.count({ where: { readAt: null } }),
  ]);
  return {
    unreadCount,
    rows: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      level: r.level,
      title: r.title,
      body: r.body,
      source: r.source,
      read: r.readAt !== null,
    })),
  };
}

export async function markAllNotificationsRead(): Promise<{ updated: number }> {
  const res = await prisma.adminNotification.updateMany({
    where: { readAt: null },
    data: { readAt: new Date() },
  });
  return { updated: res.count };
}
