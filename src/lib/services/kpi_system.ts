import prisma from "@/lib/db";
import { getOrgTimezone, getZonedFutureStartOfDay, getZonedDateString } from "./timezone";

// Extensible Job Functions list
export type JobFunctionType = "generator" | "warmup" | "scheduler" | "editor" | "curator";

/**
 * Self-healing helper to seed initial and maintenance protocols in the database if empty
 */
export async function ensureDefaultProtocols() {
  const count = await prisma.warmupProtocol.count();
  if (count === 0) {
    await prisma.warmupProtocol.createMany({
      data: [
        {
          name: "Initial 6-Day Ramp",
          type: "initial",
          config: [
            { day: 1, activeMinutes: 30, posts: 0 },
            { day: 2, activeMinutes: 25, posts: 0 },
            { day: 3, activeMinutes: 20, posts: 1 },
            { day: 4, activeMinutes: 15, posts: 1 },
            { day: 5, activeMinutes: 10, posts: 2 },
            { day: 6, activeMinutes: 5, posts: 2 }
          ]
        },
        {
          name: "Standard Maintenance",
          type: "maintenance",
          config: {
            intervalDays: 2,
            activeMinutes: 10,
            posts: 2
          }
        }
      ]
    });
  }
}

/**
 * Assigns a job function to an employee user
 */
export async function assignFunction(
  userId: string,
  functionType: string,
  startDate: Date,
  endDate?: Date | null
) {
  return await prisma.functionAssignment.create({
    data: {
      userId,
      functionType,
      startDate,
      endDate: endDate || null,
      active: true
    }
  });
}

/**
 * Sets volume targets/goals for a function per period
 */
export async function setGoal(
  userId: string,
  functionType: string,
  period: "day" | "week" | "month",
  target: number,
  startDate: Date,
  endDate?: Date | null
) {
  return await prisma.kpiGoal.create({
    data: {
      userId,
      functionType,
      period,
      target,
      startDate,
      endDate: endDate || null
    }
  });
}

/**
 * Logs manual activity event (typically Scheduler or Editor)
 */
export async function logManualActivity(
  userId: string,
  functionType: string,
  count: number,
  options: { campaignId?: string; meta?: any; createdBy?: string; approved?: boolean } = {}
) {
  return await prisma.activityEvent.create({
    data: {
      userId,
      functionType,
      count,
      campaignId: options.campaignId || null,
      source: "manual",
      meta: options.meta || {},
      createdBy: options.createdBy || userId,
      approved: options.approved !== undefined ? options.approved : true
    }
  });
}

/**
 * Auto-enrolls account to warmup protocol
 */
export async function enrollWarmup(
  managedAccountId: string,
  protocolId?: string,
  assignedWarmerId?: string | null
) {
  await ensureDefaultProtocols();
  let selectedProtocol;
  if (protocolId) {
    selectedProtocol = await prisma.warmupProtocol.findUnique({ where: { id: protocolId } });
  }
  if (!selectedProtocol) {
    selectedProtocol = await prisma.warmupProtocol.findFirst({ where: { type: "initial" } });
  }
  if (!selectedProtocol) {
    throw new Error("No initial warmup protocol found");
  }

  const tz = await getOrgTimezone();
  const nextDueDate = getZonedFutureStartOfDay(tz, 0);

  return await prisma.warmupEnrollment.upsert({
    where: { managedAccountId },
    create: {
      managedAccountId,
      protocolId: selectedProtocol.id,
      type: selectedProtocol.type,
      currentDay: selectedProtocol.type === "initial" ? 1 : null,
      nextDueDate,
      status: "active",
      assignedWarmerId: assignedWarmerId || null
    },
    update: {
      protocolId: selectedProtocol.id,
      type: selectedProtocol.type,
      currentDay: selectedProtocol.type === "initial" ? 1 : null,
      nextDueDate,
      status: "active",
      assignedWarmerId: assignedWarmerId || null
    }
  });
}

/**
 * Get warmer daily checklists due on or before today
 */
export async function getWarmupChecklist(warmerId?: string) {
  const tz = await getOrgTimezone();
  // Tasks are due today (meaning nextDueDate <= end of today in IST)
  const endOfTodayZoned = getZonedFutureStartOfDay(tz, 1);

  const enrollments = await prisma.warmupEnrollment.findMany({
    where: {
      status: "active",
      nextDueDate: { lte: endOfTodayZoned },
      ...(warmerId ? { assignedWarmerId: warmerId } : {})
    },
    include: {
      managedAccount: true,
      protocol: true,
      assignedWarmer: {
        select: { id: true, name: true, email: true }
      }
    }
  });

  return enrollments.map((e) => {
    const protocol = e.protocol;
    let taskInstructions = "";
    let activeMinutes = 0;
    let posts = 0;

    if (e.type === "initial") {
      const days = (protocol.config as any[]) || [];
      const dayConfig = days.find((d) => d.day === e.currentDay) || { activeMinutes: 10, posts: 0 };
      activeMinutes = dayConfig.activeMinutes;
      posts = dayConfig.posts;
      taskInstructions = `Day ${e.currentDay}: Active ${activeMinutes} mins + post ${posts} videos`;
    } else {
      const config = (protocol.config as any) || { activeMinutes: 10, posts: 2 };
      activeMinutes = config.activeMinutes;
      posts = config.posts;
      taskInstructions = `Maintenance: Active ${activeMinutes} mins + post ${posts} videos`;
    }

    const isOverdue = e.nextDueDate < getZonedFutureStartOfDay(tz, 0);

    return {
      enrollmentId: e.id,
      managedAccountId: e.managedAccountId,
      tiktokUsername: e.managedAccount.tiktokUsername,
      tiktokDisplayName: e.managedAccount.tiktokDisplayName,
      tiktokAvatarUrl: e.managedAccount.tiktokAvatarUrl,
      currentDay: e.currentDay,
      type: e.type,
      activeMinutes,
      posts,
      taskInstructions,
      nextDueDate: e.nextDueDate,
      isOverdue,
      assignedWarmer: e.assignedWarmer
    };
  });
}

/**
 * Checks off checklist task, logging event and advancing schedule
 */
export async function completeWarmupTask(enrollmentId: string, userId: string) {
  const tz = await getOrgTimezone();
  const enrollment = await prisma.warmupEnrollment.findUnique({
    where: { id: enrollmentId },
    include: { protocol: true }
  });

  if (!enrollment) {
    throw new Error("Warmup enrollment not found");
  }

  // Create ActivityEvent record
  await prisma.activityEvent.create({
    data: {
      userId,
      functionType: "warmup",
      count: 1,
      source: "auto",
      meta: {
        enrollmentId,
        managedAccountId: enrollment.managedAccountId,
        type: enrollment.type,
        currentDay: enrollment.currentDay
      },
      createdBy: userId,
      approved: true
    }
  });

  let nextDay: number | null = enrollment.currentDay;
  let nextType = enrollment.type;
  let nextProtocolId = enrollment.protocolId;
  let nextDueDate: Date;

  if (enrollment.type === "initial") {
    const days = (enrollment.protocol.config as any[]) || [];
    const currentDay = enrollment.currentDay || 1;
    if (currentDay >= days.length) {
      const maintenanceProtocol = await prisma.warmupProtocol.findFirst({
        where: { type: "maintenance" }
      });
      nextType = "maintenance";
      nextDay = null;
      if (maintenanceProtocol) {
        nextProtocolId = maintenanceProtocol.id;
        const config = (maintenanceProtocol.config as any) || { intervalDays: 2 };
        nextDueDate = getZonedFutureStartOfDay(tz, config.intervalDays || 2);
      } else {
        nextDueDate = getZonedFutureStartOfDay(tz, 2);
      }
    } else {
      nextDay = currentDay + 1;
      nextDueDate = getZonedFutureStartOfDay(tz, 1);
    }
  } else {
    const config = (enrollment.protocol.config as any) || { intervalDays: 2 };
    nextDueDate = getZonedFutureStartOfDay(tz, config.intervalDays || 2);
  }

  return await prisma.warmupEnrollment.update({
    where: { id: enrollmentId },
    data: {
      currentDay: nextDay,
      type: nextType,
      protocolId: nextProtocolId,
      nextDueDate,
      lastActionAt: new Date()
    }
  });
}

/**
 * Computes self KPI stats progress vs targets
 */
export async function getSelfKpi(userId: string) {
  const tz = await getOrgTimezone();
  
  const assignments = await prisma.functionAssignment.findMany({
    where: { userId, active: true }
  });

  const goals = await prisma.kpiGoal.findMany({
    where: {
      userId,
      OR: [
        { endDate: null },
        { endDate: { gte: new Date() } }
      ]
    }
  });

  const dayStart = getZonedFutureStartOfDay(tz, 0);
  const weekStart = getZonedFutureStartOfDay(tz, -((new Date().getDay() + 6) % 7));
  const monthStart = getZonedFutureStartOfDay(tz, -(new Date().getDate() - 1));

  return await Promise.all(
    assignments.map(async (assign) => {
      const type = assign.functionType;

      const [daySum, weekSum, monthSum] = await Promise.all([
        prisma.activityEvent.aggregate({
          where: { userId, functionType: type, occurredAt: { gte: dayStart }, approved: true },
          _sum: { count: true }
        }),
        prisma.activityEvent.aggregate({
          where: { userId, functionType: type, occurredAt: { gte: weekStart }, approved: true },
          _sum: { count: true }
        }),
        prisma.activityEvent.aggregate({
          where: { userId, functionType: type, occurredAt: { gte: monthStart }, approved: true },
          _sum: { count: true }
        })
      ]);

      const dayDone = daySum._sum.count || 0;
      const weekDone = weekSum._sum.count || 0;
      const monthDone = monthSum._sum.count || 0;

      const dayGoal = goals.find((g) => g.functionType === type && g.period === "day")?.target || 0;
      const weekGoal = goals.find((g) => g.functionType === type && g.period === "week")?.target || 0;
      const monthGoal = goals.find((g) => g.functionType === type && g.period === "month")?.target || 0;

      return {
        functionType: type,
        day: { done: dayDone, target: dayGoal },
        week: { done: weekDone, target: weekGoal },
        month: { done: monthDone, target: monthGoal }
      };
    })
  );
}

/**
 * Gets aggregated performance statistics and leaderboards for managers (zoned to IST)
 */
export async function getManagerKpi(filters: {
  from?: Date;
  to?: Date;
  functionType?: string;
  campaignId?: string;
}) {
  const tz = await getOrgTimezone();
  const startRange = filters.from || getZonedFutureStartOfDay(tz, -30); // default last 30 days
  const endRange = filters.to || new Date();

  // Query events in range
  const events = await prisma.activityEvent.findMany({
    where: {
      occurredAt: { gte: startRange, lte: endRange },
      approved: true,
      ...(filters.functionType ? { functionType: filters.functionType } : {}),
      ...(filters.campaignId ? { campaignId: filters.campaignId } : {})
    },
    include: {
      user: {
        select: { id: true, name: true, email: true }
      },
      campaign: {
        select: { id: true, title: true }
      }
    },
    orderBy: { occurredAt: "desc" }
  });

  // Calculate volume totals by function
  const volumes: Record<string, number> = {};
  events.forEach((ev) => {
    volumes[ev.functionType] = (volumes[ev.functionType] || 0) + ev.count;
  });

  // Compile Leaderboard list
  const userStats: Record<string, { name: string; email: string; successes: number; totals: number }> = {};
  events.forEach((ev) => {
    const key = ev.userId;
    if (!userStats[key]) {
      userStats[key] = {
        name: ev.user.name || "Unknown",
        email: ev.user.email,
        successes: 0,
        totals: 0
      };
    }
    userStats[key].successes += ev.count;
  });

  const leaderboard = Object.entries(userStats)
    .map(([userId, stats]) => ({
      userId,
      ...stats
    }))
    .sort((a, b) => b.successes - a.successes);

  // Quality Ratios
  // GeneratorSuccessRate
  const [genSuccessCount, genTotalCount] = await Promise.all([
    prisma.accountGenerationEvent.count({ where: { status: "success", occurredAt: { gte: startRange, lte: endRange } } }),
    prisma.accountGenerationEvent.count({ where: { occurredAt: { gte: startRange, lte: endRange } } })
  ]);
  const generatorRatio = genTotalCount > 0 ? (genSuccessCount / genTotalCount) * 100 : 100;

  // CuratorApprovalRate
  const [curatorApprovedCount, curatorTotalCount] = await Promise.all([
    prisma.curatorSubmission.count({ where: { status: "APPROVED", createdAt: { gte: startRange, lte: endRange } } }),
    prisma.curatorSubmission.count({ where: { createdAt: { gte: startRange, lte: endRange } } })
  ]);
  const curatorRatio = curatorTotalCount > 0 ? (curatorApprovedCount / curatorTotalCount) * 100 : 100;

  return {
    volumes,
    leaderboard,
    qualityRatios: {
      generator: generatorRatio,
      curator: curatorRatio
    },
    rawEvents: events.map((ev) => ({
      id: ev.id,
      userName: ev.user.name || "Unknown",
      userEmail: ev.user.email,
      functionType: ev.functionType,
      count: ev.count,
      occurredAt: getZonedDateString(ev.occurredAt, tz),
      campaignTitle: ev.campaign?.title || null,
      source: ev.source
    }))
  };
}

/**
 * Returns pipeline metrics: accounts by stage, overdue warmup tasks, and warmer accuracy
 */
export async function getWarmupPipelineHealth() {
  const tz = await getOrgTimezone();
  const startOfToday = getZonedFutureStartOfDay(tz, 0);

  // Counts by stage
  const [stageInitialCount, stageMaintenanceCount] = await Promise.all([
    prisma.warmupEnrollment.count({ where: { status: "active", type: "initial" } }),
    prisma.warmupEnrollment.count({ where: { status: "active", type: "maintenance" } })
  ]);

  // Overdue count
  const overdueCount = await prisma.warmupEnrollment.count({
    where: { status: "active", nextDueDate: { lt: startOfToday } }
  });

  // Calculate Warmer accuracy/on-time completion rate
  // We look at warmup events checked off in the last 7 days vs overdue tasks
  const completedEventsLastWeek = await prisma.activityEvent.count({
    where: { functionType: "warmup", occurredAt: { gte: getZonedFutureStartOfDay(tz, -7) } }
  });
  const totalTasks = completedEventsLastWeek + overdueCount;
  const onTimeRate = totalTasks > 0 ? (completedEventsLastWeek / totalTasks) * 100 : 100;

  return {
    stageInitialCount,
    stageMaintenanceCount,
    overdueCount,
    onTimeRate
  };
}

/**
 * Formats KPI log lines as a CSV string
 */
export function exportKpiCsv(events: any[]) {
  const headers = ["ID", "Employee", "Email", "Job Function", "Volume Count", "Zoned Date", "Campaign", "Mode"];
  const lines = [headers.join(",")];

  events.forEach((ev) => {
    const line = [
      ev.id,
      `"${ev.userName.replace(/"/g, '""')}"`,
      ev.userEmail,
      ev.functionType,
      ev.count,
      ev.occurredAt,
      ev.campaignTitle ? `"${ev.campaignTitle.replace(/"/g, '""')}"` : "",
      ev.source
    ];
    lines.push(line.join(","));
  });

  return lines.join("\n");
}
