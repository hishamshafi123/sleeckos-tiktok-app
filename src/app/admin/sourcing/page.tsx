"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Loader2, Video, Eye, ThumbsUp, MessageSquare, Clock,
  ChevronRight, RefreshCw, ExternalLink, Settings2,
} from "lucide-react";

type Section = {
  id: string;
  name: string;
  slug: string;
  color: string;
  maxSources: number;
  groups: {
    id: string;
    name: string;
    slug: string;
    _count: { youtubeSources: number; sourcedVideos: number };
  }[];
};

type SourcedVideoItem = {
  id: string;
  youtubeVideoId: string;
  title: string;
  thumbnailUrl: string;
  channelTitle: string;
  publishedAt: string;
  duration: string;
  viewCount: string;
  likeCount: string;
  commentCount: string;
  status: string;
  source: { title: string; type: string };
  group: { name: string; slug: string; section: { name: string; slug: string } };
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
  return `${Math.floor(hrs / 24)}d ago`;
}

const STATUS_COLORS: Record<string, string> = {
  NEW: "bg-blue-500/10 text-blue-400",
  DOWNLOADED: "bg-green-500/10 text-green-400",
  CLIPPED: "bg-purple-500/10 text-purple-400",
  SKIPPED: "bg-gray-500/10 text-gray-500",
};

export default function SourcingDashboard() {
  const [sections, setSections] = useState<Section[]>([]);
  const [videos, setVideos] = useState<SourcedVideoItem[]>([]);
  const [videoTotal, setVideoTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState("discovered");
  const [statusFilter, setStatusFilter] = useState("");
  const [sectionFilter, setSectionFilter] = useState("");

  const fetchSections = useCallback(async () => {
    const res = await fetch("/api/managed/sections");
    if (res.ok) setSections(await res.json());
  }, []);

  const fetchVideos = useCallback(async () => {
    const params = new URLSearchParams({ sortBy, limit: "50" });
    if (statusFilter) params.set("status", statusFilter);
    if (sectionFilter) params.set("sectionId", sectionFilter);
    const res = await fetch(`/api/managed/videos?${params}`);
    if (res.ok) {
      const data = await res.json();
      setVideos(data.videos);
      setVideoTotal(data.total);
    }
  }, [sortBy, statusFilter, sectionFilter]);

  useEffect(() => {
    Promise.all([fetchSections(), fetchVideos()]).finally(() => setLoading(false));
  }, [fetchSections, fetchVideos]);

  const updateVideoStatus = async (id: string, status: string) => {
    try {
      await fetch(`/api/managed/videos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      fetchVideos();
    } catch { toast.error("Update failed"); }
  };

  // Count totals
  const totalSources = sections.reduce((s, sec) => s + sec.groups.reduce((g, gr) => g + gr._count.youtubeSources, 0), 0);
  const totalVideosAll = sections.reduce((s, sec) => s + sec.groups.reduce((g, gr) => g + gr._count.sourcedVideos, 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 text-red-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center">
              <Video className="w-5 h-5 text-red-500" />
            </div>
            Video Sourcing
          </h1>
          <p className="text-gray-500 mt-1">{totalSources} sources · {totalVideosAll} videos discovered</p>
        </div>
      </div>

      {/* Niche Overview Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) => {
          const srcCount = section.groups.reduce((s, g) => s + g._count.youtubeSources, 0);
          const vidCount = section.groups.reduce((s, g) => s + g._count.sourcedVideos, 0);
          if (srcCount === 0 && section.groups.length === 0) return null;
          return (
            <div key={section.id} className="glass border border-white/5 rounded-2xl overflow-hidden hover:border-white/10 transition-all">
              <div className="h-1" style={{ backgroundColor: section.color }} />
              <div className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-white">{section.name}</h3>
                  <span className="text-xs text-gray-500">max {section.maxSources} sources/group</span>
                </div>
                <div className="flex items-center gap-4 text-sm text-gray-400 mb-4">
                  <span>{srcCount} sources</span>
                  <span>{vidCount} videos</span>
                  <span>{section.groups.length} sub-niches</span>
                </div>
                {/* Sub-niche list */}
                <div className="space-y-1.5">
                  {section.groups.map((g) => (
                    <Link
                      key={g.id}
                      href={`/admin/accounts/${section.slug}/${g.slug}/sources`}
                      className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/3 hover:bg-white/5 transition-colors"
                    >
                      <span className="text-sm text-gray-300">{g.name}</span>
                      <div className="flex items-center gap-2 text-xs text-gray-600">
                        <span>{g._count.youtubeSources} src</span>
                        <span>{g._count.sourcedVideos} vids</span>
                        <ChevronRight className="w-3 h-3" />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Global Video Feed */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">All Discovered Videos</h2>
          <span className="text-xs text-gray-500">{videoTotal} total</span>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500">
            <option value="discovered">Recently Discovered</option>
            <option value="recent">Most Recent (YouTube)</option>
            <option value="views">Most Views</option>
            <option value="likes">Most Likes</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500">
            <option value="">All Status</option>
            <option value="NEW">New</option>
            <option value="DOWNLOADED">Downloaded</option>
            <option value="CLIPPED">Clipped</option>
            <option value="SKIPPED">Skipped</option>
          </select>
          <select value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500">
            <option value="">All Niches</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* Video list */}
        {videos.length === 0 ? (
          <div className="glass border border-white/5 rounded-2xl p-12 text-center">
            <Video className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">No videos yet</h3>
            <p className="text-gray-500 text-sm">Add YouTube sources to your sub-niches and fetch videos to get started</p>
          </div>
        ) : (
          <div className="space-y-2">
            {videos.map((v) => (
              <div key={v.id} className="glass border border-white/5 rounded-xl p-4 hover:border-white/10 transition-all">
                <div className="flex gap-4">
                  <a href={`https://youtube.com/watch?v=${v.youtubeVideoId}`} target="_blank" rel="noopener noreferrer"
                    className="relative flex-shrink-0 w-40 h-[90px] rounded-lg overflow-hidden group">
                    <img src={v.thumbnailUrl} alt={v.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                    <div className="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1.5 py-0.5 rounded font-mono">{formatDuration(v.duration)}</div>
                  </a>
                  <div className="flex-1 min-w-0">
                    <a href={`https://youtube.com/watch?v=${v.youtubeVideoId}`} target="_blank" rel="noopener noreferrer"
                      className="font-semibold text-white text-sm hover:text-purple-300 transition-colors line-clamp-2">{v.title}</a>
                    <p className="text-xs text-gray-500 mt-1">
                      {v.channelTitle} · {timeAgo(v.publishedAt)}
                      <span className="text-gray-600 ml-2">{v.group.section.name} → {v.group.name}</span>
                    </p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                      <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{formatCount(v.viewCount)}</span>
                      <span className="flex items-center gap-1"><ThumbsUp className="w-3 h-3" />{formatCount(v.likeCount)}</span>
                      <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{formatCount(v.commentCount)}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[v.status]}`}>{v.status}</span>
                    <div className="flex gap-1">
                      <a href={`https://youtube.com/watch?v=${v.youtubeVideoId}`} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 bg-white/5 hover:bg-white/10 text-gray-400 text-xs px-2.5 py-1.5 rounded-lg transition-all">
                        <ExternalLink className="w-3 h-3" /> Open
                      </a>
                      {v.status === "NEW" && (
                        <button onClick={() => updateVideoStatus(v.id, "SKIPPED")}
                          className="text-xs text-gray-600 hover:text-gray-400 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-all">Skip</button>
                      )}
                      {v.status === "SKIPPED" && (
                        <button onClick={() => updateVideoStatus(v.id, "NEW")}
                          className="text-xs text-blue-400 px-2 py-1.5 rounded-lg hover:bg-blue-500/10 transition-all">Undo</button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
