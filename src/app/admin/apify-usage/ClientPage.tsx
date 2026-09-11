"use client";
import { useState, useEffect } from "react";
import { Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";

// ── API contract types ──────────────────────────────────────────────────────
type Rates = { costPerCall: number; costPerResult: number };

type UsageWindow = {
  calls: number;
  results: number;
  estCostUsd: number;
  actualUsd: number;
  actualRows: number;
};

type Overview = { rates: Rates; today: UsageWindow; last7d: UsageWindow; last30d: UsageWindow };

type SourceRow = {
  source: string;
  calls: number;
  results: number;
  estCostUsd: number;
  actualUsd: number;
  sharePct: number;
};
type BySource = { days: number; totalEstCostUsd: number; rows: SourceRow[] };

type UsageDay = {
  day: string;
  calls: number;
  results: number;
  estCostUsd: number;
  actualUsd: number;
  bySource: Record<string, number>;
};
type Daily = { days: UsageDay[] };

type TopAccount = { handle: string; calls: number; results: number; estCostUsd: number };
type TopAccounts = { days: number; rows: TopAccount[] };

type ProviderRow = {
  provider: string;
  calls: number;
  results: number;
  errors: number;
  estCostUsd: number;
  actualUsd: number;
};
type ByProvider = { days: number; rows: ProviderRow[] };

type RecentCall = {
  id: string;
  createdAt: string;
  source: string;
  provider: string;
  inputType: string;
  inputSummary: string;
  inputCount: number;
  resultCount: number;
  apifyRunId: string | null;
  durationMs: number | null;
  usageUsd: number | null;
  status: string;
  errorKind: string | null;
};

// ── Source presentation ─────────────────────────────────────────────────────
const SOURCE_META: Record<string, { label: string; color: string }> = {
  sweep: { label: "Sweep", color: "#60a5fa" },
  refresh: { label: "Refresh", color: "#34d399" },
  spot_check: { label: "Spot check", color: "#a78bfa" },
  recover: { label: "Recover", color: "#fbbf24" },
  capture: { label: "Capture", color: "#2dd4bf" },
};
const sourceMeta = (s: string) =>
  SOURCE_META[s] ?? { label: s, color: "#71717a" };
const SOURCE_ORDER = ["sweep", "refresh", "spot_check", "recover", "capture"];

// ── Provider presentation ───────────────────────────────────────────────────
const PROVIDER_META: Record<string, { color: string; note: string }> = {
  TikLiveAPI: { color: "#38bdf8", note: "primary · ~$0.0001/call" },
  Apify: { color: "#fbbf24", note: "fallback · higher cost" },
};
const ProviderBadge = ({ provider }: { provider: string }) => {
  const meta = PROVIDER_META[provider] ?? { color: "#71717a", note: "" };
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border"
      style={{ color: meta.color, borderColor: `${meta.color}40`, backgroundColor: `${meta.color}12` }}
    >
      {provider}
    </span>
  );
};

// ── Formatting helpers (all display times IST) ──────────────────────────────
const IST = "Asia/Kolkata";
const full = (n: number) => n.toLocaleString("en-US");
// USD amounts are often fractions of a cent — show enough precision.
const usd = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`);

const istDateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: IST,
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const istDateTime = (iso: string) => istDateTimeFmt.format(new Date(iso));

const dayLabel = (day: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }).format(
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

function SkeletonBlock({ height = "h-24" }: { height?: string }) {
  return <div className={`${height} rounded-lg bg-zinc-900 animate-pulse`} />;
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-[#27272a] rounded-lg px-4 py-8 text-center text-xs text-zinc-600">
      {children}
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="border border-[#27272a] rounded-lg px-4 py-3 bg-[#0c0c10]">
      <div className={`text-lg font-semibold tabular-nums ${tone ?? "text-white"}`}>{value}</div>
      <div className="text-[11px] text-zinc-500 mt-0.5">{label}</div>
      {sub && <div className="text-[10px] text-zinc-600 mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────
export default function ClientPage() {
  const overview = useResource<Overview>("/api/admin/apify-usage/overview");
  const byProvider = useResource<ByProvider>("/api/admin/apify-usage/by-provider?days=30");
  const bySource = useResource<BySource>("/api/admin/apify-usage/by-source?days=30");
  const daily = useResource<Daily>("/api/admin/apify-usage/daily?days=30");
  const topAccounts = useResource<TopAccounts>("/api/admin/apify-usage/top-accounts?days=7");
  const recent = useResource<{ rows: RecentCall[] }>("/api/admin/apify-usage/recent?limit=50");

  const reloadEstimates = () => {
    overview.reload();
    bySource.reload();
    daily.reload();
    topAccounts.reload();
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-white">Scraper Usage</h1>
        <p className="text-xs text-zinc-500 mt-1">
          TikLiveAPI is the primary scraper, Apify the automatic fallback · every call, where the
          spend goes, and what it costs · all times IST
        </p>
      </div>

      {/* ── KPI strip ──────────────────────────────────────────────────── */}
      <section>
        {overview.error ? (
          <SectionError message={overview.error} onRetry={overview.reload} />
        ) : overview.loading || !overview.data ? (
          <div className="grid grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonBlock key={i} height="h-20" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-3">
            <KpiCard label="Calls today" value={full(overview.data.today.calls)} />
            <KpiCard
              label="Videos fetched today"
              value={full(overview.data.today.results)}
              sub="dataset items returned"
            />
            <KpiCard
              label="Est. cost today"
              value={usd(overview.data.today.estCostUsd)}
              sub="estimated from rates below"
            />
            <KpiCard
              label="Est. cost (30d)"
              value={usd(overview.data.last30d.estCostUsd)}
              sub={`${full(overview.data.last30d.calls)} calls · ${full(overview.data.last30d.results)} items`}
            />
            <KpiCard
              label="Reported by Apify (30d)"
              value={overview.data.last30d.actualRows > 0 ? usd(overview.data.last30d.actualUsd) : "—"}
              sub={
                overview.data.last30d.actualRows > 0
                  ? `actual charges from ${full(overview.data.last30d.actualRows)} runs`
                  : "no actual-cost data reported yet"
              }
              tone="text-green-400"
            />
          </div>
        )}
      </section>

      {/* ── By provider ────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-200">
          By provider (last {byProvider.data?.days ?? 30} days)
        </h2>
        {byProvider.error ? (
          <SectionError message={byProvider.error} onRetry={byProvider.reload} />
        ) : byProvider.loading || !byProvider.data ? (
          <SkeletonBlock height="h-20" />
        ) : byProvider.data.rows.length === 0 ? (
          <EmptyNote>No scraper calls logged yet.</EmptyNote>
        ) : (
          <div className="border border-[#27272a] rounded-lg overflow-hidden">
            {byProvider.data.rows.map((r) => {
              const meta = PROVIDER_META[r.provider] ?? { color: "#71717a", note: "" };
              return (
                <div
                  key={r.provider}
                  className="flex items-center gap-4 px-4 py-2.5 text-xs border-b border-[#1c1c21] last:border-0"
                >
                  <span className="w-36 flex-shrink-0 flex items-center gap-2">
                    <ProviderBadge provider={r.provider} />
                    <span className="text-[10px] text-zinc-600">{meta.note}</span>
                  </span>
                  <span className="w-20 text-right text-zinc-300 tabular-nums flex-shrink-0">
                    {full(r.calls)} calls
                  </span>
                  <span className="w-24 text-right text-zinc-500 tabular-nums flex-shrink-0">
                    {full(r.results)} items
                  </span>
                  <span className="w-20 text-right text-zinc-500 tabular-nums flex-shrink-0">
                    {r.errors > 0 ? <span className="text-red-400">{full(r.errors)} err</span> : "0 err"}
                  </span>
                  <span className="w-20 text-right text-zinc-100 tabular-nums font-medium flex-shrink-0">
                    {usd(r.estCostUsd)}
                  </span>
                  <span className="w-20 text-right text-green-400/80 tabular-nums flex-shrink-0">
                    {r.actualUsd > 0 ? usd(r.actualUsd) : "—"}
                  </span>
                </div>
              );
            })}
            <div className="px-4 py-2 bg-[#0c0c10] text-[11px] text-zinc-600">
              Est. cost uses each provider&apos;s own rate · actual $ reported where available.
            </div>
          </div>
        )}
      </section>

      {/* ── Cost by source ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-200">
          Where the money goes — by source (last 30 days)
        </h2>
        {bySource.error ? (
          <SectionError message={bySource.error} onRetry={bySource.reload} />
        ) : bySource.loading || !bySource.data ? (
          <SkeletonBlock height="h-40" />
        ) : bySource.data.rows.length === 0 ? (
          <EmptyNote>
            No Apify calls logged yet — rows appear after the next sweep, refresh, spot-check,
            recover or capture run.
          </EmptyNote>
        ) : (
          <div className="border border-[#27272a] rounded-lg overflow-hidden">
            {bySource.data.rows.map((r) => {
              const meta = sourceMeta(r.source);
              return (
                <div
                  key={r.source}
                  className="flex items-center gap-4 px-4 py-2.5 text-xs border-b border-[#1c1c21] last:border-0"
                >
                  <span className="flex items-center gap-2 w-28 flex-shrink-0">
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: meta.color }}
                    />
                    <span className="text-zinc-200 font-medium">{meta.label}</span>
                  </span>
                  <span className="w-20 text-right text-zinc-300 tabular-nums flex-shrink-0">
                    {full(r.calls)} calls
                  </span>
                  <span className="w-24 text-right text-zinc-500 tabular-nums flex-shrink-0">
                    {full(r.results)} items
                  </span>
                  <span className="w-20 text-right text-zinc-100 tabular-nums font-medium flex-shrink-0">
                    {usd(r.estCostUsd)}
                  </span>
                  <span className="w-20 text-right text-green-400/80 tabular-nums flex-shrink-0">
                    {r.actualUsd > 0 ? usd(r.actualUsd) : "—"}
                  </span>
                  <span className="flex-1 flex items-center gap-2 min-w-0">
                    <span className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${r.sharePct}%`, backgroundColor: meta.color }}
                      />
                    </span>
                    <span className="text-zinc-500 tabular-nums w-12 text-right flex-shrink-0">
                      {r.sharePct.toFixed(1)}%
                    </span>
                  </span>
                </div>
              );
            })}
            <div className="px-4 py-2 bg-[#0c0c10] text-[11px] text-zinc-600">
              Est. cost · actual $ reported by Apify where available. Total est:{" "}
              <span className="text-zinc-300 font-medium">{usd(bySource.data.totalEstCostUsd)}</span>
            </div>
          </div>
        )}
      </section>

      {/* ── Daily stacked chart ────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-200">Calls per day — last 30 days</h2>
        {daily.error ? (
          <SectionError message={daily.error} onRetry={daily.reload} />
        ) : daily.loading || !daily.data ? (
          <SkeletonBlock height="h-36" />
        ) : (
          <DailyStackedChart days={daily.data.days} />
        )}
      </section>

      {/* ── Top accounts + rates ───────────────────────────────────────── */}
      <section className="grid grid-cols-3 gap-4 items-start">
        <div className="col-span-2 space-y-3">
          <h2 className="text-sm font-semibold text-zinc-200">
            Top fetched accounts (last {topAccounts.data?.days ?? 7} days)
          </h2>
          {topAccounts.error ? (
            <SectionError message={topAccounts.error} onRetry={topAccounts.reload} />
          ) : topAccounts.loading || !topAccounts.data ? (
            <SkeletonBlock height="h-48" />
          ) : topAccounts.data.rows.length === 0 ? (
            <EmptyNote>No profile fetches logged in this window.</EmptyNote>
          ) : (
            <div className="border border-[#27272a] rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#27272a] bg-[#0c0c10]">
                    <th className="text-left px-4 py-2 text-zinc-500 font-medium">Account</th>
                    <th className="text-right px-3 py-2 text-zinc-500 font-medium">Calls</th>
                    <th className="text-right px-3 py-2 text-zinc-500 font-medium">Items</th>
                    <th className="text-right px-4 py-2 text-zinc-500 font-medium">Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {topAccounts.data.rows.map((r) => (
                    <tr key={r.handle} className="border-b border-[#1c1c21] last:border-0">
                      <td className="px-4 py-2">
                        <a
                          href={`https://www.tiktok.com/@${r.handle}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-zinc-200 hover:text-blue-400 hover:underline"
                        >
                          @{r.handle}
                        </a>
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-300 tabular-nums">{r.calls}</td>
                      <td className="px-3 py-2 text-right text-zinc-400 tabular-nums">
                        {full(r.results)}
                      </td>
                      <td className="px-4 py-2 text-right text-zinc-100 tabular-nums">
                        {usd(r.estCostUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <RatesEditor onSaved={reloadEstimates} />
      </section>

      {/* ── Recent calls ───────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-200">Recent calls</h2>
        {recent.error ? (
          <SectionError message={recent.error} onRetry={recent.reload} />
        ) : recent.loading || !recent.data ? (
          <SkeletonBlock height="h-48" />
        ) : recent.data.rows.length === 0 ? (
          <EmptyNote>No calls logged yet.</EmptyNote>
        ) : (
          <div className="border border-[#27272a] rounded-lg overflow-hidden">
            <div className="max-h-[420px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[#0c0c10] z-10">
                  <tr className="border-b border-[#27272a]">
                    <th className="text-left px-4 py-2 text-zinc-500 font-medium">Time (IST)</th>
                    <th className="text-left px-3 py-2 text-zinc-500 font-medium">Source</th>
                    <th className="text-left px-3 py-2 text-zinc-500 font-medium">Provider</th>
                    <th className="text-left px-3 py-2 text-zinc-500 font-medium">Input</th>
                    <th className="text-right px-3 py-2 text-zinc-500 font-medium">In</th>
                    <th className="text-right px-3 py-2 text-zinc-500 font-medium">Out</th>
                    <th className="text-right px-3 py-2 text-zinc-500 font-medium">Took</th>
                    <th className="text-right px-3 py-2 text-zinc-500 font-medium">Actual $</th>
                    <th className="text-left px-4 py-2 text-zinc-500 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.data.rows.map((r) => {
                    const meta = sourceMeta(r.source);
                    return (
                      <tr key={r.id} className="border-b border-[#1c1c21] last:border-0">
                        <td className="px-4 py-2 text-zinc-500 whitespace-nowrap">
                          {istDateTime(r.createdAt)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="w-1.5 h-1.5 rounded-full"
                              style={{ backgroundColor: meta.color }}
                            />
                            <span className="text-zinc-300">{meta.label}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <ProviderBadge provider={r.provider} />
                        </td>
                        <td className="px-3 py-2 text-zinc-400 max-w-[260px] truncate" title={r.inputSummary}>
                          {r.inputSummary}
                        </td>
                        <td className="px-3 py-2 text-right text-zinc-400 tabular-nums">
                          {r.inputCount}
                        </td>
                        <td className="px-3 py-2 text-right text-zinc-300 tabular-nums">
                          {r.resultCount}
                        </td>
                        <td className="px-3 py-2 text-right text-zinc-500 tabular-nums whitespace-nowrap">
                          {r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-green-400/80 tabular-nums">
                          {r.usageUsd != null ? usd(r.usageUsd) : "—"}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          {r.status === "ok" ? (
                            <span className="text-zinc-500">ok</span>
                          ) : (
                            <span className="text-red-400">error{r.errorKind ? ` · ${r.errorKind}` : ""}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// ── Daily stacked bar chart (calls per day, stacked by source) ─────────────
function DailyStackedChart({ days }: { days: UsageDay[] }) {
  const max = Math.max(...days.map((d) => d.calls), 1);
  const sources = SOURCE_ORDER.filter((s) => days.some((d) => (d.bySource[s] ?? 0) > 0));
  const extraSources = [
    ...new Set(days.flatMap((d) => Object.keys(d.bySource))),
  ].filter((s) => !SOURCE_ORDER.includes(s));
  const legend = [...sources, ...extraSources];

  return (
    <div className="border border-[#27272a] rounded-lg p-5 space-y-3">
      {legend.length > 0 && (
        <div className="flex items-center gap-4 flex-wrap text-[11px] text-zinc-500">
          {legend.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: sourceMeta(s).color }}
              />
              {sourceMeta(s).label}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-[3px] h-32">
        {days.map((d) => (
          <div
            key={d.day}
            className="flex-1 min-w-[3px] flex flex-col justify-end rounded-sm overflow-hidden"
            style={{ height: "100%" }}
            title={`${dayLabel(d.day)} — ${d.calls} calls · ${full(d.results)} items · est ${usd(d.estCostUsd)}${
              d.actualUsd > 0 ? ` · actual ${usd(d.actualUsd)}` : ""
            }`}
          >
            {d.calls === 0 ? (
              <div className="w-full bg-[#27272a]" style={{ height: "1%" }} />
            ) : (
              legend.map((s) => {
                const n = d.bySource[s] ?? 0;
                if (n === 0) return null;
                return (
                  <div
                    key={s}
                    className="w-full"
                    style={{
                      height: `${(n / max) * 100}%`,
                      backgroundColor: sourceMeta(s).color,
                    }}
                  />
                );
              })
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-zinc-600">
        <span>{dayLabel(days[0]?.day ?? "")}</span>
        <span>{dayLabel(days[days.length - 1]?.day ?? "")}</span>
      </div>
    </div>
  );
}

// ── Rates editor ────────────────────────────────────────────────────────────
// The $ rates behind every "estimated" figure on this page. Stored org-wide
// in AppSetting; saving is admin-only (the API returns 403 otherwise).
function RatesEditor({ onSaved }: { onSaved: () => void }) {
  const rates = useResource<Rates>("/api/admin/apify-usage/rates");
  const [perCall, setPerCall] = useState("");
  const [perResult, setPerResult] = useState("");
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (rates.data && !hydrated) {
      setPerCall(String(rates.data.costPerCall));
      setPerResult(String(rates.data.costPerResult));
      setHydrated(true);
    }
  }, [rates.data, hydrated]);

  const save = async () => {
    const costPerCall = Number(perCall);
    const costPerResult = Number(perResult);
    if (!Number.isFinite(costPerCall) || !Number.isFinite(costPerResult) || costPerCall < 0 || costPerResult < 0) {
      toast.error("Rates must be numbers ≥ 0");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/apify-usage/rates", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ costPerCall, costPerResult }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
      toast.success("Rates saved");
      onSaved(); // recompute every "estimated" figure with the new rates
    } catch (err: any) {
      toast.error(`Failed to save rates: ${err?.message || "unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-zinc-200">Estimate rates</h2>
      {rates.error ? (
        <SectionError message={rates.error} onRetry={rates.reload} />
      ) : rates.loading || !rates.data ? (
        <SkeletonBlock height="h-32" />
      ) : (
        <div className="border border-[#27272a] rounded-lg p-4 space-y-3 bg-[#0c0c10]">
          <p className="text-[11px] text-zinc-500">
            These $ rates drive every figure labeled <span className="text-zinc-300">estimated</span>{" "}
            on this page. Actual spend comes from Apify run metadata when the actor reports it.
          </p>
          <label className="block">
            <span className="text-[11px] text-zinc-500">Cost per call ($)</span>
            <input
              type="number"
              min={0}
              step={0.001}
              value={perCall}
              onChange={(e) => setPerCall(e.target.value)}
              className="mt-1 w-full bg-[#09090b] border border-[#27272a] rounded-md px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600 tabular-nums"
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-zinc-500">Cost per result / item ($)</span>
            <input
              type="number"
              min={0}
              step={0.001}
              value={perResult}
              onChange={(e) => setPerResult(e.target.value)}
              className="mt-1 w-full bg-[#09090b] border border-[#27272a] rounded-md px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600 tabular-nums"
            />
          </label>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1.5 text-xs text-zinc-200 hover:text-white border border-[#27272a] hover:border-zinc-600 rounded-md px-3 py-1.5 transition-colors disabled:opacity-40"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            Save rates
          </button>
        </div>
      )}
    </div>
  );
}
