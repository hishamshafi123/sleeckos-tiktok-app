"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Table as TableIcon,
  Download,
  Loader2,
  Search,
  AlertCircle,
  RefreshCw,
  X,
} from "lucide-react";

// ── API contract types ──────────────────────────────────────────────────────
type HistoryAccount = { id: string; username: string; driveFolderName: string | null };
type HistoryCampaign = { id: string; title: string };

type PostingHistoryData = {
  range: { from: string; to: string; timezone: string };
  accounts: HistoryAccount[];
  campaigns: HistoryCampaign[];
  cells: Record<string, number>;
  rowTotals: Record<string, number>;
  colTotals: Record<string, number>;
  grandTotal: number;
  postCount: number;
};

// ── Date helpers (IST day semantics — server does the bucketing) ────────────
const IST = "Asia/Kolkata";
const DAY_MS = 24 * 60 * 60 * 1000;
const istFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: IST,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function istDateString(d: Date = new Date()): string {
  return istFmt.format(d); // YYYY-MM-DD in IST
}

function addDays(dateStr: string, days: number): string {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

type Preset = "today" | "yesterday" | "7d" | "30d" | "month" | "custom";

const PRESETS: { key: Preset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "This month" },
  { key: "custom", label: "Custom" },
];

function presetRange(preset: Exclude<Preset, "custom">): { from: string; to: string } {
  const today = istDateString();
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
  }
}

function cellKey(accountId: string, campaignId: string | null): string {
  return `${accountId}::${campaignId ?? "null"}`;
}

// ── Component ───────────────────────────────────────────────────────────────
export default function ClientPage({ allCampaigns }: { allCampaigns: HistoryCampaign[] }) {
  const [preset, setPreset] = useState<Preset>("7d");
  const [range, setRange] = useState(() => presetRange("7d"));
  const [customFrom, setCustomFrom] = useState(range.from);
  const [customTo, setCustomTo] = useState(range.to);

  const [selectedCampaigns, setSelectedCampaigns] = useState<Set<string>>(new Set());
  const [accountSearch, setAccountSearch] = useState("");
  const [hideZero, setHideZero] = useState(true);

  const [data, setData] = useState<PostingHistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      if (selectedCampaigns.size) {
        params.set("campaignIds", [...selectedCampaigns].join(","));
      }
      const res = await fetch(`/api/managed/posting-history?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load posting history");
      setData(json);
    } catch (err: any) {
      setError(err.message || "Failed to load posting history");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, selectedCampaigns]);

  useEffect(() => {
    load();
  }, [load]);

  const applyPreset = (p: Preset) => {
    setPreset(p);
    if (p !== "custom") setRange(presetRange(p));
  };

  const applyCustom = (from: string, to: string) => {
    setCustomFrom(from);
    setCustomTo(to);
    if (from && to && from <= to) setRange({ from, to });
  };

  const toggleCampaign = (id: string) => {
    setSelectedCampaigns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exportCsv = () => {
    const params = new URLSearchParams({ from: range.from, to: range.to });
    if (selectedCampaigns.size) {
      params.set("campaignIds", [...selectedCampaigns].join(","));
    }
    window.location.href = `/api/managed/posting-history/csv?${params}`;
  };

  // ── Derived display data ─────────────────────────────────────────────────
  const visibleAccounts = useMemo(() => {
    if (!data) return [];
    const q = accountSearch.trim().toLowerCase();
    return data.accounts.filter((a) => {
      if (hideZero && !(data.rowTotals[a.id] > 0)) return false;
      if (!q) return true;
      return (
        a.username.toLowerCase().includes(q) ||
        (a.driveFolderName || "").toLowerCase().includes(q)
      );
    });
  }, [data, accountSearch, hideZero]);

  const hasNoCampaignCol = useMemo(
    () => !!data && (data.colTotals["null"] || 0) > 0,
    [data]
  );

  const columns = useMemo(() => {
    if (!data) return [];
    const cols: { id: string | null; label: string }[] = data.campaigns.map((c) => ({
      id: c.id,
      label: c.title,
    }));
    if (hasNoCampaignCol) cols.push({ id: null, label: "No Campaign" });
    return cols;
  }, [data, hasNoCampaignCol]);

  const cellTint = (count: number): string => {
    if (count >= 3) return "bg-zinc-800/80 text-zinc-100";
    if (count >= 1) return "bg-zinc-800/40 text-zinc-300";
    return "";
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-200 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <TableIcon className="w-6 h-6 text-[#E11D48]" />
            <h1 className="text-2xl font-semibold text-zinc-100">Posting History</h1>
          </div>
          <p className="text-sm text-zinc-500 mt-1">
            {data ? (
              <>
                <span className="text-zinc-300 font-medium tabular-nums">
                  {data.postCount.toLocaleString()}
                </span>{" "}
                posts ·{" "}
                <span className="text-zinc-300 font-medium tabular-nums">
                  {visibleAccounts.length}
                </span>{" "}
                accounts ·{" "}
                <span className="text-zinc-300 font-medium tabular-nums">
                  {data.campaigns.length}
                </span>{" "}
                campaigns
                <span className="mx-2 text-zinc-700">|</span>
                {data.range.from} → {data.range.to} · {data.range.timezone}
              </>
            ) : (
              <>{range.from} → {range.to} · {IST}</>
            )}
          </p>
        </div>
        <button
          onClick={exportCsv}
          disabled={loading || !data}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#E11D48] hover:bg-[#be123c] disabled:opacity-50 text-white text-sm font-medium transition-colors"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      {/* Date control */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => applyPreset(p.key)}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              preset === p.key
                ? "bg-[#E11D48]/10 text-rose-400 border-[#E11D48]/30"
                : "bg-[#18181b] text-zinc-400 border-[#27272a] hover:text-zinc-200"
            }`}
          >
            {p.label}
          </button>
        ))}
        {preset === "custom" && (
          <div className="flex items-center gap-2 ml-2">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => applyCustom(e.target.value, customTo)}
              className="bg-[#18181b] border border-[#27272a] rounded-lg px-3 py-1.5 text-sm text-zinc-200 [color-scheme:dark]"
            />
            <span className="text-zinc-600 text-sm">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => applyCustom(customFrom, e.target.value)}
              className="bg-[#18181b] border border-[#27272a] rounded-lg px-3 py-1.5 text-sm text-zinc-200 [color-scheme:dark]"
            />
          </div>
        )}
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
          <input
            type="text"
            value={accountSearch}
            onChange={(e) => setAccountSearch(e.target.value)}
            placeholder="Search account or folder…"
            className="bg-[#18181b] border border-[#27272a] rounded-lg pl-9 pr-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 w-64 focus:outline-none focus:border-[#E11D48]/50"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer select-none">
          <button
            role="switch"
            aria-checked={hideZero}
            onClick={() => setHideZero((v) => !v)}
            className={`w-9 h-5 rounded-full transition-colors relative ${
              hideZero ? "bg-[#E11D48]" : "bg-zinc-700"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                hideZero ? "translate-x-4" : ""
              }`}
            />
          </button>
          Hide zero-post accounts
        </label>

        {selectedCampaigns.size > 0 && (
          <button
            onClick={() => setSelectedCampaigns(new Set())}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300"
          >
            <X className="w-3 h-3" /> Clear campaign filter
          </button>
        )}
      </div>

      {/* Campaign multi-select chips */}
      {allCampaigns.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-5">
          {allCampaigns.map((c) => {
            const active = selectedCampaigns.has(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggleCampaign(c.id)}
                className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                  active
                    ? "bg-[#E11D48]/15 text-rose-400 border-[#E11D48]/40"
                    : "bg-[#18181b] text-zinc-500 border-[#27272a] hover:text-zinc-300"
                }`}
              >
                {c.title}
              </button>
            );
          })}
        </div>
      )}

      {/* Body */}
      {loading ? (
        <SkeletonGrid />
      ) : error ? (
        <div className="border border-red-500/20 bg-red-400/5 rounded-xl p-8 text-center">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
          <p className="text-red-400 text-sm mb-4">{error}</p>
          <button
            onClick={load}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#18181b] border border-[#27272a] text-sm text-zinc-200 hover:border-zinc-600"
          >
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      ) : !data || data.postCount === 0 || visibleAccounts.length === 0 ? (
        <div className="border border-[#27272a] bg-[#18181b] rounded-xl p-12 text-center">
          <TableIcon className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
          <p className="text-zinc-400 text-sm">No posts in this period</p>
          <p className="text-zinc-600 text-xs mt-1">
            Try a wider date range or different filters.
          </p>
        </div>
      ) : (
        <div
          tabIndex={0}
          className="overflow-auto rounded-xl border border-[#27272a] bg-[#18181b] focus:outline-none focus:border-zinc-600"
          style={{ maxHeight: "70vh" }}
        >
          <table className="border-separate border-spacing-0 text-sm w-full">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-30 bg-[#18181b] border-b border-r border-[#27272a] text-left px-4 py-2.5 font-medium text-zinc-400 min-w-[220px]">
                  Account / Drive Folder
                </th>
                {columns.map((col) => (
                  <th
                    key={col.id ?? "null"}
                    title={col.label}
                    className="sticky top-0 z-20 bg-[#18181b] border-b border-r border-[#27272a] px-3 py-2.5 font-medium text-zinc-400 text-right whitespace-nowrap max-w-[160px] truncate"
                  >
                    {col.label}
                  </th>
                ))}
                {/* Solid pre-blended accent tint (sticky cells need opaque bg) */}
                <th className="sticky top-0 z-20 bg-[#22191b] border-b border-[#27272a] px-3 py-2.5 font-semibold text-zinc-200 text-right">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleAccounts.map((a) => {
                const rowTotal = data.rowTotals[a.id] || 0;
                return (
                  <tr key={a.id} className="group">
                    <td className="sticky left-0 z-10 bg-[#18181b] group-hover:bg-zinc-900 border-b border-r border-[#27272a] px-4 py-2 min-w-[220px]">
                      <div className="font-semibold text-zinc-200 leading-tight truncate max-w-[240px]">
                        @{a.username}
                      </div>
                      <div className="text-xs text-zinc-500 leading-tight truncate max-w-[240px]">
                        {a.driveFolderName || "No folder"}
                      </div>
                    </td>
                    {columns.map((col) => {
                      const count = data.cells[cellKey(a.id, col.id)] || 0;
                      return (
                        <td
                          key={col.id ?? "null"}
                          className={`border-b border-r border-[#27272a] px-3 py-2 text-right tabular-nums ${cellTint(count)}`}
                        >
                          {count > 0 ? (
                            <span>{count.toLocaleString()}</span>
                          ) : (
                            <span className="text-zinc-700">·</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="border-b border-[#27272a] px-3 py-2 text-right tabular-nums font-semibold text-zinc-100 bg-[#E11D48]/5">
                      {rowTotal.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="sticky bottom-0 left-0 z-30 bg-[#18181b] border-t border-r border-[#27272a] px-4 py-2.5 font-semibold text-zinc-200">
                  Total
                </td>
                {columns.map((col) => (
                  <td
                    key={col.id ?? "null"}
                    className="sticky bottom-0 z-20 bg-[#18181b] border-t border-r border-[#27272a] px-3 py-2.5 text-right tabular-nums font-semibold text-zinc-200"
                  >
                    {(data.colTotals[col.id ?? "null"] || 0).toLocaleString()}
                  </td>
                ))}
                {/* Solid pre-blended accent tint (sticky cells need opaque bg) */}
                <td className="sticky bottom-0 z-20 bg-[#2c1920] border-t border-[#27272a] px-3 py-2.5 text-right tabular-nums font-bold text-rose-400">
                  {data.grandTotal.toLocaleString()}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="rounded-xl border border-[#27272a] bg-[#18181b] p-4 animate-pulse">
      <div className="flex gap-2 mb-4">
        <div className="h-8 w-56 bg-zinc-800 rounded" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-8 w-24 bg-zinc-800 rounded" />
        ))}
      </div>
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="flex gap-2 mb-2">
          <div className="h-10 w-56 bg-zinc-800/70 rounded" />
          {Array.from({ length: 5 }).map((_, j) => (
            <div key={j} className="h-10 w-24 bg-zinc-800/50 rounded" />
          ))}
        </div>
      ))}
    </div>
  );
}
