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
};

export default function QueuePage() {
  const [posts, setPosts] = useState<QueuePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("all");
  const [expandedError, setExpandedError] = useState<string | null>(null);

  const fetchPosts = useCallback(async () => {
    try {
      const res = await fetch(`/api/managed/queue?filter=${activeTab}`);
      if (res.ok) setPosts(await res.json());
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
      {loading ? (
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
                        {post.driveFileName || post.caption || "—"}
                      </p>
                      <p className="text-gray-600 text-[10px] mt-1">
                        {timeAgo(post.createdAt)}
                        {post.publishedAt &&
                          ` · Published ${timeAgo(post.publishedAt)}`}
                      </p>
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
