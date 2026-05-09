"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Plus,
  FolderOpen,
  Users,
  MonitorPlay,
  Loader2,
  Trash2,
  Pencil,
  X,
} from "lucide-react";

type Section = {
  id: string;
  name: string;
  slug: string;
  color: string;
  icon: string | null;
  sortOrder: number;
  totalGroups: number;
  totalAccounts: number;
  groups: {
    id: string;
    name: string;
    slug: string;
    _count: { accounts: number };
  }[];
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

export default function AccountsPage() {
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createColor, setCreateColor] = useState("#8b5cf6");
  const [creating, setCreating] = useState(false);

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
    if (!confirm(`Delete "${name}" and all its groups and accounts?`)) return;
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
            Manage your TikTok accounts organized by sections and groups
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-all"
        >
          <Plus className="w-4 h-4" />
          New Section
        </button>
      </div>

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
              {/* Color accent bar */}
              <div
                className="h-1"
                style={{ backgroundColor: section.color }}
              />
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <Link
                      href={`/admin/accounts/${section.slug}`}
                      className="text-lg font-bold text-white hover:underline"
                    >
                      {section.name}
                    </Link>
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
                    <FolderOpen className="w-3.5 h-3.5" />
                    {section.totalGroups} group
                    {section.totalGroups !== 1 ? "s" : ""}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <MonitorPlay className="w-3.5 h-3.5" />
                    {section.totalAccounts} account
                    {section.totalAccounts !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Groups preview */}
                {section.groups.length > 0 ? (
                  <div className="space-y-1.5 mb-4">
                    {section.groups.slice(0, 4).map((g) => (
                      <Link
                        key={g.id}
                        href={`/admin/accounts/${section.slug}/${g.slug}`}
                        className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/3 hover:bg-white/5 transition-colors"
                      >
                        <span className="text-sm text-gray-300">{g.name}</span>
                        <span className="text-xs text-gray-600">
                          {g._count.accounts} acc
                        </span>
                      </Link>
                    ))}
                    {section.groups.length > 4 && (
                      <p className="text-xs text-gray-600 text-center pt-1">
                        +{section.groups.length - 4} more groups
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-gray-600 mb-4">
                    No groups yet — click to add one
                  </p>
                )}

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
    </div>
  );
}
