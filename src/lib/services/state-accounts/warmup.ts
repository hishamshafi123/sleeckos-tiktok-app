import prisma from "@/lib/db";
import { observedSessions } from "./sessions";
export async function stateWarmup(params: URLSearchParams) {
  const day = await prisma.stateReportingDay.findUnique({
    where: { id: params.get("day") || "" },
    include: { accounts: true },
  });
  const row = day?.accounts.find((r) => r.accountId === params.get("account"));
  if (!day || !row) return null;
  const profileId = row.guardianProfileId;
  const [samples, stops, phone] = profileId
    ? await Promise.all([
        prisma.guardianRuntimeSample.findMany({
          where: { profileId, observedAt: { gte: day.startsAt } },
          select: { observedAt: true, runtimeSecs: true },
        }),
        prisma.guardianStopEvent.findMany({
          where: {
            profileId,
            occurredAt: { gte: day.startsAt },
            runtimeSecs: { not: null },
          },
          select: { occurredAt: true, runtimeSecs: true },
        }),
        prisma.guardianPhone.findUnique({ where: { profileId } }),
      ])
    : [[], [], null];
  const observations = [
    ...samples,
    ...stops.map((s) => ({
      observedAt: s.occurredAt,
      runtimeSecs: s.runtimeSecs!,
    })),
    ...(phone?.isRunning && phone.runningTimeSecs !== null
      ? [{ observedAt: phone.lastSeenAt, runtimeSecs: phone.runningTimeSecs }]
      : []),
  ];
  const sessions = observedSessions(observations, day.startsAt, day.endsAt);
  return {
    timezone: day.timezone,
    label: day.label,
    linked: !!profileId,
    sessions,
    totalSeconds: sessions.reduce((total, s) => total + s.seconds, 0),
    opens: sessions.filter((s) => !s.carriedOver).length,
    lastSeenAt: phone?.lastSeenAt.toISOString() ?? null,
    runningAtLastCheck: phone?.isRunning ?? false,
  };
}
