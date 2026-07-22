"use client";
import { useState, useEffect, useCallback, useRef, use, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import ManagedAccountEditForm from "@/components/ManagedAccountEditForm";
import { naturalCompare } from "@/lib/utils/sorting";
import {
  Plus,
  Loader2,
  ChevronRight,
  Trash2,
  Power,
  FileText,
  Save,
  Search,
  Play,
  Pause,
  Clock,
  FolderOpen,
  Settings,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  Zap,
  ArrowUpDown,
} from "lucide-react";

type Account = {
  id: string;
  tiktokOpenId: string;
  tiktokUsername: string;
  tiktokDisplayName: string;
  tiktokAvatarUrl: string;
  followerCount: number;
  followingCount: number;
  likesCount: number;
  videoCount: number;
  isVerified: boolean;
  isActive: boolean;
  driveConnected: boolean;
  driveFolderId: string | null;
  driveFolderName: string | null;
  postTimeHour: number;
  postTimeMinute: number;
  postTimezone: string;
  postDays: string;
  postMode: string;
  postTimeSlots: string;
  postpeerAccountId: string | null;
  tokenExpiresAt: string;
  _count: { scheduledPosts: number };
  googleOAuthConnected?: boolean;
  connectionState?: string;
  lastCheckedAt?: string | null;
  lastError?: string | null;
  color?: string;
  colorId?: string;
  colorRef?: { id: string; color: string; meaning: string; defaultPostCount: number } | null;
};

type Section = {
  id: string;
  name: string;
  slug: string;
  color: string;
  descTags: string | null;
  descTagCount: number;
  isActive: boolean;
  accounts: Account[];
};

const DAYS = [
  { num: "1", label: "Mon" },
  { num: "2", label: "Tue" },
  { num: "3", label: "Wed" },
  { num: "4", label: "Thu" },
  { num: "5", label: "Fri" },
  { num: "6", label: "Sat" },
  { num: "7", label: "Sun" },
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

export default function SectionPage({
  params,
}: {
  params: Promise<{ sectionSlug: string }>;
}) {
  const { sectionSlug } = use(params);
  const searchParams = useSearchParams();
  const [section, setSection] = useState<Section | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [postingNow, setPostingNow] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ tiktokUsername: "", postpeerAccountId: "" });
  const [addingAccount, setAddingAccount] = useState(false);
  const [clockTick, setClockTick] = useState(0);

  // Section-level structured description editing (hashtag pool only —
  // fixed text moved to Campaigns, see /admin/migration-report)
  const [descTags, setDescTags] = useState("");
  const [descTagCount, setDescTagCount] = useState(3);
  const [descDirty, setDescDirty] = useState(false);
  const [savingSection, setSavingSection] = useState(false);

  // Search accounts state — defaults to Google Drive mode so accounts load
  // sorted by Drive folder name (natural numeric) ascending
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"account" | "drive">("drive");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const filteredAccounts = useMemo(() => {
    if (!section) return [];

    // Sort by Drive folder name (natural numeric — "POL ACC 2" before "POL ACC 10")
    // or by username, based on searchMode. In Drive mode, accounts without a
    // linked folder sort last with username as tiebreak. Direction inverts the comparator.
    const sorted = [...section.accounts].sort((a, b) => {
      let comp: number;
      if (searchMode === "drive") {
        const nameA = a.driveFolderName;
        const nameB = b.driveFolderName;
        if (nameA && !nameB) comp = 1;
        else if (!nameA && nameB) comp = -1;
        else comp = nameA && nameB ? naturalCompare(nameA, nameB) : 0;
        if (comp === 0) comp = naturalCompare(a.tiktokUsername, b.tiktokUsername);
      } else {
        comp = naturalCompare(a.tiktokUsername, b.tiktokUsername);
      }
      return sortDirection === "asc" ? comp : -comp;
    });

    if (!searchQuery.trim()) return sorted;
    const query = searchQuery.toLowerCase().trim();
    return sorted.filter((acc) => {
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
  }, [section, searchQuery, searchMode, sortDirection]);

  const clockRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Tick the clock every second for live timezone display
  useEffect(() => {
    clockRef.current = setInterval(() => setClockTick((t) => t + 1), 1000);
    return () => clearInterval(clockRef.current);
  }, []);

  const getTimeInZone = (tz: string) => {
    try {
      return new Date().toLocaleTimeString("en-US", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      });
    } catch {
      return "--:--";
    }
  };

  const fetchSection = useCallback(async () => {
    try {
      const res = await fetch(`/api/managed/sections/by-slug/${sectionSlug}`);
      if (res.ok) {
        const data = await res.json();
        setSection(data);
        setDescTags(data.descTags || "");
        setDescTagCount(data.descTagCount ?? 3);
        setDescDirty(false);
      } else {
        setSection(null);
      }
    } finally {
      setLoading(false);
    }
  }, [sectionSlug]);

  useEffect(() => {
    fetchSection();
  }, [fetchSection]);

  // Handle Google Drive OAuth Redirect Alerts
  useEffect(() => {
    const success = searchParams.get("google_success");
    const error = searchParams.get("google_error");
    const username = searchParams.get("username");

    if (success) {
      toast.success(`Google Drive connected successfully for @${username}!`);
      // Clean query params
      const newUrl = window.location.pathname;
      window.history.replaceState({}, "", newUrl);
      fetchSection();
    } else if (error) {
      toast.error(`Google Drive connection failed: ${error}`);
      // Clean query params
      const newUrl = window.location.pathname;
      window.history.replaceState({}, "", newUrl);
    }
  }, [searchParams, fetchSection]);

  const addAccountManual = async () => {
    if (!addForm.tiktokUsername.trim()) { toast.error("Enter a TikTok username"); return; }
    if (!section) return;
    setAddingAccount(true);
    try {
      const res = await fetch("/api/managed/accounts/add-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionId: section.id, ...addForm }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add");
      toast.success(`@${addForm.tiktokUsername} added!`);
      setAddForm({ tiktokUsername: "", postpeerAccountId: "" });
      setShowAddForm(false);
      fetchSection();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setAddingAccount(false);
    }
  };

  const postNow = async (acc: Account) => {
    if (!acc.driveConnected) { toast.error("Link a Drive folder first"); return; }
    setPostingNow(acc.id);
    try {
      const res = await fetch(`/api/managed/accounts/${acc.id}/post-now`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Post failed");
      toast.success(data.message || "Posting now...");
      fetchSection();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to post");
    } finally {
      setPostingNow(null);
    }
  };

  // ── Section toggle ──────────────────────────────────────────────────────────
  const toggleSection = async () => {
    if (!section) return;
    try {
      const res = await fetch(`/api/managed/sections/${section.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !section.isActive }),
      });
      if (!res.ok) throw new Error("Failed");
      setSection({ ...section, isActive: !section.isActive });
      toast.success(section.isActive ? "Section disabled" : "Section enabled");
    } catch {
      toast.error("Failed to toggle section");
    }
  };

  // ── Section hashtag pool save ───────────────────────────────────────────────
  const saveSectionDesc = async () => {
    if (!section) return;
    setSavingSection(true);
    try {
      const res = await fetch(`/api/managed/sections/${section.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          descTags: descTags.trim(),
          descTagCount: descTagCount,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      setSection({
        ...section,
        descTags: descTags.trim() || null,
        descTagCount,
      });
      setDescDirty(false);
      toast.success("Description settings saved");
    } catch {
      toast.error("Failed to save description settings");
    } finally {
      setSavingSection(false);
    }
  };

  const toggleActive = async (acc: Account) => {
    try {
      const res = await fetch(`/api/managed/accounts/${acc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !acc.isActive }),
      });
      if (!res.ok) throw new Error("Update failed");
      toast.success(
        `@${acc.tiktokUsername} ${!acc.isActive ? "activated" : "paused"}`
      );
      fetchSection();
    } catch {
      toast.error("Failed to update");
    }
  };

  const deleteAccount = async (acc: Account) => {
    if (
      !confirm(
        `Remove @${acc.tiktokUsername} from this section? This will delete all scheduled posts.`
      )
    )
      return;
    try {
      const res = await fetch(`/api/managed/accounts/${acc.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      toast.success(`@${acc.tiktokUsername} removed`);
      fetchSection();
    } catch {
      toast.error("Failed to remove account");
    }
  };

  const startEdit = (acc: Account) => {
    setEditingId(acc.id);
  };

  const formatTime = (h: number, m: number) =>
    `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;

  const isTokenExpired = (expiresAt: string) =>
    new Date(expiresAt) < new Date();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
      </div>
    );
  }

  if (!section) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500">Section not found</p>
        <Link
          href="/admin/accounts"
          className="text-purple-400 hover:text-purple-300 text-sm mt-2 inline-block"
        >
          ← Back to sections
        </Link>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${!section.isActive ? "opacity-60" : ""}`}>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link
          href="/admin/accounts"
          className="hover:text-white transition-colors"
        >
          Accounts
        </Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-white font-medium">{section.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-3 h-8 rounded-full"
            style={{ backgroundColor: section.color }}
          />
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white">{section.name}</h1>
              {/* Section master toggle */}
              <button
                onClick={toggleSection}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                  section.isActive
                    ? "bg-green-500/15 text-green-400 hover:bg-green-500/25"
                    : "bg-red-500/15 text-red-400 hover:bg-red-500/25"
                }`}
                title={section.isActive ? "Click to disable all accounts in this section" : "Click to enable section"}
              >
                <Power className="w-3 h-3" />
                {section.isActive ? "Active" : "Disabled"}
              </button>
            </div>
            <p className="text-gray-500 text-sm">
              {section.accounts.length} account
              {section.accounts.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-all"
        >
          <Plus className="w-4 h-4" />
          Add Account
        </button>
      </div>

      {/* Section-level Hashtag Pool (fixed text moved to Campaigns) */}
      <div className="glass border border-white/5 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-300">
          <FileText className="w-4 h-4 text-purple-400" />
          Video Description Builder
          <span className="text-xs font-normal text-gray-600 ml-1">
            Hashtags applied to all accounts in this section
          </span>
        </div>

        {/* Tags Pool Block */}
        <div className="bg-white/3 border border-white/5 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wide">Hashtag Pool</span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500 font-medium">Tags per video:</span>
              <input
                type="number"
                min={0}
                max={20}
                value={descTagCount}
                onChange={(e) => {
                  setDescTagCount(Math.max(0, Math.min(20, parseInt(e.target.value) || 0)));
                  setDescDirty(true);
                }}
                className="w-14 bg-black/30 border border-white/10 rounded-lg px-2 py-1 text-white text-xs text-center focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>
          <textarea
            value={descTags}
            onChange={(e) => {
              setDescTags(e.target.value);
              setDescDirty(true);
            }}
            placeholder="Enter hashtags separated by commas (e.g. #music, #viral, #fyp, #trending, #foryou, #tiktok)"
            rows={3}
            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-purple-500 transition-colors resize-none"
          />
          {descTags && (
            <div className="flex flex-wrap gap-1.5">
              {descTags.split(",").map((tag, i) => tag.trim()).filter(Boolean).map((tag, i) => (
                <span key={i} className="bg-purple-500/15 text-purple-300 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-purple-500/20">
                  {tag}
                </span>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-600">
            {descTags ? `${descTags.split(",").filter(t => t.trim()).length} tags in pool → ${descTagCount} random tags will be selected for each video` : 'No tags added yet'}
          </p>
        </div>

        {/* Preview */}
        {descTags && (
          <div className="bg-black/30 border border-white/5 rounded-xl p-3 space-y-1">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Preview (example)</span>
            <div className="text-xs text-gray-300 whitespace-pre-wrap">
              {descTags ? descTags.split(",").filter(t => t.trim()).slice(0, descTagCount).map(t => t.trim()).join(" ") : ''}
            </div>
          </div>
        )}

        <p className="text-[10px] text-gray-600">
          Fixed description text now lives on Campaigns. Old Section/Group texts are preserved in the{" "}
          <Link href="/admin/migration-report" className="text-purple-400 hover:text-purple-300 underline underline-offset-2">
            Migration Report
          </Link>{" "}
          for manual reassignment.
        </p>

        {/* Save button */}
        {descDirty && (
          <button
            onClick={saveSectionDesc}
            disabled={savingSection}
            className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-all"
          >
            {savingSection ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Save className="w-3 h-3" />
            )}
            Save Description Settings
          </button>
        )}
      </div>

      {/* Disabled banner */}
      {!section.isActive && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400 flex items-center gap-2">
          <Power className="w-4 h-4" />
          This section is disabled — no accounts will auto-post. Toggle the switch above to re-enable.
        </div>
      )}

      {/* Manual Add Form */}
      {showAddForm && (
        <div className="glass border border-purple-500/20 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-white font-semibold text-sm">Add TikTok Account</h3>
            <a
              href={`/api/managed/tiktok/auth?sectionId=${section.id}`}
              className="text-xs text-purple-400 hover:text-purple-300 font-semibold transition-colors"
            >
              Connect via TikTok OAuth →
            </a>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">TikTok Username *</label>
              <input
                type="text"
                value={addForm.tiktokUsername}
                onChange={(e) => setAddForm({ ...addForm, tiktokUsername: e.target.value })}
                placeholder="@username"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-purple-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">PostPeer Account ID</label>
              <input
                type="text"
                value={addForm.postpeerAccountId}
                onChange={(e) => setAddForm({ ...addForm, postpeerAccountId: e.target.value })}
                placeholder="e.g. 6a009951aebd14fd48e032c9"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm font-mono placeholder-gray-600 focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={addAccountManual}
              disabled={addingAccount}
              className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-all disabled:opacity-50"
            >
              {addingAccount && <Loader2 className="w-3 h-3 animate-spin" />}
              Add Account
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              className="text-gray-500 hover:text-white text-sm px-3 py-2 rounded-xl transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Search and Accounts List */}
      {section.accounts.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center max-w-xl">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder={searchMode === "account" ? "Search accounts in this section..." : "Search Google Drive folders/emails..."}
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
      )}

      {section.accounts.length === 0 ? (
        <div className="glass border border-white/5 rounded-2xl p-12 text-center">
          <Plus className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2">
            No accounts yet
          </h3>
          <p className="text-gray-500 text-sm mb-6">
            Add TikTok accounts to start managing them
          </p>
          <button
            onClick={() => setShowAddForm(true)}
            className="inline-flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all"
          >
            <Plus className="w-4 h-4" />
            Add First Account
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredAccounts.length === 0 ? (
            <div className="glass border border-white/5 rounded-2xl p-8 text-center text-gray-500 text-sm">
              No matching accounts found for "{searchQuery}"
            </div>
          ) : (
            filteredAccounts.map((acc) => {
              const colKey = acc.colorRef?.color || acc.color || "zinc";
              const baseColor = COLOR_MAP[colKey] || (colKey.startsWith("#") ? colKey : null) || COLOR_MAP.zinc;
              const isSpecialColor = colKey !== "zinc" && colKey !== "gray";
              return (
                <div
                  key={acc.id}
                  className="glass border rounded-2xl overflow-hidden transition-all"
                  style={{
                    borderLeft: `4px solid ${baseColor}`,
                    borderColor: isSpecialColor ? `${baseColor}60` : undefined,
                    backgroundColor: isSpecialColor ? `${baseColor}1f` : undefined,
                    boxShadow: isSpecialColor ? `0 4px 20px ${baseColor}08` : undefined,
                  }}
                >
                  <div className="p-5">
                {/* Top row */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <img
                        src={acc.tiktokAvatarUrl || "/default-avatar.png"}
                        alt={acc.tiktokUsername}
                        className="w-12 h-12 rounded-full object-cover"
                      />
                      <div
                        className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-[#0a0a0f] ${
                          acc.isActive ? "bg-green-500" : "bg-gray-500"
                        }`}
                      />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white">
                          @{acc.tiktokUsername}
                        </span>
                        {acc.isVerified && (
                          <span className="text-blue-400 text-xs">✓</span>
                        )}
                        {acc.connectionState === "needs_reauth" && (
                          <div className="flex items-center gap-1.5">
                            <span className="flex items-center gap-1 text-[10px] text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full">
                              <AlertCircle className="w-3.5 h-3.5" />
                              Needs Re-auth
                            </span>
                            <a
                              href={`/api/managed/tiktok/auth?sectionId=${section.id}`}
                              className="text-[10px] text-purple-400 hover:text-purple-300 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-full transition-all font-semibold"
                              title="Reconnect this TikTok account"
                            >
                              Reconnect
                            </a>
                          </div>
                        )}
                        {acc.connectionState === "not_found" && (
                          <div className="flex items-center gap-1.5">
                            <span className="flex items-center gap-1 text-[10px] text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full" title={acc.lastError || ""}>
                              <AlertCircle className="w-3.5 h-3.5" />
                              Not Found
                            </span>
                            <button
                              onClick={() => startEdit(acc)}
                              className="text-[10px] text-amber-400 hover:text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full transition-all font-semibold"
                              title="Open Settings to update PostPeer ID"
                            >
                              Fix ID
                            </button>
                          </div>
                        )}
                        {acc.connectionState === "checking" && (
                          <span className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full animate-pulse">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Checking...
                          </span>
                        )}
                        {(acc.connectionState === "healthy" || (!acc.connectionState && !isTokenExpired(acc.tokenExpiresAt))) && (
                          <span className="flex items-center gap-1 text-[10px] text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Healthy
                          </span>
                        )}
                        {!acc.connectionState && isTokenExpired(acc.tokenExpiresAt) && (
                          <div className="flex items-center gap-1.5">
                            <span className="flex items-center gap-1 text-[10px] text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full">
                              <AlertCircle className="w-3.5 h-3.5" />
                              Token expired
                            </span>
                            <a
                              href={`/api/managed/tiktok/auth?sectionId=${section.id}`}
                              className="text-[10px] text-purple-400 hover:text-purple-300 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-full transition-all font-semibold"
                            >
                              Reconnect
                            </a>
                          </div>
                        )}
                      </div>
                      <p className="text-sm text-gray-500">
                        {acc.tiktokDisplayName}
                      </p>
                      {/* Drive folder — the primary sort key, shown prominently for scanning */}
                      {acc.driveConnected && acc.driveFolderId ? (
                        <a
                          href={`https://drive.google.com/drive/folders/${acc.driveFolderId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 mt-0.5 text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors"
                          title="Open Google Drive folder"
                        >
                          <FolderOpen className="w-3 h-3" />
                          {acc.driveFolderName || "Drive linked"}
                          <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                        </a>
                      ) : (
                        <span className="flex items-center gap-1 mt-0.5 text-xs font-medium text-yellow-500/80">
                          <FolderOpen className="w-3 h-3" />
                          No folder linked
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => postNow(acc)}
                      disabled={postingNow === acc.id || !acc.driveConnected || !acc.postpeerAccountId}
                      className="flex items-center gap-1 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all disabled:opacity-40"
                      title={!acc.driveConnected ? "Link Drive folder first" : !acc.postpeerAccountId ? "Set PostPeer Account ID first" : "Post next video now"}
                    >
                      {postingNow === acc.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Zap className="w-3.5 h-3.5" />
                      )}
                      Post Now
                    </button>
                    <button
                      onClick={() => toggleActive(acc)}
                      className={`p-2 rounded-lg transition-all ${
                        acc.isActive
                          ? "text-green-400 hover:bg-green-400/10"
                          : "text-gray-500 hover:bg-white/5"
                      }`}
                      title={acc.isActive ? "Pause" : "Activate"}
                    >
                      {acc.isActive ? (
                        <Pause className="w-4 h-4" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                    </button>
                    <button
                      onClick={() =>
                        editingId === acc.id
                          ? setEditingId(null)
                          : startEdit(acc)
                      }
                      className="p-2 rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-all"
                      title="Settings"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteAccount(acc)}
                      className="p-2 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-400/10 transition-all"
                      title="Remove"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Stats row */}
                <div className="flex items-center gap-5 text-sm mb-3">
                  <div>
                    <span className="text-white font-semibold">
                      {acc.followerCount.toLocaleString()}
                    </span>
                    <span className="text-gray-600 ml-1">followers</span>
                  </div>
                  <div>
                    <span className="text-white font-semibold">
                      {acc.likesCount.toLocaleString()}
                    </span>
                    <span className="text-gray-600 ml-1">likes</span>
                  </div>
                  <div>
                    <span className="text-white font-semibold">
                      {acc.videoCount.toLocaleString()}
                    </span>
                    <span className="text-gray-600 ml-1">videos</span>
                  </div>
                  <div>
                    <span className="text-white font-semibold">
                      {acc._count.scheduledPosts}
                    </span>
                    <span className="text-gray-600 ml-1">published</span>
                  </div>
                </div>

                {/* Info chips */}
                <div className="flex flex-wrap gap-2 text-xs">
                  {/* Live clock in account timezone */}
                  <span className="flex items-center gap-1 bg-purple-500/10 text-purple-400 px-2.5 py-1 rounded-full font-mono" key={clockTick}>
                    🕐 {getTimeInZone(acc.postTimezone)}
                    <span className="text-purple-400/60 ml-0.5">{acc.postTimezone.split("/").pop()?.replace(/_/g, " ")}</span>
                  </span>
                  <span className="flex items-center gap-1 bg-white/5 text-gray-400 px-2.5 py-1 rounded-full">
                    <Clock className="w-3 h-3" />
                    {(acc.postTimeSlots || formatTime(acc.postTimeHour, acc.postTimeMinute)).split(",").map(s => s.trim()).join(" · ")}
                  </span>
                  <span className="flex items-center gap-1 bg-white/5 text-gray-400 px-2.5 py-1 rounded-full">
                    📅{" "}
                    {acc.postDays
                      .split(",")
                      .map(
                        (d) => DAYS.find((day) => day.num === d)?.label || d
                      )
                      .join(", ")}
                  </span>
                  <span
                    className={`px-2.5 py-1 rounded-full ${
                      acc.postMode === "DIRECT"
                        ? "bg-green-500/10 text-green-400"
                        : "bg-blue-500/10 text-blue-400"
                    }`}
                  >
                    {acc.postMode === "DIRECT" ? "Direct Post" : "Draft"}
                  </span>
                </div>

                {/* Edit panel */}
                {editingId === acc.id && (
                  <div className="mt-4 pt-4 border-t border-white/5">
                    <ManagedAccountEditForm
                      accountId={acc.id}
                      onClose={() => setEditingId(null)}
                      onSave={() => fetchSection()}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        }))}
        </div>
      )}
    </div>
  );
}
