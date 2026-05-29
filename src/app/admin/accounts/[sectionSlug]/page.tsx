"use client";
import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Plus,
  Loader2,
  X,
  Users,
  Trash2,
  ChevronRight,
  Power,
  FileText,
  Save,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";

type Account = {
  id: string;
  tiktokUsername: string;
  tiktokDisplayName: string;
  tiktokAvatarUrl: string;
  followerCount: number;
  isActive: boolean;
  driveConnected: boolean;
  postTimeHour: number;
  postTimeMinute: number;
  postTimezone: string;
  tokenExpiresAt: string;
};

type Group = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  defaultDescription: string | null;
  isActive: boolean;
  accounts: Account[];
  _count: { accounts: number };
};

type Section = {
  id: string;
  name: string;
  slug: string;
  color: string;
  defaultDescription: string | null;
  isActive: boolean;
  groups: Group[];
};

export default function SectionPage({
  params,
}: {
  params: Promise<{ sectionSlug: string }>;
}) {
  const { sectionSlug } = use(params);
  const [section, setSection] = useState<Section | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupDesc, setGroupDesc] = useState("");
  const [creating, setCreating] = useState(false);

  // Section-level description editing
  const [sectionDesc, setSectionDesc] = useState("");
  const [sectionDescDirty, setSectionDescDirty] = useState(false);
  const [savingSection, setSavingSection] = useState(false);

  // Group-level description editing
  const [editingGroupDesc, setEditingGroupDesc] = useState<string | null>(null);
  const [groupDescValue, setGroupDescValue] = useState("");

  const fetchSection = useCallback(async () => {
    try {
      const res = await fetch(`/api/managed/sections/by-slug/${sectionSlug}`);
      if (res.ok) {
        const data = await res.json();
        setSection(data);
        setSectionDesc(data.defaultDescription || "");
        setSectionDescDirty(false);
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

  const handleCreateGroup = async () => {
    if (!groupName.trim() || !section) return;
    setCreating(true);
    try {
      const res = await fetch("/api/managed/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionId: section.id,
          name: groupName.trim(),
          description: groupDesc.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed");
      }
      toast.success(`Group "${groupName}" created`);
      setGroupName("");
      setGroupDesc("");
      setShowCreateGroup(false);
      fetchSection();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Creation failed");
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteGroup = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}" and all its accounts?`)) return;
    try {
      const res = await fetch(`/api/managed/groups/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      toast.success(`Group "${name}" deleted`);
      fetchSection();
    } catch {
      toast.error("Failed to delete group");
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

  // ── Section description save ────────────────────────────────────────────────
  const saveSectionDesc = async () => {
    if (!section) return;
    setSavingSection(true);
    try {
      const res = await fetch(`/api/managed/sections/${section.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultDescription: sectionDesc.trim() }),
      });
      if (!res.ok) throw new Error("Failed");
      setSection({ ...section, defaultDescription: sectionDesc.trim() || null });
      setSectionDescDirty(false);
      toast.success("Section description saved");
    } catch {
      toast.error("Failed to save description");
    } finally {
      setSavingSection(false);
    }
  };

  // ── Group toggle ────────────────────────────────────────────────────────────
  const toggleGroup = async (groupId: string, currentActive: boolean) => {
    try {
      const res = await fetch(`/api/managed/groups/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !currentActive }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success(currentActive ? "Group disabled" : "Group enabled");
      fetchSection();
    } catch {
      toast.error("Failed to toggle group");
    }
  };

  // ── Group description save ──────────────────────────────────────────────────
  const saveGroupDesc = async (groupId: string) => {
    try {
      const res = await fetch(`/api/managed/groups/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultDescription: groupDescValue.trim() }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Group description saved");
      setEditingGroupDesc(null);
      fetchSection();
    } catch {
      toast.error("Failed to save description");
    }
  };

  const formatTime = (h: number, m: number) =>
    `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;

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
              {section.groups.length} group
              {section.groups.length !== 1 ? "s" : ""} ·{" "}
              {section.groups.reduce(
                (s, g) => s + g._count.accounts,
                0
              )}{" "}
              accounts
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowCreateGroup(true)}
          className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-all"
        >
          <Plus className="w-4 h-4" />
          New Group
        </button>
      </div>

      {/* Section-level Global Description */}
      <div className="glass border border-white/5 rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-300">
          <FileText className="w-4 h-4 text-purple-400" />
          Global Video Description
          <span className="text-xs font-normal text-gray-600 ml-1">
            Applied to all accounts in this section (unless overridden at group or account level)
          </span>
        </div>
        <textarea
          value={sectionDesc}
          onChange={(e) => {
            setSectionDesc(e.target.value);
            setSectionDescDirty(true);
          }}
          placeholder="Enter a default TikTok video description for all accounts in this section... (e.g. hashtags, call-to-action)"
          rows={3}
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-purple-500 transition-colors resize-none"
        />
        {sectionDescDirty && (
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
            Save Description
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

      {/* Create Group Dialog */}
      {showCreateGroup && (
        <div className="glass border border-purple-500/20 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-white">Create Group</h3>
            <button
              onClick={() => setShowCreateGroup(false)}
              className="text-gray-500 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Group Name
            </label>
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder='e.g. "US Politics", "EDM", "Memes"'
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 transition-colors text-sm"
              onKeyDown={(e) => e.key === "Enter" && handleCreateGroup()}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Description (optional)
            </label>
            <input
              type="text"
              value={groupDesc}
              onChange={(e) => setGroupDesc(e.target.value)}
              placeholder="Short description of this group"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 transition-colors text-sm"
            />
          </div>
          <button
            onClick={handleCreateGroup}
            disabled={!groupName.trim() || creating}
            className="bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all flex items-center gap-2"
          >
            {creating && <Loader2 className="w-4 h-4 animate-spin" />}
            Create Group
          </button>
        </div>
      )}

      {/* Groups List */}
      {section.groups.length === 0 && !showCreateGroup ? (
        <div className="glass border border-white/5 rounded-2xl p-12 text-center">
          <Users className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2">
            No groups yet
          </h3>
          <p className="text-gray-500 text-sm mb-6">
            Create groups to organize your TikTok accounts
          </p>
          <button
            onClick={() => setShowCreateGroup(true)}
            className="bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Create First Group
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {section.groups.map((group) => (
            <div
              key={group.id}
              className={`glass border border-white/5 rounded-2xl overflow-hidden hover:border-white/10 transition-all ${
                !group.isActive ? "opacity-50" : ""
              }`}
            >
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/admin/accounts/${section.slug}/${group.slug}`}
                        className="text-lg font-bold text-white hover:underline"
                      >
                        {group.name}
                      </Link>
                      {/* Group toggle */}
                      <button
                        onClick={() => toggleGroup(group.id, group.isActive)}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-all ${
                          group.isActive
                            ? "bg-green-500/10 text-green-400 hover:bg-green-500/20"
                            : "bg-red-500/10 text-red-400 hover:bg-red-500/20"
                        }`}
                        title={group.isActive ? "Disable group" : "Enable group"}
                      >
                        {group.isActive ? (
                          <ToggleRight className="w-3.5 h-3.5" />
                        ) : (
                          <ToggleLeft className="w-3.5 h-3.5" />
                        )}
                        {group.isActive ? "On" : "Off"}
                      </button>
                    </div>
                    {group.description && (
                      <p className="text-sm text-gray-500 mt-0.5">
                        {group.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/admin/accounts/${section.slug}/${group.slug}`}
                      className="text-sm text-purple-400 hover:text-purple-300 font-medium transition-colors"
                    >
                      Manage →
                    </Link>
                    <button
                      onClick={() =>
                        handleDeleteGroup(group.id, group.name)
                      }
                      className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-400/10 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Group-level Video Description */}
                <div className="mb-4">
                  {editingGroupDesc === group.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={groupDescValue}
                        onChange={(e) => setGroupDescValue(e.target.value)}
                        placeholder="Group video description (overrides section description)..."
                        rows={2}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-xs placeholder-gray-600 focus:outline-none focus:border-purple-500 transition-colors resize-none"
                        autoFocus
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => saveGroupDesc(group.id)}
                          className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
                        >
                          <Save className="w-3 h-3" />
                          Save
                        </button>
                        <button
                          onClick={() => setEditingGroupDesc(null)}
                          className="text-xs text-gray-500 hover:text-white transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setEditingGroupDesc(group.id);
                        setGroupDescValue(group.defaultDescription || "");
                      }}
                      className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-purple-400 transition-colors"
                    >
                      <FileText className="w-3 h-3" />
                      {group.defaultDescription
                        ? `Description: ${group.defaultDescription.substring(0, 60)}${group.defaultDescription.length > 60 ? "..." : ""}`
                        : "Set group video description..."}
                    </button>
                  )}
                </div>

                {/* Account avatars preview */}
                {group.accounts.length > 0 ? (
                  <div className="space-y-2">
                    {group.accounts.slice(0, 5).map((acc) => (
                      <div
                        key={acc.id}
                        className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/3 hover:bg-white/5 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <img
                            src={acc.tiktokAvatarUrl || "/default-avatar.png"}
                            alt={acc.tiktokUsername}
                            className="w-8 h-8 rounded-full object-cover"
                          />
                          <div>
                            <p className="text-sm font-medium text-white">
                              @{acc.tiktokUsername}
                            </p>
                            <p className="text-xs text-gray-500">
                              {acc.followerCount.toLocaleString()} followers
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span
                            className={`px-2 py-0.5 rounded-full ${
                              acc.isActive
                                ? "bg-green-500/10 text-green-400"
                                : "bg-gray-500/10 text-gray-500"
                            }`}
                          >
                            {acc.isActive ? "Active" : "Paused"}
                          </span>
                          <span className="text-gray-600">
                            {formatTime(acc.postTimeHour, acc.postTimeMinute)}
                          </span>
                          {acc.driveConnected && (
                            <span className="text-blue-400" title="Drive linked">
                              📂
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                    {group.accounts.length > 5 && (
                      <p className="text-xs text-gray-600 text-center pt-1">
                        +{group.accounts.length - 5} more accounts
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-gray-600">No accounts yet</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
