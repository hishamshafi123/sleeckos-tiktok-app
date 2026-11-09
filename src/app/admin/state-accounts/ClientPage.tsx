"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  RefreshCw,
  Users,
  Settings2,
  AlertCircle,
  Clock3,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Team = {
  id: string;
  name: string;
  postsTarget: number;
  warmupTarget: number;
  members: { id: string; name: string }[];
};
type Account = {
  accountId: string;
  teamId: string | null;
  stateName: string;
  guardianProfileId: string | null;
  phoneName: string | null;
  postsTarget: number | null;
  warmupTarget: number | null;
  lastSyncAt: string | null;
  syncError: string | null;
  followers: string | null;
  profileLikes: string | null;
  account: { tiktokUsername: string; isActive: boolean };
};
type DayRow = {
  accountId: string;
  teamId: string | null;
  guardianProfileId: string | null;
  posts: number;
  postsTarget: number;
  warmupMinutes: number;
  warmupTarget: number;
  views: string;
  likes: string;
  followerGrowth: string;
  metricsObserved: boolean;
  followersObserved: boolean;
  lastSyncAt: string | null;
};
type Day = {
  id: string;
  label: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  accounts: DayRow[];
};
type Data = {
  generatedAt: string;
  discoveryLimit: number;
  isAdmin: boolean;
  todayId: string;
  timezone: string;
  nextTimezone: string;
  endsAt: string;
  teams: Team[];
  accounts: Account[];
  days: Day[];
  users: { id: string; name: string | null; email: string }[];
  phones: { id: string; name: string; lastSeenAt: string }[];
  guardianHeartbeat: string | null;
};
const COLORS = [
  "#60a5fa",
  "#a78bfa",
  "#2dd4bf",
  "#fbbf24",
  "#fb7185",
  "#f472b6",
  "#a3e635",
  "#38bdf8",
];
const input =
  "w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500";
const button =
  "inline-flex items-center justify-center gap-2 rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-50";
const fmt = (value: number | string) => Number(value).toLocaleString("en-US");
const met = (r: DayRow) =>
  r.posts >= r.postsTarget && r.warmupMinutes >= r.warmupTarget;
const eligible = (r: DayRow) =>
  !!r.teamId && (r.postsTarget > 0 || r.warmupTarget > 0);
const weekLabel = (label: string) => {
  const d = new Date(`${label}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

function Progress({
  value,
  target,
  suffix = "",
}: {
  value: number;
  target: number;
  suffix?: string;
}) {
  return (
    <div className="min-w-28">
      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
        <span
          className={
            target > 0 && value >= target ? "text-teal-300" : "text-zinc-200"
          }
        >
          {value}
          {suffix}
        </span>
        <span className="text-zinc-500">
          {target ? `/ ${target}${suffix}` : "No target"}
        </span>
      </div>
      {target > 0 && (
        <div
          className="h-1 rounded bg-zinc-800"
          role="progressbar"
          aria-label={suffix ? "Warm-up target" : "Posting target"}
          aria-valuenow={Math.min(value, target)}
          aria-valuemin={0}
          aria-valuemax={target}
        >
          <div
            className={`h-1 rounded ${value >= target ? "bg-teal-400" : "bg-blue-400"}`}
            style={{ width: `${Math.min(100, (value / target) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function TeamChart({
  days,
  teams,
  weekly,
}: {
  days: Day[];
  teams: Team[];
  weekly: boolean;
}) {
  const groups = new Map<string, { label: string; days: Day[] }>();
  for (const day of days) {
    const key = weekly ? weekLabel(day.label) : day.id;
    const group = groups.get(key) || {
      label: weekly ? key : day.label,
      days: [],
    };
    group.days.push(day);
    groups.set(key, group);
  }
  const points = [...groups].map(([key, { label, days: group }]) => ({
    key,
    label,
    values: teams.map((t) => {
      const rows = group.flatMap((d) =>
        d.accounts.filter((a) => a.teamId === t.id),
      );
      return rows.some((r) => r.metricsObserved)
        ? rows.reduce((sum, r) => sum + Number(r.views), 0)
        : null;
    }),
  }));
  const max = Math.max(
    1,
    ...points.flatMap((p) => p.values.filter((v): v is number => v !== null)),
  );
  if (!points.some((p) => p.values.some((v) => v !== null)))
    return (
      <div className="flex h-52 items-center justify-center text-sm text-zinc-500">
        Charts appear after the hourly sync establishes a baseline.
      </div>
    );
  const width = Math.max(640, points.length * 60),
    height = 220,
    left = 65,
    inner = width - left - 15;
  const slot = inner / Math.max(1, points.length),
    barWidth = Math.min(22, (slot - 12) / Math.max(1, teams.length));
  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full min-w-[640px]"
        role="img"
        aria-label={`${weekly ? "Weekly" : "Daily"} observed views gained by team`}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line
              x1={left}
              x2={width - 10}
              y1={180 - 155 * f}
              y2={180 - 155 * f}
              stroke="#27272a"
            />
            <text
              x={left - 10}
              y={184 - 155 * f}
              fill="#a1a1aa"
              textAnchor="end"
              fontSize="10"
            >
              {Intl.NumberFormat("en", { notation: "compact" }).format(max * f)}
            </text>
          </g>
        ))}
        {points.map((point, i) => (
          <g key={point.key}>
            {point.values.map(
              (value, j) =>
                value !== null && (
                  <rect
                    key={teams[j].id}
                    x={
                      left +
                      slot * i +
                      (slot - teams.length * barWidth) / 2 +
                      j * barWidth
                    }
                    y={180 - (value / max) * 155}
                    width={Math.max(1, barWidth - 2)}
                    height={Math.max(1, (value / max) * 155)}
                    rx="2"
                    fill={COLORS[j % COLORS.length]}
                  >
                    <title>
                      {teams[j].name}: {fmt(value)} views, {point.label}
                      {weekly ? " week" : ""}
                    </title>
                  </rect>
                ),
            )}
            {(points.length < 12 || i % 3 === 0 || i === points.length - 1) && (
              <text
                x={left + slot * (i + 0.5)}
                y={205}
                fill="#a1a1aa"
                textAnchor="middle"
                fontSize="10"
              >
                {point.label.slice(5)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="flex flex-wrap gap-x-5 gap-y-2 px-4 text-xs text-zinc-400">
        {teams.map((t, i) => (
          <span key={t.id} className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: COLORS[i % COLORS.length] }}
            />
            {t.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function ClientPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState("all");
  const [period, setPeriod] = useState(7);
  const [weekly, setWeekly] = useState(false);
  const [sort, setSort] = useState<
    "views" | "likes" | "followers" | "consistency"
  >("views");
  const [teamEdit, setTeamEdit] = useState<Team | "new" | null>(null);
  const [accountEdit, setAccountEdit] = useState<Account | null>(null);
  const [timezoneOpen, setTimezoneOpen] = useState(false);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/state-accounts", {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setData(body);
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load state accounts.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const first = setTimeout(() => {
      void load();
    }, 0);
    const timer = setInterval(() => {
      void load();
    }, 60000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);
  const save = async (payload: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/state-accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setTeamEdit(null);
      setAccountEdit(null);
      setTimezoneOpen(false);
      toast.success("Changes saved");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save changes.");
    } finally {
      setBusy(false);
    }
  };
  const rankings = useMemo(() => {
    if (!data) return [];
    const days = data.days.slice(-period);
    return data.teams
      .map((team) => {
        const rows = days.flatMap((d) =>
          d.accounts.filter((r) => r.teamId === team.id),
        );
        const complete = days
          .filter((d) => d.id !== data.todayId)
          .flatMap((d) =>
            d.accounts.filter((r) => r.teamId === team.id && eligible(r)),
          );
        const total = (key: "views" | "likes" | "followerGrowth") =>
          rows.reduce((sum, r) => sum + Number(r[key]), 0);
        const known = complete.filter(
          (r) => r.lastSyncAt && (r.warmupTarget === 0 || r.guardianProfileId),
        );
        const done = known.filter(met).length;
        return {
          team,
          views: total("views"),
          likes: total("likes"),
          followers: total("followerGrowth"),
          consistency: known.length ? done / known.length : -1,
          done,
          total: known.length,
          missing: complete.length - known.length,
          observed: rows.some((r) => r.metricsObserved),
          followersObserved: rows.some((r) => r.followersObserved),
        };
      })
      .sort((a, b) => b[sort] - a[sort]);
  }, [data, period, sort]);
  if (loading)
    return <p className="py-12 text-zinc-400">Loading state accounts…</p>;
  if (!data)
    return (
      <div role="alert" className="text-red-300">
        {error}
        <button className={`${button} ml-4`} onClick={load}>
          Retry
        </button>
      </div>
    );
  const today = data.days.find((d) => d.id === data.todayId)!;
  const rows = today.accounts.filter(
    (r) => selected === "all" || r.teamId === selected,
  );
  const accounts = data.accounts.filter(
    (a) => selected === "all" || rows.some((r) => r.accountId === a.accountId),
  );
  const selectedTeams = data.teams.filter(
    (t) => selected === "all" || t.id === selected,
  );
  const stale = data.accounts.filter(
    (a) =>
      !a.lastSyncAt ||
      new Date(data.generatedAt).getTime() - new Date(a.lastSyncAt).getTime() >
        90 * 60000 ||
      a.syncError,
  ).length;
  const guardianStale =
    !data.guardianHeartbeat ||
    new Date(data.generatedAt).getTime() -
      new Date(data.guardianHeartbeat).getTime() >
      5 * 60000;
  const completed = rows.filter((r) => eligible(r) && met(r)).length;
  const teamName = (id: string | null) =>
    data.teams.find((t) => t.id === id)?.name || "Unassigned";

  return (
    <div className="space-y-7 text-zinc-100">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            State Accounts
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Team performance and daily posting & warm-up targets.
          </p>
          <p className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
            <Clock3 size={13} />
            {data.timezone} · Day ends{" "}
            {new Date(data.endsAt).toLocaleTimeString("en", {
              timeZone: data.timezone,
              hour: "2-digit",
              minute: "2-digit",
            })}
            {data.nextTimezone !== data.timezone &&
              ` · Next day: ${data.nextTimezone}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className={button}
            onClick={load}
            aria-label="Refresh dashboard"
          >
            <RefreshCw size={15} />
          </button>
          {data.isAdmin && (
            <>
              <button className={button} onClick={() => setTimezoneOpen(true)}>
                <Settings2 size={15} />
                Timezone
              </button>
              <button
                className={`${button} border-blue-600 bg-blue-600 hover:bg-blue-500`}
                onClick={() => setTeamEdit("new")}
              >
                <Plus size={15} />
                Create team
              </button>
            </>
          )}
        </div>
      </header>
      {error && (
        <p
          role="alert"
          className="rounded border border-red-900 bg-red-950/30 p-3 text-sm text-red-300"
        >
          {error}
        </p>
      )}
      {(stale > 0 || guardianStale) && (
        <div className="flex gap-3 rounded-md border border-amber-900/70 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div>
            {stale > 0 && (
              <p>
                {stale} account{stale === 1 ? " is" : "s are"} awaiting a fresh
                hourly sync. Existing figures are retained.
              </p>
            )}
            {guardianStale && (
              <p>
                Guardian has no recent heartbeat. Warm-up totals reflect the
                last received observations.
              </p>
            )}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-4 border-y border-zinc-800 py-5">
        <div className="flex flex-wrap gap-x-9 gap-y-4">
          <div>
            <p className="text-2xl font-semibold tabular-nums">
              {accounts.length}
            </p>
            <p className="text-xs text-zinc-500">State accounts</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">
              {completed}
              <span className="text-base font-normal text-zinc-500">
                {" "}
                / {rows.filter(eligible).length}
              </span>
            </p>
            <p className="text-xs text-zinc-500">
              Accounts meeting today’s KPIs
            </p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">
              {rows.reduce((n, r) => n + r.posts, 0)}
            </p>
            <p className="text-xs text-zinc-500">Posts detected today</p>
          </div>
        </div>
        <label className="text-xs text-zinc-400">
          View team
          <select
            className={`${input} mt-1 min-w-44`}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="all">All teams</option>
            {data.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!data.teams.length && (
        <div className="rounded-lg border border-dashed border-zinc-700 p-7">
          <Users className="mb-3 text-blue-400" size={24} />
          <h2 className="font-medium">Put your state accounts into teams</h2>
          <p className="mt-2 max-w-xl text-sm text-zinc-400">
            Create a team, select its members, then assign accounts and link
            their Guardian phones. Members can compare every team’s performance.
          </p>
          {data.isAdmin && (
            <button
              className={`${button} mt-4`}
              onClick={() => setTeamEdit("new")}
            >
              Create your first team
            </button>
          )}
        </div>
      )}
      <section
        aria-labelledby="views-heading"
        className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5"
      >
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="views-heading" className="font-medium">
              Views gained by team
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Observed growth since tracking began. Current day and week are
              partial.
            </p>
          </div>
          <div className="flex gap-2">
            <select
              aria-label="Chart grouping"
              className={input}
              value={weekly ? "weekly" : "daily"}
              onChange={(e) => setWeekly(e.target.value === "weekly")}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
            <select
              aria-label="Reporting period"
              className={input}
              value={period}
              onChange={(e) => setPeriod(Number(e.target.value))}
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
            </select>
          </div>
        </div>
        <TeamChart
          days={data.days.slice(-period)}
          teams={selectedTeams}
          weekly={weekly}
        />
        <p className="mt-4 text-xs text-zinc-500">
          Views and likes cover discovered public videos. Initial discovery
          includes up to {data.discoveryLimit} recent posts per account; all
          discovered videos are refreshed hourly.
        </p>
      </section>
      {!!data.teams.length && (
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-medium">Team leaderboard</h2>
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              Rank by
              <select
                className={input}
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
              >
                <option value="views">Views gained</option>
                <option value="likes">Likes gained</option>
                <option value="followers">Follower growth</option>
                <option value="consistency">KPI consistency</option>
              </select>
            </label>
          </div>
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-800 bg-zinc-900/60 text-xs text-zinc-400">
                <tr>
                  {[
                    "Team / members",
                    "Views gained",
                    "Likes gained",
                    "Follower growth",
                    "KPI days met",
                    "",
                  ].map((h, i) => (
                    <th key={i} className="px-4 py-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {rankings.map((r) => (
                  <tr key={r.team.id}>
                    <td className="px-4 py-4">
                      <button
                        className="font-medium text-blue-300 hover:underline"
                        onClick={() => setSelected(r.team.id)}
                      >
                        {r.team.name}
                      </button>
                      <p className="mt-1 max-w-64 text-xs text-zinc-500">
                        {r.team.members.map((m) => m.name).join(", ") ||
                          "No members yet"}
                      </p>
                    </td>
                    <td className="px-4 tabular-nums">
                      {r.observed ? fmt(r.views) : "—"}
                    </td>
                    <td className="px-4 tabular-nums">
                      {r.observed ? fmt(r.likes) : "—"}
                    </td>
                    <td className="px-4 tabular-nums">
                      {r.followersObserved ? fmt(r.followers) : "—"}
                    </td>
                    <td className="px-4">
                      <span className="tabular-nums">
                        {r.total ? `${Math.round(r.consistency * 100)}%` : "—"}
                      </span>
                      <p className="text-xs text-zinc-500">
                        {r.done} / {r.total} account-days
                      </p>
                      {r.missing > 0 && (
                        <p className="text-xs text-amber-300">
                          {r.missing} awaiting data
                        </p>
                      )}
                    </td>
                    <td className="px-4">
                      {data.isAdmin && (
                        <button
                          className={button}
                          onClick={() => setTeamEdit(r.team)}
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Consistency uses completed days with targets. Extra posts cannot
            make up for a missed account-day. Rankings use totals; teams may
            manage different numbers of accounts.
          </p>
        </section>
      )}
      <section>
        <h2 className="mb-3 font-medium">Today’s account progress</h2>
        {!accounts.length ? (
          <p className="rounded-lg border border-zinc-800 p-6 text-sm text-zinc-400">
            No state accounts found. Add the “state” label to existing managed
            accounts, then refresh this page.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-800 bg-zinc-900/60 text-xs text-zinc-400">
                <tr>
                  {[
                    "State / account",
                    "Team today",
                    "Posts",
                    "Warm-up",
                    "Followers",
                    "Last sync",
                    "",
                  ].map((h, i) => (
                    <th
                      key={i}
                      className="whitespace-nowrap px-4 py-3 font-medium"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {accounts.map((a) => {
                  const row = today.accounts.find(
                    (r) => r.accountId === a.accountId,
                  );
                  return (
                    <tr key={a.accountId}>
                      <td className="px-4 py-4">
                        <p className="font-medium">{a.stateName}</p>
                        <a
                          className="text-xs text-zinc-500 hover:text-blue-300"
                          href={`https://www.tiktok.com/@${encodeURIComponent(a.account.tiktokUsername.replace(/^@/, ""))}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          @{a.account.tiktokUsername.replace(/^@/, "")}
                        </a>
                        <p className="mt-1 text-xs text-zinc-500">
                          {a.phoneName || "Guardian phone not linked"}
                        </p>
                      </td>
                      <td className="px-4 text-xs">
                        {teamName(row?.teamId ?? null)}
                        {row?.teamId !== a.teamId && (
                          <p className="mt-1 text-amber-300">
                            Next day: {teamName(a.teamId)}
                          </p>
                        )}
                      </td>
                      <td className="px-4">
                        {row && (
                          <Progress
                            value={row.posts}
                            target={row.postsTarget}
                          />
                        )}
                      </td>
                      <td className="px-4">
                        {row?.guardianProfileId ? (
                          <Progress
                            value={row.warmupMinutes}
                            target={row.warmupTarget}
                            suffix=" min"
                          />
                        ) : (
                          <span className="text-xs text-amber-300">
                            Link Guardian phone
                          </span>
                        )}
                      </td>
                      <td className="px-4 tabular-nums">
                        {a.followers === null ? "—" : fmt(a.followers)}
                      </td>
                      <td className="px-4 text-xs text-zinc-400">
                        {a.lastSyncAt
                          ? new Date(a.lastSyncAt).toLocaleString("en-GB", {
                              timeZone: data.timezone,
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "Awaiting sync"}
                        {a.syncError && (
                          <p className="mt-1 max-w-44 text-amber-300">
                            {a.syncError}
                          </p>
                        )}
                      </td>
                      <td className="px-4">
                        {data.isAdmin && (
                          <button
                            className={button}
                            onClick={() => setAccountEdit(a)}
                          >
                            Manage
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-zinc-500">
          Warm-up minutes come from Guardian’s observed phone runtime. Targets
          and assignment changes take effect next reporting day; first-time
          assignments start today.
        </p>
      </section>
      <Dialog
        open={teamEdit !== null}
        onOpenChange={(open) => !open && setTeamEdit(null)}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto border-zinc-800 bg-zinc-950 text-zinc-100">
          <DialogHeader>
            <DialogTitle>
              {teamEdit === "new" ? "Create team" : "Edit team"}
            </DialogTitle>
          </DialogHeader>
          {teamEdit && (
            <TeamForm
              key={teamEdit === "new" ? "new" : teamEdit.id}
              team={teamEdit === "new" ? null : teamEdit}
              users={data.users}
              busy={busy}
              save={save}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!accountEdit}
        onOpenChange={(open) => !open && setAccountEdit(null)}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto border-zinc-800 bg-zinc-950 text-zinc-100">
          <DialogHeader>
            <DialogTitle>Manage {accountEdit?.stateName}</DialogTitle>
          </DialogHeader>
          {accountEdit && (
            <AccountForm
              key={accountEdit.accountId}
              account={accountEdit}
              data={data}
              busy={busy}
              save={save}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={timezoneOpen} onOpenChange={setTimezoneOpen}>
        <DialogContent className="border-zinc-800 bg-zinc-950 text-zinc-100">
          <DialogHeader>
            <DialogTitle>Business timezone</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save({
                action: "timezone",
                timezone: new FormData(e.currentTarget).get("timezone"),
              });
            }}
          >
            <label className="block text-sm">
              Reporting timezone
              <select
                name="timezone"
                defaultValue={data.nextTimezone}
                className={`${input} mt-2`}
              >
                {[
                  ...new Set([
                    "Asia/Kolkata",
                    "Asia/Qatar",
                    "Europe/London",
                    data.nextTimezone,
                  ]),
                ].map((tz) => (
                  <option key={tz} value={tz}>
                    {tz === "Asia/Kolkata"
                      ? "India"
                      : tz === "Asia/Qatar"
                        ? "Qatar"
                        : tz === "Europe/London"
                          ? "London"
                          : tz}{" "}
                    ({tz})
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-zinc-400">
              Applies after the current reporting day closes. The transition day
              may be shorter; previous days keep their original boundaries.
              London daylight saving is automatic.
            </p>
            <button
              disabled={busy}
              className={`${button} bg-blue-600`}
              type="submit"
            >
              Save timezone
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TeamForm({
  team,
  users,
  busy,
  save,
}: {
  team: Team | null;
  users: Data["users"];
  busy: boolean;
  save: (body: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        void save({
          action: "team",
          id: team?.id,
          name: form.get("name"),
          postsTarget: Number(form.get("posts")),
          warmupTarget: Number(form.get("warmup")),
          memberIds: form.getAll("members"),
        });
      }}
    >
      <label className="block text-sm">
        Team name
        <input
          required
          maxLength={80}
          name="name"
          defaultValue={team?.name}
          className={`${input} mt-1`}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          Posts / account / day
          <input
            required
            name="posts"
            type="number"
            min={0}
            max={1440}
            defaultValue={team?.postsTarget ?? 3}
            className={`${input} mt-1`}
          />
        </label>
        <label className="text-sm">
          Warm-up minutes / day
          <input
            required
            name="warmup"
            type="number"
            min={0}
            max={1440}
            defaultValue={team?.warmupTarget ?? 35}
            className={`${input} mt-1`}
          />
        </label>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm">Team members</legend>
        <div className="max-h-52 space-y-2 overflow-y-auto rounded border border-zinc-800 p-3">
          {users.map((u) => (
            <label key={u.id} className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                name="members"
                value={u.id}
                defaultChecked={team?.members.some((m) => m.id === u.id)}
                className="accent-blue-500"
              />
              <span>{u.name || u.email}</span>
            </label>
          ))}
          {!users.length && (
            <p className="text-xs text-zinc-500">No available users.</p>
          )}
        </div>
      </fieldset>
      <p className="text-xs text-zinc-400">
        These defaults apply to accounts without overrides. Set a target to 0 to
        turn it off. All members can view every team’s statistics.
      </p>
      <button type="submit" disabled={busy} className={`${button} bg-blue-600`}>
        {busy ? "Saving…" : "Save team"}
      </button>
    </form>
  );
}

function AccountForm({
  account,
  data,
  busy,
  save,
}: {
  account: Account;
  data: Data;
  busy: boolean;
  save: (body: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const override = (key: string) =>
          form.get(key) === "" ? null : Number(form.get(key));
        void save({
          action: "account",
          accountId: account.accountId,
          stateName: form.get("stateName"),
          teamId: form.get("teamId"),
          guardianProfileId: form.get("phone"),
          postsTarget: override("posts"),
          warmupTarget: override("warmup"),
        });
      }}
    >
      <label className="block text-sm">
        State name
        <input
          name="stateName"
          maxLength={100}
          defaultValue={account.stateName}
          className={`${input} mt-1`}
        />
      </label>
      <label className="block text-sm">
        Assigned team
        <select
          name="teamId"
          defaultValue={account.teamId || ""}
          className={`${input} mt-1`}
        >
          <option value="">Unassigned</option>
          {data.teams.map((t) => (
            <option value={t.id} key={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Guardian phone
        <select
          name="phone"
          defaultValue={account.guardianProfileId || ""}
          className={`${input} mt-1`}
        >
          <option value="">Select a state phone</option>
          {data.phones.map((p) => (
            <option
              key={p.id}
              value={p.id}
              disabled={data.accounts.some(
                (a) =>
                  a.accountId !== account.accountId &&
                  a.guardianProfileId === p.id,
              )}
            >
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          Daily posts override
          <input
            name="posts"
            type="number"
            min={0}
            max={1440}
            defaultValue={account.postsTarget ?? ""}
            placeholder="Team default"
            className={`${input} mt-1`}
          />
        </label>
        <label className="text-sm">
          Warm-up minutes override
          <input
            name="warmup"
            type="number"
            min={0}
            max={1440}
            defaultValue={account.warmupTarget ?? ""}
            placeholder="Team default"
            className={`${input} mt-1`}
          />
        </label>
      </div>
      <p className="text-xs text-zinc-400">
        Leave overrides blank to follow the team defaults. Phone links use
        stable Guardian IDs, so renaming a phone won’t break its history.
      </p>
      <button disabled={busy} className={`${button} bg-blue-600`} type="submit">
        {busy ? "Saving…" : "Save account"}
      </button>
    </form>
  );
}
