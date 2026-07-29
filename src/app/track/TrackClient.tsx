"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BarChart3,
  Download,
  ExternalLink,
  Eye,
  Heart,
  Loader2,
  Lock,
  AlertTriangle,
  Video,
} from "lucide-react";

const IST = "Asia/Kolkata";

type PublicTrackingPayload = {
  campaign: { title: string };
  totals: { posted: number; captured: number; views: number; likes: number; avgViews: number };
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

const formatCompact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : `${n}`;

const formatDateIST = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { timeZone: IST, day: "numeric", month: "short", year: "numeric" });

const formatDayLabel = (dateStr: string) =>
  new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export default function TrackClient() {
  const [code, setCode] = useState("");
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const [data, setData] = useState<PublicTrackingPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookup = useCallback(async (rawCode: string) => {
    const trimmed = rawCode.trim();
    if (!trimmed) return;
    setLoading(true);
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

  const renderTrendChart = () => {
    if (!data) return null;
    const trend = data.trend;
    const hasData = trend.some((d) => d.views > 0 || d.likes > 0);
    if (!hasData) {
      return (
        <div className="bg-zinc-950/40 border border-[#27272a] rounded p-8 text-center select-none">
          <BarChart3 className="w-5 h-5 text-zinc-600 mx-auto mb-2" />
          <p className="text-[11px] text-zinc-500 italic">No view data recorded yet.</p>
        </div>
      );
    }

    const maxViews = Math.max(5, ...trend.map((d) => d.views));
    const labelEvery = Math.max(1, Math.ceil(trend.length / 8));
    const barHeight = (v: number) => ({
      height: `${(v / maxViews) * 100}%`,
      minHeight: v > 0 ? 2 : 0,
    });

    return (
      <div className="bg-zinc-950/40 border border-[#27272a] rounded p-3.5 space-y-2 select-none">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-[10px] text-zinc-400">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-[#E11D48] inline-block" /> Total views
            </span>
          </div>
          <span className="text-[9px] text-zinc-600 font-mono">last 30 days · IST</span>
        </div>

        <div className="relative h-36">
          {[1, 0.75, 0.5, 0.25, 0].map((ratio) => (
            <div
              key={ratio}
              className="absolute left-0 right-0 border-t border-dashed border-[#27272a] pointer-events-none"
              style={{ top: `${(1 - ratio) * 100}%` }}
            >
              <span className="absolute -top-2 left-0 text-[8px] text-zinc-600 font-mono bg-[#09090b] pr-1">
                {formatCompact(Math.round(maxViews * ratio))}
              </span>
            </div>
          ))}

          <div className="absolute inset-0 pl-8 flex items-end gap-[3px] overflow-x-auto">
            {trend.map((d) => (
              <div
                key={d.date}
                className="flex-1 min-w-[10px] h-full flex items-end justify-center"
                title={`${formatDayLabel(d.date)} — ${d.views.toLocaleString()} views, ${d.likes.toLocaleString()} likes`}
              >
                <div
                  className="w-full max-w-[14px] rounded-sm bg-[#E11D48]/80 hover:bg-[#E11D48] transition-colors"
                  style={barHeight(d.views)}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="pl-8 flex gap-[3px] overflow-x-auto">
          {trend.map((d, i) => (
            <div key={d.date} className="flex-1 min-w-[10px] text-center text-[8px] text-zinc-600 font-mono truncate">
              {i % labelEvery === 0 ? formatDayLabel(d.date) : ""}
            </div>
          ))}
        </div>
      </div>
    );
  };

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
  const { totals } = data;

  const statCard = (label: string, value: string, accent: string, icon: React.ReactNode) => (
    <div key={label} className="bg-[#18181b]/10 border border-[#27272a] rounded p-4 space-y-1.5">
      <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <span className={`text-xl font-bold font-mono ${accent}`} title={Number(value.replace(/[^0-9.-]/g, "")).toLocaleString()}>
        {value}
      </span>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100">
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#27272a] pb-5">
          <div className="space-y-1">
            <p className="text-[10px] uppercase font-semibold tracking-widest text-zinc-500">Campaign Performance</p>
            <h1 className="text-xl font-bold tracking-tight">{data.campaign.title}</h1>
          </div>
          <a
            href={`/api/track/csv?code=${encodeURIComponent(activeCode || "")}`}
            className="inline-flex items-center gap-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-950 text-[11px] font-semibold px-3 py-1.5 rounded transition self-start sm:self-auto"
          >
            <Download size={12} />
            Download CSV
          </a>
        </div>

        {/* Big totals */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {statCard("Total Views", formatCompact(totals.views), "text-zinc-100", <Eye size={11} className="text-[#E11D48]" />)}
          {statCard("Total Likes", formatCompact(totals.likes), "text-zinc-100", <Heart size={11} className="text-[#E11D48]" />)}
          {statCard("Videos Tracked", totals.captured.toLocaleString(), "text-zinc-100", <Video size={11} className="text-[#E11D48]" />)}
          {statCard("Avg Views / Video", formatCompact(totals.avgViews), "text-zinc-100", <BarChart3 size={11} className="text-[#E11D48]" />)}
        </div>

        {/* Trend chart */}
        <div className="border border-[#27272a] rounded-md bg-[#09090b] p-5 space-y-4">
          <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2 border-b border-[#27272a] pb-3">
            <BarChart3 className="w-4 h-4 text-[#E11D48]" />
            Views Over Time
          </h3>
          {renderTrendChart()}
        </div>

        {/* Videos table */}
        <div className="border border-[#27272a] rounded-md bg-[#09090b] p-5 space-y-4">
          <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2 border-b border-[#27272a] pb-3">
            <Video className="w-4 h-4 text-[#E11D48]" />
            Posted Videos
            <span className="text-[10px] text-zinc-500 font-normal font-mono ml-auto">
              {data.videos.length.toLocaleString()} tracked
            </span>
          </h3>

          {data.videos.length === 0 ? (
            <p className="text-[11px] text-zinc-500 italic text-center py-6">
              No tracked videos yet — links appear here automatically after posts publish.
            </p>
          ) : (
            <div className="border border-[#27272a] rounded overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="bg-zinc-950/40 border-b border-[#27272a] text-zinc-500 text-[10px] uppercase font-bold">
                    <th className="px-3 py-2 font-semibold">Video</th>
                    <th className="px-3 py-2 font-semibold">Posted</th>
                    <th className="px-3 py-2 font-semibold text-right">Views</th>
                    <th className="px-3 py-2 font-semibold text-right">Likes</th>
                    <th className="px-3 py-2 font-semibold text-right hidden sm:table-cell">Comments</th>
                    <th className="px-3 py-2 font-semibold text-right hidden sm:table-cell">Shares</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#27272a] text-zinc-300">
                  {data.videos.map((v, i) => (
                    <tr key={`${v.url}-${i}`} className="hover:bg-zinc-950/20">
                      <td className="px-3 py-2.5">
                        <a
                          href={v.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 font-semibold hover:underline"
                        >
                          <ExternalLink size={11} />
                          Open on TikTok
                        </a>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-zinc-400 whitespace-nowrap">
                        {formatDateIST(v.publishedAt)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold text-zinc-100">
                        {v.views.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono">{v.likes.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-zinc-400 hidden sm:table-cell">
                        {v.comments.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-zinc-400 hidden sm:table-cell">
                        {v.shares.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-center text-[10px] text-zinc-600 pt-2">
          Live campaign tracking · Powered by <span className="font-semibold text-zinc-500">Sleeckos</span>
        </p>
      </div>
    </div>
  );
}
