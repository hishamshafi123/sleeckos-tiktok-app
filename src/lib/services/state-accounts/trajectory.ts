/** Pure reporting calculations shared by the dashboard and regression tests. */
export type TrajectoryRow = {
  accountId: string;
  teamId: string | null;
  views: string;
  metricsObserved: boolean;
  lastSyncAt: string | null;
};
export type TrajectoryDay = {
  id: string;
  label: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  accounts: TrajectoryRow[];
};
export function stateTrajectory(
  days: TrajectoryDay[],
  accounts: { accountId: string; createdAt: string }[],
  todayId: string,
  team: string,
) {
  const today = days.find((d) => d.id === todayId);
  if (!today) return null;
  const created = new Map(
    accounts.map((a) => [a.accountId, Date.parse(a.createdAt)]),
  );
  const selectedRows = (d: TrajectoryDay) =>
    d.accounts.filter((r) => team === "all" || r.teamId === team);
  const boundary = Date.parse(today.startsAt);
  const eligible = days.filter((d) => {
    const start = Date.parse(d.startsAt),
      end = Date.parse(d.endsAt),
      rows = selectedRows(d);
    // Don't extrapolate the open day, an account's onboarding day, a timezone
    // transition, or a day with missing accounts/stale end-of-day collection.
    return (
      end <= boundary &&
      d.timezone === today.timezone &&
      end - start >= 23 * 3600000 &&
      end - start <= 25 * 3600000 &&
      rows.length > 0 &&
      rows.every(
        (r) =>
          r.metricsObserved &&
          r.lastSyncAt &&
          Date.parse(r.lastSyncAt) >= end - 2 * 3600000 &&
          created.has(r.accountId) &&
          created.get(r.accountId)! <= start,
      )
    );
  });
  const labelBefore = (n: number) => {
    const date = new Date(`${today.label}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - n);
    return date.toISOString().slice(0, 10);
  };
  const current = eligible.filter(
    (d) => d.label >= labelBefore(7) && d.label < today.label,
  );
  const prior = eligible.filter(
    (d) => d.label >= labelBefore(14) && d.label < labelBefore(7),
  );
  const average = (list: TrajectoryDay[]) =>
    list.length
      ? list.reduce(
          (sum, d) =>
            sum + selectedRows(d).reduce((n, r) => n + Number(r.views), 0),
          0,
        ) / list.length
      : null;
  const recentAvg = average(current),
    priorAvg = average(prior);
  const ids = (d: TrajectoryDay) =>
    selectedRows(d)
      .map((r) => r.accountId)
      .sort()
      .join("|");
  const stable = current.every((d) => ids(d) === ids(today));
  const comparable = stable && prior.every((d) => ids(d) === ids(today));
  const enough = current.length >= 3 && stable;
  const growth =
    comparable &&
    current.length >= 3 &&
    prior.length >= 3 &&
    priorAvg !== null &&
    priorAvg > 0
      ? recentAvg! / priorAvg - 1
      : null;
  const project = (horizon: number) =>
    enough
      ? {
          horizon,
          low: Math.round(recentAvg! * horizon * 0.7),
          expected: Math.round(recentAvg! * horizon),
          high: Math.round(recentAvg! * horizon * 1.3),
        }
      : null;
  return {
    recentAvg,
    priorAvg,
    recentDays: current.length,
    priorDays: prior.length,
    growth,
    stable,
    comparable,
    todayViews: selectedRows(today).some((r) => r.metricsObserved)
      ? selectedRows(today).reduce((n, r) => n + Number(r.views), 0)
      : null,
    next7: project(7),
    next30: project(30),
  };
}
