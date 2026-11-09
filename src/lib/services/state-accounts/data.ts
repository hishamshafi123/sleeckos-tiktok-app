import prisma from "@/lib/db";
import { Prisma } from "@prisma/client";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import {
  nextMidnight,
  target,
  validTimezone,
  runtimeMinutes,
  discoveryLimit,
} from "./rules";

export const STATE_WHERE: Prisma.ManagedAccountWhereInput = {
  revokedAt: null,
  OR: [
    {
      labelAssignments: {
        some: { label: { name: { equals: "state", mode: "insensitive" } } },
      },
    },
    { section: { name: { equals: "state", mode: "insensitive" } } },
    { section: { name: { equals: "state accounts", mode: "insensitive" } } },
  ],
};
const TZ_KEY = "state_accounts_timezone";

export async function ensureStateDay(now = new Date()) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(893271)`;
      const setting = await tx.appSetting.findUnique({
        where: { key: TZ_KEY },
      });
      const timezone = setting?.value || "Asia/Kolkata";
      let day = await tx.stateReportingDay.findFirst({
        orderBy: { startsAt: "desc" },
      });
      if (!day) {
        const label = formatInTimeZone(now, timezone, "yyyy-MM-dd");
        const startsAt = fromZonedTime(`${label}T00:00:00`, timezone);
        day = await tx.stateReportingDay.create({
          data: {
            label,
            timezone,
            startsAt,
            endsAt: nextMidnight(startsAt, timezone),
          },
        });
      }
      // Persist every boundary, including after downtime. Targets cannot change
      // without first opening the current day under the previous configuration.
      while (day.endsAt <= now) {
        day = await tx.stateReportingDay.create({
          data: {
            label: formatInTimeZone(day.endsAt, timezone, "yyyy-MM-dd"),
            timezone,
            startsAt: day.endsAt,
            endsAt: nextMidnight(day.endsAt, timezone),
          },
        });
        await seedDay(tx, day.id);
      }
      const accounts = await tx.managedAccount.findMany({
        where: STATE_WHERE,
        select: {
          id: true,
          tiktokUsername: true,
          tiktokDisplayName: true,
          driveFolderName: true,
        },
      });
      const phones = (await tx.guardianPhone.findMany()).filter(isStatePhone);
      const existing = await tx.stateAccount.findMany({
        select: { accountId: true, guardianProfileId: true },
      });
      const used = new Set(existing.map((a) => a.guardianProfileId));
      const normalize = (value: string) =>
        value.trim().replace(/^@/, "").toLowerCase();
      for (const account of accounts) {
        if (existing.some((a) => a.accountId === account.id)) continue;
        const names = [
          account.tiktokUsername,
          account.tiktokDisplayName,
          account.driveFolderName,
        ]
          .filter((s): s is string => !!s)
          .map(normalize);
        const matches = phones.filter(
          (p) =>
            !used.has(p.profileId) &&
            names.includes(normalize(p.name)) &&
            accounts.filter((candidate) =>
              [
                candidate.tiktokUsername,
                candidate.tiktokDisplayName,
                candidate.driveFolderName,
              ].some((name) => name && normalize(name) === normalize(p.name)),
            ).length === 1,
        );
        // Only a unique exact name match is safe; otherwise the admin links it.
        const phone = matches.length === 1 ? matches[0] : undefined;
        await tx.stateAccount.create({
          data: { accountId: account.id, guardianProfileId: phone?.profileId },
        });
        if (phone) used.add(phone.profileId);
      }
      await seedDay(tx, day.id);
      return day;
    },
    { timeout: 30000 },
  );
}

async function seedDay(tx: Prisma.TransactionClient, dayId: string) {
  const accounts = await tx.stateAccount.findMany({
    where: { account: STATE_WHERE },
    include: { team: true },
  });
  await tx.stateAccountDay.createMany({
    data: accounts.map((a) => ({
      dayId,
      accountId: a.accountId,
      teamId: a.teamId,
      guardianProfileId: a.guardianProfileId,
      postsTarget: a.postsTarget ?? a.team?.postsTarget ?? 0,
      warmupTarget: a.warmupTarget ?? a.team?.warmupTarget ?? 0,
    })),
    skipDuplicates: true,
  });
}

export async function stateAccess(userId: string, role: string) {
  if (role === "admin") return true;
  return !!(await prisma.stateTeamMember.findFirst({ where: { userId } }));
}

export async function updateStateConfig(body: Record<string, unknown>) {
  const day = await ensureStateDay();
  if (body.action === "timezone") {
    if (!validTimezone(body.timezone))
      throw new Error("Choose a valid business timezone.");
    await prisma.appSetting.upsert({
      where: { key: TZ_KEY },
      create: { key: TZ_KEY, value: body.timezone },
      update: { value: body.timezone },
    });
    return;
  }
  if (body.action === "team") {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 80)
      throw new Error("Team names must contain 1–80 characters.");
    const postsTarget = target(body.postsTarget)!;
    const warmupTarget = target(body.warmupTarget)!;
    if (
      !Array.isArray(body.memberIds) ||
      body.memberIds.some((id) => typeof id !== "string")
    )
      throw new Error("Choose valid team members.");
    const memberIds = [...new Set(body.memberIds as string[])];
    if (
      (await prisma.user.count({
        where: { id: { in: memberIds }, status: { not: "DISABLED" } },
      })) !== memberIds.length
    )
      throw new Error("A selected member is unavailable.");
    const id = typeof body.id === "string" ? body.id : undefined;
    await prisma.$transaction(async (tx) => {
      const team = id
        ? await tx.stateTeam.update({
            where: { id },
            data: { name, postsTarget, warmupTarget },
          })
        : await tx.stateTeam.create({
            data: { name, postsTarget, warmupTarget },
          });
      await tx.stateTeamMember.deleteMany({ where: { teamId: team.id } });
      await tx.stateTeamMember.createMany({
        data: memberIds.map((userId) => ({ teamId: team.id, userId })),
      });
    });
    return;
  }
  if (body.action === "account") {
    if (
      typeof body.accountId !== "string" ||
      !(await prisma.managedAccount.findFirst({
        where: { ...STATE_WHERE, id: body.accountId },
      }))
    )
      throw new Error("Select a state account.");
    const teamId =
      typeof body.teamId === "string" && body.teamId ? body.teamId : null;
    const team = teamId
      ? await prisma.stateTeam.findUnique({ where: { id: teamId } })
      : null;
    if (teamId && !team) throw new Error("Team not found.");
    const guardianProfileId =
      typeof body.guardianProfileId === "string" && body.guardianProfileId
        ? body.guardianProfileId
        : null;
    if (guardianProfileId) {
      const phone = await prisma.guardianPhone.findUnique({
        where: { profileId: guardianProfileId },
      });
      if (!phone || !isStatePhone(phone))
        throw new Error("Choose a Guardian phone tagged state.");
      if (
        await prisma.stateAccountDay.findFirst({
          where: {
            dayId: day.id,
            guardianProfileId,
            accountId: { not: body.accountId },
          },
        })
      ) {
        throw new Error(
          "This phone is credited to another account today. Link it after the reporting day closes.",
        );
      }
    }
    const postsTarget = target(body.postsTarget, true);
    const warmupTarget = target(body.warmupTarget, true);
    const stateName =
      typeof body.stateName === "string"
        ? body.stateName.trim().slice(0, 100)
        : null;
    await prisma.stateAccount.update({
      where: { accountId: body.accountId },
      data: { teamId, postsTarget, warmupTarget, stateName, guardianProfileId },
    });
    // First assignment may start immediately; existing ownership stays frozen.
    await prisma.stateAccountDay.updateMany({
      where: { accountId: body.accountId, dayId: day.id, teamId: null },
      data: {
        teamId,
        guardianProfileId,
        postsTarget: postsTarget ?? team?.postsTarget ?? 0,
        warmupTarget: warmupTarget ?? team?.warmupTarget ?? 0,
      },
    });
    return;
  }
  throw new Error("Unknown action.");
}

export function isStatePhone(phone: {
  tags: unknown;
  matchedTag: string | null;
}) {
  return (
    Array.isArray(phone.tags) &&
    phone.tags.some(
      (tag) => typeof tag === "string" && tag.toLowerCase() === "state",
    )
  );
}

export async function getStateDashboard(isAdmin: boolean) {
  const today = await ensureStateDay();
  await refreshActivityCounts();
  const [teams, accounts, days, setting, users, guardianPhones, guardianCycle] =
    await Promise.all([
      prisma.stateTeam.findMany({
        orderBy: { name: "asc" },
        include: {
          members: { include: { user: { select: { id: true, name: true } } } },
        },
      }),
      prisma.stateAccount.findMany({
        where: { account: STATE_WHERE },
        include: {
          guardianPhone: true,
          account: {
            select: {
              tiktokUsername: true,
              tiktokDisplayName: true,
              driveFolderName: true,
              isActive: true,
            },
          },
        },
      }),
      prisma.stateReportingDay.findMany({
        orderBy: { startsAt: "desc" },
        take: 35,
        include: { accounts: true },
      }),
      prisma.appSetting.findUnique({ where: { key: TZ_KEY } }),
      isAdmin
        ? prisma.user.findMany({
            where: { status: { not: "DISABLED" } },
            select: { id: true, name: true, email: true },
            orderBy: { name: "asc" },
          })
        : Promise.resolve([]),
      prisma.guardianPhone.findMany({ orderBy: { name: "asc" } }),
      prisma.guardianCycle.findFirst({
        where: { status: "success" },
        orderBy: { finishedAt: "desc" },
        select: { finishedAt: true },
      }),
    ]);
  return {
    generatedAt: new Date(),
    discoveryLimit: discoveryLimit(),
    isAdmin,
    todayId: today.id,
    timezone: today.timezone,
    nextTimezone: setting?.value || "Asia/Kolkata",
    endsAt: today.endsAt,
    teams: teams.map((t) => ({
      ...t,
      members: t.members.map((m) => ({
        id: m.user.id,
        name: m.user.name || "Team member",
      })),
    })),
    accounts: accounts.map((a) => ({
      ...a,
      phoneName: a.guardianPhone?.name ?? null,
      stateName:
        a.stateName ||
        a.guardianPhone?.name ||
        a.account.driveFolderName ||
        a.account.tiktokDisplayName ||
        a.account.tiktokUsername,
    })),
    days: days.reverse(),
    users,
    phones: guardianPhones.filter(isStatePhone).map((p) => ({
      id: p.profileId,
      name: p.name,
      lastSeenAt: p.lastSeenAt,
    })),
    guardianHeartbeat: guardianCycle?.finishedAt ?? null,
  };
}

export async function refreshActivityCounts(daysBack = 2) {
  const days = await prisma.stateReportingDay.findMany({
    orderBy: { startsAt: "desc" },
    take: daysBack,
  });
  if (!days.length) return;
  const since = days[days.length - 1].startsAt;
  const [videos, samples, stops, phones, rows] = await Promise.all([
    prisma.stateVideo.findMany({
      where: { publishedAt: { gte: since } },
      select: { accountId: true, publishedAt: true },
    }),
    prisma.guardianRuntimeSample.findMany({
      where: { observedAt: { gte: since } },
    }),
    prisma.guardianStopEvent.findMany({
      where: { occurredAt: { gte: since }, runtimeSecs: { not: null } },
      select: { profileId: true, occurredAt: true, runtimeSecs: true },
    }),
    prisma.guardianPhone.findMany({
      where: { lastSeenAt: { gte: since }, runningTimeSecs: { not: null } },
      select: {
        profileId: true,
        lastSeenAt: true,
        runningTimeSecs: true,
        isRunning: true,
      },
    }),
    prisma.stateAccountDay.findMany({
      where: { dayId: { in: days.map((d) => d.id) } },
    }),
  ]);
  const dayMap = new Map(days.map((d) => [d.id, d]));
  const observationsByPhone = new Map<
    string,
    { observedAt: Date; runtimeSecs: number }[]
  >();
  for (const sample of [
    ...samples,
    ...stops.map((s) => ({
      profileId: s.profileId,
      observedAt: s.occurredAt,
      runtimeSecs: s.runtimeSecs!,
    })),
    ...phones
      .filter((p) => p.isRunning)
      .map((p) => ({
        profileId: p.profileId,
        observedAt: p.lastSeenAt,
        runtimeSecs: p.runningTimeSecs!,
      })),
  ]) {
    const group = observationsByPhone.get(sample.profileId) || [];
    group.push(sample);
    observationsByPhone.set(sample.profileId, group);
  }
  await prisma.$transaction(
    rows.map((row) => {
      const day = dayMap.get(row.dayId)!;
      const inside = (date: Date) => date >= day.startsAt && date < day.endsAt;
      const posts = videos.filter(
        (v) => v.accountId === row.accountId && inside(v.publishedAt),
      ).length;
      const profileId = row.guardianProfileId;
      const observations = profileId
        ? observationsByPhone.get(profileId) || []
        : [];
      const warmupMinutes = runtimeMinutes(
        observations,
        day.startsAt,
        day.endsAt,
      );
      // Concurrent dashboard reads must not overwrite a newer rollup.
      return prisma.$executeRaw`
        UPDATE "StateAccountDay"
        SET "posts" = GREATEST("posts", ${posts}),
            "warmupMinutes" = GREATEST("warmupMinutes", ${warmupMinutes})
        WHERE "id" = ${row.id}
      `;
    }),
  );
}
