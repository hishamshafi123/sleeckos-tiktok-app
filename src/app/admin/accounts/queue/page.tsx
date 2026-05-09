"use client";
import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { Clock, RefreshCw, Loader2 } from "lucide-react";

type QueuePost = {
  id: string;
  status: string;
  driveFileName: string | null;
  scheduledFor: string;
  errorMessage: string | null;
  caption: string;
  account: {
    tiktokUsername: string;
    tiktokAvatarUrl: string;
    group: { name: string; section: { name: string } };
  };
};

const statusColor: Record<string, string> = {
  QUEUED: "bg-gray-500/10 text-gray-400",
  DOWNLOADING: "bg-blue-500/10 text-blue-400",
  UPLOADING: "bg-blue-500/10 text-blue-400",
  PROCESSING: "bg-amber-500/10 text-amber-400",
  FAILED: "bg-red-500/10 text-red-400",
};

export default function QueuePage() {
  const [posts, setPosts] = useState<QueuePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);

  const fetchPosts = useCallback(async () => {
    try {
      const res = await fetch("/api/managed/queue");
      if (res.ok) setPosts(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPosts();
    // Auto-refresh every 30s
    const t = setInterval(fetchPosts, 30_000);
    return () => clearInterval(t);
  }, [fetchPosts]);

  const retry = async (id: string) => {
    setRetrying(id);
    try {
      const res = await fetch(`/api/managed/posts/${id}/retry`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Retry failed");
      toast.success("Post queued for retry");
      fetchPosts();
    } catch {
      toast.error("Failed to retry");
    } finally {
      setRetrying(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Post Queue</h1>
          <p className="text-gray-500 mt-1">
            Upcoming and in-progress scheduled posts · auto-refreshes every 30s
          </p>
        </div>
        <button
          onClick={fetchPosts}
          className="p-2 rounded-xl text-gray-500 hover:text-white hover:bg-white/5 transition-all"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="glass border border-white/5 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5">
              <th className="text-left px-4 py-3 text-gray-500 font-medium">
                Account
              </th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium">
                Section / Group
              </th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium">
                Video
              </th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium">
                Scheduled For
              </th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium">
                Status
              </th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium">
                Error
              </th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {posts.map((post) => (
              <tr
                key={post.id}
                className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <img
                      src={
                        post.account.tiktokAvatarUrl || "/default-avatar.png"
                      }
                      className="w-6 h-6 rounded-full"
                      alt=""
                    />
                    <span className="text-white text-xs">
                      @{post.account.tiktokUsername}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {post.account.group.section.name} /{" "}
                  {post.account.group.name}
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs max-w-[150px] truncate">
                  {post.driveFileName || "—"}
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {new Date(post.scheduledFor).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      statusColor[post.status] ||
                      "bg-gray-500/10 text-gray-400"
                    }`}
                  >
                    {post.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-red-400 text-xs max-w-[180px] truncate">
                  {post.errorMessage || "—"}
                </td>
                <td className="px-4 py-3">
                  {post.status === "FAILED" && (
                    <button
                      onClick={() => retry(post.id)}
                      disabled={retrying === post.id}
                      className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-50"
                    >
                      {retrying === post.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3 h-3" />
                      )}
                      Retry
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {posts.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-gray-600">
                  <Clock className="w-8 h-8 mx-auto mb-3 opacity-30" />
                  No posts in queue. Posts will appear here when the scheduler
                  runs.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
