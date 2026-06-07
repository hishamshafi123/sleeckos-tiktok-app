"use client";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  History as HistoryIcon,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  Copy,
  Filter,
  CheckCircle2,
  SkipForward,
  XCircle,
} from "lucide-react";

type HistoryPost = {
  id: string;
  status: string;
  caption: string;
  driveFileName: string | null;
  tiktokPostUrl: string | null;
  tiktokVideoId: string | null;
  publishedAt: string | null;
  createdAt: string;
  errorMessage: string | null;
  viewCount: string;
  likeCount: string;
  commentCount: string;
  shareCount: string;
  account: {
    tiktokUsername: string;
    tiktokAvatarUrl: string;
    group: { name: string; section: { id: string; name: string } };
  };
};

type Section = {
  id: string;
  name: string;
};

export default function HistoryPage() {
  const [posts, setPosts] = useState<HistoryPost[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [sectionFilter, setSectionFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [hashtagFilter, setHashtagFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

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

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (sectionFilter) params.set("section", sectionFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (hashtagFilter.trim()) params.set("hashtag", hashtagFilter.trim());
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);

      const res = await fetch(`/api/managed/history?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setPosts(Array.isArray(data) ? data : []);
    } catch {
      toast.error("Failed to fetch history");
    } finally {
      setLoading(false);
    }
  }, [sectionFilter, statusFilter, hashtagFilter, fromDate, toDate]);

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

  const statusCounts = posts.reduce(
    (acc, p) => {
      acc[p.status] = (acc[p.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const linksCount = posts.filter((p) => p.tiktokPostUrl).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Post History</h1>
          <p className="text-gray-500 mt-1 text-sm">
            All published, skipped, and failed posts
          </p>
        </div>
        <div className="flex items-center gap-2">
          {linksCount > 0 && (
            <button
              onClick={copyAllLinks}
              className="flex items-center gap-1.5 text-xs font-semibold text-purple-400 hover:text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 px-3 py-2 rounded-xl transition-all"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy All Links ({linksCount})
            </button>
          )}
          <button
            onClick={fetchPosts}
            className="p-2 rounded-xl text-gray-500 hover:text-white hover:bg-white/5 transition-all"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-green-500/10 border border-white/5 rounded-xl px-4 py-3 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-green-400" />
          <div>
            <p className="text-lg font-bold text-green-400">{statusCounts.PUBLISHED || 0}</p>
            <p className="text-xs text-gray-500">Published</p>
          </div>
        </div>
        <div className="bg-yellow-500/10 border border-white/5 rounded-xl px-4 py-3 flex items-center gap-3">
          <SkipForward className="w-5 h-5 text-yellow-400" />
          <div>
            <p className="text-lg font-bold text-yellow-400">{statusCounts.SKIPPED || 0}</p>
            <p className="text-xs text-gray-500">Skipped</p>
          </div>
        </div>
        <div className="bg-red-500/10 border border-white/5 rounded-xl px-4 py-3 flex items-center gap-3">
          <XCircle className="w-5 h-5 text-red-400" />
          <div>
            <p className="text-lg font-bold text-red-400">{statusCounts.FAILED || 0}</p>
            <p className="text-xs text-gray-500">Failed</p>
          </div>
        </div>
        <div className="bg-purple-500/10 border border-white/5 rounded-xl px-4 py-3 flex items-center gap-3">
          <ExternalLink className="w-5 h-5 text-purple-400" />
          <div>
            <p className="text-lg font-bold text-purple-400">{linksCount}</p>
            <p className="text-xs text-gray-500">With Links</p>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="glass border border-white/5 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-semibold text-gray-400">Filters</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* Section */}
          <div>
            <label className="block text-[9px] uppercase tracking-wider font-bold text-gray-600 mb-1">Section</label>
            <select
              value={sectionFilter}
              onChange={(e) => setSectionFilter(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-gray-300 focus:outline-none focus:border-purple-500 transition-colors cursor-pointer"
            >
              <option value="">All Sections</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Status */}
          <div>
            <label className="block text-[9px] uppercase tracking-wider font-bold text-gray-600 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-gray-300 focus:outline-none focus:border-purple-500 transition-colors cursor-pointer"
            >
              <option value="all">All Statuses</option>
              <option value="PUBLISHED">Published</option>
              <option value="SKIPPED">Skipped</option>
              <option value="FAILED">Failed</option>
            </select>
          </div>

          {/* Hashtag */}
          <div>
            <label className="block text-[9px] uppercase tracking-wider font-bold text-gray-600 mb-1">Hashtag</label>
            <input
              type="text"
              value={hashtagFilter}
              onChange={(e) => setHashtagFilter(e.target.value)}
              placeholder="#fyp"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500 transition-colors"
              onKeyDown={(e) => e.key === "Enter" && fetchPosts()}
            />
          </div>

          {/* Date From */}
          <div>
            <label className="block text-[9px] uppercase tracking-wider font-bold text-gray-600 mb-1">From Date</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-gray-300 focus:outline-none focus:border-purple-500 transition-colors"
            />
          </div>

          {/* Date To */}
          <div>
            <label className="block text-[9px] uppercase tracking-wider font-bold text-gray-600 mb-1">To Date</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-gray-300 focus:outline-none focus:border-purple-500 transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Results Table */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
        </div>
      ) : posts.length === 0 ? (
        <div className="glass border border-white/5 rounded-2xl p-12 text-center">
          <HistoryIcon className="w-10 h-10 mx-auto mb-3 text-gray-600" />
          <h3 className="text-lg font-semibold text-white mb-1">No posts found</h3>
          <p className="text-gray-500 text-sm">
            Try adjusting your filters or wait for the scheduler to post.
          </p>
        </div>
      ) : (
        <div className="glass border border-white/5 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs">Account</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs">Section / Group</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs">Caption</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs">Status</th>
                  <th className="text-right px-4 py-3 text-gray-500 font-medium text-xs">Views</th>
                  <th className="text-right px-4 py-3 text-gray-500 font-medium text-xs">Likes</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs">Date</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium text-xs">Link</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((post) => (
                  <tr key={post.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <img
                          src={post.account.tiktokAvatarUrl || "/default-avatar.png"}
                          className="w-6 h-6 rounded-full"
                          alt=""
                        />
                        <span className="text-white text-xs font-medium">
                          @{post.account.tiktokUsername}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-gray-400 text-xs">
                        {post.account.group.section.name}
                      </span>
                      <span className="text-gray-600 text-xs"> / {post.account.group.name}</span>
                    </td>
                    <td className="px-4 py-3 max-w-[200px]">
                      <p className="text-gray-400 text-xs truncate" title={post.caption || ""}>
                        {post.caption || "—"}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          post.status === "PUBLISHED"
                            ? "bg-green-500/10 text-green-400"
                            : post.status === "FAILED"
                            ? "bg-red-500/10 text-red-400"
                            : "bg-yellow-500/10 text-yellow-400"
                        }`}
                      >
                        {post.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300 text-xs font-mono">
                      {Number(post.viewCount).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300 text-xs font-mono">
                      {Number(post.likeCount).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {post.publishedAt
                        ? new Date(post.publishedAt).toLocaleDateString()
                        : new Date(post.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      {post.tiktokPostUrl ? (
                        <a
                          href={post.tiktokPostUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors whitespace-nowrap"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Open
                        </a>
                      ) : (
                        <span className="text-gray-700 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t border-white/5 text-xs text-gray-600 text-right">
            Showing {posts.length} post{posts.length !== 1 ? "s" : ""}
          </div>
        </div>
      )}
    </div>
  );
}
