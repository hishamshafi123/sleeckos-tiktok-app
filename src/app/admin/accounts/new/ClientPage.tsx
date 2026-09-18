"use client";
import { useState, useEffect, useCallback } from "react";
import {
  Search,
  Loader2,
  AlertCircle,
  RefreshCw,
  UserPlus,
  ExternalLink,
  FolderOpen,
  AlertTriangle,
  PlugZap,
  HardDrive,
} from "lucide-react";

// ── API contract types ──────────────────────────────────────────────────────
type NewAccountRow = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  driveFolderId: string | null;
  driveFolderName: string | null;
  sectionId: string;
  sectionName: string;
  sectionSlug: string;
  color: string;
  colorMeaning: string | null;
  connectionState: string;
  hasPostPeer: boolean;
  addedAt: string;
  addedDate: string;
  ageDays: number;
  totalPosts: number;
  postsLast7d: number;
  firstPostAt: string | null;
  firstPostLatencyDays: number | null;
  labels: { id: string; name: string; color: string }[];
  warnings: ("no_drive" | "no_postpeer" | "never_posted")[];
  createdByName: string | null;
};

type NewAccountCohort = {
  weekStart: string;
  label: string;
  count: number;
  totalPosts: number;
  avgPostsPerAccount: number;
  avgFirstPostLatencyDays: number | null;
  neverPosted: number;
  accounts: NewAccountRow[];
};

type NewAccountsData = {
  timezone: string;
  generatedAt: string;
  totalAccounts: number;
  totalPosts: number;
  neverPostedCount: number;
  cohorts: NewAccountCohort[];
  dailyCreated: { date: string; count: number }[];
  lifecycle: {
    created7d: number;
    created30d: number;
    deleted7d: number;
    deleted30d: number;
    banned7d: number;
    banned30d: number;
  };
  projection: {
    avgPerDay7d: number;
    avgPerDay30d: number;
    createdLast7d: number;
    createdPrev7d: number;
    projectedNextWeek: number;
  };
};

type SectionOption = { id: string; name: string; slug: string };

// ── Display helpers ─────────────────────────────────────────────────────────
const COLOR_MAP: Record<string, string> = {
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#f59e0b",
  green: "#10b981",
  blue: "#3b82f6",
  purple: "#8b5cf6",
  pink: "#ec4899",
  zinc: "#71717a",
  gray: "#71717a",
};

const LABEL_BADGE: Record<string, string> = {
  red: "bg-red-500/10 border-red-500/30 text-red-400",
  orange: "bg-orange-500/10 border-orange-500/30 text-orange-400",
  amber: "bg-amber-500/10 border-amber-500/30 text-amber-400",
  green: "bg-green-500/10 border-green-500/30 text-green-400",
  teal: "bg-teal-500/10 border-teal-500/30 text-teal-400",
  blue: "bg-blue-500/10 border-blue-500/30 text-blue-400",
  purple: "bg-purple-500/10 border-purple-500/30 text-purple-400",
  zinc: "bg-zinc-500/10 border-zinc-500/30 text-zinc-400",
};

function colorHex(key: string): string {
  return COLOR_MAP[key] ?? (key.startsWith("#") ? key : COLOR_MAP.zinc);
}

function relativeAge(ageDays: number, addedDate: string): string {
  if (ageDays === 0) return "Today";
  if (ageDays === 1) return "Yesterday";
  if (ageDays < 7) return `${ageDays}d ago`;
  return addedDate;
}

function formatDateTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

// ── Component ───────────────────────────────────────────────────────────────
export default function ClientPage({ sections }: { sections: SectionOption[] }) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [addedFrom, setAddedFrom] = useState("");
  const [addedTo, setAddedTo] = useState("");
  const [neverPostedOnly, setNeverPostedOnly] = useState(false);

  const [data, setData] = useState<NewAccountsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (sectionId) params.set("sectionId", sectionId);
      if (addedFrom) params.set("addedFrom", addedFrom);
      if (addedTo) params.set("addedTo", addedTo);
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (neverPostedOnly) params.set("neverPosted", "1");
      const res = await fetch(`/api/managed/new-accounts?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load new accounts");
      setData(json);
    } catch (err: any) {
      setError(err.message || "Failed to load new accounts");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [sectionId, addedFrom, addedTo, debouncedSearch, neverPostedOnly]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <UserPlus className="w-6 h-6 text-gray-400" />
            New Accounts
          </h1>
          <p className="text-gray-500 mt-1">
            Accounts by when they were added, newest first — with post counts and onboarding health
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-white/10 text-gray-300 hover:bg-white/5 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Summary */}
      {data && (
        <div className="flex flex-wrap gap-3 text-sm">
          <span className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-gray-300">
            <span className="font-semibold text-white">{data.totalAccounts}</span> accounts
          </span>
          <span className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-gray-300">
            <span className="font-semibold text-white">{data.totalPosts.toLocaleString()}</span> posts total
          </span>
          <span
            className={`px-3 py-1.5 rounded-lg border ${
              data.neverPostedCount > 0
                ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                : "border-white/10 bg-white/5 text-gray-300"
            }`}
          >
            <span className="font-semibold">{data.neverPostedCount}</span> never posted
          </span>
          <span className="px-3 py-1.5 rounded-lg border border-white/5 text-gray-500">
            Times in {data.timezone}
          </span>
        </div>
      )}

      {/* Creation rate chart + lifecycle stats */}
      {data && data.dailyCreated.length > 0 && (
        <section className="border border-white/5 rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">Accounts added per day — last 30 days</h2>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="px-2.5 py-1 rounded-md border border-white/10 bg-white/5 text-gray-300">
                7d: <span className="text-white font-medium">+{data.lifecycle.created7d}</span> created
              </span>
              <span
                className={`px-2.5 py-1 rounded-md border ${
                  data.lifecycle.deleted7d > 0
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                    : "border-white/10 bg-white/5 text-gray-400"
                }`}
              >
                −{data.lifecycle.deleted7d} deleted
              </span>
              <span
                className={`px-2.5 py-1 rounded-md border ${
                  data.lifecycle.banned7d > 0
                    ? "border-red-500/30 bg-red-500/10 text-red-400"
                    : "border-white/10 bg-white/5 text-gray-400"
                }`}
              >
                {data.lifecycle.banned7d} banned
              </span>
              <span className="px-2.5 py-1 rounded-md border border-white/10 bg-white/5 text-gray-400">
                30d: +{data.lifecycle.created30d} / −{data.lifecycle.deleted30d} / {data.lifecycle.banned30d} banned
              </span>
              <span className="px-2.5 py-1 rounded-md border border-sky-500/30 bg-sky-500/10 text-sky-300">
                Pace {data.projection.avgPerDay7d}/day → ~{data.projection.projectedNextWeek} next week
                <span className="text-sky-400/60"> (prior 7d: {data.projection.createdPrev7d})</span>
              </span>
            </div>
          </div>
          <div className="flex items-end gap-[3px] h-28">
            {data.dailyCreated.map((p, i) => {
              const max = Math.max(...data.dailyCreated.map((q) => q.count), 1);
              const isToday = i === data.dailyCreated.length - 1;
              return (
                <div
                  key={p.date}
                  title={`${p.date}: ${p.count} account${p.count !== 1 ? "s" : ""} added`}
                  className={`flex-1 rounded-sm transition-colors ${
                    isToday ? "bg-sky-400" : p.count > 0 ? "bg-white/25 hover:bg-white/40" : "bg-white/5"
                  }`}
                  style={{ height: `${Math.max((p.count / max) * 100, p.count > 0 ? 4 : 2)}%` }}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-[10px] text-gray-600">
            <span>{data.dailyCreated[0].date}</span>
            <span>{data.dailyCreated[data.dailyCreated.length - 1].date} (today)</span>
          </div>
        </section>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or Drive folder…"
            className="pl-9 pr-3 py-2 w-64 text-sm rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-gray-600 focus:outline-none focus:border-white/25"
          />
        </div>
        <select
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
          className="px-3 py-2 text-sm rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:border-white/25"
        >
          <option value="">All sections</option>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <span>Added</span>
          <input
            type="date"
            value={addedFrom}
            onChange={(e) => setAddedFrom(e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-white/25 [color-scheme:dark]"
          />
          <span>→</span>
          <input
            type="date"
            value={addedTo}
            onChange={(e) => setAddedTo(e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-white/25 [color-scheme:dark]"
          />
          {(addedFrom || addedTo) && (
            <button
              onClick={() => {
                setAddedFrom("");
                setAddedTo("");
              }}
              className="text-gray-500 hover:text-gray-300 text-xs underline"
            >
              Clear
            </button>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={neverPostedOnly}
            onChange={(e) => setNeverPostedOnly(e.target.checked)}
            className="accent-amber-500"
          />
          Never posted only
        </label>
      </div>

      {/* States */}
      {error && (
        <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl px-5 py-4">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {loading && !data && (
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <div key={i} className="border border-white/5 rounded-2xl p-5 animate-pulse">
              <div className="h-4 w-40 bg-white/10 rounded mb-4" />
              <div className="space-y-2">
                {[0, 1, 2, 3].map((j) => (
                  <div key={j} className="h-8 bg-white/5 rounded" />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && !error && data && data.cohorts.length === 0 && (
        <div className="border border-white/5 rounded-2xl p-12 text-center">
          <UserPlus className="w-8 h-8 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 font-medium">No accounts match these filters</p>
          <p className="text-gray-600 text-sm mt-1">Try widening the date range or clearing the search.</p>
        </div>
      )}

      {/* Cohorts */}
      {data &&
        data.cohorts.map((cohort) => (
          <section key={cohort.weekStart} className="border border-white/5 rounded-2xl overflow-hidden">
            <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 bg-white/[0.03] border-b border-white/5">
              <h2 className="text-sm font-semibold text-white">{cohort.label}</h2>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                <span>
                  <span className="text-gray-300 font-medium">{cohort.count}</span> added
                </span>
                <span>
                  <span className="text-gray-300 font-medium">{cohort.totalPosts.toLocaleString()}</span> posts
                </span>
                <span>
                  avg <span className="text-gray-300 font-medium">{cohort.avgPostsPerAccount}</span> posts/account
                </span>
                <span>
                  first post after{" "}
                  <span className="text-gray-300 font-medium">
                    {cohort.avgFirstPostLatencyDays !== null ? `${cohort.avgFirstPostLatencyDays}d` : "—"}
                  </span>
                </span>
                {cohort.neverPosted > 0 && (
                  <span className="text-amber-400/90 font-medium">{cohort.neverPosted} never posted</span>
                )}
              </div>
            </header>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-white/5">
                    <th className="px-5 py-2.5 font-medium">Account</th>
                    <th className="px-3 py-2.5 font-medium">Drive folder</th>
                    <th className="px-3 py-2.5 font-medium">Section</th>
                    <th className="px-3 py-2.5 font-medium">Added</th>
                    <th className="px-3 py-2.5 font-medium">First post</th>
                    <th className="px-3 py-2.5 font-medium text-right">Posts</th>
                    <th className="px-3 py-2.5 font-medium text-right">Last 7d</th>
                    <th className="px-3 py-2.5 font-medium text-right">Posts/day</th>
                    <th className="px-3 py-2.5 font-medium">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {cohort.accounts.map((a) => (
                    <tr
                      key={a.id}
                      className={`border-b border-white/[0.03] hover:bg-white/[0.02] ${
                        a.warnings.includes("never_posted") ? "bg-amber-500/[0.04]" : ""
                      }`}
                    >
                      {/* Account */}
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: colorHex(a.color) }}
                            title={a.colorMeaning || a.color}
                          />
                          {a.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={a.avatarUrl} alt="" className="w-6 h-6 rounded-full flex-shrink-0 object-cover" />
                          ) : (
                            <span className="w-6 h-6 rounded-full flex-shrink-0 bg-white/10" />
                          )}
                          <div className="min-w-0">
                            <a
                              href={`https://www.tiktok.com/@${a.username}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-white hover:underline font-medium flex items-center gap-1 truncate"
                            >
                              @{a.username}
                              <ExternalLink className="w-3 h-3 text-gray-600 flex-shrink-0" />
                            </a>
                            {a.displayName && a.displayName !== a.username && (
                              <div className="text-xs text-gray-600 truncate">{a.displayName}</div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Drive folder */}
                      <td className="px-3 py-2.5">
                        {a.driveFolderId ? (
                          <a
                            href={`https://drive.google.com/drive/folders/${a.driveFolderId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-300 hover:text-white hover:underline flex items-center gap-1.5"
                          >
                            <FolderOpen className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />
                            <span className="truncate max-w-[160px]">{a.driveFolderName || "Folder"}</span>
                          </a>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>

                      {/* Section */}
                      <td className="px-3 py-2.5 text-gray-400 whitespace-nowrap">{a.sectionName}</td>

                      {/* Added */}
                      <td
                        className="px-3 py-2.5 text-gray-300 whitespace-nowrap"
                        title={formatDateTime(a.addedAt, data.timezone)}
                      >
                        {relativeAge(a.ageDays, a.addedDate)}
                        {a.createdByName && (
                          <div className="text-xs text-gray-600">by {a.createdByName}</div>
                        )}
                      </td>

                      {/* First post latency */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {a.firstPostLatencyDays !== null ? (
                          <span className="text-gray-300" title={a.firstPostAt ? formatDateTime(a.firstPostAt, data.timezone) : undefined}>
                            {a.firstPostLatencyDays === 0 ? "Same day" : `${a.firstPostLatencyDays}d`}
                          </span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>

                      {/* Posts */}
                      <td className="px-3 py-2.5 text-right font-semibold text-white tabular-nums">
                        {a.totalPosts > 0 ? a.totalPosts.toLocaleString() : <span className="text-gray-700 font-normal">0</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right text-gray-300 tabular-nums">
                        {a.postsLast7d > 0 ? a.postsLast7d : <span className="text-gray-700">0</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right text-gray-400 tabular-nums">
                        {a.totalPosts > 0 ? (a.totalPosts / Math.max(a.ageDays, 1)).toFixed(1) : "—"}
                      </td>

                      {/* Flags: labels + warnings */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {a.labels.map((l) => (
                            <span
                              key={l.id}
                              className={`px-1.5 py-0.5 rounded border text-[11px] leading-tight ${
                                LABEL_BADGE[l.color] ?? LABEL_BADGE.zinc
                              }`}
                            >
                              {l.name}
                            </span>
                          ))}
                          {a.warnings.includes("never_posted") && (
                            <span
                              className="text-amber-400"
                              title={`Added ${a.ageDays}d ago, never posted — check setup`}
                            >
                              <AlertTriangle className="w-4 h-4" />
                            </span>
                          )}
                          {a.warnings.includes("no_drive") && (
                            <span className="text-red-400" title="No Drive folder linked">
                              <HardDrive className="w-4 h-4" />
                            </span>
                          )}
                          {a.warnings.includes("no_postpeer") && (
                            <span className="text-red-400" title="No PostPeer connection">
                              <PlugZap className="w-4 h-4" />
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}

      {loading && data && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          Updating…
        </div>
      )}
    </div>
  );
}
