import assert from "node:assert/strict";
import {
  stateTrajectory,
  type TrajectoryDay,
} from "../src/lib/services/state-accounts/trajectory";
const dayMs = 86400000,
  start = Date.UTC(2026, 9, 1);
const accounts = [
  { accountId: "a", createdAt: new Date(start - dayMs).toISOString() },
  { accountId: "b", createdAt: new Date(start - dayMs).toISOString() },
];
const days: TrajectoryDay[] = Array.from({ length: 15 }, (_, i) => ({
  id: String(i),
  label: new Date(start + i * dayMs).toISOString().slice(0, 10),
  startsAt: new Date(start + i * dayMs).toISOString(),
  endsAt: new Date(start + (i + 1) * dayMs).toISOString(),
  timezone: "Asia/Kolkata",
  accounts: accounts.map((a) => ({
    accountId: a.accountId,
    teamId: a.accountId === "a" ? "team-a" : null,
    views: String(i === 14 ? 9999 : i < 7 ? 100 : 200),
    metricsObserved: true,
    lastSyncAt: new Date(start + (i + 1) * dayMs - 3600000).toISOString(),
  })),
}));
const all = stateTrajectory(days, accounts, "14", "all")!;
assert.equal(all.recentAvg, 400);
assert.equal(all.priorAvg, 200);
assert.equal(all.growth, 1);
assert.equal(all.todayViews, 19998);
assert.equal(all.next7?.expected, 2800);
assert.equal(all.next30?.expected, 12000);
const team = stateTrajectory(days, accounts, "14", "team-a")!;
assert.equal(team.recentAvg, 200);
assert.equal(team.next7?.expected, 1400);
const missing = structuredClone(days);
missing[13].accounts[0].metricsObserved = false;
const partial = stateTrajectory(missing, accounts, "14", "all")!;
assert.equal(partial.recentDays, 6);
assert.equal(partial.recentAvg, 400, "missing collection does not become zero");
missing[12].accounts[0].lastSyncAt = new Date(start + 12 * dayMs).toISOString();
assert.equal(
  stateTrajectory(missing, accounts, "14", "all")!.recentDays,
  5,
  "stale end-of-day sync excluded",
);
const zero = structuredClone(days);
zero.forEach((d) => d.accounts.forEach((a) => (a.views = "0")));
assert.equal(
  stateTrajectory(zero, accounts, "14", "all")!.next7?.expected,
  0,
  "observed zero is valid",
);
assert.equal(
  stateTrajectory(zero, accounts, "14", "all")!.growth,
  null,
  "zero baseline cannot yield percentage",
);
assert.equal(
  stateTrajectory(days.slice(-3), accounts, "14", "all")!.next7,
  null,
  "two completed days insufficient",
);
const onboard = accounts.map((a) => ({
  ...a,
  createdAt: new Date(start + 12 * dayMs + 3600000).toISOString(),
}));
assert.equal(
  stateTrajectory(days, onboard, "14", "all")!.recentDays,
  1,
  "onboarding partial days excluded",
);
const changed = structuredClone(days);
changed[13].accounts[1].teamId = "team-a";
assert.equal(
  stateTrajectory(changed, accounts, "14", "team-a")!.next7,
  null,
  "account mix changes suppress projection",
);
const tz = structuredClone(days);
tz[13].timezone = "Europe/London";
assert.equal(
  stateTrajectory(tz, accounts, "14", "all")!.recentDays,
  6,
  "different timezone excluded from trend",
);
const short = structuredClone(days);
short[13].endsAt = new Date(start + 13 * dayMs + 12 * 3600000).toISOString();
assert.equal(
  stateTrajectory(short, accounts, "14", "all")!.recentDays,
  6,
  "short reporting days excluded",
);
assert.equal(stateTrajectory(days, accounts, "14", "no-team")!.next7, null);
console.log(
  "PASS: combined/unassigned totals, team filtering, growth, projections, partial days, missing data, real zeros, onboarding, timezone changes and account mix",
);
