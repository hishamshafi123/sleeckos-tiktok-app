"use client";
import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Loader2, Plus, X, Trash2, ChevronRight, RefreshCw,
  ExternalLink, Eye, ThumbsUp, Clock, ToggleLeft, ToggleRight,
  Users, Video,
} from "lucide-react";

type Account = {
  id: string;
  tiktokUsername: string;
  tiktokDisplayName: string;
  tiktokAvatarUrl: string;
  isActive: boolean;
  group: { name: string; section: { name: string } };
};

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

type NicheDetail = {
  id: string;
  name: string;
  color: string;
  description: string | null;
  accounts: { account: Account }[];
  sources: Source[];
  _count: { videos: number };
};

type VideoItem = {
  id: string;
  youtubeVideoId: string;
  title: string;
  thumbnailUrl: string;
  channelTitle: string;
  publishedAt: string;
  duration: string;
  viewCount: string;
  likeCount: string;
  status: string;
};

type AllAccount = {
  id: string;
  tiktokUsername: string;
  tiktokAvatarUrl: string;
  group: { name: string; section: { name: string } };
};

function formatCount(n: string | number) {
  const num = typeof n === "string" ? parseInt(n, 10) : n;
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  return num.toLocaleString();
}
function formatDur(iso: string) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return iso;
  const h = parseInt(m[1] || "0"), min = parseInt(m[2] || "0"), s = parseInt(m[3] || "0");
  return h > 0 ? `${h}:${min.toString().padStart(2,"0")}:${s.toString().padStart(2,"0")}` : `${min}:${s.toString().padStart(2,"0")}`;
}
function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff/60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m/60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h/24)}d ago`;
}

export default function NichePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [niche, setNiche] = useState<NicheDetail | null>(null);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [videoTotal, setVideoTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"videos" | "accounts" | "sources">("videos");
  const [addUrl, setAddUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [sortBy, setSortBy] = useState("discovered");
  // Account picker
  const [allAccounts, setAllAccounts] = useState<AllAccount[]>([]);
  const [accountSearch, setAccountSearch] = useState("");
  const [showAccountPicker, setShowAccountPicker] = useState(false);

  const fetchNiche = useCallback(async () => {
    const res = await fetch(`/api/sourcing/niches/${id}`);
    if (res.ok) setNiche(await res.json());
  }, [id]);

  const fetchVideos = useCallback(async () => {
    const p = new URLSearchParams({ nicheId: id, sortBy, limit: "50" });
    if (statusFilter) p.set("status", statusFilter);
    const res = await fetch(`/api/managed/videos?${p}`);
    if (res.ok) { const d = await res.json(); setVideos(d.videos); setVideoTotal(d.total); }
  }, [id, sortBy, statusFilter]);

  const fetchAllAccounts = useCallback(async () => {
    const res = await fetch("/api/managed/accounts/all");
    if (res.ok) setAllAccounts(await res.json());
  }, []);

  useEffect(() => {
    Promise.all([fetchNiche(), fetchVideos()]).finally(() => setLoading(false));
  }, [fetchNiche, fetchVideos]);

  const addSource = async () => {
    if (!addUrl.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/managed/sources", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nicheId: id, url: addUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Added: ${data.title}`);
      setAddUrl("");
      fetchNiche();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
    finally { setAdding(false); }
  };

  const deleteSource = async (sourceId: string, title: string) => {
    if (!confirm(`Remove "${title}"?`)) return;
    await fetch(`/api/managed/sources/${sourceId}`, { method: "DELETE" });
    toast.success("Removed");
    fetchNiche(); fetchVideos();
  };

  const toggleSource = async (sourceId: string, current: boolean) => {
    await fetch(`/api/managed/sources/${sourceId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !current }),
    });
    fetchNiche();
  };

  const fetchNow = async (sourceId: string) => {
    setFetchingId(sourceId);
    try {
      const res = await fetch(`/api/managed/sources/${sourceId}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Fetched ${data.discovered} videos`);
      fetchVideos(); fetchNiche();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
    finally { setFetchingId(null); }
  };

  const addAccount = async (accountId: string) => {
    const res = await fetch(`/api/sourcing/niches/${id}/accounts`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId }),
    });
    if (res.ok) { toast.success("Account added"); fetchNiche(); }
    else { const d = await res.json(); toast.error(d.error); }
  };

  const removeAccount = async (accountId: string, username: string) => {
    if (!confirm(`Remove @${username} from this sub-niche?`)) return;
    await fetch(`/api/sourcing/niches/${id}/accounts`, {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId }),
    });
    toast.success(`Removed @${username}`);
    fetchNiche();
  };

  const updateVideoStatus = async (vid: string, status: string) => {
    await fetch(`/api/managed/videos/${vid}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    fetchVideos();
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-red-400" /></div>;
  if (!niche) return <div className="text-center py-20 text-gray-500">Sub-niche not found. <Link href="/admin/sourcing" className="text-red-400">← Back</Link></div>;

  const assignedIds = new Set(niche.accounts.map(a => a.account.id));
  const filteredAccounts = allAccounts.filter(a =>
    !assignedIds.has(a.id) &&
    (a.tiktokUsername.toLowerCase().includes(accountSearch.toLowerCase()) ||
     a.group.name.toLowerCase().includes(accountSearch.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/admin/sourcing" className="hover:text-white transition-colors">Video Sourcing</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-white font-medium">{niche.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-2 h-10 rounded-full" style={{ backgroundColor: niche.color }} />
        <div>
          <h1 className="text-2xl font-bold text-white">{niche.name}</h1>
          <p className="text-gray-500 text-sm">
            {niche.accounts.length} accounts · {niche.sources.length} YouTube channels · {niche._count.videos} videos
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white/5 rounded-xl p-1">
        {([
          ["videos", `📹 Videos (${videoTotal})`],
          ["accounts", `👤 Accounts (${niche.accounts.length})`],
          ["sources", `📡 YouTube Channels (${niche.sources.length})`],
        ] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${tab === key ? "bg-white/10 text-white" : "text-gray-500 hover:text-gray-300"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── ACCOUNTS TAB ── */}
      {tab === "accounts" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => { setShowAccountPicker(true); fetchAllAccounts(); }}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/15 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-all">
              <Plus className="w-4 h-4" /> Add Accounts
            </button>
          </div>

          {/* Account picker modal */}
          {showAccountPicker && (
            <div className="glass border border-white/10 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-white text-sm">Add Accounts from Platform</h3>
                <button onClick={() => setShowAccountPicker(false)}><X className="w-4 h-4 text-gray-500" /></button>
              </div>
              <input value={accountSearch} onChange={e => setAccountSearch(e.target.value)}
                placeholder="Search by username or group..."
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-purple-500" />
              <div className="max-h-60 overflow-y-auto space-y-1">
                {filteredAccounts.length === 0 ? (
                  <p className="text-gray-500 text-sm text-center py-6">{allAccounts.length === 0 ? "Loading..." : "No accounts available"}</p>
                ) : filteredAccounts.map(a => (
                  <div key={a.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/5 transition-colors">
                    <div className="flex items-center gap-2">
                      <img src={a.tiktokAvatarUrl || "/default-avatar.png"} className="w-7 h-7 rounded-full object-cover" alt={a.tiktokUsername} />
                      <div>
                        <p className="text-white text-sm font-medium">@{a.tiktokUsername}</p>
                        <p className="text-gray-600 text-xs">{a.group.section.name} → {a.group.name}</p>
                      </div>
                    </div>
                    <button onClick={() => addAccount(a.id)}
                      className="text-xs bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 px-3 py-1 rounded-lg transition-all">
                      Add
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Assigned accounts */}
          {niche.accounts.length === 0 ? (
            <div className="glass border border-white/5 rounded-2xl p-12 text-center">
              <Users className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No accounts yet — add accounts from the platform</p>
            </div>
          ) : (
            <div className="space-y-2">
              {niche.accounts.map(({ account: a }) => (
                <div key={a.id} className="glass border border-white/5 rounded-xl px-4 py-3 flex items-center justify-between hover:border-white/10 transition-all">
                  <div className="flex items-center gap-3">
                    <img src={a.tiktokAvatarUrl || "/default-avatar.png"} className="w-9 h-9 rounded-full object-cover" alt={a.tiktokUsername} />
                    <div>
                      <p className="text-white font-semibold text-sm">@{a.tiktokUsername}</p>
                      <p className="text-gray-600 text-xs">{a.group.section.name} → {a.group.name}</p>
                    </div>
                  </div>
                  <button onClick={() => removeAccount(a.id, a.tiktokUsername)}
                    className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── SOURCES TAB ── */}
      {tab === "sources" && (
        <div className="space-y-4">
          {/* Add source */}
          <div className="flex gap-2">
            <input value={addUrl} onChange={e => setAddUrl(e.target.value)}
              placeholder="Paste YouTube channel or playlist URL..."
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-red-500"
              onKeyDown={e => e.key === "Enter" && addSource()} />
            <button onClick={addSource} disabled={!addUrl.trim() || adding}
              className="bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all flex items-center gap-2">
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add
            </button>
          </div>

          {niche.sources.length === 0 ? (
            <div className="glass border border-white/5 rounded-2xl p-12 text-center">
              <Video className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No YouTube channels yet — paste a channel or playlist URL above</p>
            </div>
          ) : (
            <div className="space-y-3">
              {niche.sources.map(s => (
                <div key={s.id} className="glass border border-white/5 rounded-2xl p-4 hover:border-white/10 transition-all">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {s.thumbnailUrl
                        ? <img src={s.thumbnailUrl} className="w-10 h-10 rounded-full object-cover" alt={s.title} />
                        : <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center"><Video className="w-5 h-5 text-red-400" /></div>
                      }
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white">{s.title || "Untitled"}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${s.type === "CHANNEL" ? "bg-red-500/10 text-red-400" : "bg-blue-500/10 text-blue-400"}`}>{s.type}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                          {s.subscriberCount != null && <span>{formatCount(s.subscriberCount)} {s.type === "CHANNEL" ? "subs" : "items"}</span>}
                          <span className="text-amber-400/80">max {s.maxVideosPerFetch}/fetch</span>
                          <span>{s._count.videos} videos</span>
                          {s.lastFetchedAt && <span>fetched {timeAgo(s.lastFetchedAt)}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => fetchNow(s.id)} disabled={fetchingId === s.id}
                        className="flex items-center gap-1 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all disabled:opacity-40">
                        {fetchingId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Fetch Now
                      </button>
                      <button onClick={() => toggleSource(s.id, s.isActive)}
                        className={`p-2 rounded-lg transition-all ${s.isActive ? "text-green-400 hover:bg-green-400/10" : "text-gray-500 hover:bg-white/5"}`}>
                        {s.isActive ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                      </button>
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="p-2 text-gray-500 hover:text-white hover:bg-white/5 rounded-lg transition-all">
                        <ExternalLink className="w-4 h-4" />
                      </a>
                      <button onClick={() => deleteSource(s.id, s.title)} className="p-2 text-gray-600 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── VIDEOS TAB ── */}
      {tab === "videos" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <select value={sortBy} onChange={e => setSortBy(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500">
              <option value="discovered">Recently Discovered</option>
              <option value="recent">Latest on YouTube</option>
              <option value="views">Most Views</option>
              <option value="likes">Most Likes</option>
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
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
              <Eye className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No videos yet — add YouTube channels and click Fetch Now</p>
            </div>
          ) : (
            <div className="space-y-2">
              {videos.map(v => (
                <div key={v.id} className="glass border border-white/5 rounded-xl p-4 hover:border-white/10 transition-all">
                  <div className="flex gap-4">
                    <a href={`https://youtube.com/watch?v=${v.youtubeVideoId}`} target="_blank" rel="noopener noreferrer"
                      className="relative flex-shrink-0 w-40 h-[90px] rounded-lg overflow-hidden group">
                      <img src={v.thumbnailUrl} alt={v.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                      <div className="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1.5 py-0.5 rounded font-mono">{formatDur(v.duration)}</div>
                    </a>
                    <div className="flex-1 min-w-0">
                      <a href={`https://youtube.com/watch?v=${v.youtubeVideoId}`} target="_blank" rel="noopener noreferrer"
                        className="font-semibold text-white text-sm hover:text-purple-300 transition-colors line-clamp-2">{v.title}</a>
                      <p className="text-xs text-gray-500 mt-1">{v.channelTitle} · {timeAgo(v.publishedAt)}</p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                        <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{formatCount(v.viewCount)}</span>
                        <span className="flex items-center gap-1"><ThumbsUp className="w-3 h-3" />{formatCount(v.likeCount)}</span>
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDur(v.duration)}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        v.status === "NEW" ? "bg-blue-500/10 text-blue-400" :
                        v.status === "DOWNLOADED" ? "bg-green-500/10 text-green-400" :
                        v.status === "CLIPPED" ? "bg-purple-500/10 text-purple-400" :
                        "bg-gray-500/10 text-gray-500"}`}>{v.status}</span>
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
      )}
    </div>
  );
}
