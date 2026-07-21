"use client";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  History as HistoryIcon,
  ExternalLink,
  Loader2,
  RefreshCw,
  Copy,
  CheckCircle2,
  SkipForward,
  XCircle,
  Link2,
  Eye,
  Gauge,
  X,
  AlertCircle,
  Hash,
} from "lucide-react";

// ── API contract types ──────────────────────────────────────────────────────
type HistoryPost = {
  id: string;
  status: "PUBLISHED" | "SKIPPED" | "FAILED";
  rawStatus: string;
  caption: string;
  driveFileName: string | null;
  campaign: string | null;
  tiktokPostUrl: string | null;
  publishedAt: string | null;
  createdAt: string;
  errorMessage: string | null;
  viewCount: string;
  likeCount: string;
  commentCount: string;
  shareCount: string;
  account: {
    id: string;
    tiktokUsername: string;
    tiktokAvatarUrl: string | null;
    driveFolderId: string | null;
    driveFolderName: string | null;
    section: { id: string; name: string };
  };
};

type HistorySummary = {
  published: number;
  failed: number;
  skipped: number;
  withLinks: number;
  successRate: number;
  views: string;
  likes: string;
  comments: string;
  shares: string;
};

type Section = { id: string; name: string };
type AccountOption = { id: string; tiktokUsername: string };

const LIMIT = 200;

// ── Helpers ─────────────────────────────────────────────────────────────────
function formatCompact(value: string | number): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  const trim = (v: number) => v.toFixed(1).replace(/\.0$/, "");
  if (abs >= 1_000_000_000) return `${trim(n / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (abs >= 1_000) return `${trim(n / 1_000)}K`;
  return n.toLocaleString();
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatAbsolute(dateStr: string): string {
  return new Date(dateStr).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_STYLES: Record<HistoryPost["status"], string> = {
  PUBLISHED: "text-emerald-400 bg-emerald-400/10 border-emerald-500/20",
  SKIPPED: "text-amber-400 bg-amber-400/10 border-amber-500/20",
  FAILED: "text-red-400 bg-red-400/10 border-red-500/20",
};

function AccountAvatar({ username, url }: { username: string; url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <div className="w-6 h-6 rounded-full bg-[#27272a] flex items-center justify-center text-[10px] font-semibold text-zinc-400 shrink-0">
        {username.charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      className="w-6 h-6 rounded-full shrink-0"
      alt=""
      onError={() => setFailed(true)}
    />
  );
}

export default function HistoryPage() {
  const [posts, setPosts] = useState<HistoryPost[]>([]);
  const [summary, setSummary] = useState<HistorySummary | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshingLinks, setRefreshingLinks] = useState(false);

  // Filters
  const [sectionFilter, setSectionFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [hashtagInput, setHashtagInput] = useState("");
  const [hashtagFilter, setHashtagFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sortFilter, setSortFilter] = useState("latest");

  const hasActiveFilters =
    sectionFilter !== "" ||
    accountFilter !== "" ||
    statusFilter !== "all" ||
    hashtagFilter !== "" ||
    hashtagInput !== "" ||
    fromDate !== "" ||
    toDate !== "" ||
    sortFilter !== "latest";

  const clearFilters = () => {
    setSectionFilter("");
    setAccountFilter("");
    setStatusFilter("all");
    setHashtagInput("");
    setHashtagFilter("");
    setFromDate("");
    setToDate("");
    setSortFilter("latest");
  };

  // Fetch sections for dropdown
  useEffect(() => {
    fetch("/api/managed/sections")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setSections(data.map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })));
        }
      })
      .catch(() => {});
  }, []);

  // Fetch accounts for dropdown
  useEffect(() => {
    fetch("/api/managed/accounts/all")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setAccounts(
            data.map((a: { id: string; tiktokUsername: string }) => ({
              id: a.id,
              tiktokUsername: a.tiktokUsername,
            }))
          );
        }
      })
      .catch(() => {});
  }, []);

  // Debounce hashtag text input (~300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setHashtagFilter(hashtagInput.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [hashtagInput]);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (sectionFilter) params.set("section", sectionFilter);
      if (accountFilter) params.set("accountId", accountFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (hashtagFilter) params.set("hashtag", hashtagFilter);
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      params.set("sort", sortFilter);
      params.set("limit", String(LIMIT));

      const res = await fetch(`/api/managed/history?${params}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Failed to fetch history (${res.status})`);
      setPosts(Array.isArray(data?.posts) ? data.posts : []);
      setSummary(data?.summary ?? null);
    } catch (err) {
      setPosts([]);
      setSummary(null);
      setError(err instanceof Error ? err.message : "Failed to fetch history");
    } finally {
      setLoading(false);
    }
  }, [sectionFilter, accountFilter, statusFilter, hashtagFilter, fromDate, toDate, sortFilter]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const copyAllLinks = () => {
    const links = posts
      .filter((p) => p.tiktokPostUrl)
      .map((p) => p.tiktokPostUrl)
      .join("\n");
    if (!links) {
      toast.error("No links to copy");
      return;
    }
    navigator.clipboard.writeText(links);
    toast.success(`${links.split("\n").length} link(s) copied`);
  };

  const copyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success("Link copied");
  };

  const refreshLinks = async () => {
    setRefreshingLinks(true);
    try {
      const res = await fetch("/api/managed/history", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");

      if (data.totalChecked === 0) {
        toast.info("No posts need link refresh");
      } else if (data.updated > 0) {
        toast.success(`Updated ${data.updated} link(s)! ${data.noUrl > 0 ? `${data.noUrl} still pending.` : ""}`);
        fetchPosts(); // Reload to show new links
      } else {
        toast.info(`Checked ${data.totalChecked} posts — PostPeer hasn't returned URLs yet. ${data.details ? `Keys: ${JSON.stringify(Object.values(data.details)[0])}` : ""}`);
      }

      // Log full details for debugging
      console.log("[RefreshLinks] Full result:", data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to refresh links");
    } finally {
      setRefreshingLinks(false);
    }
  };

  const successRateColor = !summary || summary.published + summary.failed === 0
    ? "text-zinc-300"
    : summary.successRate >= 90
    ? "text-emerald-400"
    : summary.successRate >= 70
    ? "text-amber-400"
    : "text-red-400";

  const inputCls =
    "bg-[#09090b] border border-[#27272a] rounded px-2.5 py-1.5 text-xs text-zinc-300 focus:border-[#E11D48] focus:outline-none transition placeholder:text-zinc-600";
  const labelCls = "block text-[10px] uppercase tracking-wider font-semibold text-zinc-500 mb-1";

  return (
    <div className="space-y-6 text-zinc-100">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#27272a] pb-5">
        <div className="space-y-1">
          <h1 className="text-xl font-bold tracking-tight">Post History</h1>
          <p className="text-xs text-zinc-400">
            Every published, skipped, and failed post across all managed accounts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refreshLinks}
            disabled={refreshingLinks}
            className="flex items-center gap-1.5 bg-[#E11D48] hover:bg-rose-700 text-white transition text-xs font-semibold px-3 py-1.5 rounded disabled:opacity-50"
            title="Fetch TikTok URLs from PostPeer for posts missing links"
          >
            {refreshingLinks ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Link2 size={14} />
            )}
            Refresh Links
          </button>
          <button
            onClick={copyAllLinks}
            disabled={!summary || summary.withLinks === 0}
            className="flex items-center gap-1.5 bg-zinc-100 text-zinc-950 hover:bg-zinc-200 transition text-xs font-semibold px-3 py-1.5 rounded disabled:opacity-50"
            title="Copy every loaded TikTok post link, one per line"
          >
            <Copy size={14} />
            Copy All Links ({summary?.withLinks ?? 0})
          </button>
          <button
            onClick={fetchPosts}
            disabled={loading}
            className="flex items-center justify-center w-8 h-8 bg-zinc-900 border border-[#27272a] hover:text-zinc-100 transition text-zinc-400 rounded disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Stat cards — server-aggregated over every active filter */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-[#09090b] border border-[#27272a] rounded-md px-4 py-3 flex items-center gap-3">
          <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-lg font-bold text-emerald-400 leading-tight">
              {summary ? summary.published.toLocaleString() : "—"}
            </p>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500">Published</p>
          </div>
        </div>
        <div className="bg-[#09090b] border border-[#27272a] rounded-md px-4 py-3 flex items-center gap-3">
          <XCircle size={18} className={`shrink-0 ${summary && summary.failed > 0 ? "text-red-400" : "text-zinc-500"}`} />
          <div className="min-w-0">
            <p className={`text-lg font-bold leading-tight ${summary && summary.failed > 0 ? "text-red-400" : "text-zinc-300"}`}>
              {summary ? summary.failed.toLocaleString() : "—"}
            </p>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500">Failed</p>
          </div>
        </div>
        <div className="bg-[#09090b] border border-[#27272a] rounded-md px-4 py-3 flex items-center gap-3">
          <SkipForward size={18} className="text-amber-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-lg font-bold text-amber-400 leading-tight">
              {summary ? summary.skipped.toLocaleString() : "—"}
            </p>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500">Skipped</p>
          </div>
        </div>
        <div className="bg-[#09090b] border border-[#27272a] rounded-md px-4 py-3 flex items-center gap-3">
          <Gauge size={18} className={`shrink-0 ${successRateColor}`} />
          <div className="min-w-0">
            <p className={`text-lg font-bold leading-tight ${successRateColor}`}>
              {summary ? `${summary.successRate}%` : "—"}
            </p>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500">Success Rate</p>
          </div>
        </div>
        <div className="bg-[#09090b] border border-[#27272a] rounded-md px-4 py-3 flex items-center gap-3">
          <Link2 size={18} className="text-zinc-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-lg font-bold text-zinc-100 leading-tight">
              {summary ? summary.withLinks.toLocaleString() : "—"}
            </p>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500">With Links</p>
          </div>
        </div>
        <div className="bg-[#09090b] border border-[#27272a] rounded-md px-4 py-3 flex items-center gap-3">
          <Eye size={18} className="text-zinc-400 shrink-0" />
          <div className="min-w-0">
            <p
              className="text-lg font-bold text-zinc-100 leading-tight font-mono"
              title={summary ? Number(summary.views).toLocaleString() : undefined}
            >
              {summary ? formatCompact(summary.views) : "—"}
            </p>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500">Views</p>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className={labelCls}>Section</label>
          <select
            value={sectionFilter}
            onChange={(e) => setSectionFilter(e.target.value)}
            className={`${inputCls} cursor-pointer w-40`}
          >
            <option value="">All Sections</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Account</label>
          <select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            className={`${inputCls} cursor-pointer w-44`}
          >
            <option value="">All Accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>@{a.tiktokUsername}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={`${inputCls} cursor-pointer w-32`}
          >
            <option value="all">All Statuses</option>
            <option value="PUBLISHED">Published</option>
            <option value="SKIPPED">Skipped</option>
            <option value="FAILED">Failed</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Sort</label>
          <select
            value={sortFilter}
            onChange={(e) => setSortFilter(e.target.value)}
            className={`${inputCls} cursor-pointer w-36`}
          >
            <option value="latest">Latest first</option>
            <option value="oldest">Oldest first</option>
            <option value="views">Most views</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>From</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            style={{ colorScheme: "dark" }}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>To</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            style={{ colorScheme: "dark" }}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Hashtag</label>
          <div className="relative">
            <span className="absolute inset-y-0 left-2.5 flex items-center text-zinc-500">
              <Hash size={12} />
            </span>
            <input
              type="text"
              value={hashtagInput}
              onChange={(e) => setHashtagInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setHashtagFilter(hashtagInput.trim())}
              placeholder="fyp"
              className={`${inputCls} w-36 pl-7`}
            />
          </div>
        </div>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 bg-zinc-900 border border-[#27272a] hover:text-zinc-100 transition text-zinc-400 text-xs font-medium px-2.5 py-1.5 rounded"
          >
            <X size={12} />
            Clear
          </button>
        )}
      </div>

      {/* Content */}
      {error ? (
        <div className="border border-red-500/20 bg-red-500/10 rounded-md p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-red-400 text-xs">
            <AlertCircle size={14} className="shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={fetchPosts}
            className="flex items-center gap-1.5 bg-zinc-900 border border-[#27272a] hover:text-zinc-100 transition text-zinc-300 text-xs font-medium px-3 py-1.5 rounded shrink-0"
          >
            <RefreshCw size={12} />
            Retry
          </button>
        </div>
      ) : loading ? (
        <div className="border border-[#27272a] rounded-md bg-[#09090b] overflow-hidden">
          <div className="divide-y divide-[#27272a]">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="px-4 py-3.5 flex items-center gap-4 animate-pulse">
                <div className="h-5 w-16 rounded bg-[#18181b]" />
                <div className="h-6 w-6 rounded-full bg-[#18181b]" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-2/5 rounded bg-[#18181b]" />
                  <div className="h-2.5 w-1/4 rounded bg-[#18181b]" />
                </div>
                <div className="h-3 w-20 rounded bg-[#18181b]" />
                <div className="h-3 w-14 rounded bg-[#18181b]" />
              </div>
            ))}
          </div>
        </div>
      ) : posts.length === 0 ? (
        <div className="border border-[#27272a] rounded-md bg-[#09090b] p-12 text-center">
          <HistoryIcon size={32} className="mx-auto mb-3 text-zinc-600" />
          <h3 className="text-sm font-semibold text-zinc-100 mb-1">No posts match these filters</h3>
          <p className="text-xs text-zinc-500 mb-4">
            Try widening the date range or clearing a filter.
          </p>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-1.5 bg-zinc-900 border border-[#27272a] hover:text-zinc-100 transition text-zinc-300 text-xs font-medium px-3 py-1.5 rounded"
            >
              <X size={12} />
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="border border-[#27272a] rounded-md bg-[#09090b] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#27272a] text-zinc-500 font-semibold bg-[#18181b]/20">
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Account</th>
                  <th className="py-2.5 px-4">Campaign</th>
                  <th className="py-2.5 px-4">Caption</th>
                  <th className="py-2.5 px-4 text-right">Views · Likes · Comments</th>
                  <th className="py-2.5 px-4">Published</th>
                  <th className="py-2.5 px-4 text-right">Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#27272a]">
                {posts.map((post) => (
                  <tr key={post.id} className="hover:bg-zinc-900/50 transition">
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${STATUS_STYLES[post.status] ?? STATUS_STYLES.SKIPPED}`}
                        title={
                          post.errorMessage
                            ? `${post.status === "FAILED" ? "Failure reason" : "Reason"}: ${post.errorMessage}`
                            : post.rawStatus !== post.status
                            ? `Lifecycle state: ${post.rawStatus}`
                            : undefined
                        }
                      >
                        {post.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-2">
                        <AccountAvatar username={post.account.tiktokUsername} url={post.account.tiktokAvatarUrl} />
                        <div className="flex flex-col min-w-0">
                          <a
                            href={`https://www.tiktok.com/@${post.account.tiktokUsername}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-zinc-100 font-medium whitespace-nowrap hover:text-[#E11D48] hover:underline underline-offset-2 transition-colors"
                            title={`Open @${post.account.tiktokUsername} on TikTok`}
                          >
                            @{post.account.tiktokUsername}
                          </a>
                          <span className="text-[10px] text-zinc-500 whitespace-nowrap">
                            {post.account.section.name}
                          </span>
                          {post.account.driveFolderName && (
                            post.account.driveFolderId ? (
                              <a
                                href={`https://drive.google.com/drive/folders/${post.account.driveFolderId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] text-zinc-500 hover:text-zinc-200 hover:underline underline-offset-2 truncate max-w-[140px] transition-colors"
                                title={`Open Drive folder: ${post.account.driveFolderName}`}
                              >
                                {post.account.driveFolderName}
                              </a>
                            ) : (
                              <span className="text-[10px] text-zinc-600 truncate max-w-[140px]" title={post.account.driveFolderName}>
                                {post.account.driveFolderName}
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      {post.campaign ? (
                        <span className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded border border-[#27272a] bg-[#18181b] text-zinc-400 whitespace-nowrap">
                          {post.campaign}
                        </span>
                      ) : (
                        <span className="text-zinc-700">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 max-w-[240px]">
                      <p
                        className="text-zinc-400 truncate"
                        title={post.caption || post.driveFileName || ""}
                      >
                        {post.caption || post.driveFileName || "—"}
                      </p>
                      {post.status === "FAILED" && post.errorMessage && (
                        <p className="text-[10px] text-red-400/70 truncate mt-0.5" title={post.errorMessage}>
                          {post.errorMessage}
                        </p>
                      )}
                      {post.status === "SKIPPED" && post.errorMessage && (
                        <p className="text-[10px] text-amber-400/70 truncate mt-0.5" title={post.errorMessage}>
                          {post.errorMessage}
                        </p>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <span
                        className="font-mono text-zinc-400 tabular-nums"
                        title={`${Number(post.viewCount).toLocaleString()} views · ${Number(post.likeCount).toLocaleString()} likes · ${Number(post.commentCount).toLocaleString()} comments`}
                      >
                        {formatCompact(post.viewCount)} · {formatCompact(post.likeCount)} · {formatCompact(post.commentCount)}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      {post.publishedAt ? (
                        <span className="text-zinc-300" title={formatAbsolute(post.publishedAt)}>
                          {timeAgo(post.publishedAt)}
                        </span>
                      ) : (
                        <span className="text-zinc-500" title={`Created ${formatAbsolute(post.createdAt)}`}>
                          {timeAgo(post.createdAt)}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex items-center justify-end gap-1">
                        {post.tiktokPostUrl ? (
                          <>
                            <button
                              onClick={() => copyLink(post.tiktokPostUrl!)}
                              className="p-1.5 rounded text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 transition"
                              title="Copy link"
                            >
                              <Copy size={13} />
                            </button>
                            <a
                              href={post.tiktokPostUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 rounded text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 transition"
                              title="Open on TikTok"
                            >
                              <ExternalLink size={13} />
                            </a>
                          </>
                        ) : (
                          <span className="text-zinc-700">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t border-[#27272a] text-[11px] text-zinc-600 text-right">
            Showing {posts.length} post{posts.length !== 1 ? "s" : ""} (limit {LIMIT})
          </div>
        </div>
      )}
    </div>
  );
}
