"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Loader2,
  AlertCircle,
  RefreshCw,
  Search,
  X,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronRight,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// ── API contract types ──────────────────────────────────────────────────────
type Period = "today" | "yesterday" | "7d" | "30d";

type Overview = {
  totalAccounts: number;
  activeAccounts: number;
  postsYesterday: number;
  viewsYesterday: number;
  silentAccounts: number;
  unusedAccounts: number;
  flaggedAccounts: number;
};

type PerfRow = {
  accountId: string;
  accountName: string;
  driveFolderName: string | null;
  driveFolderId: string | null;
  color: string;
  connectionState: string;
  posts: number;
  viewsGained: number;
  likesGained: number;
  avgViewsPerPost: number;
  zeroViewStreak: number;
  flagged: boolean;
  lastPostAt: string | null;
  sparkline: number[];
  estViewsPerDay: number | null;
};

type Coverage = {
  days: string[];
  accounts: {
    accountId: string;
    accountName: string;
    driveFolderName: string | null;
    cells: Record<string, number>;
  }[];
  silent: QuietAccount[];
  unused: QuietAccount[];
};

type QuietAccount = {
  accountId: string;
  accountName: string;
  driveFolderName: string | null;
  driveFolderId: string | null;
  sectionName: string | null;
  daysQuiet: number | null; // null = never posted
  lastPostAt: string | null;
};

type Trajectory = {
  days: { day: string; views: number }[];
  last7Avg: number;
  prev7Avg: number;
  growthRate: number;
  baselinePerDay: number;
  activeAccounts: number;
  currentRatePerDay: number;
  source: "observed" | "estimated";
  projections: {
    next7: { conservative: number; current: number; optimistic: number };
    next30: { conservative: number; current: number; optimistic: number };
  };
};

type AccountDetail = {
  account: {
    accountId: string;
    accountName: string;
    displayName: string;
    avatarUrl: string;
    driveFolderName: string | null;
    sectionName: string | null;
    color: string;
    connectionState: string;
  };
  days: { day: string; posts: number; views: number; likes: number }[];
  totals: { posts: number; views: number; likes: number };
  zeroViewStreak: number;
  lastPostAt: string | null;
  recentVideos: {
    id: string;
    url: string;
    views: number;
    likes: number;
    publishedAt: string;
    status: string;
  }[];
};

// ── Formatting helpers (all display times IST) ──────────────────────────────
const IST = "Asia/Kolkata";
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmt = (n: number) => compact.format(n);
const full = (n: number) => n.toLocaleString("en-IN");

const istDateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: IST,
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const istDateTime = (iso: string | null) => (iso ? istDateTimeFmt.format(new Date(iso)) : "—");

// day is a YYYY-MM-DD IST day string from the server
const dayLabel = (day: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }).format(
    new Date(`${day}T00:00:00Z`)
  );
const weekdayLabel = (day: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(
    new Date(`${day}T00:00:00Z`)
  );

// ── Fetch helper with per-section state ─────────────────────────────────────
type Resource<T> = { data: T | null; loading: boolean; error: string | null };

function useResource<T>(url: string, deps: unknown[] = []): Resource<T> & { reload: () => void } {
  const [state, setState] = useState<Resource<T>>({ data: null, loading: true, error: null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => !cancelled && setState({ data, loading: false, error: null }))
      .catch((err) => !cancelled && setState({ data: null, loading: false, error: err.message }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { ...state, reload: () => setNonce((n) => n + 1) };
}

// ── Small presentational pieces ─────────────────────────────────────────────
function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between border border-red-500/20 bg-red-500/5 rounded-lg px-4 py-3">
      <div className="flex items-center gap-2 text-red-400 text-xs">
        <AlertCircle className="w-3.5 h-3.5" />
        <span>{message}</span>
      </div>
      <button
        onClick={onRetry}
        className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 border border-[#27272a] rounded-md px-2.5 py-1.5"
      >
        <RefreshCw className="w-3 h-3" /> Retry
      </button>
    </div>
  );
}

function SkeletonRows({ rows = 6, height = "h-8" }: { rows?: number; height?: string }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`${height} rounded-md bg-zinc-900 animate-pulse`} />
      ))}
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const w = 72;
  const h = 22;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * (h - 2) - 1}`);
  const allZero = values.every((v) => v === 0);
  return (
    <svg width={w} height={h} className="block">
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={allZero ? "#3f3f46" : "#60a5fa"}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BarSeries({
  data,
  height = 96,
  color = "#60a5fa",
}: {
  data: { day: string; value: number }[];
  height?: number;
  color?: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-[3px]" style={{ height }}>
      {data.map((d) => (
        <div
          key={d.day}
          title={`${dayLabel(d.day)} — ${full(d.value)}`}
          className="flex-1 rounded-sm min-w-[3px]"
          style={{
            height: `${Math.max((d.value / max) * 100, d.value > 0 ? 4 : 1)}%`,
            backgroundColor: d.value > 0 ? color : "#27272a",
          }}
        />
      ))}
    </div>
  );
}

const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
];

// ── Main page ───────────────────────────────────────────────────────────────
export default function ClientPage() {
  const [period, setPeriod] = useState<Period>("7d");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const overview = useResource<Overview>("/api/admin/account-performance/overview");
  const accounts = useResource<{ rows: PerfRow[] }>(
    `/api/admin/account-performance/accounts?period=${period}&flaggedOnly=${flaggedOnly ? 1 : 0}&query=${encodeURIComponent(debouncedQuery)}`,
    [period, flaggedOnly, debouncedQuery]
  );
  const coverage = useResource<Coverage>("/api/admin/account-performance/coverage");
  const trajectory = useResource<Trajectory>("/api/admin/account-performance/trajectory");

  const openDetail = useCallback((id: string) => setDetailId(id), []);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Account Performance</h1>
          <p className="text-xs text-zinc-500 mt-1">
            Posting output and view gains across all managed accounts · all times IST
          </p>
        </div>
      </div>

      {/* ── KPI strip ──────────────────────────────────────────────────── */}
      <section>
        {overview.error ? (
          <SectionError message={overview.error} onRetry={overview.reload} />
        ) : overview.loading || !overview.data ? (
          <div className="grid grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-20 rounded-lg bg-zinc-900 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-6 gap-3">
            <KpiCard
              label="Active (24h)"
              value={`${overview.data.activeAccounts} / ${overview.data.totalAccounts}`}
              tone="text-green-400"
            />
            <KpiCard label="Posts yesterday" value={full(overview.data.postsYesterday)} />
            <KpiCard
              label="Views yesterday"
              value={fmt(overview.data.viewsYesterday)}
              title={full(overview.data.viewsYesterday)}
            />
            <KpiCard
              label="Silent (2–7d)"
              value={full(overview.data.silentAccounts)}
              tone="text-amber-400"
              hint="No posts in 2–7 days"
            />
            <KpiCard
              label="Unused (7d+)"
              value={full(overview.data.unusedAccounts)}
              tone="text-red-400"
              hint="No posts in 7+ days, or never posted"
            />
            <KpiCard label="Flagged" value={full(overview.data.flaggedAccounts)} tone="text-red-400" />
          </div>
        )}
      </section>

      {/* ── Trajectory ─────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-200">Views trajectory — last 28 days</h2>
        {trajectory.error ? (
          <SectionError message={trajectory.error} onRetry={trajectory.reload} />
        ) : trajectory.loading || !trajectory.data ? (
          <SkeletonRows rows={3} height="h-10" />
        ) : (
          <TrajectoryPanel data={trajectory.data} />
        )}
      </section>

      {/* ── Coverage grid + quiet lists ────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-200">Posting coverage — last 7 days</h2>
        {coverage.error ? (
          <SectionError message={coverage.error} onRetry={coverage.reload} />
        ) : coverage.loading || !coverage.data ? (
          <SkeletonRows rows={8} />
        ) : (
          <CoverageSection
            data={coverage.data}
            onOpen={openDetail}
            onChanged={() => {
              coverage.reload();
              overview.reload();
            }}
          />
        )}
      </section>

      {/* ── Ranked accounts table ──────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-zinc-200">Accounts</h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-600 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search account or drive folder"
                className="bg-[#09090b] border border-[#27272a] rounded-md pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 w-60"
              />
            </div>
            <button
              onClick={() => setFlaggedOnly((f) => !f)}
              className={`text-xs rounded-md border px-2.5 py-1.5 transition-colors ${
                flaggedOnly
                  ? "border-red-500/30 bg-red-500/10 text-red-400"
                  : "border-[#27272a] text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Flagged only
            </button>
            <div className="flex border border-[#27272a] rounded-md overflow-hidden">
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPeriod(p.key)}
                  className={`text-xs px-3 py-1.5 transition-colors ${
                    period === p.key
                      ? "bg-zinc-800 text-white"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {accounts.error ? (
          <SectionError message={accounts.error} onRetry={accounts.reload} />
        ) : accounts.loading || !accounts.data ? (
          <SkeletonRows rows={10} />
        ) : accounts.data.rows.length === 0 ? (
          <div className="border border-[#27272a] rounded-lg px-4 py-10 text-center text-xs text-zinc-600">
            {flaggedOnly || debouncedQuery
              ? "No accounts match the current filters."
              : "No performance data yet. Run the AccountDailyStat backfill, then the daily sweep keeps it current."}
          </div>
        ) : (
          <AccountsTable
            // Remounting on any filter change resets pagination to page 1.
            key={`${period}|${flaggedOnly}|${debouncedQuery}`}
            rows={accounts.data.rows}
            onOpen={openDetail}
          />
        )}
      </section>

      {detailId && <DrillDown accountId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

// ── Trajectory panel ────────────────────────────────────────────────────────
function TrajectoryPanel({ data }: { data: Trajectory }) {
  return (
    <div className="border border-[#27272a] rounded-lg p-5 space-y-5">
      <div className="flex items-center gap-6 text-xs text-zinc-500 flex-wrap">
        <span>
          Last 7d avg: <span className="text-zinc-200 font-medium">{fmt(data.last7Avg)}</span> views/day
        </span>
        <span>
          Prior 7d avg: <span className="text-zinc-200 font-medium">{fmt(data.prev7Avg)}</span> views/day
        </span>
        <GrowthBadge rate={data.growthRate} />
      </div>
      <BarSeries data={data.days.map((d) => ({ day: d.day, value: d.views }))} />
      <div className="flex justify-between text-[10px] text-zinc-600">
        <span>{dayLabel(data.days[0]?.day ?? "")}</span>
        <span>{dayLabel(data.days[data.days.length - 1]?.day ?? "")}</span>
      </div>
      <div className="border-t border-[#1c1c21] pt-4 space-y-3">
        <div className="text-xs text-zinc-500">
          Projection rate:{" "}
          <span className="text-zinc-200 font-medium">~{fmt(data.currentRatePerDay)} views/day</span>
          {" — "}
          {data.source === "observed"
            ? `driven by observed daily view gains (7-day average), cross-checked against the age-normalized estimate from the last 3 videos of ${data.activeAccounts} active accounts (${fmt(data.baselinePerDay)}/day).`
            : `age-normalized views/day from the last 3 videos of ${data.activeAccounts} active accounts (posted in the last 7 days).`}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ProjectionCard
            label="Next 7 days"
            current={data.projections.next7.current}
            low={data.projections.next7.conservative}
            high={data.projections.next7.optimistic}
          />
          <ProjectionCard
            label="Next 30 days"
            current={data.projections.next30.current}
            low={data.projections.next30.conservative}
            high={data.projections.next30.optimistic}
          />
        </div>
      </div>
    </div>
  );
}

// ── Ranked accounts table (sortable, paginated, sticky header, internal scroll)
const PAGE_SIZE = 50;

type SortKey = "account" | "posts" | "views" | "avg" | "est" | "likes";
type SortDir = "asc" | "desc";

function AccountsTable({ rows, onOpen }: { rows: PerfRow[]; onOpen: (id: string) => void }) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "views", dir: "desc" });

  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "desc" ? "asc" : "desc" }
        : { key, dir: key === "account" ? "asc" : "desc" }
    );

  // Sort the full filtered set BEFORE pagination slices it. Est. views/day
  // nulls ("—", account not in use) always sort last regardless of direction.
  const sorted = useMemo(() => {
    const value = (r: PerfRow): number | string | null => {
      switch (sort.key) {
        case "account":
          return r.accountName.toLowerCase();
        case "posts":
          return r.posts;
        case "views":
          return r.viewsGained;
        case "avg":
          return r.avgViewsPerPost;
        case "est":
          return r.estViewsPerDay;
        case "likes":
          return r.likesGained;
      }
    };
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (sort.key === "est") {
        if (va === null && vb === null) return 0;
        if (va === null) return 1; // nulls last either way
        if (vb === null) return -1;
      }
      if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * dir;
      return ((va as number) - (vb as number)) * dir;
    });
  }, [rows, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const SortableTh = ({ label, k, right = true }: { label: string; k: SortKey; right?: boolean }) => (
    <th
      className={`${right ? "text-right px-3" : "text-left px-4"} py-2.5 text-zinc-500 font-medium`}
    >
      <button
        onClick={() => toggleSort(k)}
        className={`inline-flex items-center gap-1 ${right ? "flex-row-reverse" : ""} hover:text-zinc-200 transition-colors ${
          sort.key === k ? "text-zinc-300" : ""
        }`}
      >
        {label}
        {sort.key === k &&
          (sort.dir === "desc" ? (
            <ArrowDown className="w-3 h-3" />
          ) : (
            <ArrowUp className="w-3 h-3" />
          ))}
      </button>
    </th>
  );

  return (
    <div className="border border-[#27272a] rounded-lg overflow-hidden">
      <div className="max-h-[65vh] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-[#0c0c10] z-10">
            <tr className="border-b border-[#27272a]">
              <SortableTh label="Account" k="account" right={false} />
              <SortableTh label="Posts" k="posts" />
              <SortableTh label="Views" k="views" />
              <SortableTh label="Avg/post" k="avg" />
              <SortableTh label="Est. views/day" k="est" />
              <SortableTh label="Likes" k="likes" />
              <th className="text-left px-3 py-2.5 text-zinc-500 font-medium">Last post</th>
              <th className="text-left px-3 py-2.5 text-zinc-500 font-medium">7d trend</th>
              <th className="text-left px-3 py-2.5 text-zinc-500 font-medium">Flag</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr
                key={r.accountId}
                onClick={() => onOpen(r.accountId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(r.accountId);
                  }
                }}
                tabIndex={0}
                className="border-b border-[#1c1c21] last:border-0 hover:bg-zinc-900/40 cursor-pointer focus:outline-none focus:bg-zinc-900/60"
              >
                <td className="px-4 py-2.5">
                  <div>
                    <a
                      href={`https://www.tiktok.com/@${r.accountName}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-zinc-100 font-medium hover:text-blue-400 hover:underline"
                    >
                      @{r.accountName}
                    </a>
                    <div className="text-[11px] truncate max-w-[220px]">
                      {r.driveFolderId ? (
                        <a
                          href={`https://drive.google.com/drive/folders/${r.driveFolderId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-zinc-600 hover:text-blue-400 hover:underline"
                        >
                          {r.driveFolderName ?? "Drive folder"}
                        </a>
                      ) : (
                        <span className="text-zinc-600">{r.driveFolderName ?? "—"}</span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right text-zinc-300 tabular-nums">{r.posts}</td>
                <td className="px-3 py-2.5 text-right text-zinc-100 tabular-nums font-medium">
                  <span title={full(r.viewsGained)}>{fmt(r.viewsGained)}</span>
                </td>
                <td className="px-3 py-2.5 text-right text-zinc-400 tabular-nums">
                  <span title={full(r.avgViewsPerPost)}>{fmt(r.avgViewsPerPost)}</span>
                </td>
                <td className="px-3 py-2.5 text-right text-zinc-400 tabular-nums">
                  {r.estViewsPerDay === null ? (
                    <span className="text-zinc-700">—</span>
                  ) : (
                    <span title={full(r.estViewsPerDay)}>{fmt(r.estViewsPerDay)}</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right text-zinc-400 tabular-nums">
                  <span title={full(r.likesGained)}>{fmt(r.likesGained)}</span>
                </td>
                <td className="px-3 py-2.5 text-zinc-500 whitespace-nowrap">
                  {istDateTime(r.lastPostAt)}
                </td>
                <td className="px-3 py-2.5">
                  <Sparkline values={r.sparkline} />
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {r.flagged ? (
                    <span className="inline-flex items-center gap-1.5 text-red-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                      0-view streak ×{r.zeroViewStreak}
                    </span>
                  ) : r.zeroViewStreak > 0 ? (
                    <span className="inline-flex items-center gap-1.5 text-amber-400/80">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500/70" />
                      streak ×{r.zeroViewStreak}
                    </span>
                  ) : (
                    <span className="text-zinc-700">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between px-4 py-2 border-t border-[#27272a] bg-[#0c0c10]">
        <span className="text-[11px] text-zinc-500 tabular-nums">
          {full(rows.length)} accounts · page {safePage} of {pageCount}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className="text-xs text-zinc-400 hover:text-zinc-200 border border-[#27272a] rounded-md px-2.5 py-1 disabled:opacity-40 disabled:hover:text-zinc-400"
          >
            Prev
          </button>
          <button
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={safePage >= pageCount}
            className="text-xs text-zinc-400 hover:text-zinc-200 border border-[#27272a] rounded-md px-2.5 py-1 disabled:opacity-40 disabled:hover:text-zinc-400"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Coverage section ────────────────────────────────────────────────────────
function CoverageSection({
  data,
  onOpen,
  onChanged,
}: {
  data: Coverage;
  onOpen: (id: string) => void;
  onChanged: () => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-4 items-start">
      <div className="col-span-2 border border-[#27272a] rounded-lg overflow-hidden">
        <div className="max-h-[420px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[#0c0c10] z-10">
              <tr className="border-b border-[#27272a]">
                <th className="text-left px-4 py-2.5 text-zinc-500 font-medium">Account</th>
                {data.days.map((d) => (
                  <th key={d} className="px-2 py-2.5 text-zinc-500 font-medium text-center w-12">
                    <div>{weekdayLabel(d)}</div>
                    <div className="text-[10px] text-zinc-600">{dayLabel(d)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((a) => (
                <tr key={a.accountId} className="border-b border-[#1c1c21] last:border-0 hover:bg-zinc-900/40">
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center gap-1">
                      <a
                        href={`https://www.tiktok.com/@${a.accountName}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-zinc-200 hover:text-blue-400 hover:underline"
                      >
                        @{a.accountName}
                      </a>
                      <button
                        onClick={() => onOpen(a.accountId)}
                        aria-label={`Open details for @${a.accountName}`}
                        title="Open account details"
                        className="text-zinc-600 hover:text-zinc-300 p-0.5"
                      >
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    </span>
                  </td>
                  {data.days.map((d) => {
                    const n = a.cells[d] ?? 0;
                    return (
                      <td key={d} className="px-2 py-2 text-center tabular-nums">
                        {n > 0 ? (
                          <span
                            className={`inline-block min-w-[24px] rounded px-1 py-0.5 ${
                              n >= 3
                                ? "bg-green-500/15 text-green-400"
                                : "bg-blue-500/10 text-blue-300"
                            }`}
                          >
                            {n}
                          </span>
                        ) : (
                          <span className="text-zinc-800">·</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.accounts.length === 0 && (
          <div className="px-4 py-10 text-center text-xs text-zinc-600">No accounts found.</div>
        )}
      </div>

      <div className="space-y-4">
        <QuietPanel
          title="Silent accounts"
          subtitle="No posts in 2–7 days"
          kind="silent"
          rows={data.silent}
          onOpen={onOpen}
          onChanged={onChanged}
        />
        <QuietPanel
          title="Unused accounts"
          subtitle="No posts in 7+ days, or never posted"
          kind="unused"
          rows={data.unused}
          onOpen={onOpen}
          onChanged={onChanged}
        />
      </div>
    </div>
  );
}

// ── KPI / panels ────────────────────────────────────────────────────────────
function KpiCard({
  label,
  value,
  tone,
  title,
  hint,
}: {
  label: string;
  value: string;
  tone?: string;
  title?: string;
  hint?: string;
}) {
  return (
    <div className="border border-[#27272a] rounded-lg px-4 py-3 bg-[#0c0c10]" title={hint}>
      <div className={`text-lg font-semibold tabular-nums ${tone ?? "text-white"}`} title={title}>
        {value}
      </div>
      <div className="text-[11px] text-zinc-500 mt-0.5">{label}</div>
    </div>
  );
}

function QuietPanel({
  title,
  subtitle,
  kind,
  rows,
  onOpen,
  onChanged,
}: {
  title: string;
  subtitle: string;
  kind: "silent" | "unused";
  rows: QuietAccount[];
  onOpen: (id: string) => void;
  onChanged: () => void;
}) {
  const [viewAll, setViewAll] = useState(false);
  // Intensity by days quiet: silent 2–3 = amber, 4–6 = orange, 7 = red;
  // unused rows are always red.
  const toneFor = (daysQuiet: number | null): { dot: string; text: string } => {
    if (kind === "unused" || (daysQuiet !== null && daysQuiet >= 7)) {
      return { dot: "bg-red-500", text: "text-red-400" };
    }
    if (daysQuiet !== null && daysQuiet >= 4) {
      return { dot: "bg-orange-500", text: "text-orange-400" };
    }
    return { dot: "bg-amber-500", text: "text-amber-400" };
  };

  return (
    <div className="border border-[#27272a] rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-[#27272a] bg-[#0c0c10] flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-zinc-200">
            {title} <span className="text-zinc-500 font-normal">({rows.length})</span>
          </div>
          <div className="text-[10px] text-zinc-600 mt-0.5">{subtitle}</div>
        </div>
        {rows.length > 0 && (
          <button
            onClick={() => setViewAll(true)}
            className="text-[11px] text-zinc-400 hover:text-zinc-200 border border-[#27272a] rounded-md px-2 py-1 flex-shrink-0"
          >
            View all
          </button>
        )}
      </div>
      <div className="max-h-[220px] overflow-y-auto">
        {rows.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-zinc-600">None right now.</div>
        ) : (
          rows.map((r) => {
            const tone = toneFor(r.daysQuiet);
            return (
              <div
                key={r.accountId}
                onClick={() => onOpen(r.accountId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(r.accountId);
                  }
                }}
                tabIndex={0}
                role="button"
                className="w-full flex items-center justify-between gap-3 px-4 py-2 text-xs border-b border-[#1c1c21] last:border-0 hover:bg-zinc-900/40 cursor-pointer focus:outline-none focus:bg-zinc-900/60"
              >
                <span className="flex items-start gap-2 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${tone.dot}`} />
                  <span className="min-w-0">
                    <a
                      href={`https://www.tiktok.com/@${r.accountName}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-zinc-200 hover:text-blue-400 hover:underline"
                    >
                      @{r.accountName}
                    </a>
                    <span className="block text-[11px] truncate max-w-[180px]">
                      {r.driveFolderId ? (
                        <a
                          href={`https://drive.google.com/drive/folders/${r.driveFolderId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-zinc-600 hover:text-blue-400 hover:underline"
                        >
                          {r.driveFolderName ?? "Drive folder"}
                        </a>
                      ) : (
                        <span className="text-zinc-600">{r.driveFolderName ?? "—"}</span>
                      )}
                    </span>
                  </span>
                </span>
                <span className={`flex-shrink-0 tabular-nums ${tone.text}`}>
                  {r.daysQuiet === null ? "never posted" : `${r.daysQuiet} days quiet`}
                </span>
              </div>
            );
          })
        )}
      </div>
      <QuietListModal
        open={viewAll}
        onClose={() => setViewAll(false)}
        kind={kind}
        title={title}
        rows={rows}
        onChanged={onChanged}
      />
    </div>
  );
}

// ── "View all" modal for quiet-account buckets ──────────────────────────────
// Full bucket list grouped by AccountSection, searchable, keyboard-dismissable
// (base-ui Dialog handles Esc). The unused bucket additionally offers Delete.
function QuietListModal({
  open,
  onClose,
  kind,
  title,
  rows,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  kind: "silent" | "unused";
  title: string;
  rows: QuietAccount[];
  onChanged: () => void;
}) {
  const [query, setQuery] = useState("");
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Selected section chip; null = All sections.
  const [section, setSection] = useState<string | null>(null);
  // "Show more" is keyed by section+query so changing either re-caps the list.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const visible = rows.filter(
    (r) =>
      !removedIds.has(r.accountId) &&
      (!q ||
        r.accountName.toLowerCase().includes(q) ||
        (r.driveFolderName ?? "").toLowerCase().includes(q))
  );

  const sectionCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of visible) {
      const key = r.sectionName ?? "Other";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    );
  }, [visible]);

  const filtered = useMemo(() => {
    const list = section
      ? visible.filter((r) => (r.sectionName ?? "Other") === section)
      : visible;
    return [...list].sort(
      (a, b) => (b.daysQuiet ?? 9999) - (a.daysQuiet ?? 9999)
    );
  }, [visible, section]);

  const RENDER_CAP = 150;
  const listKey = `${section ?? "all"}|${q}`;
  const shown =
    expandedKey === listKey ? filtered : filtered.slice(0, RENDER_CAP);

  const toneFor = (daysQuiet: number | null): { dot: string; text: string } => {
    if (kind === "unused" || (daysQuiet !== null && daysQuiet >= 7)) {
      return { dot: "bg-red-500", text: "text-red-400" };
    }
    if (daysQuiet !== null && daysQuiet >= 4) {
      return { dot: "bg-orange-500", text: "text-orange-400" };
    }
    return { dot: "bg-amber-500", text: "text-amber-400" };
  };

  const handleDelete = async (r: QuietAccount) => {
    setDeletingId(r.accountId);
    try {
      // Reuses the existing managed-accounts delete endpoint (permission
      // "accounts"); the delete cascades per the Prisma schema relations.
      const res = await fetch(`/api/managed/accounts/${r.accountId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
      toast.success(`@${r.accountName} deleted`);
      setRemovedIds((s) => new Set(s).add(r.accountId));
      setConfirmId(null);
      onChanged(); // refresh overview counts + coverage lists
    } catch (err: any) {
      toast.error(`Failed to delete @${r.accountName}: ${err?.message || "unknown error"}`);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-zinc-950 border border-zinc-800 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-white text-sm">
            {title} <span className="text-zinc-500 font-normal">({visible.length})</span>
          </DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-zinc-600 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search account or drive folder"
            className="w-full bg-[#09090b] border border-[#27272a] rounded-md pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
          />
        </div>
        {/* Section selector — click a section to see only its accounts */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setSection(null)}
            className={`text-[11px] rounded-md px-2.5 py-1 border ${
              section === null
                ? "bg-zinc-200 text-zinc-900 border-zinc-200 font-medium"
                : "text-zinc-400 border-[#27272a] hover:text-zinc-200 hover:border-zinc-600"
            }`}
          >
            All ({visible.length})
          </button>
          {sectionCounts.map(([name, count]) => (
            <button
              key={name}
              onClick={() => setSection(name)}
              className={`text-[11px] rounded-md px-2.5 py-1 border ${
                section === name
                  ? "bg-zinc-200 text-zinc-900 border-zinc-200 font-medium"
                  : "text-zinc-400 border-[#27272a] hover:text-zinc-200 hover:border-zinc-600"
              }`}
            >
              {name} ({count})
            </button>
          ))}
        </div>
        <div className="max-h-[55vh] overflow-y-auto -mx-1 px-1">
          {shown.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-600">
              {q
                ? "No accounts match the search."
                : section
                  ? `No accounts in ${section}.`
                  : "No accounts in this bucket."}
            </div>
          ) : (
            <div className="border border-[#1c1c21] rounded-md overflow-hidden">
              {shown.map((r) => {
                const tone = toneFor(r.daysQuiet);
                return (
                  <div
                    key={r.accountId}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-xs border-b border-[#1c1c21] last:border-0"
                  >
                    <span className="flex items-start gap-2 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${tone.dot}`} />
                      <span className="min-w-0">
                        <a
                          href={`https://www.tiktok.com/@${r.accountName}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-zinc-200 hover:text-blue-400 hover:underline"
                        >
                          @{r.accountName}
                        </a>
                        <span className="block text-[11px] truncate max-w-[220px]">
                          {r.driveFolderId ? (
                            <a
                              href={`https://drive.google.com/drive/folders/${r.driveFolderId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-zinc-600 hover:text-blue-400 hover:underline"
                            >
                              {r.driveFolderName ?? "Drive folder"}
                            </a>
                          ) : (
                            <span className="text-zinc-600">{r.driveFolderName ?? "—"}</span>
                          )}
                        </span>
                      </span>
                    </span>
                    <span className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-right">
                        <span className={`block tabular-nums ${tone.text}`}>
                          {r.daysQuiet === null ? "never posted" : `${r.daysQuiet} days quiet`}
                        </span>
                        <span className="block text-[10px] text-zinc-600">
                          {section === null && (
                            <span className="text-zinc-500">{r.sectionName ?? "Other"} · </span>
                          )}
                          last post {istDateTime(r.lastPostAt)}
                        </span>
                      </span>
                      {kind === "unused" &&
                        (confirmId === r.accountId ? (
                          <span className="flex items-center gap-1.5">
                            <button
                              onClick={() => handleDelete(r)}
                              disabled={deletingId === r.accountId}
                              className="text-[11px] text-red-400 hover:text-red-300 border border-red-500/30 rounded px-2 py-1 disabled:opacity-40"
                            >
                              {deletingId === r.accountId ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                `Confirm delete @${r.accountName}`
                              )}
                            </button>
                            <button
                              onClick={() => setConfirmId(null)}
                              className="text-[11px] text-zinc-500 hover:text-zinc-300 border border-[#27272a] rounded px-2 py-1"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setConfirmId(r.accountId)}
                            className="text-[11px] text-zinc-600 hover:text-red-400 border border-transparent hover:border-red-500/30 rounded px-2 py-1"
                          >
                            Delete
                          </button>
                        ))}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {filtered.length > shown.length && (
            <div className="py-2 text-center">
              <button
                onClick={() => setExpandedKey(listKey)}
                className="text-[11px] text-zinc-400 hover:text-zinc-200 border border-[#27272a] rounded-md px-3 py-1"
              >
                Show all {filtered.length} accounts
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GrowthBadge({ rate }: { rate: number }) {
  const pct = Math.abs(rate * 100).toFixed(0);
  if (rate > 0.005) {
    return (
      <span className="inline-flex items-center gap-1 text-green-400">
        <TrendingUp className="w-3.5 h-3.5" /> +{pct}% week over week
      </span>
    );
  }
  if (rate < -0.005) {
    return (
      <span className="inline-flex items-center gap-1 text-red-400">
        <TrendingDown className="w-3.5 h-3.5" /> −{pct}% week over week
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-zinc-500">
      <Minus className="w-3.5 h-3.5" /> flat week over week
    </span>
  );
}

function ProjectionCard({ label, current, low, high }: { label: string; current: number; low: number; high: number }) {
  return (
    <div className="border border-[#27272a] rounded-lg px-4 py-3 bg-[#0c0c10]">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className="text-lg font-semibold text-white tabular-nums mt-0.5" title={full(current)}>
        ~{fmt(current)} views
      </div>
      <div className="text-[11px] text-zinc-600 mt-0.5 tabular-nums">
        range {fmt(low)} – {fmt(high)}
      </div>
    </div>
  );
}

// ── Drill-down slide-over ───────────────────────────────────────────────────
function DrillDown({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const detail = useResource<AccountDetail>(`/api/admin/account-performance/accounts/${accountId}`, [accountId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 w-[520px] max-w-full bg-[#0a0a0f] border-l border-[#27272a] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#27272a]">
          <div className="text-sm font-semibold text-zinc-100">
            {detail.data ? `@${detail.data.account.accountName}` : "Account detail"}
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {detail.error ? (
            <SectionError message={detail.error} onRetry={detail.reload} />
          ) : detail.loading || !detail.data ? (
            <div className="flex items-center gap-2 text-zinc-500 text-xs pt-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading account detail…
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                {detail.data.account.avatarUrl ? (
                  <img src={detail.data.account.avatarUrl} alt="" className="w-10 h-10 rounded-full" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-zinc-800" />
                )}
                <div>
                  <div className="text-sm text-zinc-100 font-medium">
                    {detail.data.account.displayName || `@${detail.data.account.accountName}`}
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    {detail.data.account.driveFolderName ?? "No drive folder"}
                    {detail.data.account.sectionName ? ` · ${detail.data.account.sectionName}` : ""}
                    {` · ${detail.data.account.connectionState}`}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <KpiCard label="Posts (30d)" value={full(detail.data.totals.posts)} />
                <KpiCard label="Views (30d)" value={fmt(detail.data.totals.views)} title={full(detail.data.totals.views)} />
                <KpiCard label="Likes (30d)" value={fmt(detail.data.totals.likes)} title={full(detail.data.totals.likes)} />
              </div>

              {detail.data.zeroViewStreak > 0 && (
                <div
                  className={`flex items-center gap-2 border rounded-lg px-3 py-2 text-xs ${
                    detail.data.zeroViewStreak >= 5
                      ? "border-red-500/20 bg-red-500/5 text-red-400"
                      : "border-amber-500/20 bg-amber-500/5 text-amber-400"
                  }`}
                >
                  <AlertCircle className="w-3.5 h-3.5" />
                  Latest {detail.data.zeroViewStreak} video{detail.data.zeroViewStreak !== 1 ? "s" : ""} under 10 views
                </div>
              )}

              <div>
                <div className="text-xs font-semibold text-zinc-300 mb-2">Daily views — last 30 days</div>
                <BarSeries
                  data={detail.data.days.map((d) => ({ day: d.day, value: d.views }))}
                  height={80}
                />
                <div className="flex justify-between text-[10px] text-zinc-600 mt-1">
                  <span>{dayLabel(detail.data.days[0]?.day ?? "")}</span>
                  <span>{dayLabel(detail.data.days[detail.data.days.length - 1]?.day ?? "")}</span>
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-zinc-300 mb-2">Posts per day</div>
                <BarSeries
                  data={detail.data.days.map((d) => ({ day: d.day, value: d.posts }))}
                  height={48}
                  color="#34d399"
                />
              </div>

              <div>
                <div className="text-xs font-semibold text-zinc-300 mb-2">Recent videos</div>
                {detail.data.recentVideos.length === 0 ? (
                  <div className="border border-[#27272a] rounded-lg px-4 py-6 text-center text-xs text-zinc-600">
                    No tracked videos for this account yet.
                  </div>
                ) : (
                  <div className="border border-[#27272a] rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[#27272a] bg-[#0c0c10]">
                          <th className="text-left px-3 py-2 text-zinc-500 font-medium">Video</th>
                          <th className="text-right px-3 py-2 text-zinc-500 font-medium">Views</th>
                          <th className="text-right px-3 py-2 text-zinc-500 font-medium">Likes</th>
                          <th className="text-right px-3 py-2 text-zinc-500 font-medium">Posted (IST)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.data.recentVideos.map((v) => (
                          <tr key={v.id} className="border-b border-[#1c1c21] last:border-0">
                            <td className="px-3 py-2">
                              <a
                                href={v.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-400 hover:underline"
                              >
                                Open
                              </a>
                              {v.status !== "captured" && (
                                <span className="text-zinc-600 ml-2">({v.status})</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right text-zinc-200 tabular-nums">
                              <span title={full(v.views)}>{fmt(v.views)}</span>
                            </td>
                            <td className="px-3 py-2 text-right text-zinc-400 tabular-nums">
                              <span title={full(v.likes)}>{fmt(v.likes)}</span>
                            </td>
                            <td className="px-3 py-2 text-right text-zinc-500 whitespace-nowrap">
                              {istDateTime(v.publishedAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
