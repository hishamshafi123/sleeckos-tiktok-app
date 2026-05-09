"use client";
import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
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
  defaultCaption: string | null;
  captionSource: string;
  tokenExpiresAt: string;
  _count: { scheduledPosts: number };
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
  const [group, setGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    postTimeHour: 12,
    postTimeMinute: 0,
    postTimezone: "UTC",
    postDays: "1,2,3,4,5,6,7",
    postMode: "DIRECT",
    defaultCaption: "",
    captionSource: "FILENAME",
  });
  const [driveUrl, setDriveUrl] = useState("");
  const [linkingDrive, setLinkingDrive] = useState(false);

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
    setEditForm({
      postTimeHour: acc.postTimeHour,
      postTimeMinute: acc.postTimeMinute,
      postTimezone: acc.postTimezone,
      postDays: acc.postDays,
      postMode: acc.postMode,
      defaultCaption: acc.defaultCaption || "",
      captionSource: acc.captionSource,
    });
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

  const unlinkDrive = async (id: string) => {
    if (!confirm("Remove Drive folder link?")) return;
    try {
      const res = await fetch(`/api/managed/accounts/${id}/link-drive`, { method: "DELETE" });
      if (!res.ok) throw new Error("Unlink failed");
      toast.success("Drive folder unlinked");
      fetchGroup();
    } catch {
      toast.error("Failed to unlink");
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
        <a
          href={`/api/managed/tiktok/auth?groupId=${group.id}`}
          className="flex items-center gap-2 bg-[#010101] hover:bg-[#1a1a1a] border border-white/10 hover:border-white/20 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-all"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V9.41a8.16 8.16 0 0 0 4.77 1.52V7.49a4.85 4.85 0 0 1-1-.8z" />
          </svg>
          Add TikTok Account
        </a>
      </div>

      {/* Accounts List */}
      {group.accounts.length === 0 ? (
        <div className="glass border border-white/5 rounded-2xl p-12 text-center">
          <svg
            className="w-12 h-12 text-gray-600 mx-auto mb-4"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V9.41a8.16 8.16 0 0 0 4.77 1.52V7.49a4.85 4.85 0 0 1-1-.8z" />
          </svg>
          <h3 className="text-lg font-semibold text-white mb-2">
            No accounts yet
          </h3>
          <p className="text-gray-500 text-sm mb-6">
            Connect TikTok accounts to start managing them
          </p>
          <a
            href={`/api/managed/tiktok/auth?groupId=${group.id}`}
            className="inline-flex items-center gap-2 bg-[#010101] hover:bg-[#1a1a1a] border border-white/10 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V9.41a8.16 8.16 0 0 0 4.77 1.52V7.49a4.85 4.85 0 0 1-1-.8z" />
            </svg>
            Connect First Account
          </a>
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
                  <span className="flex items-center gap-1 bg-white/5 text-gray-400 px-2.5 py-1 rounded-full">
                    <Clock className="w-3 h-3" />
                    {formatTime(acc.postTimeHour, acc.postTimeMinute)}{" "}
                    {acc.postTimezone}
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

                    {/* Time */}
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">
                          Hour (0-23)
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={23}
                          value={editForm.postTimeHour}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              postTimeHour: +e.target.value,
                            })
                          }
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">
                          Minute (0-59)
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={59}
                          value={editForm.postTimeMinute}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              postTimeMinute: +e.target.value,
                            })
                          }
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">
                          Timezone
                        </label>
                        <select
                          value={editForm.postTimezone}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              postTimezone: e.target.value,
                            })
                          }
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
                        <div className="flex items-center justify-between bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3">
                          <div>
                            <p className="text-sm text-blue-300 font-medium">{acc.driveFolderName || "Drive Folder"}</p>
                            <p className="text-xs text-blue-400/60 font-mono mt-0.5">{acc.driveFolderId}</p>
                          </div>
                          <button
                            onClick={() => unlinkDrive(acc.id)}
                            className="text-xs text-red-400 hover:text-red-300 transition-colors"
                          >
                            Unlink
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-xs text-gray-500">
                            Paste a Google Drive folder URL or folder ID. The folder must be shared with the service account.
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
                      )}
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
