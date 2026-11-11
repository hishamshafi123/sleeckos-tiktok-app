import prisma from "@/lib/db";

export async function statePosts(params: URLSearchParams, now = new Date()) {
  const dayId = params.get("day") || "";
  const team = params.get("team") || "all";
  const accountId = params.get("account") || "";
  const page = Math.max(
    0,
    Math.min(10000, Math.floor(Number(params.get("page")) || 0)),
  );
  const day = await prisma.stateReportingDay.findUnique({
    where: { id: dayId },
    include: { accounts: { include: { team: { select: { name: true } } } } },
  });
  if (!day) return null;
  const rolling = params.get("window") === "24h";
  if (rolling && !accountId) return null;
  const requestedEnd = new Date(params.get("asOf") || now);
  const windowEnd =
    Number.isFinite(requestedEnd.getTime()) && requestedEnd <= now
      ? requestedEnd
      : now;
  const startsAt = rolling
    ? new Date(windowEnd.getTime() - 24 * 3600000)
    : day.startsAt;
  const endsAt = rolling ? windowEnd : day.endsAt;
  const rows = day.accounts.filter(
    (r) =>
      (team === "all" || r.teamId === team) &&
      (!accountId || r.accountId === accountId),
  );
  const where = {
    accountId: { in: rows.map((r) => r.accountId) },
    publishedAt: { gte: startsAt, lt: endsAt },
  };
  const [posts, total] = await prisma.$transaction(
    [
      prisma.stateVideo.findMany({
        where,
        orderBy: [{ publishedAt: "desc" }, { videoId: "asc" }],
        take: 50,
        skip: page * 50,
        include: {
          account: {
            select: {
              stateName: true,
              guardianPhone: { select: { name: true } },
              account: {
                select: {
                  tiktokUsername: true,
                  tiktokDisplayName: true,
                  driveFolderName: true,
                },
              },
            },
          },
        },
      }),
      prisma.stateVideo.count({ where }),
    ],
    { isolationLevel: "RepeatableRead" },
  );
  return {
    day: {
      id: day.id,
      label: day.label,
      timezone: day.timezone,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    },
    total,
    page,
    posts: posts.map((p) => ({
      videoId: p.videoId,
      accountId: p.accountId,
      url: p.url,
      publishedAt: p.publishedAt.toISOString(),
      lastObservedAt: p.lastObservedAt.toISOString(),
      unavailable: p.unavailable,
      accountName:
        p.account.stateName ||
        p.account.guardianPhone?.name ||
        p.account.account.driveFolderName ||
        p.account.account.tiktokDisplayName ||
        p.account.account.tiktokUsername,
      username: p.account.account.tiktokUsername,
      teamName:
        rows.find((r) => r.accountId === p.accountId)?.team?.name ||
        "Unassigned",
      views: p.views.toString(),
      likes: p.likes.toString(),
    })),
  };
}
