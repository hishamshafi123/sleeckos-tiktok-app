export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { notifyAdmin } from "@/lib/services/notifications";
import { dayNumber, accountSlots, dueSlotsFor } from "@/lib/services/posting-schedule";

function verifyCronSecret(req: NextRequest) {
  const secret =
    req.headers.get("x-cron-secret") || req.nextUrl.searchParams.get("secret");
  return secret === process.env.CRON_SECRET;
}

function categorizeFailure(reason: string | null | undefined): string {
  const r = (reason || "").toLowerCase();
  if (r.includes("no tiktok account")) return "stale PostPeer ID";
  if (r.includes("invalid_grant")) return "dead TikTok token";
  if (r.includes("spam_risk")) return "TikTok spam_risk rejection";
  if (r.includes("spam")) return "TikTok spam rejection";
  return "upload failing";
}

/**
 * Daily posting digest (run near end of the UTC day): which eligible accounts
 * finished the day behind their slot quota, and why. Posts a single admin
 * notification so misses are visible instead of silent.
 */
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  const accounts = await prisma.managedAccount.findMany({
    where: { isActive: true, driveConnected: true, postpeerAccountId: { not: null } },
    select: {
      id: true,
      tiktokUsername: true,
      postTimeSlots: true,
      postTimeHour: true,
      postTimeMinute: true,
      postTimezone: true,
      postDays: true,
      connectionState: true,
      section: { select: { isActive: true } },
    },
  });

  // Batch per-timezone day windows (nearly all accounts share one tz).
  const byTz = new Map<string, typeof accounts>();
  for (const a of accounts) {
    const list = byTz.get(a.postTimezone) || [];
    list.push(a);
    byTz.set(a.postTimezone, list);
  }

  const fulfilledByAccount = new Map<string, number>();
  const earliestDayStart = new Date(now.getTime() - 30 * 60 * 60 * 1000);

  for (const [tz, group] of byTz) {
    const zonedNow = toZonedTime(now, tz);
    const dateStr = `${zonedNow.getFullYear()}-${String(zonedNow.getMonth() + 1).padStart(2, "0")}-${String(
      zonedNow.getDate()
    ).padStart(2, "0")}`;
    const dayStart = fromZonedTime(`${dateStr}T00:00:00`, tz);
    const counts = await prisma.postJob.groupBy({
      by: ["accountId"],
      where: {
        accountId: { in: group.map((a) => a.id) },
        OR: [
          { publishedAt: { gte: dayStart } },
          { state: { in: ["CLAIMED", "UPLOADING"] }, updatedAt: { gte: dayStart } },
        ],
      },
      _count: { _all: true },
    });
    for (const c of counts) {
      fulfilledByAccount.set(c.accountId, (fulfilledByAccount.get(c.accountId) || 0) + c._count._all);
    }
  }

  const ids = accounts.map((a) => a.id);
  const [availableCounts, backoffCounts, recentFailures] = await Promise.all([
    prisma.postJob.groupBy({
      by: ["accountId"],
      where: { accountId: { in: ids }, state: "AVAILABLE" },
      _count: { _all: true },
    }),
    prisma.postJob.groupBy({
      by: ["accountId"],
      where: { accountId: { in: ids }, state: "AVAILABLE", lockedAt: { gt: now } },
      _count: { _all: true },
    }),
    prisma.postJob.findMany({
      where: {
        accountId: { in: ids },
        updatedAt: { gte: earliestDayStart },
        failureReason: { not: null },
      },
      orderBy: { updatedAt: "desc" },
      select: { accountId: true, failureReason: true },
      take: 5000,
    }),
  ]);

  const availableByAccount = new Map(availableCounts.map((c) => [c.accountId, c._count._all]));
  const backoffByAccount = new Map(backoffCounts.map((c) => [c.accountId, c._count._all]));
  const lastFailureByAccount = new Map<string, string>();
  for (const f of recentFailures) {
    if (!lastFailureByAccount.has(f.accountId) && f.failureReason) {
      lastFailureByAccount.set(f.accountId, f.failureReason);
    }
  }

  type BehindRow = { username: string; fulfilled: number; due: number; reason: string };
  const behind: BehindRow[] = [];
  const reasonCounts = new Map<string, number>();
  let evaluated = 0;

  for (const a of accounts) {
    if (a.connectionState !== "healthy" || !a.section.isActive) continue;

    const zonedNow = toZonedTime(now, a.postTimezone);
    if (!a.postDays.split(",").includes(dayNumber(zonedNow))) continue;

    const currentMinutes = zonedNow.getHours() * 60 + zonedNow.getMinutes();
    const dateStr = `${zonedNow.getFullYear()}-${String(zonedNow.getMonth() + 1).padStart(2, "0")}-${String(
      zonedNow.getDate()
    ).padStart(2, "0")}`;
    const due = dueSlotsFor(a.id, accountSlots(a), dateStr, currentMinutes).length;
    if (due === 0) continue;

    evaluated++;
    const fulfilled = fulfilledByAccount.get(a.id) || 0;
    if (fulfilled >= due) continue;

    let reason: string;
    if ((availableByAccount.get(a.id) || 0) === 0) {
      reason = "no videos in Drive";
    } else if ((backoffByAccount.get(a.id) || 0) > 0) {
      reason = "retry backoff (recent failure)";
    } else if (lastFailureByAccount.has(a.id)) {
      reason = categorizeFailure(lastFailureByAccount.get(a.id));
    } else {
      reason = "behind schedule (catch-up in progress)";
    }

    reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    behind.push({ username: a.tiktokUsername, fulfilled, due, reason });
  }

  const dateLabel = now.toISOString().slice(0, 10);

  if (behind.length > 0) {
    const reasonSummary = [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([r, n]) => `${n}× ${r}`)
      .join(" · ");
    const accountLines = behind
      .slice(0, 15)
      .map((b) => `@${b.username} — ${b.fulfilled}/${b.due} posted (${b.reason})`)
      .join("\n");
    await notifyAdmin({
      level: "warning",
      title: `Posting digest ${dateLabel}: ${behind.length} of ${evaluated} accounts behind quota`,
      body: `${reasonSummary}\n\n${accountLines}${behind.length > 15 ? `\n…and ${behind.length - 15} more` : ""}`,
      source: "posting-digest",
      dedupeMinutes: 60,
    });
  }

  return NextResponse.json({
    ok: true,
    date: dateLabel,
    evaluated,
    behindCount: behind.length,
    reasons: Object.fromEntries(reasonCounts),
    behind: behind.slice(0, 100),
  });
}
