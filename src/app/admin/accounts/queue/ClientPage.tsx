"use client";
import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import {
  Clock,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  SkipForward,
  Download,
  Upload,
  Cog,
  ExternalLink,
} from "lucide-react";

type QueuePost = {
  id: string;
  status: string;
  driveFileName: string | null;
  driveFileId: string | null;
  scheduledFor: string;
  publishedAt: string | null;
  errorMessage: string | null;
  caption: string;
  tiktokPostUrl: string | null;
  tiktokVideoId: string | null;
  createdAt: string;
  account: {
    tiktokUsername: string;
    tiktokAvatarUrl: string;
    group: { name: string; section: { name: string } };
  };
};

const TABS = [
  { key: "all", label: "All Posts" },
  { key: "active", label: "In Progress" },
  { key: "failed", label: "Failed" },
  { key: "completed", label: "Completed" },
  { key: "reconciliation", label: "Reconciliation" },
];

const statusConfig: Record<
  string,
  { icon: typeof Clock; color: string; bg: string; label: string }
> = {
  QUEUED: {
    icon: Clock,
    color: "text-gray-400",
    bg: "bg-gray-500/10",
    label: "Queued",
  },
  DOWNLOADING: {
    icon: Download,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    label: "Downloading",
  },
  UPLOADING: {
    icon: Upload,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    label: "Uploading",
  },
  PROCESSING: {
    icon: Cog,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    label: "Processing",
  },
  PUBLISHED: {
    icon: CheckCircle2,
    color: "text-green-400",
    bg: "bg-green-500/10",
    label: "Published",
  },
  FAILED: {
    icon: XCircle,
    color: "text-red-400",
    bg: "bg-red-500/10",
    label: "Failed",
  },
  SKIPPED: {
    icon: SkipForward,
    color: "text-yellow-400",
    bg: "bg-yellow-500/10",
    label: "Skipped",
  },
  CLAIMED: {
    icon: Clock,
    color: "text-yellow-400",
    bg: "bg-yellow-500/10",
    label: "Claimed",
  },
  PENDING_DELETION: {
    icon: CheckCircle2,
    color: "text-green-400",
    bg: "bg-green-500/10",
    label: "Published (Pending Cleanup)",
  },
  DELETED: {
    icon: CheckCircle2,
    color: "text-green-500",
    bg: "bg-green-500/10",
    label: "Published & Cleaned",
  },
};

export default function QueuePage() {
  const [posts, setPosts] = useState<QueuePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("all");
  const [expandedError, setExpandedError] = useState<string | null>(null);
  const [recoReport, setRecoReport] = useState<any>(null);
  const [loadingReport, setLoadingReport] = useState(false);

  const fetchPosts = useCallback(async () => {
    if (activeTab === "reconciliation") {
      setLoadingReport(true);
      try {
        const res = await fetch("/api/managed/posts/reconciliation");
        if (!res.ok) throw new Error("Failed to fetch reconciliation report");
        const data = await res.json();
        setRecoReport(data);
      } catch (err: any) {
        toast.error(err.message || "Failed to load report");
      } finally {
        setLoadingReport(false);
      }
      return;
    }

    try {
      const res = await fetch(`/api/managed/queue?filter=${activeTab}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error("Queue API error:", data);
        toast.error(data.error || `Failed to load posts (${res.status})`);
        return;
      }
      const data = await res.json();
      if (Array.isArray(data)) {
        setPosts(data);
      } else {
        console.error("Queue API returned non-array:", data);
        setPosts([]);
      }
    } catch (err) {
      console.error("Queue fetch error:", err);
      toast.error("Failed to connect to server");
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    setLoading(true);
    fetchPosts();
    const t = setInterval(fetchPosts, 30_000);
    return () => clearInterval(t);
  }, [fetchPosts]);

  const retry = async (id: string) => {
    setRetrying(id);
    try {
      const res = await fetch(`/api/managed/posts/${id}/retry`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Retry failed");
      toast.success("Post queued for retry");
      fetchPosts();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to retry"
      );
    } finally {
      setRetrying(null);
    }
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  // Count by status
  const counts = posts.reduce(
    (acc, p) => {
      acc[p.status] = (acc[p.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Post Queue</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Track all scheduled posts · auto-refreshes every 30s
          </p>
        </div>
        <button
          onClick={() => {
            setLoading(true);
            fetchPosts();
          }}
          className="p-2 rounded-xl text-gray-500 hover:text-white hover:bg-white/5 transition-all"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Status summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(["PUBLISHED", "FAILED", "PROCESSING", "SKIPPED"] as const).map(
          (status) => {
            const cfg = statusConfig[status];
            const Icon = cfg.icon;
            return (
              <div
                key={status}
                className={`${cfg.bg} border border-white/5 rounded-xl px-4 py-3 flex items-center gap-3`}
              >
                <Icon className={`w-5 h-5 ${cfg.color}`} />
                <div>
                  <p className={`text-lg font-bold ${cfg.color}`}>
                    {counts[status] || 0}
                  </p>
                  <p className="text-xs text-gray-500">{cfg.label}</p>
                </div>
              </div>
            );
          }
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-white/[0.02] border border-white/5 rounded-xl p-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 text-xs font-medium px-3 py-2 rounded-lg transition-all ${
              activeTab === tab.key
                ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                : "text-gray-500 hover:text-gray-300 border border-transparent"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Posts list */}
      {activeTab === "reconciliation" ? (
        loadingReport ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
          </div>
        ) : !recoReport ? (
          <div className="text-gray-500 text-center py-6">Failed to load report data.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Duplicates Section */}
            <div className="glass border border-white/5 rounded-2xl p-5 space-y-3">
              <h3 className="font-bold text-white text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                Videos Posted Multiple Times ({recoReport.duplicates?.length || 0})
              </h3>
              {recoReport.duplicates?.length === 0 ? (
                <p className="text-xs text-gray-500">No duplicate postings detected. Idempotency is working perfectly.</p>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {recoReport.duplicates.map((dup: any, idx: number) => (
                    <div key={idx} className="bg-white/[0.02] border border-white/5 rounded-xl p-3 text-xs">
                      <p className="text-white font-medium">Account: @{dup.tiktokUsername}</p>
                      <p className="text-gray-400 mt-1">File ID: <code className="bg-black/30 px-1 py-0.5 rounded text-[10px]">{dup.driveFileId}</code> (Posted {dup.count} times)</p>
                      <div className="mt-2 pl-3 border-l border-white/5 space-y-1">
                        {dup.posts.map((p: any, pIdx: number) => (
                          <div key={pIdx} className="flex justify-between items-center text-[10px] text-gray-500">
                            <span>Posted {timeAgo(p.publishedAt)}</span>
                            {p.tiktokPostUrl && (
                              <a href={p.tiktokPostUrl} target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">View Post</a>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Stuck In Progress Section */}
            <div className="glass border border-white/5 rounded-2xl p-5 space-y-3">
              <h3 className="font-bold text-white text-sm flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-400" />
                Stuck In-Progress Jobs ({recoReport.stuckJobs?.length || 0})
              </h3>
              {recoReport.stuckJobs?.length === 0 ? (
                <p className="text-xs text-gray-500">No stuck jobs. All postings completed cleanly or failed.</p>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {recoReport.stuckJobs.map((job: any) => (
                    <div key={job.id} className="bg-white/[0.02] border border-white/5 rounded-xl p-3 text-xs flex justify-between items-center">
                      <div>
                        <p className="text-white font-medium">{job.driveFileName}</p>
                        <p className="text-[10px] text-gray-500">State: {job.state} · Locked {timeAgo(job.lockedAt)} for @{job.tiktokUsername}</p>
                      </div>
                      <span className="text-[10px] text-amber-400 font-semibold bg-amber-500/10 px-2 py-0.5 rounded-full">Reconciling</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Posted but Not Deleted Section */}
            <div className="glass border border-white/5 rounded-2xl p-5 space-y-3">
              <h3 className="font-bold text-white text-sm flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-400" />
                Videos Posted but Not Deleted ({recoReport.notDeleted?.length || 0})
              </h3>
              {recoReport.notDeleted?.length === 0 ? (
                <p className="text-xs text-gray-500">All published videos have been cleaned up or are in the delayed queue.</p>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {recoReport.notDeleted.map((job: any) => (
                    <div key={job.id} className="bg-white/[0.02] border border-white/5 rounded-xl p-3 text-xs flex justify-between items-center">
                      <div>
                        <p className="text-white font-medium">{job.driveFileName}</p>
                        <p className="text-[10px] text-gray-500">State: {job.state} · Published {timeAgo(job.publishedAt)} for @{job.tiktokUsername}</p>
                      </div>
                      <span className="text-[10px] text-blue-400 font-semibold bg-blue-500/10 px-2 py-0.5 rounded-full">Pending Delete</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Untracked Files Section */}
            <div className="glass border border-white/5 rounded-2xl p-5 space-y-3">
              <h3 className="font-bold text-white text-sm flex items-center gap-2">
                <Cog className="w-4 h-4 text-purple-400" />
                Videos in Drive Not Tracked Yet ({recoReport.untracked?.length || 0})
              </h3>
              {recoReport.untracked?.length === 0 ? (
                <p className="text-xs text-gray-500">All files in Google Drive folders are currently indexed.</p>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {recoReport.untracked.map((file: any, idx: number) => (
                    <div key={idx} className="bg-white/[0.02] border border-white/5 rounded-xl p-3 text-xs flex justify-between items-center">
                      <div className="min-w-0 flex-1">
                        <p className="text-white font-medium truncate">{file.filename}</p>
                        <p className="text-[10px] text-gray-500 truncate">ID: <code className="bg-black/30 px-1 py-0.5 rounded text-[10px]">{file.fileId}</code></p>
                      </div>
                      <span className="text-[10px] text-purple-400 font-semibold bg-purple-500/10 px-2.5 py-0.5 rounded-full flex-shrink-0">@{file.tiktokUsername}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      ) : loading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
        </div>
      ) : posts.length === 0 ? (
        <div className="glass border border-white/5 rounded-2xl p-12 text-center">
          <Clock className="w-10 h-10 mx-auto mb-3 text-gray-600" />
          <h3 className="text-lg font-semibold text-white mb-1">
            No posts found
          </h3>
          <p className="text-gray-500 text-sm max-w-md mx-auto">
            {activeTab === "all"
              ? "Posts will appear here when the scheduler runs. Make sure you have active accounts with Drive folders linked and time slots configured."
              : `No ${activeTab} posts at the moment.`}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {posts.map((post) => {
            const cfg = statusConfig[post.status] || statusConfig.QUEUED;
            const Icon = cfg.icon;
            const isExpanded = expandedError === post.id;

            return (
              <div
                key={post.id}
                className="glass border border-white/5 rounded-xl p-4 hover:border-white/10 transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left: account + file info */}
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <img
                      src={
                        post.account.tiktokAvatarUrl || "/default-avatar.png"
                      }
                      className="w-9 h-9 rounded-full flex-shrink-0 mt-0.5"
                      alt=""
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white text-sm font-medium">
                          @{post.account.tiktokUsername}
                        </span>
                        <span className="text-gray-600 text-xs">
                          {post.account.group.section.name} /{" "}
                          {post.account.group.name}
                        </span>
                      </div>
                      <p className="text-gray-400 text-xs mt-0.5 truncate">
                        {post.driveFileName || "—"}
                      </p>
                      {post.caption && (
                        <p className="text-gray-500 text-[10px] mt-0.5 truncate" title={post.caption}>
                          📝 {post.caption.slice(0, 80)}{post.caption.length > 80 ? "…" : ""}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-gray-600 text-[10px]">
                          {timeAgo(post.createdAt)}
                          {post.publishedAt &&
                            ` · Published ${timeAgo(post.publishedAt)}`}
                        </span>
                        {(post.tiktokPostUrl || post.tiktokVideoId) && (
                          <a
                            href={post.tiktokPostUrl || `https://www.tiktok.com/@${post.account.tiktokUsername}/video/${post.tiktokVideoId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 text-[10px] text-purple-400 hover:text-purple-300 transition-colors"
                          >
                            <ExternalLink className="w-2.5 h-2.5" />
                            TikTok Link
                          </a>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: status + actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span
                      className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${cfg.bg} ${cfg.color}`}
                    >
                      <Icon className="w-3 h-3" />
                      {cfg.label}
                    </span>
                    {post.driveFileId && (
                      <a
                        href={`https://drive.google.com/file/d/${post.driveFileId}/view`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 px-2.5 py-1 rounded-full transition-all"
                        title="Open in Google Drive"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        View File
                      </a>
                    )}
                    {post.status === "FAILED" && (
                      <button
                        onClick={() => retry(post.id)}
                        disabled={retrying === post.id}
                        className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 bg-amber-400/10 px-2.5 py-1 rounded-full transition-colors disabled:opacity-50"
                      >
                        {retrying === post.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3 h-3" />
                        )}
                        Retry
                      </button>
                    )}
                  </div>
                </div>

                {/* Error message */}
                {post.errorMessage && (
                  <div className="mt-3">
                    <button
                      onClick={() =>
                        setExpandedError(isExpanded ? null : post.id)
                      }
                      className="flex items-start gap-2 w-full text-left"
                    >
                      <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                      <p
                        className={`text-xs ${
                          post.status === "FAILED"
                            ? "text-red-400"
                            : "text-yellow-400/80"
                        } ${isExpanded ? "" : "line-clamp-1"}`}
                      >
                        {post.errorMessage}
                      </p>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
