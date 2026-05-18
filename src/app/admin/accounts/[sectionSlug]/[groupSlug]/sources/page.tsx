"use client";
import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Plus, Loader2, X, ChevronRight, Trash2, Video, ExternalLink,
  RefreshCw, Eye, ThumbsUp, MessageSquare, Download, Clock, ToggleLeft, ToggleRight,
} from "lucide-react";

type Source = {
  id: string;
  type: "CHANNEL" | "PLAYLIST";
  youtubeId: string;
  url: string;
  title: string;
  thumbnailUrl: string | null;
  subscriberCount: number | null;
  maxVideosPerFetch: number;
  isActive: boolean;
  lastFetchedAt: string | null;
  _count: { videos: number };
};

type SourcedVideoItem = {
  id: string;
  youtubeVideoId: string;
  title: string;
  description: string | null;
  thumbnailUrl: string;
  channelTitle: string;
  publishedAt: string;
  duration: string;
  viewCount: string;
  likeCount: string;
  commentCount: string;
  status: "NEW" | "DOWNLOADED" | "CLIPPED" | "SKIPPED";
  source: { title: string; type: string };
};

type GroupInfo = {
  id: string;
  name: string;
  slug: string;
  section: { name: string; slug: string; color: string };
};

function formatCount(n: string | number): string {
  const num = typeof n === "string" ? parseInt(n, 10) : n;
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  return num.toLocaleString();
}

function formatDuration(iso: string): string {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return iso;
  const h = parseInt(m[1] || "0"), min = parseInt(m[2] || "0"), s = parseInt(m[3] || "0");
  if (h > 0) return `${h}:${min.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${min}:${s.toString().padStart(2, "0")}`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const STATUS_COLORS: Record<string, string> = {
  NEW: "bg-blue-500/10 text-blue-400",
  DOWNLOADED: "bg-green-500/10 text-green-400",
  CLIPPED: "bg-purple-500/10 text-purple-400",
  SKIPPED: "bg-gray-500/10 text-gray-500",
};

export default function SourcesPage({
  params,
}: {
  params: Promise<{ sectionSlug: string; groupSlug: string }>;
}) {
  const { sectionSlug, groupSlug } = use(params);
  const [group, setGroup] = useState<GroupInfo | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [videos, setVideos] = useState<SourcedVideoItem[]>([]);
  const [videoTotal, setVideoTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState("views");
  const [statusFilter, setStatusFilter] = useState("");
  const [tab, setTab] = useState<"videos" | "sources">("videos");

  const fetchGroup = useCallback(async () => {
    const res = await fetch(`/api/managed/groups/by-path/${sectionSlug}/${groupSlug}`);
    if (res.ok) {
      const data = await res.json();
      setGroup(data);
      return data.id;
    }
    return null;
  }, [sectionSlug, groupSlug]);

  const fetchSources = useCallback(async (groupId: string) => {
    const res = await fetch(`/api/managed/sources?groupId=${groupId}`);
    if (res.ok) setSources(await res.json());
  }, []);

  const fetchVideos = useCallback(async (groupId: string) => {
    const params = new URLSearchParams({ groupId, sortBy, limit: "50" });
    if (statusFilter) params.set("status", statusFilter);
    const res = await fetch(`/api/managed/videos?${params}`);
    if (res.ok) {
      const data = await res.json();
      setVideos(data.videos);
      setVideoTotal(data.total);
    }
  }, [sortBy, statusFilter]);

  useEffect(() => {
    (async () => {
      const gid = await fetchGroup();
      if (gid) {
        await Promise.all([fetchSources(gid), fetchVideos(gid)]);
      }
      setLoading(false);
    })();
  }, [fetchGroup, fetchSources, fetchVideos]);

  const addSource = async () => {
    if (!addUrl.trim() || !group) return;
    setAdding(true);
    try {
      const res = await fetch("/api/managed/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: group.id, url: addUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success(`Added: ${data.title}`);
      setAddUrl("");
      setShowAdd(false);
      fetchSources(group.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add source");
    } finally {
      setAdding(false);
    }
  };

  const deleteSource = async (id: string, title: string) => {
    if (!confirm(`Remove "${title}" and all its discovered videos?`)) return;
    try {
      await fetch(`/api/managed/sources/${id}`, { method: "DELETE" });
      toast.success(`Removed: ${title}`);
      if (group) {
        fetchSources(group.id);
        fetchVideos(group.id);
      }
    } catch { toast.error("Failed to delete"); }
  };

  const toggleSource = async (id: string, currentActive: boolean) => {
    try {
      await fetch(`/api/managed/sources/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !currentActive }),
      });
      toast.success(currentActive ? "Source paused" : "Source activated");
      if (group) fetchSources(group.id);
    } catch { toast.error("Update failed"); }
  };

  const fetchNow = async (id: string) => {
    setFetchingId(id);
    try {
      const res = await fetch(`/api/managed/sources/${id}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Fetch failed");
      toast.success(`Discovered ${data.discovered} videos`);
      if (group) fetchVideos(group.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Fetch failed");
    } finally {
      setFetchingId(null);
    }
  };

  const updateVideoStatus = async (id: string, status: string) => {
    try {
      await fetch(`/api/managed/videos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (group) fetchVideos(group.id);
    } catch { toast.error("Update failed"); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
      </div>
    );
  }

  if (!group) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500">Group not found</p>
        <Link href="/admin/accounts" className="text-purple-400 hover:text-purple-300 text-sm mt-2 inline-block">← Back</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/admin/accounts" className="hover:text-white transition-colors">Accounts</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <Link href={`/admin/accounts/${sectionSlug}`} className="hover:text-white transition-colors">{group.section.name}</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <Link href={`/admin/accounts/${sectionSlug}/${groupSlug}`} className="hover:text-white transition-colors">{group.name}</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-white font-medium">Video Sources</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-3 h-8 rounded-full" style={{ backgroundColor: group.section.color }} />
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Video className="w-6 h-6 text-red-500" />
              {group.name} — Video Sources
            </h1>
            <p className="text-gray-500 text-sm">{sources.length} sources · {videoTotal} videos discovered</p>
          </div>
        </div>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-all">
          <Plus className="w-4 h-4" /> Add Source
        </button>
      </div>

      {/* Add Source Form */}
      {showAdd && (
        <div className="glass border border-red-500/20 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-white flex items-center gap-2">
              <Video className="w-4 h-4 text-red-500" /> Add YouTube Source
            </h3>
            <button onClick={() => setShowAdd(false)} className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
          </div>
          <p className="text-xs text-gray-500">Paste a YouTube channel URL (e.g. youtube.com/@MrBeast) or playlist URL</p>
          <div className="flex gap-2">
            <input
              type="text" value={addUrl} onChange={(e) => setAddUrl(e.target.value)}
              placeholder="https://youtube.com/@ChannelName or playlist URL"
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-red-500 transition-colors text-sm"
              onKeyDown={(e) => e.key === "Enter" && addSource()}
            />
            <button onClick={addSource} disabled={!addUrl.trim() || adding}
              className="bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-sm font-semibold px-5 py-3 rounded-xl transition-all flex items-center gap-2">
              {adding && <Loader2 className="w-4 h-4 animate-spin" />} Add
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-white/5 rounded-xl p-1">
        <button onClick={() => setTab("videos")}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${tab === "videos" ? "bg-white/10 text-white" : "text-gray-500 hover:text-gray-300"}`}>
          📹 Discovered Videos ({videoTotal})
        </button>
        <button onClick={() => setTab("sources")}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${tab === "sources" ? "bg-white/10 text-white" : "text-gray-500 hover:text-gray-300"}`}>
          📡 Sources ({sources.length})
        </button>
      </div>

      {/* Sources Tab */}
      {tab === "sources" && (
        <div className="space-y-3">
          {sources.length === 0 ? (
            <div className="glass border border-white/5 rounded-2xl p-12 text-center">
              <Video className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">No sources yet</h3>
              <p className="text-gray-500 text-sm mb-6">Add YouTube channels or playlists to start sourcing videos</p>
              <button onClick={() => setShowAdd(true)} className="bg-red-600 hover:bg-red-500 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all inline-flex items-center gap-2">
                <Plus className="w-4 h-4" /> Add First Source
              </button>
            </div>
          ) : (
            sources.map((s) => (
              <div key={s.id} className="glass border border-white/5 rounded-2xl p-5 hover:border-white/10 transition-all">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {s.thumbnailUrl ? (
                      <img src={s.thumbnailUrl} alt={s.title} className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                        <Video className="w-5 h-5 text-red-400" />
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white">{s.title || "Untitled"}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${s.type === "CHANNEL" ? "bg-red-500/10 text-red-400" : "bg-blue-500/10 text-blue-400"}`}>
                          {s.type}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                        {s.subscriberCount != null && (
                          <span>{formatCount(s.subscriberCount)} {s.type === "CHANNEL" ? "subs" : "items"}</span>
                        )}
                        <span>{s._count.videos} videos found</span>
                        <span className="text-amber-400/80">max {s.maxVideosPerFetch}/fetch</span>
                        {s.lastFetchedAt && <span>Last fetched: {timeAgo(s.lastFetchedAt)}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => fetchNow(s.id)} disabled={fetchingId === s.id}
                      className="flex items-center gap-1 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all disabled:opacity-40"
                      title="Fetch videos now">
                      {fetchingId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                      Fetch Now
                    </button>
                    <button onClick={() => toggleSource(s.id, s.isActive)}
                      className={`p-2 rounded-lg transition-all ${s.isActive ? "text-green-400 hover:bg-green-400/10" : "text-gray-500 hover:bg-white/5"}`}
                      title={s.isActive ? "Pause" : "Activate"}>
                      {s.isActive ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                    </button>
                    <a href={s.url} target="_blank" rel="noopener noreferrer"
                      className="p-2 rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-all">
                      <ExternalLink className="w-4 h-4" />
                    </a>
                    <button onClick={() => deleteSource(s.id, s.title)}
                      className="p-2 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-400/10 transition-all">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Videos Tab */}
      {tab === "videos" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-3">
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500">
              <option value="views">Most Views</option>
              <option value="recent">Most Recent</option>
              <option value="likes">Most Likes</option>
              <option value="discovered">Recently Discovered</option>
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500">
              <option value="">All Status</option>
              <option value="NEW">New</option>
              <option value="DOWNLOADED">Downloaded</option>
              <option value="CLIPPED">Clipped</option>
              <option value="SKIPPED">Skipped</option>
            </select>
            <span className="text-xs text-gray-500 ml-auto">{videoTotal} videos</span>
          </div>

          {videos.length === 0 ? (
            <div className="glass border border-white/5 rounded-2xl p-12 text-center">
              <Eye className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">No videos yet</h3>
              <p className="text-gray-500 text-sm">Add sources and click &quot;Fetch Now&quot; to discover videos</p>
            </div>
          ) : (
            <div className="space-y-2">
              {videos.map((v) => (
                <div key={v.id} className="glass border border-white/5 rounded-xl p-4 hover:border-white/10 transition-all">
                  <div className="flex gap-4">
                    {/* Thumbnail */}
                    <a href={`https://youtube.com/watch?v=${v.youtubeVideoId}`} target="_blank" rel="noopener noreferrer"
                      className="relative flex-shrink-0 w-40 h-[90px] rounded-lg overflow-hidden group">
                      <img src={v.thumbnailUrl} alt={v.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                      <div className="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1.5 py-0.5 rounded font-mono">
                        {formatDuration(v.duration)}
                      </div>
                    </a>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <a href={`https://youtube.com/watch?v=${v.youtubeVideoId}`} target="_blank" rel="noopener noreferrer"
                        className="font-semibold text-white text-sm hover:text-purple-300 transition-colors line-clamp-2">
                        {v.title}
                      </a>
                      <p className="text-xs text-gray-500 mt-1">{v.channelTitle} · {timeAgo(v.publishedAt)}</p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                        <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{formatCount(v.viewCount)}</span>
                        <span className="flex items-center gap-1"><ThumbsUp className="w-3 h-3" />{formatCount(v.likeCount)}</span>
                        <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{formatCount(v.commentCount)}</span>
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDuration(v.duration)}</span>
                      </div>
                    </div>
                    {/* Actions */}
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[v.status]}`}>
                        {v.status}
                      </span>
                      <div className="flex gap-1">
                        {v.status === "NEW" && (
                          <>
                            <a href={`https://youtube.com/watch?v=${v.youtubeVideoId}`} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 text-green-400 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-all">
                              <Download className="w-3 h-3" /> Open
                            </a>
                            <button onClick={() => updateVideoStatus(v.id, "SKIPPED")}
                              className="text-xs text-gray-600 hover:text-gray-400 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-all">
                              Skip
                            </button>
                          </>
                        )}
                        {v.status === "DOWNLOADED" && (
                          <button onClick={() => updateVideoStatus(v.id, "CLIPPED")}
                            className="text-xs text-purple-400 hover:text-purple-300 px-2 py-1.5 rounded-lg hover:bg-purple-500/10 transition-all">
                            Mark Clipped
                          </button>
                        )}
                        {v.status === "SKIPPED" && (
                          <button onClick={() => updateVideoStatus(v.id, "NEW")}
                            className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1.5 rounded-lg hover:bg-blue-500/10 transition-all">
                            Undo Skip
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
