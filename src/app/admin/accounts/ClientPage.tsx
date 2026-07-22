"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { toast } from "sonner";
import ManagedAccountEditForm from "@/components/ManagedAccountEditForm";
import ColorSettingsModal from "@/components/ColorSettingsModal";
import { naturalCompare } from "@/lib/utils/sorting";
import {
  Plus,
  FolderOpen,
  MonitorPlay,
  Loader2,
  Trash2,
  Pencil,
  X,
  Power,
  Link2,
  Search,
  Copy,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Calendar,
  Hash,
  ArrowUpDown,
  Settings,
} from "lucide-react";

// ── Video Links Panel (per section) ──────────────────────────────────────────
type VideoLink = {
  id: string;
  url: string;
  videoId: string | null;
  caption: string;
  publishedAt: string | null;
  username: string;
  avatarUrl: string;
  sectionName: string;
};

function VideoLinksPanel({ sectionId, sectionColor }: { sectionId: string; sectionColor: string }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [hashtag, setHashtag] = useState("");
  const [videos, setVideos] = useState<VideoLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    setLoading(true);
    setSearched(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (hashtag.trim()) params.set("hashtag", hashtag.trim());
      const res = await fetch(`/api/managed/sections/${sectionId}/video-links?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setVideos(data.videos || []);
    } catch {
      toast.error("Failed to fetch video links");
    } finally {
      setLoading(false);
    }
  };

  const copyAllLinks = () => {
    const links = videos.map((v) => v.url).join("\n");
    navigator.clipboard.writeText(links);
    toast.success(`${videos.length} link(s) copied to clipboard`);
  };

  return (
    <div className="mt-3 mb-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider px-3 py-1.5 rounded-lg transition-all w-full justify-between"
        style={{ color: sectionColor, backgroundColor: `${sectionColor}10` }}
      >
        <span className="flex items-center gap-1.5">
          <Link2 className="w-3 h-3" />
          Video Links
        </span>
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {open && (
        <div className="mt-2 space-y-2 bg-black/30 rounded-xl p-3 border border-white/5">
          {/* Filters */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] uppercase text-gray-500 font-bold tracking-wider flex items-center gap-1">
                <Calendar className="w-2.5 h-2.5" /> From
              </label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-purple-500 transition-colors"
              />
            </div>
            <div>
              <label className="text-[9px] uppercase text-gray-500 font-bold tracking-wider flex items-center gap-1">
                <Calendar className="w-2.5 h-2.5" /> To
              </label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-purple-500 transition-colors"
              />
            </div>
          </div>
          <div>
            <label className="text-[9px] uppercase text-gray-500 font-bold tracking-wider flex items-center gap-1">
              <Hash className="w-2.5 h-2.5" /> Hashtag Filter
            </label>
            <input
              type="text"
              value={hashtag}
              onChange={(e) => setHashtag(e.target.value)}
              placeholder="e.g. #fyp"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500 transition-colors"
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={loading}
            className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-lg transition-all text-white"
            style={{ backgroundColor: sectionColor }}
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
            Search Videos
          </button>

          {/* Results */}
          {searched && (
            <div className="space-y-1.5">
              {videos.length > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-500 font-semibold">
                    {videos.length} video{videos.length !== 1 ? "s" : ""} found
                  </span>
                  <button
                    onClick={copyAllLinks}
                    className="flex items-center gap-1 text-[10px] font-semibold text-purple-400 hover:text-purple-300 transition-colors"
                  >
                    <Copy className="w-2.5 h-2.5" />
                    Copy All Links
                  </button>
                </div>
              )}
              <div className="max-h-48 overflow-y-auto space-y-1 custom-scrollbar">
                {videos.length === 0 ? (
                  <p className="text-xs text-gray-600 text-center py-3">No videos found for these filters</p>
                ) : (
                  videos.map((v) => (
                    <a
                      key={v.id}
                      href={v.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-white/3 hover:bg-white/5 transition-colors group/link"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-gray-300 font-medium truncate">@{v.username}</span>
                          <span className="text-[9px] text-gray-600">{v.sectionName}</span>
                        </div>
                        <p className="text-[10px] text-gray-500 truncate">
                          {v.caption?.slice(0, 60) || "No caption"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        <span className="text-[9px] text-gray-600">
                          {v.publishedAt ? new Date(v.publishedAt).toLocaleDateString() : ""}
                        </span>
                        <ExternalLink className="w-3 h-3 text-gray-600 group-hover/link:text-white transition-colors" />
                      </div>
                    </a>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type Section = {
  id: string;
  name: string;
  slug: string;
  color: string;
  icon: string | null;
  isActive: boolean;
  sortOrder: number;
  totalAccounts: number;
};

const COLOR_PRESETS = [
  "#8b5cf6",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#ef4444",
  "#06b6d4",
  "#f97316",
];

const COLOR_MAP: Record<string, string> = {
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#f59e0b",
  green: "#10b981",
  blue: "#3b82f6",
  purple: "#8b5cf6",
  pink: "#ec4899",
  zinc: "#71717a",
  gray: "#71717a",
};

export default function AccountsPage() {
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createColor, setCreateColor] = useState("#8b5cf6");
  const [creating, setCreating] = useState(false);

  // Search accounts states
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"account" | "drive">("account");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [allAccounts, setAllAccounts] = useState<any[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [showColorSettings, setShowColorSettings] = useState(false);

  const fetchSections = useCallback(async () => {
    try {
      const res = await fetch("/api/managed/sections");
      if (res.ok) setSections(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSections();
  }, [fetchSections]);

  const fetchAllAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      const res = await fetch("/api/managed/accounts/all");
      if (res.ok) setAllAccounts(await res.json());
    } catch (err) {
      console.error("Failed to load accounts list for search", err);
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  useEffect(() => {
    fetchAllAccounts();
  }, [fetchAllAccounts]);

  const filteredAccounts = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase().trim();

    const colorOrder: Record<string, number> = {
      red: 1,
      orange: 2,
      yellow: 3,
      green: 4,
      blue: 5,
      purple: 6,
      pink: 7,
      zinc: 8,
      gray: 8,
    };

    const matched = allAccounts.filter((acc) => {
      if (searchMode === "drive") {
        return (
          (acc.driveFolderName || "").toLowerCase().includes(query) ||
          (acc.driveFolderId || "").toLowerCase().includes(query)
        );
      } else {
        return (
          acc.tiktokUsername.toLowerCase().includes(query) ||
          acc.tiktokDisplayName.toLowerCase().includes(query)
        );
      }
    });

    // Sort by username / folder name alphabetically based on searchMode and sortDirection using naturalCompare
    return matched.sort((a, b) => {
      const valA = searchMode === "drive" ? (a.driveFolderName || "") : a.tiktokUsername;
      const valB = searchMode === "drive" ? (b.driveFolderName || "") : b.tiktokUsername;
      
      const comp = naturalCompare(valA, valB);
      return sortDirection === "asc" ? comp : -comp;
    });
  }, [allAccounts, searchQuery, searchMode, sortDirection]);

  const handleCreate = async () => {
    if (!createName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/managed/sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: createName.trim(), color: createColor }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create section");
      }
      toast.success(`Section "${createName}" created`);
      setCreateName("");
      setShowCreate(false);
      fetchSections();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Creation failed");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}" and all its accounts?`)) return;
    try {
      const res = await fetch(`/api/managed/sections/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      toast.success(`Section "${name}" deleted`);
      fetchSections();
    } catch {
      toast.error("Failed to delete section");
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
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">TikTok Accounts</h1>
          <p className="text-gray-500 mt-1">
            Manage your TikTok accounts organized by sections
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowColorSettings(true)}
            className="flex items-center gap-2 bg-white/5 border border-white/10 hover:bg-white/10 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-all"
          >
            <Settings className="w-4 h-4 text-purple-400" />
            Color Settings
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-all"
          >
            <Plus className="w-4 h-4" />
            New Section
          </button>
        </div>
      </div>

      {/* Search and Accounts List */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center max-w-xl">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder={searchMode === "account" ? "Search accounts by username or display name..." : "Search Google Drive folders/emails..."}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-8 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 transition-colors"
          />
          <Search className="w-4 h-4 text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="text-gray-500 hover:text-white absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold font-mono p-1"
            >
              ×
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex bg-white/5 border border-white/10 rounded-xl p-1 gap-1">
            <button
              onClick={() => {
                setSearchMode("account");
                setSearchQuery("");
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                searchMode === "account"
                  ? "bg-purple-600 text-white shadow"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              Account Name
            </button>
            <button
              onClick={() => {
                setSearchMode("drive");
                setSearchQuery("");
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                searchMode === "drive"
                  ? "bg-purple-600 text-white shadow"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              Google Drive
            </button>
          </div>

          <button
            onClick={() => setSortDirection(sortDirection === "asc" ? "desc" : "asc")}
            className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 hover:bg-white/10 text-xs font-medium text-gray-300 hover:text-white transition-all"
            title={sortDirection === "asc" ? "Ascending Sort" : "Descending Sort"}
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
            <span className="uppercase tracking-wider font-mono font-bold">{sortDirection}</span>
          </button>
        </div>
      </div>

      {/* Search Results */}
      {searchQuery && (
        <div className="glass border border-white/5 rounded-2xl p-6 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
            Account Search Results ({filteredAccounts.length})
          </h2>
          {filteredAccounts.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No matching TikTok accounts found</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {filteredAccounts.map((acc) => {
                const colKey = acc.colorRef?.color || acc.color || "zinc";
                const baseColor = COLOR_MAP[colKey] || (colKey.startsWith("#") ? colKey : null) || COLOR_MAP.zinc;
                const isSpecialColor = colKey !== "zinc" && colKey !== "gray";
                return (
                  <button
                    key={acc.id}
                    onClick={() => setEditingAccountId(acc.id)}
                    className="flex items-center text-left w-full gap-3 p-3 rounded-xl transition-all group border"
                    style={{
                      borderLeft: `4px solid ${baseColor}`,
                      borderColor: isSpecialColor ? `${baseColor}60` : "rgba(255,255,255,0.05)",
                      backgroundColor: isSpecialColor ? `${baseColor}1f` : "rgba(255,255,255,0.02)",
                    }}
                  >
                    <img
                      src={acc.tiktokAvatarUrl || "https://www.tiktok.com/favicon.ico"}
                      alt={acc.tiktokDisplayName}
                      className="w-10 h-10 rounded-full object-cover border border-white/10"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "https://www.tiktok.com/favicon.ico";
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-bold text-white truncate group-hover:text-purple-400 transition-colors">
                        @{acc.tiktokUsername}
                      </h3>
                      <p className="text-xs text-gray-400 truncate">
                        {searchMode === "drive" && acc.driveFolderName
                          ? `📁 ${acc.driveFolderName}`
                          : acc.tiktokDisplayName}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="text-[9px] font-semibold text-gray-500 truncate">
                          {acc.section.name}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-purple-400 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Create Section Dialog */}
      {showCreate && (
        <div className="glass border border-purple-500/20 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-white">Create Section</h3>
            <button
              onClick={() => setShowCreate(false)}
              className="text-gray-500 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Section Name
            </label>
            <input
              type="text"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder='e.g. "Political", "Music", "Comedy"'
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 transition-colors text-sm"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Color
            </label>
            <div className="flex gap-2">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  onClick={() => setCreateColor(c)}
                  className={`w-8 h-8 rounded-lg transition-all ${
                    createColor === c
                      ? "ring-2 ring-white ring-offset-2 ring-offset-[#0a0a0f] scale-110"
                      : "hover:scale-110"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={!createName.trim() || creating}
            className="bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all flex items-center gap-2"
          >
            {creating && <Loader2 className="w-4 h-4 animate-spin" />}
            Create Section
          </button>
        </div>
      )}

      {/* Sections Grid */}
      {sections.length === 0 && !showCreate ? (
        <div className="glass border border-white/5 rounded-2xl p-12 text-center">
          <FolderOpen className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2">
            No sections yet
          </h3>
          <p className="text-gray-500 text-sm mb-6">
            Create your first section to start organizing TikTok accounts
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Create First Section
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((section) => (
            <div
              key={section.id}
              className="glass border border-white/5 rounded-2xl overflow-hidden hover:border-white/10 transition-all group"
            >
              <div
                className="h-1"
                style={{ backgroundColor: section.color, opacity: section.isActive ? 1 : 0.4 }}
              />
              <div className={`p-6 ${!section.isActive ? 'opacity-50' : ''}`}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <Link
                      href={`/admin/accounts/${section.slug}`}
                      className="text-lg font-bold text-white hover:underline"
                    >
                      {section.name}
                    </Link>
                    {!section.isActive && (
                      <span className="inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400">
                        <Power className="w-3 h-3" />
                        Disabled
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleDelete(section.id, section.name)}
                      className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-400/10 transition-all"
                      title="Delete section"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-sm text-gray-400 mb-5">
                  <span className="flex items-center gap-1.5">
                    <MonitorPlay className="w-3.5 h-3.5" />
                    {section.totalAccounts} account
                    {section.totalAccounts !== 1 ? "s" : ""}
                  </span>
                </div>

                <VideoLinksPanel sectionId={section.id} sectionColor={section.color} />

                <Link
                  href={`/admin/accounts/${section.slug}`}
                  className="block text-center text-sm font-medium py-2 rounded-xl border border-white/10 text-gray-400 hover:text-white hover:border-white/20 transition-all"
                >
                  Manage Section →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
      {/* Account Settings Popup Modal */}
      {editingAccountId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="relative w-full max-w-2xl bg-[#09090b] border border-white/10 rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto custom-scrollbar">
            <button
              onClick={() => setEditingAccountId(null)}
              className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors"
              aria-label="Close settings"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-bold text-white mb-4">Account Settings</h2>
            <ManagedAccountEditForm
              accountId={editingAccountId}
              onClose={() => setEditingAccountId(null)}
              onSave={() => {
                setEditingAccountId(null);
                fetchAllAccounts();
                fetchSections();
              }}
            />
          </div>
        </div>
      )}
      {/* Account Color Settings Modal */}
      {showColorSettings && (
        <ColorSettingsModal
          onClose={() => {
            setShowColorSettings(false);
            fetchAllAccounts();
          }}
        />
      )}
    </div>
  );
}
