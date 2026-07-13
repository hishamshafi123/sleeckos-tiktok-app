import prisma from "@/lib/db";
import { getOrgTimezone } from "./timezone";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { startOfDay, endOfDay, startOfWeek, subDays, eachDayOfInterval } from "date-fns";

export interface KpiParams {
  from?: Date;
  to?: Date;
  folderId?: string;
  employeeId?: string;
}

export async function getKpiSummary(params: KpiParams) {
  const timezone = await getOrgTimezone();
  const now = new Date();
  
  const zonedNow = toZonedTime(now, timezone);
  const zonedTodayStart = startOfDay(zonedNow);
  const zonedTodayEnd = endOfDay(zonedNow);
  const zonedWeekStart = startOfWeek(zonedNow, { weekStartsOn: 1 }); // Start on Monday

  const utcTodayStart = fromZonedTime(zonedTodayStart, timezone);
  const utcTodayEnd = fromZonedTime(zonedTodayEnd, timezone);
  const utcWeekStart = fromZonedTime(zonedWeekStart, timezone);

  // General filters for the query
  const whereFilter: any = {};
  if (params.folderId) {
    whereFilter.folderId = params.folderId;
  }
  if (params.employeeId) {
    whereFilter.ownerUserId = params.employeeId;
  }

  // 1. Successes Today
  const successesToday = await prisma.accountGenerationEvent.count({
    where: {
      ...whereFilter,
      status: "success",
      occurredAt: { gte: utcTodayStart, lte: utcTodayEnd },
    },
  });

  // 2. Successes This Week
  const successesWeek = await prisma.accountGenerationEvent.count({
    where: {
      ...whereFilter,
      status: "success",
      occurredAt: { gte: utcWeekStart, lte: utcTodayEnd },
    },
  });

  // 3. Total Successes (in the requested range, or all-time)
  const totalWhere: any = { ...whereFilter, status: "success" };
  if (params.from || params.to) {
    totalWhere.occurredAt = {};
    if (params.from) totalWhere.occurredAt.gte = params.from;
    if (params.to) totalWhere.occurredAt.lte = params.to;
  }
  const totalSuccesses = await prisma.accountGenerationEvent.count({
    where: totalWhere,
  });

  // 4. Fail Rate (in the selected range, or all-time)
  const rateWhere: any = { ...whereFilter };
  if (params.from || params.to) {
    rateWhere.occurredAt = {};
    if (params.from) rateWhere.occurredAt.gte = params.from;
    if (params.to) rateWhere.occurredAt.lte = params.to;
  }
  const totalEvents = await prisma.accountGenerationEvent.findMany({
    where: rateWhere,
    select: { status: true },
  });

  const successes = totalEvents.filter(e => e.status === "success").length;
  const fails = totalEvents.filter(e => e.status === "fail").length;
  const failRate = successes + fails > 0 ? (fails / (successes + fails)) * 100 : 0;

  // 5. Trend (last 7 days by default, or the requested range)
  const trendFrom = params.from || fromZonedTime(subDays(zonedTodayStart, 6), timezone);
  const trendTo = params.to || utcTodayEnd;

  const trendEvents = await prisma.accountGenerationEvent.findMany({
    where: {
      ...whereFilter,
      occurredAt: { gte: trendFrom, lte: trendTo },
    },
    select: { status: true, occurredAt: true },
  });

  // Bucketing trend by day in org timezone
  const trendZonedFrom = toZonedTime(trendFrom, timezone);
  const trendZonedTo = toZonedTime(trendTo, timezone);
  const daysInterval = eachDayOfInterval({ start: trendZonedFrom, end: trendZonedTo });

  const trendData = daysInterval.map(dayDate => {
    const dayStr = dayDate.toISOString().split("T")[0]; // YYYY-MM-DD local to interval day
    
    // Filter events occurring on this local day in timezone
    const dayStartUtc = fromZonedTime(startOfDay(dayDate), timezone);
    const dayEndUtc = fromZonedTime(endOfDay(dayDate), timezone);

    const dayEvents = trendEvents.filter(
      e => e.occurredAt >= dayStartUtc && e.occurredAt <= dayEndUtc
    );

    const daySuccess = dayEvents.filter(e => e.status === "success").length;
    const dayFail = dayEvents.filter(e => e.status === "fail").length;

    return {
      date: dayStr,
      successes: daySuccess,
      fails: dayFail,
    };
  });

  return {
    successesToday,
    successesWeek,
    totalSuccesses,
    failRate,
    trend: trendData,
  };
}

export async function getLeaderboard(range: "day" | "week" | "month" | "all" = "all", folderId?: string) {
  const timezone = await getOrgTimezone();
  const now = new Date();
  const zonedNow = toZonedTime(now, timezone);

  let utcStart: Date | undefined;
  let utcEnd = now;

  if (range === "day") {
    utcStart = fromZonedTime(startOfDay(zonedNow), timezone);
    utcEnd = fromZonedTime(endOfDay(zonedNow), timezone);
  } else if (range === "week") {
    utcStart = fromZonedTime(startOfWeek(zonedNow, { weekStartsOn: 1 }), timezone);
  } else if (range === "month") {
    const zonedMonthStart = new Date(zonedNow.getFullYear(), zonedNow.getMonth(), 1);
    utcStart = fromZonedTime(zonedMonthStart, timezone);
  }

  const whereFilter: any = { status: "success" };
  if (folderId) {
    whereFilter.folderId = folderId;
  }
  if (utcStart) {
    whereFilter.occurredAt = { gte: utcStart, lte: utcEnd };
  }

  const events = await prisma.accountGenerationEvent.findMany({
    where: whereFilter,
    select: { ownerUserId: true },
  });

  // Count successes per ownerUserId
  const counts: Record<string, number> = {};
  for (const event of events) {
    if (!event.ownerUserId) continue;
    counts[event.ownerUserId] = (counts[event.ownerUserId] || 0) + 1;
  }

  // Load all users to attach names/emails
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true },
  });

  const leaderboard = users.map(user => {
    return {
      userId: user.id,
      name: user.name || "Unknown User",
      email: user.email,
      successes: counts[user.id] || 0,
    };
  });

  // Sort by successes descending
  return leaderboard.sort((a, b) => b.successes - a.successes);
}
