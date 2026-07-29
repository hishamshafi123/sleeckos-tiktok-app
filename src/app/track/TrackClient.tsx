"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  CalendarClock,
  Download,
  ExternalLink,
  Eye,
  Heart,
  Loader2,
  Lock,
  MessageCircle,
  Search,
  TrendingUp,
  Video,
} from "lucide-react";

const IST = "Asia/Kolkata";

type PublicTrackingPayload = {
  campaign: { title: string };
  totals: {
    posted: number;
    captured: number;
    published: number;
    scheduled: number;
    views: number;
    likes: number;
    avgViews: number;
  };
  trend: { date: string; views: number; likes: number }[];
  videos: {
    url: string;
    publishedAt: string;
    views: number;
    likes: number;
    comments: number;
    shares: number;
  }[];
};

type PublicVideo = PublicTrackingPayload["videos"][number];

type SortKey = "views" | "likes" | "date";
type SortDir = "asc" | "desc";

const formatCompact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : `${n}`;

const formatDateIST = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { timeZone: IST, day: "numeric", month: "short", year: "numeric" });

const formatDayLabel = (dateStr: string) =>
  new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

// Tail of the TikTok video id for a compact, recognizable link label
const videoIdTail = (url: string) => {
  const m = url.match(/\/video\/(\d+)/);
  const id = m ? m[1] : url.replace(/\D/g, "");
  return id ? `…${id.slice(-8)}` : "Open";
};

export default function TrackClient() {
  const [code, setCode] = useState("");
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const [data, setData] = useState<PublicTrackingPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookup = useCallback(async (rawCode: string) => {
    const trimmed = rawCode.trim();
    if (!trimmed) return;
    setLoading(true);
    setSubmitted(true);
    setError(null);
    try {
      const res = await fetch("/api/track/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      if (res.status === 404) {
        setData(null);
        setActiveCode(null);
        setError("This tracking code is invalid, revoked, or expired. Please check the link you were given.");
        return;
      }
      if (res.status === 429) {
        setError("Too many attempts — please wait a minute and try again.");
        return;
      }
      if (!res.ok) throw new Error("Lookup failed");
      const payload: PublicTrackingPayload = await res.json();
      setData(payload);
      setActiveCode(trimmed.toUpperCase());
      // Keep the code in the URL hash so the page can be refreshed/shared
      window.history.replaceState(null, "", `#${trimmed.toUpperCase()}`);
    } catch {
      setError("Something went wrong while loading the tracking data. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Accept the code from the URL hash on first load (/track#CODE)
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "").trim();
    if (hash) {
      setCode(hash);
      lookup(hash);
    }
  }, [lookup]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    lookup(code);
  };

  // ── Loading skeleton (lookup in flight, nothing to show yet) ──
  if (loading && submitted && !data && !error) {
    return (
      <div className="min-h-screen bg-[#09090b] text-zinc-100">
        <div className="max-w-5xl mx-auto px-4 py-10 space-y-6 animate-pulse">
          <div className="flex items-center justify-between border-b border-[#27272a] pb-5">
            <div className="space-y-2">
              <div className="h-2.5 w-32 bg-[#18181b] rounded" />
              <div className="h-5 w-56 bg-[#18181b] rounded" />
            </div>
            <div className="h-8 w-28 bg-[#18181b] rounded" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-24 bg-[#18181b]/40 border border-[#27272a] rounded" />
            ))}
          </div>
          <div className="h-64 bg-[#18181b]/40 border border-[#27272a] rounded-md" />
          <div className="h-72 bg-[#18181b]/40 border border-[#27272a] rounded-md" />
        </div>
      </div>
    );
  }

  // ── Locked state: code entry ──
  if (!data) {
    return (
      <div className="min-h-screen bg-[#09090b] text-zinc-100 flex items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-md bg-[#18181b] border border-[#27272a] flex items-center justify-center mx-auto">
              <BarChart3 className="w-5 h-5 text-[#E11D48]" />
            </div>
            <h1 className="text-lg font-bold tracking-tight">Campaign Tracking</h1>
            <p className="text-xs text-zinc-500">Enter your tracking code to view live campaign performance.</p>
          </div>

          <form onSubmit={handleSubmit} className="border border-[#27272a] rounded-md bg-[#09090b] p-5 space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-semibold tracking-wider text-zinc-500 block">
                Tracking Code
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. X7K2P9Q4MD"
                autoFocus
                autoCapitalize="characters"
                className="w-full bg-[#09090b] border border-[#27272a] rounded px-3 py-2 text-zinc-100 font-mono text-sm tracking-widest uppercase focus:border-zinc-500 focus:outline-none placeholder-zinc-700"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2.5 bg-red-950/20 border border-red-900/30 text-red-400 rounded p-3 text-xs">
                <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !code.trim()}
              className="w-full flex items-center justify-center gap-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-950 text-xs font-semibold px-3 py-2 rounded transition disabled:opacity-50"
            >
              {loading ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />}
              {loading ? "Checking..." : "View Tracking"}
            </button>
          </form>

          <p className="text-center text-[10px] text-zinc-600">
            Powered by <span className="font-semibold text-zinc-500">Sleeckos</span>
          </p>
        </div>
      </div>
    );
  }

  // ── Unlocked state: read-only dashboard ──
  return <ReportDashboard data={data} activeCode={activeCode} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Report dashboard
// ─────────────────────────────────────────────────────────────────────────────

function ReportDashboard({ data, activeCode }: { data: PublicTrackingPayload; activeCode: string | null }) {
  const { totals } = data;

  const totalComments = useMemo(() => data.videos.reduce((s, v) => s + v.comments, 0), [data.videos]);

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100">
      <div className="max-w-5xl mx-auto px-4 py-10 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[#27272a] pb-5">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-3.5 h-3.5 text-[#E11D48]" />
              <p className="text-[10px] uppercase font-semibold tracking-widest text-zinc-500">
                SleeckOS · Campaign Report
              </p>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{data.campaign.title}</h1>
            <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
              Live stats · last 30 days · IST
            </p>
          </div>
          <a
            href={`/api/track/csv?code=${encodeURIComponent(activeCode || "")}`}
            className="inline-flex items-center gap-1.5 bg-[#E11D48] hover:bg-[#be123c] text-white text-[11px] font-semibold px-3.5 py-2 rounded transition self-start sm:self-auto"
          >
            <Download size={12} />
            Download CSV
          </a>
        </div>

        {/* Hero stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <HeroStat
            label="Videos Published"
            value={totals.published}
            icon={<Video size={11} className="text-emerald-500" />}
            valueClass="text-emerald-400"
          />
          <HeroStat
            label="Videos Scheduled"
            value={totals.scheduled}
            icon={<CalendarClock size={11} className="text-amber-500" />}
            valueClass="text-amber-400"
          />
          <HeroStat
            label="Total Views"
            value={totals.views}
            icon={<Eye size={11} className="text-[#E11D48]" />}
            valueClass="text-[#E11D48]"
            large
          />
          <HeroStat
            label="Total Likes"
            value={totals.likes}
            icon={<Heart size={11} className="text-zinc-500" />}
            valueClass="text-zinc-100"
          />
          <HeroStat
            label="Comments"
            value={totalComments}
            icon={<MessageCircle size={11} className="text-zinc-500" />}
            valueClass="text-zinc-100"
          />
          <HeroStat
            label="Avg Views / Video"
            value={totals.avgViews}
            icon={<TrendingUp size={11} className="text-zinc-500" />}
            valueClass="text-zinc-100"
          />
        </div>

        {/* Trend chart */}
        <TrendChart trend={data.trend} />

        {/* Links table */}
        <LinksTable videos={data.videos} />

        {/* Footer */}
        <p className="text-center text-[10px] text-zinc-600 pt-2">
          Powered by <span className="font-semibold text-zinc-500">SleeckOS</span>
        </p>
      </div>
    </div>
  );
}

function HeroStat({
  label,
  value,
  icon,
  valueClass,
  large = false,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  valueClass: string;
  large?: boolean;
}) {
  return (
    <div className="bg-[#18181b]/40 border border-[#27272a] rounded-md p-4 space-y-2 hover:border-zinc-600 transition-colors">
      <span className="text-[9px] text-zinc-500 font-semibold uppercase tracking-widest flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <span
        className={`block font-bold font-mono tabular-nums ${large ? "text-3xl" : "text-2xl"} ${valueClass}`}
        title={value.toLocaleString()}
      >
        {formatCompact(value)}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Views-over-time chart: daily gains (deltas of the cumulative series)
// ─────────────────────────────────────────────────────────────────────────────

function TrendChart({ trend }: { trend: PublicTrackingPayload["trend"] }) {
  const [hover, setHover] = useState<number | null>(null);

  // Convert cumulative trend → daily deltas
  const days = useMemo(
    () =>
      trend.map((d, i) => {
        const prev = i > 0 ? trend[i - 1] : { views: 0, likes: 0 };
        return {
          date: d.date,
          views: Math.max(0, d.views - prev.views),
          likes: Math.max(0, d.likes - prev.likes),
        };
      }),
    [trend]
  );

  const hasData = days.some((d) => d.views > 0 || d.likes > 0);

  return (
    <div className="border border-[#27272a] rounded-md bg-[#09090b] p-5 space-y-4">
      <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2 border-b border-[#27272a] pb-3">
        <BarChart3 className="w-4 h-4 text-[#E11D48]" />
        Views Over Time
        <span className="text-[10px] text-zinc-500 font-normal font-mono ml-auto">daily gains · last 30 days · IST</span>
      </h3>

      {!hasData ? (
        <div className="bg-zinc-950/40 border border-[#27272a] rounded p-8 text-center select-none">
          <BarChart3 className="w-5 h-5 text-zinc-600 mx-auto mb-2" />
          <p className="text-[11px] text-zinc-500 italic">No view data recorded yet.</p>
        </div>
      ) : (
        <TrendChartBody days={days} hover={hover} setHover={setHover} />
      )}
    </div>
  );
}

function TrendChartBody({
  days,
  hover,
  setHover,
}: {
  days: { date: string; views: number; likes: number }[];
  hover: number | null;
  setHover: (i: number | null) => void;
}) {
  const maxViews = Math.max(5, ...days.map((d) => d.views));
  const labelEvery = Math.max(1, Math.ceil(days.length / 8));

  return (
    <div className="bg-zinc-950/40 border border-[#27272a] rounded p-3.5 space-y-2 select-none">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-[10px] text-zinc-400">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-[#E11D48] inline-block" /> Views gained
          </span>
        </div>
        <span className="text-[9px] text-zinc-600 font-mono">
          {hover !== null
            ? `${formatDayLabel(days[hover].date)} — ${days[hover].views.toLocaleString()} views · ${days[
                hover
              ].likes.toLocaleString()} likes`
            : "hover a bar for details"}
        </span>
      </div>

      <div className="relative h-40">
        {/* Grid */}
        {[1, 0.75, 0.5, 0.25, 0].map((ratio) => (
          <div
            key={ratio}
            className="absolute left-8 right-0 border-t border-dashed border-[#27272a] pointer-events-none"
            style={{ top: `${(1 - ratio) * 100}%` }}
          >
            <span className="absolute -top-2 -left-8 text-[8px] text-zinc-600 font-mono w-7 text-right pr-1">
              {formatCompact(Math.round(maxViews * ratio))}
            </span>
          </div>
        ))}

        {/* Bars */}
        <div className="absolute inset-0 left-8 flex items-end gap-[3px]">
          {days.map((d, i) => (
            <div
              key={d.date}
              className="relative flex-1 min-w-[8px] h-full flex items-end justify-center"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {/* hover hit area */}
              <div className={`absolute inset-0 rounded-sm transition-colors ${hover === i ? "bg-zinc-800/40" : ""}`} />
              <div
                className={`relative w-full max-w-[16px] rounded-sm transition-colors ${
                  hover === i ? "bg-[#E11D48]" : "bg-[#E11D48]/70"
                }`}
                style={{
                  height: `${(d.views / maxViews) * 100}%`,
                  minHeight: d.views > 0 ? 2 : 0,
                }}
              />
              {/* Tooltip */}
              {hover === i && (
                <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
                  <div className="bg-[#18181b] border border-[#27272a] rounded px-2 py-1.5 text-center whitespace-nowrap shadow-lg">
                    <p className="text-[9px] text-zinc-500 font-mono">{formatDayLabel(d.date)}</p>
                    <p className="text-[11px] font-bold font-mono text-zinc-100 tabular-nums">
                      +{d.views.toLocaleString()} <span className="text-[9px] font-normal text-zinc-500">views</span>
                    </p>
                    <p className="text-[10px] font-mono text-zinc-400 tabular-nums">
                      +{d.likes.toLocaleString()} <span className="text-[9px] text-zinc-500">likes</span>
                    </p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* X labels */}
      <div className="pl-8 flex gap-[3px]">
        {days.map((d, i) => (
          <div key={d.date} className="flex-1 min-w-[8px] text-center text-[8px] text-zinc-600 font-mono truncate">
            {i % labelEvery === 0 ? formatDayLabel(d.date) : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Links table: searchable, sortable
// ─────────────────────────────────────────────────────────────────────────────

function LinksTable({ videos }: { videos: PublicVideo[] }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("views");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? videos.filter((v) => v.url.toLowerCase().includes(q)) : [...videos];
    const dir = sortDir === "desc" ? -1 : 1;
    filtered.sort((a, b) => {
      if (sortKey === "date") return dir * (new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());
      return dir * (a[sortKey] - b[sortKey]);
    });
    return filtered;
  }, [videos, query, sortKey, sortDir]);

  const isDefaultRanking = sortKey === "views" && sortDir === "desc";

  const sortHeader = (label: string, key: SortKey, alignRight = false) => {
    const active = sortKey === key;
    return (
      <th
        className={`px-3 py-2 font-semibold cursor-pointer select-none hover:text-zinc-300 transition-colors ${
          alignRight ? "text-right" : ""
        } ${active ? "text-zinc-300" : ""}`}
        onClick={() => toggleSort(key)}
      >
        <span className={`inline-flex items-center gap-1 ${alignRight ? "flex-row-reverse" : ""}`}>
          {label}
          {active ? (
            sortDir === "desc" ? (
              <ArrowDown size={10} className="text-[#E11D48]" />
            ) : (
              <ArrowUp size={10} className="text-[#E11D48]" />
            )
          ) : (
            <ArrowUpDown size={10} className="text-zinc-700" />
          )}
        </span>
      </th>
    );
  };

  return (
    <div className="border border-[#27272a] rounded-md bg-[#09090b] p-5 space-y-4">
      <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2 border-b border-[#27272a] pb-3">
        <Video className="w-4 h-4 text-[#E11D48]" />
        All Published Videos
        <span className="text-[10px] text-zinc-500 font-normal font-mono ml-auto">
          {rows.length.toLocaleString()}
          {query && ` of ${videos.length.toLocaleString()}`} links
        </span>
      </h3>

      {videos.length === 0 ? (
        <div className="bg-zinc-950/40 border border-[#27272a] rounded p-8 text-center select-none">
          <Video className="w-5 h-5 text-zinc-600 mx-auto mb-2" />
          <p className="text-[11px] text-zinc-500 italic">
            No tracked videos yet — links appear here automatically after posts publish.
          </p>
        </div>
      ) : (
        <>
          {/* Search */}
          <div className="relative max-w-xs">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by link…"
              className="w-full bg-zinc-950/40 border border-[#27272a] rounded pl-7 pr-3 py-1.5 text-[11px] text-zinc-200 focus:border-zinc-500 focus:outline-none placeholder-zinc-600"
            />
          </div>

          {rows.length === 0 ? (
            <p className="text-[11px] text-zinc-500 italic text-center py-6">No links match “{query}”.</p>
          ) : (
            <div className="border border-[#27272a] rounded overflow-auto max-h-[480px]">
              <table className="w-full text-xs text-left min-w-[640px]">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[#18181b] border-b border-[#27272a] text-zinc-500 text-[10px] uppercase font-bold">
                    <th className="px-3 py-2 font-semibold w-10">#</th>
                    <th className="px-3 py-2 font-semibold">Video</th>
                    {sortHeader("Posted", "date")}
                    {sortHeader("Views", "views", true)}
                    {sortHeader("Likes", "likes", true)}
                    <th className="px-3 py-2 font-semibold text-right">Comments</th>
                    <th className="px-3 py-2 font-semibold text-right">Shares</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#27272a] text-zinc-300">
                  {rows.map((v, i) => {
                    const isTop = isDefaultRanking && i === 0;
                    return (
                      <tr
                        key={`${v.url}-${i}`}
                        className={`${i % 2 === 1 ? "bg-zinc-950/30" : ""} ${
                          isTop ? "bg-[#E11D48]/5" : ""
                        } hover:bg-zinc-900/60 transition-colors`}
                      >
                        <td className="px-3 py-2.5 font-mono text-[10px] text-zinc-600">
                          {isTop ? (
                            <span className="inline-flex items-center gap-1 text-[#E11D48] font-bold">
                              <TrendingUp size={10} />
                              {i + 1}
                            </span>
                          ) : (
                            i + 1
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <a
                            href={v.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-blue-400 hover:text-blue-300 font-semibold hover:underline"
                          >
                            <ExternalLink size={11} className="flex-shrink-0" />
                            <span className="font-mono text-[11px]">{videoIdTail(v.url)}</span>
                          </a>
                          {isTop && (
                            <span className="ml-2 text-[8px] uppercase font-bold tracking-wider text-[#E11D48] border border-[#E11D48]/30 rounded px-1 py-0.5">
                              Top
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11px] text-zinc-400 whitespace-nowrap">
                          {formatDateIST(v.publishedAt)}
                        </td>
                        <td
                          className="px-3 py-2.5 text-right font-mono font-semibold text-zinc-100 tabular-nums"
                          title={v.views.toLocaleString()}
                        >
                          {v.views.toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums" title={v.likes.toLocaleString()}>
                          {v.likes.toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-zinc-400 tabular-nums">
                          {v.comments.toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-zinc-400 tabular-nums">
                          {v.shares.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
