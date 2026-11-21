"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Code2,
  Download,
  ExternalLink,
  Eye,
  Flame,
  Globe2,
  Heart,
  KeyRound,
  LayoutGrid,
  List,
  Loader2,
  LogOut,
  MapPin,
  RefreshCw,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
  Video,
} from "lucide-react";
import type {
  ClientPortalAccount,
  ClientPortalPayload,
  ClientStateDailyPoint,
  ClientStateVideo,
} from "@/lib/services/state-accounts/client-portal";
import PerformanceChart, { MiniSparkline } from "./PerformanceChart";
import ApiQuickstartModal from "./ApiQuickstartModal";

type Timeframe = 7 | 14 | 30 | "all";
type AccountViewMode = "cards" | "table";
type AccountSortKey =
  | "periodViews"
  | "followers"
  | "periodLikes"
  | "periodPosts"
  | "stateName";
type VideoSortKey = "views" | "publishedAt" | "likes" | "engagementRate";

const STATE_ACCENTS = [
  { bg: "bg-rose-500/12", border: "border-rose-500/25", text: "text-rose-300", hex: "#fb7185" },
  { bg: "bg-blue-500/12", border: "border-blue-500/25", text: "text-blue-300", hex: "#60a5fa" },
  { bg: "bg-emerald-500/12", border: "border-emerald-500/25", text: "text-emerald-300", hex: "#34d399" },
  { bg: "bg-violet-500/12", border: "border-violet-500/25", text: "text-violet-300", hex: "#a78bfa" },
  { bg: "bg-amber-500/12", border: "border-amber-500/25", text: "text-amber-300", hex: "#fbbf24" },
  { bg: "bg-cyan-500/12", border: "border-cyan-500/25", text: "text-cyan-300", hex: "#22d3ee" },
  { bg: "bg-fuchsia-500/12", border: "border-fuchsia-500/25", text: "text-fuchsia-300", hex: "#e879f9" },
  { bg: "bg-teal-500/12", border: "border-teal-500/25", text: "text-teal-300", hex: "#2dd4bf" },
];

function stateAccent(key: string) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return STATE_ACCENTS[hash % STATE_ACCENTS.length];
}

function monogram(acc: { stateCode: string | null; stateName: string }) {
  if (acc.stateCode) return acc.stateCode;
  const words = acc.stateName.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return acc.stateName.slice(0, 2).toUpperCase();
}

function formatCompact(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(2)}K`;
  return n.toLocaleString("en-US");
}

function formatRelative(iso: string | null): string {
  if (!iso) return "Awaiting sync";
  const diffMs = Date.now() - Date.parse(iso);
  if (diffMs < 60_000) return "Just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDateTz(iso: string, timezone: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }
}

function formatDateTimeTz(iso: string, timezone: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return new Date(iso).toLocaleString("en-US");
  }
}

function videoTail(url: string): string {
  const m = url.match(/\/video\/(\d+)/);
  const id = m ? m[1] : url.replace(/\D/g, "");
  return id ? `…${id.slice(-7)}` : "Watch";
}

function computeWindowWoW(
  daily: ClientStateDailyPoint[],
  currentDayDate: string | null,
): number | null {
  const completed = daily.filter(
    (d) => d.date !== currentDayDate && d.metricsObserved,
  );
  if (completed.length < 6) return null;
  const recent = completed.slice(-7);
  const prior = completed.slice(-14, -7);
  if (recent.length < 3 || prior.length < 3) return null;
  const rAvg = recent.reduce((s, d) => s + d.viewsGained, 0) / recent.length;
  const pAvg = prior.reduce((s, d) => s + d.viewsGained, 0) / prior.length;
  if (pAvg <= 0) return null;
  return Math.round((rAvg / pAvg - 1) * 1000) / 10;
}

function MomentumPill({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const positive = pct >= 0;
  return (
    <span
      title="Week-over-week change in average daily views"
      className={`inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums ${
        positive
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
          : "border-amber-500/25 bg-amber-500/10 text-amber-300"
      }`}
    >
      {positive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
      {positive ? "+" : ""}
      {pct.toFixed(1)}%
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Client Portal Shell (Access Gate → Skeleton → Dashboard)
// ─────────────────────────────────────────────────────────────────────────────

export default function StatePortalClient({
  initialData = null,
  initialCode = null,
  directLink = false,
  invalidLink = false,
}: {
  initialData?: ClientPortalPayload | null;
  initialCode?: string | null;
  directLink?: boolean;
  invalidLink?: boolean;
}) {
  const [codeInput, setCodeInput] = useState(initialCode ?? "");
  const [activeCode, setActiveCode] = useState<string | null>(initialCode);
  const [data, setData] = useState<ClientPortalPayload | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [submitted, setSubmitted] = useState(Boolean(initialData));
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setOrigin(window.location.origin);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const lookup = useCallback(
    async (rawCode: string, isRefresh = false) => {
      const trimmed = rawCode.trim().toUpperCase();
      if (!trimmed) return;
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
        setSubmitted(true);
        setError(null);
      }

      try {
        const res = await fetch("/api/state-portal/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: trimmed }),
          cache: "no-store",
        });
        if (res.status === 404) {
          if (!isRefresh) {
            setData(null);
            setActiveCode(null);
          }
          setError(
            "This report link is invalid, revoked, or expired. Double-check the link shared with you.",
          );
          return;
        }
        if (res.status === 429) {
          setError("Too many requests — please wait a minute and try again.");
          return;
        }
        if (!res.ok) throw new Error("Lookup failed");
        const payload: ClientPortalPayload = await res.json();
        setData(payload);
        setActiveCode(trimmed);
        setOrigin(window.location.origin);
        setError(null);
        if (!directLink) {
          window.history.replaceState(
            null,
            "",
            `/state-accounts/${encodeURIComponent(trimmed)}`,
          );
        }
      } catch {
        setError("Could not load live performance data. Please try again.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [directLink],
  );

  // Auto-unlock legacy #CODE or ?code=CODE links by upgrading straight to /state-accounts/CODE
  useEffect(() => {
    if (initialData || invalidLink) return;
    const hash = window.location.hash.replace(/^#/, "").trim();
    const queryCode = new URLSearchParams(window.location.search)
      .get("code")
      ?.trim();
    const initial = hash || queryCode || "";
    if (!initial) return;
    const timer = setTimeout(() => {
      setCodeInput(initial.toUpperCase());
      void lookup(initial);
    }, 0);
    return () => clearTimeout(timer);
  }, [initialData, invalidLink, lookup]);

  const handleSignOut = () => {
    setData(null);
    setActiveCode(null);
    setCodeInput("");
    setSubmitted(false);
    setError(null);
    window.history.replaceState(null, "", "/state-accounts");
  };

  // Invalid / Revoked Direct Link Notice (no login prompt)
  if (invalidLink) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#07070a] px-4 py-12 text-zinc-100">
        <div
          className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full opacity-25 blur-[120px]"
          style={{
            background:
              "radial-gradient(circle, rgba(225,29,72,0.4) 0%, rgba(37,99,235,0.2) 55%, transparent 100%)",
          }}
        />
        <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/[0.09] bg-[#0c0c10]/90 p-7 text-center shadow-2xl backdrop-blur-xl">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-rose-500/25 bg-rose-500/10 text-rose-400">
            <AlertTriangle size={18} />
          </div>
          <h1 className="text-lg font-semibold tracking-tight text-white">
            Report Link Unavailable
          </h1>
          <p className="mt-2 text-xs leading-relaxed text-zinc-400">
            This client dashboard link is no longer active or has expired.
            Please ask your SleeckOS contact for an updated link.
          </p>
        </div>
      </div>
    );
  }

  // Loading Skeleton
  if (loading && submitted && !data && !error) {
    return (
      <div className="min-h-screen bg-[#07070a] text-zinc-100">
        <div className="border-b border-white/[0.06] bg-[#07070a]/90">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
            <div className="space-y-2 animate-pulse">
              <div className="h-3 w-36 rounded bg-white/[0.06]" />
              <div className="h-6 w-64 rounded bg-white/[0.08]" />
            </div>
            <div className="h-9 w-48 rounded-lg bg-white/[0.06] animate-pulse" />
          </div>
        </div>
        <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 animate-pulse">
          <div className="flex gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-9 w-28 rounded-full bg-white/[0.05]" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-32 rounded-2xl border border-white/[0.06] bg-[#0c0c10]"
              />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="h-80 rounded-2xl border border-white/[0.06] bg-[#0c0c10] lg:col-span-8" />
            <div className="h-80 rounded-2xl border border-white/[0.06] bg-[#0c0c10] lg:col-span-4" />
          </div>
        </div>
      </div>
    );
  }

  // Access Gate
  if (!data || !activeCode) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#07070a] px-4 py-12 text-zinc-100">
        {/* Subtle ambient architectural lighting */}
        <div
          className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full opacity-30 blur-[120px]"
          style={{
            background:
              "radial-gradient(circle, rgba(225,29,72,0.45) 0%, rgba(37,99,235,0.22) 55%, transparent 100%)",
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage:
              "radial-gradient(rgba(255,255,255,0.12) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />

        <div className="relative z-10 w-full max-w-md space-y-7">
          <div className="space-y-3 text-center">
            <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/[0.09] bg-white/[0.03] px-3 py-1 text-[11px] font-medium text-zinc-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              SleeckOS · State Accounts Portal
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              State Network Analytics
            </h1>
            <p className="mx-auto max-w-sm text-sm leading-relaxed text-zinc-400">
              Enter your private client access code to view live reach, follower
              growth, and published TikTok results across your state accounts.
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              lookup(codeInput);
            }}
            className="rounded-2xl border border-white/[0.09] bg-[#0c0c10]/90 p-6 shadow-2xl backdrop-blur-xl"
          >
            <label
              htmlFor="state-access-code"
              className="block text-[11px] font-semibold uppercase tracking-widest text-zinc-400"
            >
              Client Access Code
            </label>
            <div className="relative mt-2">
              <KeyRound
                size={15}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500"
              />
              <input
                id="state-access-code"
                type="text"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                placeholder="e.g. K7X9M2P4QW"
                autoFocus
                autoCapitalize="characters"
                spellCheck={false}
                className="w-full rounded-xl border border-white/10 bg-[#07070a] py-3 pl-10 pr-4 font-mono text-sm uppercase tracking-[0.2em] text-white placeholder:tracking-normal placeholder:text-zinc-600 focus:border-rose-500/60 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2.5 rounded-xl border border-rose-500/25 bg-rose-950/30 p-3 text-xs leading-relaxed text-rose-300"
              >
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !codeInput.trim()}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-xs font-semibold text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Verifying access…
                </>
              ) : (
                <>
                  Open Live Dashboard
                  <ArrowUpRight size={14} />
                </>
              )}
            </button>
          </form>

          <div className="flex items-center justify-center gap-4 text-[11px] text-zinc-500">
            <span>Hourly synced metrics</span>
            <span className="text-zinc-700">·</span>
            <span>Read-only client report</span>
            <span className="text-zinc-700">·</span>
            <span className="font-medium text-zinc-400">SleeckOS</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ExecutiveDashboard
      data={data}
      activeCode={activeCode}
      origin={origin}
      refreshing={refreshing}
      onRefresh={() => lookup(activeCode, true)}
      onSignOut={directLink ? undefined : handleSignOut}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Executive Dashboard
// ─────────────────────────────────────────────────────────────────────────────

function ExecutiveDashboard({
  data,
  activeCode,
  origin,
  refreshing,
  onRefresh,
  onSignOut,
}: {
  data: ClientPortalPayload;
  activeCode: string;
  origin: string;
  refreshing: boolean;
  onRefresh: () => void;
  onSignOut?: () => void;
}) {
  const isSingleAccountShare = data.accounts.length === 1;
  const [selectedSlug, setSelectedSlug] = useState<string | null>(
    isSingleAccountShare ? data.accounts[0].slug : null,
  );
  const [timeframe, setTimeframe] = useState<Timeframe>(7);
  const [accountView, setAccountView] = useState<AccountViewMode>("cards");
  const [accountSort, setAccountSort] = useState<{
    key: AccountSortKey;
    dir: "asc" | "desc";
  }>({ key: "periodViews", dir: "desc" });
  const [apiModalOpen, setApiModalOpen] = useState(false);

  const effectiveSlug = isSingleAccountShare
    ? data.accounts[0].slug
    : selectedSlug && data.accounts.some((a) => a.slug === selectedSlug)
      ? selectedSlug
      : null;

  const currentDayDate = useMemo(
    () => data.days.find((d) => d.isCurrentDay)?.date ?? null,
    [data.days],
  );

  // Slice reporting days to active timeframe
  const activeDaySlice = useMemo(() => {
    if (timeframe === "all") return data.days;
    return data.days.slice(-timeframe);
  }, [data.days, timeframe]);

  const activeDateSet = useMemo(
    () => new Set(activeDaySlice.map((d) => d.date)),
    [activeDaySlice],
  );

  const windowStartIso = activeDaySlice[0]?.startsAt ?? null;

  // Enrich each account with timeframe-sliced period metrics
  const enrichedAccounts = useMemo(() => {
    return data.accounts.map((acc) => {
      const slicedDaily =
        timeframe === "all"
          ? acc.daily
          : acc.daily.filter((d) => activeDateSet.has(d.date));
      const periodViews = slicedDaily.reduce((s, d) => s + d.viewsGained, 0);
      const periodLikes = slicedDaily.reduce((s, d) => s + d.likesGained, 0);
      const periodFollowerGrowth = slicedDaily.reduce(
        (s, d) => s + d.followerGrowth,
        0,
      );
      const periodPosts = slicedDaily.reduce((s, d) => s + d.posts, 0);
      const hasFollowerObs = slicedDaily.some((d) => d.followersObserved);
      const latestPt = slicedDaily[slicedDaily.length - 1] ?? null;
      return {
        ...acc,
        slicedDaily,
        periodViews,
        periodLikes,
        periodFollowerGrowth,
        periodPosts,
        hasFollowerObs,
        todayViews: latestPt?.viewsGained ?? 0,
        todayPosts: latestPt?.posts ?? 0,
      };
    });
  }, [data.accounts, timeframe, activeDateSet]);

  const activeAccount = useMemo(
    () =>
      effectiveSlug
        ? enrichedAccounts.find((a) => a.slug === effectiveSlug) ?? null
        : null,
    [enrichedAccounts, effectiveSlug],
  );

  // Active scoped accounts (either 1 selected state or all authorized)
  const scopedAccounts = useMemo(
    () => (activeAccount ? [activeAccount] : enrichedAccounts),
    [activeAccount, enrichedAccounts],
  );

  // Aggregated daily series for chart (matching timeframe)
  const chartDaily = useMemo<ClientStateDailyPoint[]>(() => {
    if (activeAccount) return activeAccount.slicedDaily;
    return activeDaySlice.map((dm) => {
      let viewsGained = 0;
      let likesGained = 0;
      let followerGrowth = 0;
      let posts = 0;
      let metricsObserved = false;
      let followersObserved = false;
      for (const acc of scopedAccounts) {
        const pt = acc.daily.find((d) => d.date === dm.date);
        if (!pt) continue;
        viewsGained += pt.viewsGained;
        likesGained += pt.likesGained;
        followerGrowth += pt.followerGrowth;
        posts += pt.posts;
        metricsObserved ||= pt.metricsObserved;
        followersObserved ||= pt.followersObserved;
      }
      return {
        date: dm.date,
        viewsGained,
        likesGained,
        followerGrowth,
        posts,
        metricsObserved,
        followersObserved,
      };
    });
  }, [activeAccount, activeDaySlice, scopedAccounts]);

  // Full daily series (for accurate WoW even when viewing 7D)
  const fullScopedDaily = useMemo<ClientStateDailyPoint[]>(() => {
    if (activeAccount) return activeAccount.daily;
    return data.days.map((dm) => {
      let viewsGained = 0;
      let likesGained = 0;
      let followerGrowth = 0;
      let posts = 0;
      let metricsObserved = false;
      let followersObserved = false;
      for (const acc of scopedAccounts) {
        const pt = acc.daily.find((d) => d.date === dm.date);
        if (!pt) continue;
        viewsGained += pt.viewsGained;
        likesGained += pt.likesGained;
        followerGrowth += pt.followerGrowth;
        posts += pt.posts;
        metricsObserved ||= pt.metricsObserved;
        followersObserved ||= pt.followersObserved;
      }
      return {
        date: dm.date,
        viewsGained,
        likesGained,
        followerGrowth,
        posts,
        metricsObserved,
        followersObserved,
      };
    });
  }, [activeAccount, data.days, scopedAccounts]);

  // Hero KPI rollup
  const hero = useMemo(() => {
    const trackedVideos = scopedAccounts.reduce(
      (s, a) => s + a.trackedVideos,
      0,
    );
    const followersKnown = scopedAccounts.some((a) => a.followers !== null);
    const followers = scopedAccounts.reduce(
      (s, a) => s + (a.followers ?? 0),
      0,
    );
    const periodViews = scopedAccounts.reduce((s, a) => s + a.periodViews, 0);
    const periodLikes = scopedAccounts.reduce((s, a) => s + a.periodLikes, 0);
    const periodFollowerGrowth = scopedAccounts.reduce(
      (s, a) => s + a.periodFollowerGrowth,
      0,
    );
    const hasFollowerObs = scopedAccounts.some((a) => a.hasFollowerObs);
    const periodPosts = scopedAccounts.reduce((s, a) => s + a.periodPosts, 0);
    const todayViews = scopedAccounts.reduce((s, a) => s + a.todayViews, 0);
    const todayPosts = scopedAccounts.reduce((s, a) => s + a.todayPosts, 0);
    const periodEngagementRate =
      periodViews > 0
        ? Math.round((periodLikes / periodViews) * 10000) / 100
        : 0;
    const dailyAvgViews =
      chartDaily.length > 0 ? Math.round(periodViews / chartDaily.length) : 0;
    const wowPct = computeWindowWoW(fullScopedDaily, currentDayDate);

    return {
      trackedVideos,
      followersKnown,
      followers,
      periodViews,
      periodLikes,
      periodFollowerGrowth,
      hasFollowerObs,
      periodPosts,
      todayViews,
      todayPosts,
      periodEngagementRate,
      dailyAvgViews,
      wowPct,
    };
  }, [scopedAccounts, chartDaily.length, fullScopedDaily, currentDayDate]);

  // Scoped videos
  const scopedVideos = useMemo(
    () =>
      activeAccount
        ? data.videos.filter((v) => v.accountId === activeAccount.id)
        : data.videos,
    [data.videos, activeAccount],
  );

  // Sorted accounts for grid/table
  const sortedAccounts = useMemo(() => {
    const dir = accountSort.dir === "desc" ? -1 : 1;
    return [...enrichedAccounts].sort((a, b) => {
      if (accountSort.key === "stateName") {
        return dir * a.stateName.localeCompare(b.stateName);
      }
      const va =
        accountSort.key === "followers"
          ? a.followers ?? -1
          : a[accountSort.key];
      const vb =
        accountSort.key === "followers"
          ? b.followers ?? -1
          : b[accountSort.key];
      return dir * (va - vb);
    });
  }, [enrichedAccounts, accountSort]);

  // Top states leaderboard (sorted by views gained in active timeframe)
  const leaderboard = useMemo(() => {
    const ranked = [...enrichedAccounts].sort(
      (a, b) => b.periodViews - a.periodViews || (b.followers ?? 0) - (a.followers ?? 0),
    );
    const maxVal = Math.max(1, ...ranked.map((r) => r.periodViews));
    const totalSum = ranked.reduce((s, r) => s + r.periodViews, 0);
    return { ranked, maxVal, totalSum };
  }, [enrichedAccounts]);

  const toggleAccountSort = (key: AccountSortKey) => {
    setAccountSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { key, dir: key === "stateName" ? "asc" : "desc" },
    );
  };

  const timeframeTitle =
    timeframe === "all" ? "All-Time" : `${timeframe}-Day`;
  const timeframeShort =
    timeframe === "all" ? "All" : `${timeframe}D`;
  const timeframeLabel =
    timeframe === "all" ? `All ${data.days.length}d` : `Last ${timeframe}d`;

  const csvUrl = `/api/state-portal/csv?code=${encodeURIComponent(activeCode)}${
    activeAccount ? `&state=${encodeURIComponent(activeAccount.slug)}` : ""
  }`;

  return (
    <div className="relative min-h-screen bg-[#07070a] text-zinc-100">
      {/* Subtle top ambient radiance */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 h-80 opacity-20"
        style={{
          background:
            "radial-gradient(ellipse 65% 50% at 50% -15%, rgba(225,29,72,0.55), rgba(37,99,235,0.18) 55%, transparent 100%)",
        }}
      />

      {/* Sticky Executive Navigation Header */}
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#07070a]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3.5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-rose-500/25 bg-gradient-to-br from-rose-500/20 to-blue-600/15 text-rose-400">
              <Globe2 size={17} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  SleeckOS · State Network
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span
                    suppressHydrationWarning
                    title={
                      data.dataUpdatedAt
                        ? `Last synced ${formatDateTimeTz(data.dataUpdatedAt, data.timezone)} (${data.timezone})`
                        : "Hourly sync active"
                    }
                  >
                    {formatRelative(data.dataUpdatedAt)}
                  </span>
                </span>
              </div>
              <h1 className="truncate text-base font-semibold tracking-tight text-white sm:text-lg">
                {data.scope.title}
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Timeframe Switcher */}
            <div
              className="inline-flex items-center rounded-xl border border-white/[0.08] bg-[#0c0c10] p-0.5"
              role="group"
              aria-label="Reporting timeframe"
            >
              {([7, 14, 30, "all"] as Timeframe[]).map((tf) => (
                <button
                  key={String(tf)}
                  type="button"
                  onClick={() => setTimeframe(tf)}
                  className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition ${
                    timeframe === tf
                      ? "bg-white text-zinc-950 shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <span className="sm:hidden">
                    {tf === "all" ? "All" : `${tf}D`}
                  </span>
                  <span className="hidden sm:inline">
                    {tf === "all" ? "All" : `${tf} Days`}
                  </span>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setApiModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.09] bg-[#0c0c10] px-3 py-2 text-xs font-medium text-zinc-300 transition hover:border-white/20 hover:text-white"
              title="View REST API endpoints & code snippets"
            >
              <Code2 size={13} className="text-rose-400" />
              API
            </button>

            <a
              href={csvUrl}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-rose-500"
            >
              <Download size={13} />
              <span className="hidden sm:inline">Export CSV</span>
              <span className="sm:hidden">CSV</span>
            </a>

            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/[0.09] bg-[#0c0c10] text-zinc-400 transition hover:border-white/20 hover:text-white disabled:opacity-50"
              title="Refresh live data"
              aria-label="Refresh live data"
            >
              <RefreshCw
                size={13}
                className={refreshing ? "animate-spin" : ""}
              />
            </button>

            {onSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/[0.09] bg-[#0c0c10] text-zinc-500 transition hover:border-white/20 hover:text-zinc-200"
                title="Switch access code"
                aria-label="Switch access code"
              >
                <LogOut size={13} />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        {/* Empty network safeguard */}
        {data.accounts.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.07] bg-[#0c0c10] p-12 text-center">
            <MapPin className="mx-auto mb-3 h-7 w-7 text-zinc-600" />
            <h2 className="text-base font-semibold text-zinc-200">
              No active state accounts in this report yet
            </h2>
            <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-zinc-500">
              Once accounts in your scope are linked and synced, live metrics
              and video results will appear here automatically.
            </p>
          </div>
        ) : (
          <>
            {/* Interactive State Account Ribbon (when multiple states authorized) */}
            {!isSingleAccountShare && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                <button
                  type="button"
                  onClick={() => setSelectedSlug(null)}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-medium transition ${
                    selectedSlug === null
                      ? "border-white/25 bg-white text-zinc-950 shadow-sm"
                      : "border-white/[0.08] bg-[#0c0c10] text-zinc-300 hover:border-white/20 hover:text-white"
                  }`}
                >
                  <Globe2 size={13} />
                  All States
                  <span
                    className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] ${
                      selectedSlug === null
                        ? "bg-zinc-950/15 text-zinc-900"
                        : "bg-white/[0.06] text-zinc-400"
                    }`}
                  >
                    {enrichedAccounts.length}
                  </span>
                </button>

                {enrichedAccounts.map((acc) => {
                  const selected = selectedSlug === acc.slug;
                  const accent = stateAccent(acc.slug);
                  return (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() =>
                        setSelectedSlug(selected ? null : acc.slug)
                      }
                      className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        selected
                          ? "border-rose-500/50 bg-rose-500/15 text-white shadow-sm"
                          : "border-white/[0.07] bg-[#0c0c10] text-zinc-300 hover:border-white/20 hover:text-white"
                      }`}
                    >
                      <span
                        className={`inline-flex h-5 w-5 items-center justify-center rounded-full border font-mono text-[9px] font-bold ${accent.bg} ${accent.border} ${accent.text}`}
                      >
                        {monogram(acc)}
                      </span>
                      <span>{acc.stateName}</span>
                      <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
                        {formatCompact(acc.periodViews)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Single State Focus Banner */}
            {activeAccount && (
              <section className="relative overflow-hidden rounded-2xl border border-white/[0.09] bg-gradient-to-r from-[#111118] via-[#0c0c11] to-[#0c0c10] p-5 sm:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    {!isSingleAccountShare && (
                      <button
                        type="button"
                        onClick={() => setSelectedSlug(null)}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-300 transition hover:bg-white/[0.09] hover:text-white"
                        title="Back to all states"
                        aria-label="Back to all states"
                      >
                        <ArrowLeft size={15} />
                      </button>
                    )}
                    <div
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border font-mono text-base font-bold ${
                        stateAccent(activeAccount.slug).bg
                      } ${stateAccent(activeAccount.slug).border} ${
                        stateAccent(activeAccount.slug).text
                      }`}
                    >
                      {monogram(activeAccount)}
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2.5">
                        <h2 className="text-xl font-semibold tracking-tight text-white">
                          {activeAccount.stateName}
                        </h2>
                        <MomentumPill pct={activeAccount.weekOverWeekViewsPct} />
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-zinc-400">
                        {activeAccount.profileUrl ? (
                          <a
                            href={activeAccount.profileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-zinc-300 transition hover:text-rose-300"
                          >
                            @{activeAccount.username}
                            <ExternalLink size={11} />
                          </a>
                        ) : (
                          <span className="font-mono">
                            @{activeAccount.username}
                          </span>
                        )}
                        <span className="text-zinc-700">·</span>
                        <span suppressHydrationWarning>
                          Synced {formatRelative(activeAccount.lastSyncAt)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-6 border-t border-white/[0.06] pt-3 sm:border-t-0 sm:pt-0">
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                        Daily Avg ({timeframeShort})
                      </p>
                      <p className="mt-0.5 font-mono text-base font-semibold text-zinc-100 tabular-nums">
                        {formatCompact(
                          activeAccount.slicedDaily.length > 0
                            ? Math.round(
                                activeAccount.periodViews /
                                  activeAccount.slicedDaily.length,
                              )
                            : 0,
                        )}
                        /day
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                        Profile Likes
                      </p>
                      <p className="mt-0.5 font-mono text-base font-semibold text-zinc-100 tabular-nums">
                        {formatCompact(activeAccount.profileLikes)}
                      </p>
                    </div>
                    {activeAccount.profileUrl && (
                      <a
                        href={activeAccount.profileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2 text-xs font-medium text-zinc-200 transition hover:bg-white/[0.1] hover:text-white"
                      >
                        View on TikTok
                        <ArrowUpRight size={13} />
                      </a>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* Executive Hero KPI Bento Row */}
            <section
              aria-label="Key performance indicators"
              className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4"
            >
              {/* Primary featured metric: Period Views Gained */}
              <div className="relative overflow-hidden rounded-2xl border border-rose-500/25 bg-gradient-to-b from-rose-500/[0.08] via-[#0c0c10] to-[#0c0c10] p-5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-rose-300/90">
                    <Eye size={12} />
                    {timeframeTitle} Views
                  </span>
                  <MomentumPill pct={hero.wowPct} />
                </div>
                <p
                  className="mt-3 font-mono text-3xl font-bold tracking-tight text-white tabular-nums"
                  title={hero.periodViews.toLocaleString("en-US")}
                >
                  {formatCompact(hero.periodViews)}
                </p>
                <p className="mt-2 text-[11px] text-zinc-400">
                  <span className="font-mono text-zinc-200 tabular-nums">
                    {formatCompact(hero.dailyAvgViews)}
                  </span>
                  /day avg ·{" "}
                  <span className="font-mono text-emerald-300 tabular-nums">
                    +{formatCompact(hero.todayViews)}
                  </span>{" "}
                  today
                </p>
              </div>

              <KpiCard
                label="Audience Followers"
                icon={<Users size={12} className="text-emerald-400" />}
                value={
                  hero.followersKnown ? formatCompact(hero.followers) : "—"
                }
                exact={
                  hero.followersKnown
                    ? hero.followers.toLocaleString("en-US")
                    : undefined
                }
                sub={
                  hero.hasFollowerObs ? (
                    <>
                      <span
                        className={`font-mono tabular-nums ${
                          hero.periodFollowerGrowth >= 0
                            ? "text-emerald-300"
                            : "text-amber-300"
                        }`}
                      >
                        {hero.periodFollowerGrowth >= 0 ? "+" : ""}
                        {formatCompact(hero.periodFollowerGrowth)}
                      </span>{" "}
                      net in {timeframeLabel.toLowerCase()}
                    </>
                  ) : (
                    <>
                      Across {scopedAccounts.length}{" "}
                      {scopedAccounts.length === 1 ? "account" : "accounts"}
                    </>
                  )
                }
              />

              <KpiCard
                label={`${timeframeTitle} Likes`}
                icon={<Heart size={12} className="text-violet-400" />}
                value={formatCompact(hero.periodLikes)}
                exact={hero.periodLikes.toLocaleString("en-US")}
                prefix={hero.periodLikes > 0 ? "+" : ""}
                sub={
                  <>
                    <span className="font-mono text-zinc-200 tabular-nums">
                      {hero.periodEngagementRate.toFixed(2)}%
                    </span>{" "}
                    like rate in {timeframeLabel.toLowerCase()}
                  </>
                }
              />

              <KpiCard
                label={`${timeframeTitle} Posts`}
                icon={<Video size={12} className="text-blue-400" />}
                value={hero.periodPosts.toLocaleString("en-US")}
                sub={
                  <>
                    <span className="font-mono text-blue-300 tabular-nums">
                      {hero.todayPosts}
                    </span>{" "}
                    today ·{" "}
                    <span className="font-mono text-zinc-300 tabular-nums">
                      {hero.trackedVideos.toLocaleString("en-US")}
                    </span>{" "}
                    tracked
                  </>
                }
              />
            </section>

            {/* Primary Analytics Grid: Interactive Chart + Leaderboard / Spotlight */}
            <section className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              <div className="lg:col-span-8">
                <PerformanceChart
                  daily={chartDaily}
                  timezone={data.timezone}
                  title={
                    activeAccount
                      ? `${activeAccount.stateName} Performance Trend`
                      : "Network Performance Trend"
                  }
                  currentDayDate={currentDayDate}
                />
              </div>

              <div className="lg:col-span-4">
                {activeAccount ? (
                  <TopVideosSpotlight
                    videos={scopedVideos}
                    timezone={data.timezone}
                    stateName={activeAccount.stateName}
                  />
                ) : (
                  <StateLeaderboardPanel
                    ranked={leaderboard.ranked}
                    maxVal={leaderboard.maxVal}
                    totalSum={leaderboard.totalSum}
                    timeframeTitle={timeframeTitle}
                    onSelectState={(slug) => setSelectedSlug(slug)}
                  />
                )}
              </div>
            </section>

            {/* State Accounts Breakdown (Cards with Sparklines OR Comparison Table) */}
            {!activeAccount && enrichedAccounts.length > 1 && (
              <section className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold tracking-tight text-white">
                      State Accounts Breakdown
                    </h2>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      Click any state account to inspect its individual trend
                      and published content.
                    </p>
                  </div>

                  <div className="inline-flex items-center rounded-xl border border-white/[0.08] bg-[#0c0c10] p-0.5">
                    <button
                      type="button"
                      onClick={() => setAccountView("cards")}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                        accountView === "cards"
                          ? "bg-zinc-800 text-white"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      <LayoutGrid size={13} />
                      Cards
                    </button>
                    <button
                      type="button"
                      onClick={() => setAccountView("table")}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                        accountView === "table"
                          ? "bg-zinc-800 text-white"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      <List size={13} />
                      Table
                    </button>
                  </div>
                </div>

                {accountView === "cards" ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {sortedAccounts.map((acc) => {
                      const accent = stateAccent(acc.slug);
                      return (
                        <div
                          key={acc.id}
                          onClick={() => setSelectedSlug(acc.slug)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedSlug(acc.slug);
                            }
                          }}
                          className="group flex cursor-pointer flex-col justify-between rounded-2xl border border-white/[0.07] bg-[#0c0c10] p-5 transition duration-200 hover:-translate-y-0.5 hover:border-white/[0.18] hover:bg-[#101016] focus:outline-none focus:ring-2 focus:ring-rose-500/40"
                        >
                          <div>
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-3">
                                <div
                                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border font-mono text-xs font-bold ${accent.bg} ${accent.border} ${accent.text}`}
                                >
                                  {monogram(acc)}
                                </div>
                                <div className="min-w-0">
                                  <h3 className="truncate text-sm font-semibold text-white group-hover:text-rose-200 transition-colors">
                                    {acc.stateName}
                                  </h3>
                                  <p className="truncate font-mono text-[11px] text-zinc-500">
                                    @{acc.username}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <MomentumPill pct={acc.weekOverWeekViewsPct} />
                                <ArrowUpRight
                                  size={14}
                                  className="text-zinc-600 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-zinc-300"
                                />
                              </div>
                            </div>

                            {/* Mini Sparkline */}
                            <div className="mt-4 rounded-xl border border-white/[0.04] bg-zinc-950/60 px-3 py-2.5">
                              <div className="mb-1 flex items-center justify-between text-[10px]">
                                <span className="text-zinc-500">
                                  Views gained ({timeframeLabel})
                                </span>
                                <span className="font-mono font-semibold text-zinc-200 tabular-nums">
                                  +{formatCompact(acc.periodViews)}
                                </span>
                              </div>
                              <MiniSparkline
                                values={acc.slicedDaily.map((d) => d.viewsGained)}
                                color={accent.hex}
                              />
                            </div>
                          </div>

                          {/* Card Footer Metrics */}
                          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/[0.06] pt-3.5">
                            <div>
                              <p className="text-[10px] text-zinc-500">
                                Followers
                              </p>
                              <p className="mt-0.5 font-mono text-sm font-semibold text-zinc-100 tabular-nums">
                                {formatCompact(acc.followers)}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-zinc-500">
                                Likes ({timeframeShort})
                              </p>
                              <p className="mt-0.5 font-mono text-sm font-semibold text-zinc-100 tabular-nums">
                                +{formatCompact(acc.periodLikes)}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-zinc-500">
                                Posts ({timeframeShort})
                              </p>
                              <p className="mt-0.5 font-mono text-sm font-semibold text-zinc-100 tabular-nums">
                                {acc.periodPosts}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0c0c10]">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[740px] text-left text-xs">
                        <thead>
                          <tr className="border-b border-white/[0.06] bg-white/[0.02] text-[10px] uppercase tracking-wider text-zinc-500">
                            <SortableTh
                              label="State Account"
                              active={accountSort.key === "stateName"}
                              dir={accountSort.dir}
                              onClick={() => toggleAccountSort("stateName")}
                            />
                            <SortableTh
                              label={`${timeframeTitle} Views`}
                              alignRight
                              active={accountSort.key === "periodViews"}
                              dir={accountSort.dir}
                              onClick={() => toggleAccountSort("periodViews")}
                            />
                            <SortableTh
                              label="Followers"
                              alignRight
                              active={accountSort.key === "followers"}
                              dir={accountSort.dir}
                              onClick={() => toggleAccountSort("followers")}
                            />
                            <SortableTh
                              label={`Likes (${timeframeShort})`}
                              alignRight
                              active={accountSort.key === "periodLikes"}
                              dir={accountSort.dir}
                              onClick={() => toggleAccountSort("periodLikes")}
                            />
                            <SortableTh
                              label={`Posts (${timeframeShort})`}
                              alignRight
                              active={accountSort.key === "periodPosts"}
                              dir={accountSort.dir}
                              onClick={() => toggleAccountSort("periodPosts")}
                            />
                            <th className="px-4 py-3 text-right font-semibold">
                              WoW
                            </th>
                            <th className="px-4 py-3 text-right font-semibold">
                              Synced
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.05]">
                          {sortedAccounts.map((acc) => {
                            const accent = stateAccent(acc.slug);
                            return (
                              <tr
                                key={acc.id}
                                onClick={() => setSelectedSlug(acc.slug)}
                                className="cursor-pointer transition hover:bg-white/[0.03]"
                              >
                                <td className="px-4 py-3.5">
                                  <div className="flex items-center gap-2.5">
                                    <span
                                      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border font-mono text-[10px] font-bold ${accent.bg} ${accent.border} ${accent.text}`}
                                    >
                                      {monogram(acc)}
                                    </span>
                                    <div>
                                      <p className="font-semibold text-zinc-100">
                                        {acc.stateName}
                                      </p>
                                      <p className="font-mono text-[10px] text-zinc-500">
                                        @{acc.username}
                                      </p>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-3.5 text-right font-mono font-semibold text-white tabular-nums">
                                  {acc.periodViews.toLocaleString("en-US")}
                                </td>
                                <td className="px-4 py-3.5 text-right font-mono text-zinc-200 tabular-nums">
                                  {acc.followers !== null
                                    ? acc.followers.toLocaleString("en-US")
                                    : "—"}
                                </td>
                                <td className="px-4 py-3.5 text-right font-mono text-zinc-300 tabular-nums">
                                  +{acc.periodLikes.toLocaleString("en-US")}
                                </td>
                                <td className="px-4 py-3.5 text-right font-mono text-zinc-300 tabular-nums">
                                  {acc.periodPosts}
                                </td>
                                <td className="px-4 py-3.5 text-right">
                                  <div className="inline-flex justify-end">
                                    <MomentumPill
                                      pct={acc.weekOverWeekViewsPct}
                                    />
                                    {acc.weekOverWeekViewsPct === null && (
                                      <span className="font-mono text-zinc-600">
                                        —
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td
                                  suppressHydrationWarning
                                  className="px-4 py-3.5 text-right text-[11px] text-zinc-500"
                                >
                                  {formatRelative(acc.lastSyncAt)}
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
            )}

            {/* Published Content Explorer */}
            <VideosExplorer
              videos={scopedVideos}
              accounts={data.accounts}
              showStateFilter={!activeAccount && data.accounts.length > 1}
              timezone={data.timezone}
              windowStartIso={timeframe === "all" ? null : windowStartIso}
              timeframeLabel={timeframeLabel}
            />
          </>
        )}

        {/* Footer */}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-6 pb-4 text-[11px] text-zinc-500">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-zinc-400">SleeckOS</span>
            <span>·</span>
            <span>State Accounts Live Performance Report</span>
          </div>
          <div className="flex items-center gap-3">
            <span>Timezone: {data.timezone}</span>
            <span>·</span>
            <span>Synced hourly</span>
          </div>
        </footer>
      </main>

      <ApiQuickstartModal
        open={apiModalOpen}
        onClose={() => setApiModalOpen(false)}
        accessCode={activeCode}
        selectedSlug={activeAccount?.slug ?? data.accounts[0]?.slug ?? null}
        origin={origin}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  icon,
  value,
  exact,
  prefix = "",
  sub,
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  exact?: string;
  prefix?: string;
  sub: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#0c0c10] p-5 transition hover:border-white/[0.14]">
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
        {icon}
        {label}
      </span>
      <p
        className="mt-3 font-mono text-2xl font-bold tracking-tight text-white tabular-nums sm:text-[26px]"
        title={exact}
      >
        {prefix}
        {value}
      </p>
      <p className="mt-2 text-[11px] text-zinc-500">{sub}</p>
    </div>
  );
}

function StateLeaderboardPanel({
  ranked,
  maxVal,
  totalSum,
  timeframeTitle,
  onSelectState,
}: {
  ranked: (ClientPortalAccount & { periodViews: number })[];
  maxVal: number;
  totalSum: number;
  timeframeTitle: string;
  onSelectState: (slug: string) => void;
}) {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-white/[0.07] bg-[#0c0c10] p-5 sm:p-6">
      <div className="flex items-center justify-between border-b border-white/[0.06] pb-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-zinc-100">
            Reach by State
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Ranked by {timeframeTitle.toLowerCase()} views
          </p>
        </div>
        <Sparkles size={15} className="text-rose-400/80" />
      </div>

      <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-0.5 max-h-[310px]">
        {ranked.map((acc, idx) => {
          const val = acc.periodViews;
          const pct = val > 0 ? Math.max(3, (val / maxVal) * 100) : 0;
          const share = totalSum > 0 ? Math.round((val / totalSum) * 100) : 0;
          const accent = stateAccent(acc.slug);
          return (
            <button
              key={acc.id}
              type="button"
              onClick={() => onSelectState(acc.slug)}
              className="group block w-full rounded-xl p-2 text-left transition hover:bg-white/[0.04]"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="w-4 font-mono text-[10px] text-zinc-600">
                    {idx + 1}
                  </span>
                  <span
                    className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border font-mono text-[9px] font-bold ${accent.bg} ${accent.border} ${accent.text}`}
                  >
                    {monogram(acc)}
                  </span>
                  <span className="truncate text-xs font-medium text-zinc-200 group-hover:text-white">
                    {acc.stateName}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-white tabular-nums">
                    {formatCompact(val)}
                  </span>
                  <span className="w-8 text-right font-mono text-[10px] text-zinc-500 tabular-nums">
                    {share}%
                  </span>
                </div>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.05]">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: accent.hex,
                    opacity: 0.85,
                  }}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TopVideosSpotlight({
  videos,
  timezone,
  stateName,
}: {
  videos: ClientStateVideo[];
  timezone: string;
  stateName: string;
}) {
  const top = useMemo(
    () => [...videos].sort((a, b) => b.views - a.views).slice(0, 5),
    [videos],
  );

  return (
    <div className="flex h-full flex-col rounded-2xl border border-white/[0.07] bg-[#0c0c10] p-5 sm:p-6">
      <div className="flex items-center justify-between border-b border-white/[0.06] pb-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-zinc-100">
            Top Performing Videos
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Highest reach posts on {stateName}
          </p>
        </div>
        <Flame size={15} className="text-rose-400" />
      </div>

      {top.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
          <Video className="mb-2 h-5 w-5 text-zinc-600" />
          <p className="text-xs text-zinc-500">No tracked videos yet.</p>
        </div>
      ) : (
        <div className="mt-3 flex-1 divide-y divide-white/[0.05]">
          {top.map((v, idx) => (
            <a
              key={v.videoId}
              href={v.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-between gap-3 py-3 transition hover:text-white"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg font-mono text-[10px] font-bold ${
                    idx === 0
                      ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                      : "bg-white/[0.05] text-zinc-400"
                  }`}
                >
                  #{idx + 1}
                </span>
                <div className="min-w-0">
                  <p className="flex items-center gap-1 font-mono text-xs font-medium text-zinc-200 group-hover:text-rose-300">
                    <span>{videoTail(v.url)}</span>
                    <ExternalLink size={10} className="opacity-60" />
                  </p>
                  <p className="text-[10px] text-zinc-500">
                    {formatDateTz(v.publishedAt, timezone)} ·{" "}
                    {v.engagementRate.toFixed(1)}% likes
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-mono text-xs font-semibold text-white tabular-nums">
                  {formatCompact(v.views)}
                </p>
                <p className="font-mono text-[10px] text-zinc-500 tabular-nums">
                  {formatCompact(v.likes)} likes
                </p>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function SortableTh({
  label,
  active,
  dir,
  alignRight = false,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  alignRight?: boolean;
  onClick: () => void;
}) {
  return (
    <th
      onClick={onClick}
      className={`cursor-pointer select-none px-4 py-3 font-semibold transition hover:text-zinc-200 ${
        alignRight ? "text-right" : "text-left"
      } ${active ? "text-zinc-200" : ""}`}
    >
      <span
        className={`inline-flex items-center gap-1 ${
          alignRight ? "flex-row-reverse" : ""
        }`}
      >
        {label}
        {active ? (
          dir === "desc" ? (
            <ArrowDown size={11} className="text-rose-400" />
          ) : (
            <ArrowUp size={11} className="text-rose-400" />
          )
        ) : (
          <ArrowUpDown size={11} className="text-zinc-700" />
        )}
      </span>
    </th>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Published Content Explorer
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

function VideosExplorer({
  videos,
  accounts,
  showStateFilter,
  timezone,
  windowStartIso,
  timeframeLabel,
}: {
  videos: ClientStateVideo[];
  accounts: ClientPortalAccount[];
  showStateFilter: boolean;
  timezone: string;
  windowStartIso: string | null;
  timeframeLabel: string;
}) {
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [sortKey, setSortKey] = useState<VideoSortKey>("views");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [onlyWindow, setOnlyWindow] = useState(false);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const minTs = onlyWindow && windowStartIso ? Date.parse(windowStartIso) : null;
    const list = videos.filter((v) => {
      if (stateFilter !== "all" && v.stateSlug !== stateFilter) return false;
      if (minTs !== null && Date.parse(v.publishedAt) < minTs) return false;
      if (q) {
        return (
          v.url.toLowerCase().includes(q) ||
          v.stateName.toLowerCase().includes(q) ||
          v.username.toLowerCase().includes(q) ||
          (v.stateCode && v.stateCode.toLowerCase().includes(q))
        );
      }
      return true;
    });
    const dir = sortDir === "desc" ? -1 : 1;
    list.sort((a, b) => {
      if (sortKey === "publishedAt") {
        return dir * (Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
      }
      return dir * (a[sortKey] - b[sortKey]);
    });
    return list;
  }, [videos, query, stateFilter, sortKey, sortDir, onlyWindow, windowStartIso]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(
    safePage * PAGE_SIZE,
    (safePage + 1) * PAGE_SIZE,
  );
  const maxViews = Math.max(1, ...filtered.map((v) => v.views));

  const toggleSort = (key: VideoSortKey) => {
    setPage(0);
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  return (
    <section className="rounded-2xl border border-white/[0.07] bg-[#0c0c10] p-5 sm:p-6">
      <div className="flex flex-col gap-4 border-b border-white/[0.06] pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-white">
            <Video size={15} className="text-rose-400" />
            Published Videos
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] font-medium text-zinc-400">
              {filtered.length.toLocaleString("en-US")}
            </span>
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            All verified TikTok posts with live view and engagement tracking.
          </p>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              size={13}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder="Search link, state, handle…"
              className="w-52 rounded-xl border border-white/[0.09] bg-[#07070a] py-1.5 pl-8 pr-3 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-white/25 focus:outline-none"
            />
          </div>

          {showStateFilter && (
            <select
              aria-label="Filter videos by state"
              value={stateFilter}
              onChange={(e) => {
                setStateFilter(e.target.value);
                setPage(0);
              }}
              className="rounded-xl border border-white/[0.09] bg-[#07070a] px-3 py-1.5 text-xs text-zinc-200 focus:border-white/25 focus:outline-none"
            >
              <option value="all">All states</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.slug}>
                  {a.stateName}
                </option>
              ))}
            </select>
          )}

          {windowStartIso && (
            <button
              type="button"
              onClick={() => {
                setOnlyWindow((v) => !v);
                setPage(0);
              }}
              className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                onlyWindow
                  ? "border-rose-500/40 bg-rose-500/15 text-rose-200"
                  : "border-white/[0.09] bg-[#07070a] text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Posted in {timeframeLabel}
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="py-12 text-center">
          <Video className="mx-auto mb-2 h-5 w-5 text-zinc-600" />
          <p className="text-xs text-zinc-400">
            {videos.length === 0
              ? "No tracked videos yet — links appear automatically once posts are discovered."
              : "No videos match the current filters."}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto rounded-xl border border-white/[0.06]">
            <table className="w-full min-w-[700px] text-left text-xs">
              <thead>
                <tr className="border-b border-white/[0.06] bg-white/[0.02] text-[10px] uppercase tracking-wider text-zinc-500">
                  <th className="w-12 px-4 py-3 font-semibold">#</th>
                  {showStateFilter && (
                    <th className="px-4 py-3 font-semibold">State</th>
                  )}
                  <th className="px-4 py-3 font-semibold">TikTok Video</th>
                  <SortableTh
                    label="Published"
                    active={sortKey === "publishedAt"}
                    dir={sortDir}
                    onClick={() => toggleSort("publishedAt")}
                  />
                  <SortableTh
                    label="Views"
                    alignRight
                    active={sortKey === "views"}
                    dir={sortDir}
                    onClick={() => toggleSort("views")}
                  />
                  <SortableTh
                    label="Likes"
                    alignRight
                    active={sortKey === "likes"}
                    dir={sortDir}
                    onClick={() => toggleSort("likes")}
                  />
                  <SortableTh
                    label="Like Rate"
                    alignRight
                    active={sortKey === "engagementRate"}
                    dir={sortDir}
                    onClick={() => toggleSort("engagementRate")}
                  />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {pageRows.map((v, idx) => {
                  const rank = safePage * PAGE_SIZE + idx + 1;
                  const isTop = sortKey === "views" && sortDir === "desc" && rank <= 3;
                  const accent = stateAccent(v.stateSlug);
                  const barPct = Math.max(2, (v.views / maxViews) * 100);
                  return (
                    <tr
                      key={v.videoId}
                      className={`transition hover:bg-white/[0.03] ${
                        isTop && rank === 1 ? "bg-rose-500/[0.04]" : ""
                      }`}
                    >
                      <td className="px-4 py-3 font-mono text-[11px] text-zinc-500">
                        {isTop ? (
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-rose-500/15 text-[10px] font-bold text-rose-300">
                            {rank}
                          </span>
                        ) : (
                          rank
                        )}
                      </td>
                      {showStateFilter && (
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${accent.bg} ${accent.border} ${accent.text}`}
                          >
                            {v.stateCode || v.stateName.slice(0, 2).toUpperCase()}
                            <span className="hidden text-zinc-200 sm:inline">
                              {v.stateName}
                            </span>
                          </span>
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <a
                          href={v.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 font-mono text-xs font-medium text-blue-300 transition hover:text-blue-200 hover:underline"
                        >
                          <ExternalLink size={12} className="shrink-0" />
                          <span>{videoTail(v.url)}</span>
                          <span className="text-[10px] text-zinc-500 no-underline">
                            @{v.username}
                          </span>
                        </a>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap font-mono text-[11px] text-zinc-400">
                        {formatDateTimeTz(v.publishedAt, timezone)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex flex-col items-end gap-1">
                          <span className="font-mono font-semibold text-white tabular-nums">
                            {v.views.toLocaleString("en-US")}
                          </span>
                          <div className="h-1 w-20 overflow-hidden rounded-full bg-white/[0.06]">
                            <div
                              className="h-full rounded-full bg-rose-500/80"
                              style={{ width: `${barPct}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-300 tabular-nums">
                        {v.likes.toLocaleString("en-US")}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-400 tabular-nums">
                        {v.engagementRate.toFixed(2)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-xs text-zinc-400">
              <span>
                Showing{" "}
                <strong className="font-mono text-zinc-200">
                  {safePage * PAGE_SIZE + 1}–
                  {Math.min((safePage + 1) * PAGE_SIZE, filtered.length)}
                </strong>{" "}
                of{" "}
                <strong className="font-mono text-zinc-200">
                  {filtered.length.toLocaleString("en-US")}
                </strong>
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={safePage === 0}
                  onClick={() => setPage(Math.max(0, safePage - 1))}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs transition hover:bg-white/[0.06] disabled:opacity-40"
                >
                  <ChevronLeft size={13} />
                  Prev
                </button>
                <span className="px-2 font-mono text-[11px] text-zinc-500">
                  {safePage + 1} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={safePage >= totalPages - 1}
                  onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs transition hover:bg-white/[0.06] disabled:opacity-40"
                >
                  Next
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
