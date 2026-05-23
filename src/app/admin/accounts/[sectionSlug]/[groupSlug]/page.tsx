"use client";
import { useState, useEffect, useCallback, useRef, use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Plus,
  Loader2,
  ChevronRight,
  Trash2,
  Play,
  Pause,
  Clock,
  FolderOpen,
  Settings,
  ExternalLink,
  AlertCircle,
  Zap,
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
  defaultCaption: string | null;
  captionSource: string;
  tokenExpiresAt: string;
  _count: { scheduledPosts: number };
  googleOAuthConnected?: boolean;
};

type Group = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  section: { id: string; name: string; slug: string; color: string };
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

export default function GroupPage({
  params,
}: {
  params: Promise<{ sectionSlug: string; groupSlug: string }>;
}) {
  const { sectionSlug, groupSlug } = use(params);
  const searchParams = useSearchParams();
  const [group, setGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    postTimeSlots: "12:00",
    postTimezone: "UTC",
    postDays: "1,2,3,4,5,6,7",
    postMode: "DIRECT",
    defaultCaption: "",
    captionSource: "FILENAME",
    postpeerAccountId: "",
  });
  const [newSlot, setNewSlot] = useState("12:00");
  const [driveUrl, setDriveUrl] = useState("");
  const [linkingDrive, setLinkingDrive] = useState(false);
  const [foldersList, setFoldersList] = useState<{ id: string; name: string }[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState("");

  const fetchFolders = async (accountId: string) => {
    setLoadingFolders(true);
    setFoldersList([]);
    try {
      const res = await fetch(`/api/managed/accounts/${accountId}/drive-folders`);
      if (res.ok) {
        const data = await res.json();
        setFoldersList(data.folders || []);
        if (data.folders && data.folders.length > 0) {
          setSelectedFolderId(data.folders[0].id);
        }
      }
    } catch (err) {
      console.warn("Failed to fetch folders list:", err);
    } finally {
      setLoadingFolders(false);
    }
  };

  const linkSelectedFolder = async (accountId: string) => {
    if (!selectedFolderId) return;
    setLinkingDrive(true);
    try {
      const folder = foldersList.find(f => f.id === selectedFolderId);
      const folderName = folder ? folder.name : "Drive Folder";

      const res = await fetch(`/api/managed/accounts/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driveFolderId: selectedFolderId,
          driveFolderName: folderName,
        }),
      });

      if (!res.ok) throw new Error("Failed to link folder");
      toast.success(`Linked folder: ${folderName}`);
      fetchGroup();
    } catch (err: any) {
      toast.error(err.message || "Failed to link folder");
    } finally {
      setLinkingDrive(false);
    }
  };
  const [postingNow, setPostingNow] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ tiktokUsername: "", postpeerAccountId: "" });
  const [addingAccount, setAddingAccount] = useState(false);
  const [clockTick, setClockTick] = useState(0);
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

  const addAccountManual = async () => {
    if (!addForm.tiktokUsername.trim()) { toast.error("Enter a TikTok username"); return; }
    if (!group) return;
    setAddingAccount(true);
    try {
      const res = await fetch("/api/managed/accounts/add-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: group.id, ...addForm }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add");
      toast.success(`@${addForm.tiktokUsername} added!`);
      setAddForm({ tiktokUsername: "", postpeerAccountId: "" });
      setShowAddForm(false);
      fetchGroup();
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
      fetchGroup();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to post");
    } finally {
      setPostingNow(null);
    }
  };

  const fetchGroup = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/managed/groups/by-path/${sectionSlug}/${groupSlug}`
      );
      if (res.ok) setGroup(await res.json());
      else setGroup(null);
    } finally {
      setLoading(false);
    }
  }, [sectionSlug, groupSlug]);

  useEffect(() => {
    fetchGroup();
  }, [fetchGroup]);

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
      fetchGroup();
    } else if (error) {
      toast.error(`Google Drive connection failed: ${error}`);
      // Clean query params
      const newUrl = window.location.pathname;
      window.history.replaceState({}, "", newUrl);
    }
  }, [searchParams, fetchGroup]);

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
      fetchGroup();
    } catch {
      toast.error("Failed to update");
    }
  };

  const deleteAccount = async (acc: Account) => {
    if (
      !confirm(
        `Remove @${acc.tiktokUsername} from this group? This will delete all scheduled posts.`
      )
    )
      return;
    try {
      const res = await fetch(`/api/managed/accounts/${acc.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      toast.success(`@${acc.tiktokUsername} removed`);
      fetchGroup();
    } catch {
      toast.error("Failed to remove account");
    }
  };

  const startEdit = (acc: Account) => {
    setEditingId(acc.id);
    const slots = acc.postTimeSlots || `${acc.postTimeHour.toString().padStart(2,"0")}:${acc.postTimeMinute.toString().padStart(2,"0")}`;
    setEditForm({
      postTimeSlots: slots,
      postTimezone: acc.postTimezone,
      postDays: acc.postDays,
      postMode: acc.postMode,
      defaultCaption: acc.defaultCaption || "",
      captionSource: acc.captionSource,
      postpeerAccountId: acc.postpeerAccountId || "",
    });
    setDriveUrl("");
    setSelectedFolderId("");
    fetchFolders(acc.id);
  };

  const addSlot = () => {
    const existing = editForm.postTimeSlots.split(",").map(s => s.trim()).filter(Boolean);
    if (existing.includes(newSlot)) { toast.error("Slot already exists"); return; }
    if (existing.length >= 10) { toast.error("Max 10 slots"); return; }
    const updated = [...existing, newSlot].sort().join(",");
    setEditForm({ ...editForm, postTimeSlots: updated });
  };

  const removeSlot = (slot: string) => {
    const existing = editForm.postTimeSlots.split(",").map(s => s.trim()).filter(Boolean);
    if (existing.length <= 1) { toast.error("Need at least 1 slot"); return; }
    setEditForm({ ...editForm, postTimeSlots: existing.filter(s => s !== slot).join(",") });
  };

  const saveEdit = async (id: string) => {
    try {
      const res = await fetch(`/api/managed/accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success("Schedule updated");
      setEditingId(null);
      fetchGroup();
    } catch {
      toast.error("Failed to save");
    }
  };

  const linkDrive = async (id: string) => {
    if (!driveUrl.trim()) return;
    setLinkingDrive(true);
    try {
      const res = await fetch(`/api/managed/accounts/${id}/link-drive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderUrl: driveUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Link failed");
      if (data.warning) toast.warning(data.warning);
      else toast.success(`Linked: ${data.folderName}`);
      setDriveUrl("");
      fetchGroup();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to link folder");
    } finally {
      setLinkingDrive(false);
    }
  };

  const unlinkDrive = async (id: string, disconnectGoogle = false) => {
    const confirmMsg = disconnectGoogle
      ? "Disconnect Google Account? This will remove the connected Google Drive folder and log you out of Google on this server."
      : "Remove Google Drive folder link? (This keeps your Google Account connected so you can paste a new folder URL instantly)";

    if (!confirm(confirmMsg)) return;
    try {
      const url = `/api/managed/accounts/${id}/link-drive${disconnectGoogle ? "?disconnectGoogle=true" : ""}`;
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) throw new Error("Unlink failed");
      toast.success(disconnectGoogle ? "Google Account disconnected" : "Drive folder unlinked");
      fetchGroup();
    } catch {
      toast.error(disconnectGoogle ? "Failed to disconnect account" : "Failed to unlink folder");
    }
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

  if (!group) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500">Group not found</p>
        <Link
          href="/admin/accounts"
          className="text-purple-400 hover:text-purple-300 text-sm mt-2 inline-block"
        >
          ← Back to accounts
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link
          href="/admin/accounts"
          className="hover:text-white transition-colors"
        >
          Accounts
        </Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <Link
          href={`/admin/accounts/${sectionSlug}`}
          className="hover:text-white transition-colors"
        >
          {group.section.name}
        </Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-white font-medium">{group.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-3 h-8 rounded-full"
            style={{ backgroundColor: group.section.color }}
          />
          <div>
            <h1 className="text-2xl font-bold text-white">{group.name}</h1>
            {group.description && (
              <p className="text-gray-500 text-sm">{group.description}</p>
            )}
            <p className="text-gray-600 text-xs mt-0.5">
              {group.accounts.length} account
              {group.accounts.length !== 1 ? "s" : ""}
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

      {/* Manual Add Form */}
      {showAddForm && (
        <div className="glass border border-purple-500/20 rounded-2xl p-5 space-y-3">
          <h3 className="text-white font-semibold text-sm">Add TikTok Account</h3>
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

      {/* Accounts List */}
      {group.accounts.length === 0 ? (
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
          {group.accounts.map((acc) => (
            <div
              key={acc.id}
              className="glass border border-white/5 rounded-2xl overflow-hidden hover:border-white/10 transition-all"
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
                        {isTokenExpired(acc.tokenExpiresAt) && (
                          <span className="flex items-center gap-1 text-xs text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full">
                            <AlertCircle className="w-3 h-3" />
                            Token expired
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500">
                        {acc.tiktokDisplayName}
                      </p>
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
                  {acc.driveConnected ? (
                    <span className="flex items-center gap-1 bg-blue-500/10 text-blue-400 px-2.5 py-1 rounded-full">
                      <FolderOpen className="w-3 h-3" />
                      {acc.driveFolderName || "Drive linked"}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 bg-yellow-500/10 text-yellow-500 px-2.5 py-1 rounded-full">
                      <FolderOpen className="w-3 h-3" />
                      No folder linked
                    </span>
                  )}
                </div>

                {/* Edit panel */}
                {editingId === acc.id && (
                  <div className="mt-4 pt-4 border-t border-white/5 space-y-4">
                    <h4 className="font-semibold text-white text-sm">
                      Schedule Settings
                    </h4>

                    {/* Time Slots */}
                    <div className="space-y-3">
                      <label className="block text-xs text-gray-400">Post Times (per day)</label>
                      <div className="flex flex-wrap gap-2">
                        {editForm.postTimeSlots.split(",").map(s => s.trim()).filter(Boolean).map((slot) => (
                          <span key={slot} className="flex items-center gap-1.5 bg-purple-500/15 border border-purple-500/30 text-purple-300 text-xs font-medium px-3 py-1.5 rounded-lg">
                            <Clock className="w-3 h-3" />
                            {slot}
                            <button onClick={() => removeSlot(slot)} className="ml-1 text-purple-400 hover:text-red-400 transition-colors text-sm leading-none">×</button>
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="time"
                          value={newSlot}
                          onChange={(e) => setNewSlot(e.target.value)}
                          className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                        />
                        <button
                          onClick={addSlot}
                          className="bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/30 text-purple-300 text-xs font-semibold px-3 py-2 rounded-lg transition-all"
                        >
                          + Add Slot
                        </button>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Timezone</label>
                        <select
                          value={editForm.postTimezone}
                          onChange={(e) => setEditForm({ ...editForm, postTimezone: e.target.value })}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                        >
                          <option value="UTC">UTC</option>
                          <option value="America/New_York">Eastern</option>
                          <option value="America/Chicago">Central</option>
                          <option value="America/Denver">Mountain</option>
                          <option value="America/Los_Angeles">Pacific</option>
                          <option value="Europe/London">London</option>
                          <option value="Europe/Paris">Paris</option>
                          <option value="Asia/Dubai">Dubai</option>
                          <option value="Asia/Kolkata">India</option>
                          <option value="Asia/Tokyo">Tokyo</option>
                          <option value="Asia/Riyadh">Riyadh</option>
                        </select>
                      </div>
                    </div>

                    {/* Days */}
                    <div>
                      <label className="block text-xs text-gray-400 mb-2">
                        Post Days
                      </label>
                      <div className="flex gap-1.5">
                        {DAYS.map((d) => {
                          const active = editForm.postDays
                            .split(",")
                            .includes(d.num);
                          return (
                            <button
                              key={d.num}
                              onClick={() => {
                                const days = editForm.postDays
                                  .split(",")
                                  .filter(Boolean);
                                const newDays = active
                                  ? days.filter((x) => x !== d.num)
                                  : [...days, d.num];
                                setEditForm({
                                  ...editForm,
                                  postDays: newDays.sort().join(","),
                                });
                              }}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                active
                                  ? "bg-purple-500/20 border border-purple-500 text-purple-300"
                                  : "bg-white/5 border border-white/10 text-gray-500 hover:border-white/20"
                              }`}
                            >
                              {d.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Mode + Caption */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">
                          Post Mode
                        </label>
                        <select
                          value={editForm.postMode}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              postMode: e.target.value,
                            })
                          }
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                        >
                          <option value="DIRECT">Direct Post</option>
                          <option value="DRAFT">Draft (Inbox)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">
                          Caption Source
                        </label>
                        <select
                          value={editForm.captionSource}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              captionSource: e.target.value,
                            })
                          }
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                        >
                          <option value="FILENAME">From filename</option>
                          <option value="TXT_FILE">From .txt file</option>
                          <option value="DEFAULT">Default caption</option>
                        </select>
                      </div>
                    </div>

                    {editForm.captionSource === "DEFAULT" && (
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">
                          Default Caption
                        </label>
                        <textarea
                          value={editForm.defaultCaption}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              defaultCaption: e.target.value,
                            })
                          }
                          rows={2}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500 resize-none"
                          placeholder="Caption text with #hashtags..."
                        />
                      </div>
                    )}

                    {/* ── Drive Folder Linking ── */}
                    <div className="pt-3 border-t border-white/5 space-y-3">
                      <h4 className="font-semibold text-white text-sm flex items-center gap-2">
                        <FolderOpen className="w-3.5 h-3.5 text-blue-400" />
                        Google Drive Folder
                      </h4>

                      {acc.driveConnected && acc.driveFolderId ? (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3">
                            <div className="overflow-hidden flex-1 mr-2">
                              <div className="flex items-center gap-2">
                                {acc.googleOAuthConnected && (
                                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                )}
                                <p className="text-sm text-blue-300 font-medium truncate">
                                  {acc.googleOAuthConnected
                                    ? `OAuth: ${acc.driveFolderName || "Sleeckos Videos"}`
                                    : acc.driveFolderName || "Drive Folder"}
                                </p>
                              </div>
                              <p className="text-xs text-blue-400/60 font-mono mt-0.5 truncate">{acc.driveFolderId}</p>
                            </div>
                            <div className="flex flex-col items-end gap-1 flex-shrink-0">
                              <button
                                onClick={() => unlinkDrive(acc.id, false)}
                                className="text-xs text-blue-400 hover:text-blue-300 font-semibold transition-colors"
                                title="Remove the current folder link but keep Google OAuth logged in"
                              >
                                Unlink Folder
                              </button>
                              {acc.googleOAuthConnected && (
                                <button
                                  onClick={() => unlinkDrive(acc.id, true)}
                                  className="text-[10px] text-red-400/70 hover:text-red-400 transition-colors font-medium"
                                  title="Log out of Google completely"
                                >
                                  Disconnect Account
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Folder Selector Dropdown (Render only if folders are loaded) */}
                          {foldersList.length > 0 ? (
                            <div className="space-y-2 pl-3 border-l-2 border-blue-500/20">
                              <div className="flex justify-between items-center">
                                <label className="block text-[10px] text-gray-500 font-bold uppercase tracking-wider">Select Folder Specifically</label>
                                <button
                                  onClick={() => fetchFolders(acc.id)}
                                  className="text-[9px] text-blue-400 hover:text-blue-300 transition-colors"
                                  type="button"
                                >
                                  🔄 Refresh List
                                </button>
                              </div>
                              <div className="flex gap-2">
                                <select
                                  value={selectedFolderId}
                                  onChange={(e) => setSelectedFolderId(e.target.value)}
                                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-blue-500 transition-colors"
                                >
                                  <option value="" className="bg-[#11111c]">-- Choose Folder --</option>
                                  {foldersList.map((f) => (
                                    <option key={f.id} value={f.id} className="bg-[#11111c]">
                                      {f.name}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => linkSelectedFolder(acc.id)}
                                  disabled={!selectedFolderId || linkingDrive}
                                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all flex items-center gap-1.5 flex-shrink-0"
                                >
                                  {linkingDrive && <Loader2 className="w-3 h-3 animate-spin" />}
                                  Select
                                </button>
                              </div>
                            </div>
                          ) : loadingFolders ? (
                            <div className="flex items-center gap-2 text-xs text-gray-400 pl-3">
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                              Fetching folders list from Google...
                            </div>
                          ) : null}

                          {/* Quick Change Folder Link block */}
                          <div className="space-y-2 pl-3 border-l-2 border-blue-500/20">
                            <label className="block text-[10px] text-gray-500 font-bold uppercase tracking-wider">Or Paste Folder Link</label>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={driveUrl}
                                onChange={(e) => setDriveUrl(e.target.value)}
                                placeholder="Paste new Google Drive folder URL or ID..."
                                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-xs placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
                                onKeyDown={(e) => e.key === "Enter" && linkDrive(acc.id)}
                              />
                              <button
                                onClick={() => linkDrive(acc.id)}
                                disabled={!driveUrl.trim() || linkingDrive}
                                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all flex items-center gap-1.5"
                              >
                                {linkingDrive && <Loader2 className="w-3 h-3 animate-spin" />}
                                Change
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {/* Premium Google OAuth Connection */}
                          <div className="flex flex-col sm:flex-row gap-3">
                            <a
                              href={`/api/managed/accounts/${acc.id}/auth/google?section=${sectionSlug}&group=${groupSlug}`}
                              className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold px-4 py-3 rounded-xl transition-all shadow-lg hover:shadow-purple-500/20 hover:scale-[1.01]"
                            >
                              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12.24 10.285V14.4h6.887c-.648 2.41-2.519 4.114-5.136 4.114-3.51 0-6.357-2.846-6.357-6.357s2.846-6.357 6.357-6.357c1.616 0 3.084.604 4.225 1.597L21.3 4.316C19.043 2.214 15.938 1 12.24 1c-6.076 0-11 4.924-11 11s4.924 11 11 11c6.34 0 10.55-4.46 10.55-10.74 0-.74-.08-1.285-.2-1.974h-10.35z"/>
                              </svg>
                              Connect Google Drive (OAuth)
                            </a>
                          </div>

                          {/* Divider */}
                          <div className="relative flex py-1 items-center">
                            <div className="flex-grow border-t border-white/5"></div>
                            <span className="flex-shrink mx-3 text-[10px] text-gray-500 font-medium uppercase tracking-wider">Or paste folder URL</span>
                            <div className="flex-grow border-t border-white/5"></div>
                          </div>

                          {/* Folder Selector Dropdown (Render only if folders are loaded) */}
                          {foldersList.length > 0 ? (
                            <div className="space-y-2">
                              <div className="flex justify-between items-center">
                                <label className="block text-[10px] text-gray-500 font-bold uppercase tracking-wider">Select Folder Specifically</label>
                                <button
                                  onClick={() => fetchFolders(acc.id)}
                                  className="text-[9px] text-blue-400 hover:text-blue-300 transition-colors"
                                  type="button"
                                >
                                  🔄 Refresh List
                                </button>
                              </div>
                              <div className="flex gap-2">
                                <select
                                  value={selectedFolderId}
                                  onChange={(e) => setSelectedFolderId(e.target.value)}
                                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-blue-500 transition-colors"
                                >
                                  <option value="" className="bg-[#11111c]">-- Choose Folder --</option>
                                  {foldersList.map((f) => (
                                    <option key={f.id} value={f.id} className="bg-[#11111c]">
                                      {f.name}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => linkSelectedFolder(acc.id)}
                                  disabled={!selectedFolderId || linkingDrive}
                                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all flex items-center gap-1.5 flex-shrink-0"
                                >
                                  {linkingDrive && <Loader2 className="w-3 h-3 animate-spin" />}
                                  Select
                                </button>
                              </div>
                            </div>
                          ) : loadingFolders ? (
                            <div className="flex items-center gap-2 text-xs text-gray-400">
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                              Fetching folders list from Google...
                            </div>
                          ) : null}

                          {/* Folder URL Fallback */}
                          <div className="space-y-2">
                            <p className="text-[10px] text-gray-500">
                              Or paste a Google Drive folder URL or ID. This will automatically authenticate uploads using the Master/Global Google OAuth credentials.
                            </p>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={driveUrl}
                                onChange={(e) => setDriveUrl(e.target.value)}
                                placeholder="https://drive.google.com/drive/folders/..."
                                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-xs placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
                                onKeyDown={(e) => e.key === "Enter" && linkDrive(acc.id)}
                              />
                              <button
                                onClick={() => linkDrive(acc.id)}
                                disabled={!driveUrl.trim() || linkingDrive}
                                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all flex items-center gap-1.5"
                              >
                                {linkingDrive && <Loader2 className="w-3 h-3 animate-spin" />}
                                Link
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* ── PostPeer Account ID ── */}
                    <div className="pt-3 border-t border-white/5 space-y-2">
                      <h4 className="font-semibold text-white text-sm flex items-center gap-2">
                        <svg className="w-3.5 h-3.5 text-amber-400" viewBox="0 0 24 24" fill="currentColor"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                        PostPeer Integration
                      </h4>
                      <p className="text-xs text-gray-500">
                        Enter the PostPeer account ID for this TikTok account (from your PostPeer dashboard).
                      </p>
                      <input
                        type="text"
                        value={editForm.postpeerAccountId}
                        onChange={(e) => setEditForm({ ...editForm, postpeerAccountId: e.target.value })}
                        placeholder="e.g. 6a009951aebd14fd48e032c9"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-xs font-mono placeholder-gray-600 focus:outline-none focus:border-amber-500 transition-colors"
                      />
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => saveEdit(acc.id)}
                        className="bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-all"
                      >
                        Save Schedule
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="bg-white/5 hover:bg-white/10 text-white text-sm font-medium px-4 py-2 rounded-xl transition-all border border-white/10"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
