"use client";
import React, { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Clock,
  FolderOpen,
  Save,
  AlertCircle,
  Search,
  X,
} from "lucide-react";

type Account = {
  id: string;
  tiktokUsername: string;
  tiktokDisplayName: string;
  tiktokAvatarUrl: string;
  followerCount: number;
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
  defaultCaption: string | null;
  captionSource: string;
  postpeerAccountId: string | null;
  googleOAuthConnected?: boolean;
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

export default function ManagedAccountEditForm({
  accountId,
  isReadOnly = false,
  onClose,
  onSave,
}: {
  accountId: string;
  isReadOnly?: boolean;
  onClose: () => void;
  onSave?: () => void;
}) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [editForm, setEditForm] = useState({
    tiktokUsername: "",
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
  const [searchQuery, setSearchQuery] = useState("");

  const fetchAccount = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/managed/accounts/${accountId}`);
      if (!res.ok) throw new Error("Failed to fetch account settings");
      const data = await res.json();
      setAccount(data);
      const slots = data.postTimeSlots || `${data.postTimeHour.toString().padStart(2, "0")}:${data.postTimeMinute.toString().padStart(2, "0")}`;
      setEditForm({
        tiktokUsername: data.tiktokUsername,
        postTimeSlots: slots,
        postTimezone: data.postTimezone,
        postDays: data.postDays,
        postMode: data.postMode,
        defaultCaption: data.defaultCaption || "",
        captionSource: data.captionSource,
        postpeerAccountId: data.postpeerAccountId || "",
      });
      fetchFolders();
    } catch (err: any) {
      toast.error(err.message || "Failed to load account");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  const fetchFolders = async (query?: string) => {
    setLoadingFolders(true);
    setFoldersList([]);
    try {
      let url = `/api/managed/accounts/${accountId}/drive-folders`;
      if (query && query.trim()) {
        url += `?search=${encodeURIComponent(query.trim())}`;
      }
      const res = await fetch(url);
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

  useEffect(() => {
    fetchAccount();
  }, [fetchAccount]);

  const addSlot = () => {
    if (isReadOnly) return;
    const existing = editForm.postTimeSlots.split(",").map(s => s.trim()).filter(Boolean);
    if (existing.includes(newSlot)) {
      toast.error("Slot already exists");
      return;
    }
    if (existing.length >= 10) {
      toast.error("Max 10 slots");
      return;
    }
    const updated = [...existing, newSlot].sort().join(",");
    setEditForm({ ...editForm, postTimeSlots: updated });
  };

  const removeSlot = (slot: string) => {
    if (isReadOnly) return;
    const existing = editForm.postTimeSlots.split(",").map(s => s.trim()).filter(Boolean);
    if (existing.length <= 1) {
      toast.error("Need at least 1 slot");
      return;
    }
    setEditForm({ ...editForm, postTimeSlots: existing.filter(s => s !== slot).join(",") });
  };

  const saveEdit = async () => {
    if (isReadOnly) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/managed/accounts/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Save failed");
      }
      toast.success("Schedule updated");
      if (onSave) onSave();
      fetchAccount();
    } catch (err: any) {
      toast.error(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const linkDrive = async () => {
    if (isReadOnly || !driveUrl.trim()) return;
    setLinkingDrive(true);
    try {
      const res = await fetch(`/api/managed/accounts/${accountId}/link-drive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderUrl: driveUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Link failed");
      if (data.warning) toast.warning(data.warning);
      else toast.success(`Linked: ${data.folderName}`);
      setDriveUrl("");
      fetchAccount();
    } catch (err: any) {
      toast.error(err.message || "Failed to link folder");
    } finally {
      setLinkingDrive(false);
    }
  };

  const linkSelectedFolder = async () => {
    if (isReadOnly || !selectedFolderId) return;
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
      fetchAccount();
    } catch (err: any) {
      toast.error(err.message || "Failed to link folder");
    } finally {
      setLinkingDrive(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
      </div>
    );
  }

  if (!account) {
    return (
      <div className="text-center py-6 text-zinc-500">
        <AlertCircle className="w-8 h-8 mx-auto mb-2 text-zinc-600" />
        <p>Account not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-h-[80vh] overflow-y-auto pr-1">
      {/* Username Edit */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">TikTok Username</label>
        <div className="flex gap-2">
          <div className="flex items-center gap-1 flex-1">
            <span className="text-gray-500 text-sm">@</span>
            <input
              type="text"
              disabled={isReadOnly}
              value={editForm.tiktokUsername}
              onChange={(e) => setEditForm({ ...editForm, tiktokUsername: e.target.value.replace(/^@/, "") })}
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500 disabled:opacity-40"
              placeholder="username"
            />
          </div>
        </div>
        <p className="text-[10px] text-gray-600 mt-1">Changing username will reset video links — use Refresh Links in History to rebuild them.</p>
      </div>

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
              {!isReadOnly && (
                <button onClick={() => removeSlot(slot)} className="ml-1 text-purple-400 hover:text-red-400 transition-colors text-sm leading-none">×</button>
              )}
            </span>
          ))}
        </div>
        {!isReadOnly && (
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
        )}
        <div>
          <label className="block text-xs text-gray-400 mb-1">Timezone</label>
          <select
            disabled={isReadOnly}
            value={editForm.postTimezone}
            onChange={(e) => setEditForm({ ...editForm, postTimezone: e.target.value })}
            className="w-full bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500 disabled:opacity-40"
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
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((d) => {
            const active = editForm.postDays
              .split(",")
              .includes(d.num);
            return (
              <button
                key={d.num}
                disabled={isReadOnly}
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
                } disabled:opacity-50`}
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
            disabled={isReadOnly}
            value={editForm.postMode}
            onChange={(e) =>
              setEditForm({
                ...editForm,
                postMode: e.target.value,
              })
            }
            className="w-full bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500 disabled:opacity-40"
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
            disabled={isReadOnly}
            value={editForm.captionSource}
            onChange={(e) =>
              setEditForm({
                ...editForm,
                captionSource: e.target.value,
              })
            }
            className="w-full bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500 disabled:opacity-40"
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
            disabled={isReadOnly}
            value={editForm.defaultCaption}
            onChange={(e) =>
              setEditForm({
                ...editForm,
                defaultCaption: e.target.value,
              })
            }
            rows={2}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500 resize-none disabled:opacity-40"
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

        {account.driveConnected && account.driveFolderId ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3">
              <div className="overflow-hidden flex-1 mr-2">
                <div className="flex items-center gap-2">
                  {account.googleOAuthConnected && (
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  )}
                  <p className="text-sm text-blue-300 font-medium truncate">
                    {account.googleOAuthConnected
                      ? `OAuth: ${account.driveFolderName || "Sleeckos Videos"}`
                      : account.driveFolderName || "Drive Folder"}
                  </p>
                </div>
                <p className="text-[10px] text-zinc-500 font-mono truncate mt-0.5">{account.driveFolderId}</p>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-zinc-500 italic">No Google Drive folder linked yet.</p>
        )}

        {!isReadOnly && (
          <div className="space-y-3 pt-2">
            {/* Folder Picker Card */}
            <div className="space-y-2 bg-[#111] p-3 border border-white/5 rounded-xl">
              <div className="flex items-center justify-between">
                <label className="block text-[10px] uppercase text-zinc-500 font-bold tracking-wider">Select Folder from Account Drive</label>
                {loadingFolders && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />}
              </div>

              {/* Search Bar */}
              <div className="relative flex items-center gap-1.5 mt-1">
                <div className="relative flex-1">
                  <input
                    type="text"
                    placeholder="Search folder by name..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        fetchFolders(searchQuery);
                      }
                    }}
                    className="w-full bg-black/40 border border-white/10 rounded-lg pl-8 pr-7 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500"
                  />
                  <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  {searchQuery && (
                    <button
                      onClick={() => {
                        setSearchQuery("");
                        fetchFolders("");
                      }}
                      className="text-zinc-500 hover:text-white absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold font-mono"
                    >
                      ×
                    </button>
                  )}
                </div>
                <button
                  onClick={() => fetchFolders(searchQuery)}
                  disabled={loadingFolders}
                  className="bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 hover:text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
                >
                  Search
                </button>
              </div>

              {/* Dropdown Select & Link Button */}
              {foldersList.length > 0 ? (
                <div className="flex gap-2 mt-2">
                  <select
                    value={selectedFolderId}
                    onChange={(e) => setSelectedFolderId(e.target.value)}
                    className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  >
                    {foldersList.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={linkSelectedFolder}
                    disabled={linkingDrive || !selectedFolderId}
                    className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-all"
                  >
                    Link Selection
                  </button>
                </div>
              ) : (
                <p className="text-[11px] text-zinc-500 italic mt-2 text-center py-2 bg-black/20 rounded-lg border border-zinc-950">
                  {loadingFolders ? "Searching folders..." : "No folders found in this account."}
                </p>
              )}
            </div>

            {/* Manual Link Input */}
            <div className="space-y-2 bg-[#111] p-3 border border-white/5 rounded-xl">
              <label className="block text-[10px] uppercase text-zinc-500 font-bold tracking-wider">Link Folder Manually by Link/ID</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="https://drive.google.com/drive/folders/... or Folder ID"
                  value={driveUrl}
                  onChange={(e) => setDriveUrl(e.target.value)}
                  className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-zinc-600 focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={linkDrive}
                  disabled={linkingDrive || !driveUrl.trim()}
                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-all flex items-center gap-1.5"
                >
                  {linkingDrive && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Link Manual
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="pt-4 border-t border-white/5 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-all text-xs font-semibold"
        >
          {isReadOnly ? "Close" : "Cancel"}
        </button>
        {!isReadOnly && (
          <button
            onClick={saveEdit}
            disabled={saving}
            className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-all"
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            Save Schedule
          </button>
        )}
      </div>
    </div>
  );
}
