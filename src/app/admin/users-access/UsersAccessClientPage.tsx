"use client";

import React, { useState, useEffect } from "react";
import {
  Users,
  Shield,
  Search,
  CheckCircle,
  AlertTriangle,
  UserPlus,
  ArrowLeft,
  X,
  Save,
  Trash2,
  Lock,
  Check,
  RefreshCw,
  Loader2,
  AlertCircle,
  Folder
} from "lucide-react";
import { toast } from "sonner";

interface RoleDefault {
  toolKey: string;
}

interface Role {
  id: string;
  key: string;
  label: string;
  defaults: RoleDefault[];
}

interface Entitlement {
  id: string;
  toolKey: string;
  granted: boolean;
}

interface User {
  id: string;
  name: string | null;
  email: string;
  status: "ACTIVE" | "TRIAL" | "DISABLED";
  createdAt: string;
  role: Role;
  entitlements: Entitlement[];
}

const TOOLS = [
  { key: "overview", label: "Overview", desc: "Access the system dashboard and general overview analytics." },
  { key: "accounts", label: "Managed Accounts", desc: "Link/unlink accounts, modify sections and metadata." },
  { key: "analytics", label: "Analytics Dashboard", desc: "View detailed post analytics, views, and engagement performance." },
  { key: "post_queue", label: "Post Queue", desc: "Manage scheduled, processing, and queued posts." },
  { key: "history", label: "Posting History", desc: "Audit completed, published, and skipped posting records." },
  { key: "clip_mixer", label: "Clip Mixer", desc: "Access the multi-clip video stitcher and mixer." },
  { key: "style_studio", label: "Style Studio", desc: "Create and edit video template captions and presets." },
  { key: "composer", label: "Bulk Genres", desc: "Use lyrical and quote composers for bulk video rendering." },
  { key: "multiplier", label: "Multiplier", desc: "Use video multiplier for bulk text overlay generations." },
  { key: "campaigns", label: "Campaigns", desc: "Configure global campaigns and payout details." },
  { key: "projects", label: "Projects", desc: "Organize internal workflows, editor pipelines and assignments." },
  { key: "data_vault", label: "Data Vault", desc: "Store credentials, usernames, passwords, proxies securely." },
  { key: "sourcing", label: "Sourcing Feed", desc: "Manage YouTube content sources, niches, and automated fetches." },
  { key: "users_access", label: "Users & Access", desc: "Edit system roles, statuses, and specific tool overrides." },
  { key: "lms", label: "LMS Academy", desc: "Access onboarding and editor training lessons." },
  { key: "agent", label: "AI Agent", desc: "Voice/text assistant that can run actions across the platform." },
];

const ROLE_DEFAULTS: Record<string, string[]> = {
  admin: ["overview", "accounts", "analytics", "post_queue", "history", "clip_mixer", "style_studio", "composer", "multiplier", "campaigns", "projects", "data_vault", "sourcing", "users_access", "lms", "agent"],
  team_lead: ["lms"],
  editor: ["lms"],
  curator: ["lms"],
};

export default function UsersAccessClientPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Edit states
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [editRoleKey, setEditRoleKey] = useState("");
  const [editStatus, setEditStatus] = useState<"ACTIVE" | "TRIAL" | "DISABLED">("TRIAL");
  const [overrides, setOverrides] = useState<Record<string, "grant" | "revoke" | "default">>({});
  const [saving, setSaving] = useState(false);

  // Vault Access states
  const [activeTab, setActiveTab] = useState<"system" | "vault">("system");
  const [vaultAccessList, setVaultAccessList] = useState<any[]>([]);
  const [loadingVaultAccess, setLoadingVaultAccess] = useState(false);
  const [searchFolderQuery, setSearchFolderQuery] = useState("");

  // Create states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRoleKey, setNewRoleKey] = useState("editor");
  const [creating, setCreating] = useState(false);

  const fetchUserVaultAccess = async (userId?: string) => {
    const targetId = userId || selectedUser?.id;
    if (!targetId) return;

    setLoadingVaultAccess(true);
    try {
      const res = await fetch(`/api/managed/vault/users/${targetId}/access`);
      if (!res.ok) throw new Error("Failed to fetch folder access details");
      const data = await res.json();
      setVaultAccessList(data);
    } catch (err: any) {
      toast.error(err.message || "Failed to read vault permissions");
    } finally {
      setLoadingVaultAccess(false);
    }
  };

  const handleUpdateFolderPermission = async (folderId: string, value: string) => {
    if (!selectedUser) return;

    try {
      if (value === "inherited") {
        const res = await fetch(`/api/managed/vault/users/${selectedUser.id}/access?folderId=${folderId}`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to remove custom override");
      } else {
        const res = await fetch(`/api/managed/vault/users/${selectedUser.id}/access`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderId, permission: value }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to set custom override");
      }
      toast.success("Folder permissions updated");
      fetchUserVaultAccess(selectedUser.id);
    } catch (err: any) {
      toast.error(err.message || "Failed to update permissions");
    }
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/team");
      if (!res.ok) throw new Error("Failed to fetch users");
      const data = await res.json();
      setUsers(data);
    } catch (err: any) {
      toast.error(err.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleSelectUser = (user: User) => {
    setSelectedUser(user);
    setEditRoleKey(user.role.key);
    setEditStatus(user.status);
    setActiveTab("system");
    fetchUserVaultAccess(user.id);

    // Parse overrides from entitlements array
    const parsedOverrides: Record<string, "grant" | "revoke" | "default"> = {};
    TOOLS.forEach((tool) => {
      const ent = user.entitlements.find((e) => e.toolKey === tool.key);
      if (ent) {
        parsedOverrides[tool.key] = ent.granted ? "grant" : "revoke";
      } else {
        parsedOverrides[tool.key] = "default";
      }
    });
    setOverrides(parsedOverrides);
  };

  const handleOverrideChange = (toolKey: string, val: "grant" | "revoke" | "default") => {
    setOverrides((prev) => ({
      ...prev,
      [toolKey]: val,
    }));
  };

  const handleSaveUser = async () => {
    if (!selectedUser) return;

    setSaving(true);
    try {
      // Calculate which entitlements changed or require updates
      const entitlementPayload = Object.entries(overrides).map(([toolKey, override]) => ({
        toolKey,
        override,
      }));

      const res = await fetch("/api/admin/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          userId: selectedUser.id,
          roleKey: editRoleKey,
          status: editStatus,
          entitlements: entitlementPayload,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update user");

      toast.success("User access configurations saved successfully");
      
      // Refresh list and re-select updated user
      await fetchUsers();
      
      // Update selectedUser state with local updates
      const updatedUser: User = {
        ...selectedUser,
        status: editStatus,
        role: {
          ...selectedUser.role,
          key: editRoleKey,
          label: editRoleKey === "admin" ? "Administrator" : editRoleKey === "team_lead" ? "Team Lead" : editRoleKey === "editor" ? "Editor" : "Curator"
        },
        entitlements: Object.entries(overrides)
          .filter(([_, override]) => override !== "default")
          .map(([toolKey, override]) => ({
            id: "",
            toolKey,
            granted: override === "grant"
          }))
      };
      setSelectedUser(updatedUser);

    } catch (err: any) {
      toast.error(err.message || "Failed to update permissions");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newEmail || !newPassword) {
      toast.error("Please fill in all fields");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/admin/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: newName,
          email: newEmail,
          password: newPassword,
          roleKey: newRoleKey,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create user");

      toast.success("User created successfully with default TRIAL status (LMS-only)");
      setShowCreateModal(false);
      setNewName("");
      setNewEmail("");
      setNewPassword("");
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message || "Failed to create user");
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteUser = async (user: User) => {
    if (!confirm(`Are you sure you want to delete ${user.name || user.email}?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/team?id=${user.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete user");

      toast.success("User removed successfully");
      if (selectedUser?.id === user.id) {
        setSelectedUser(null);
      }
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete user");
    }
  };

  const getEffectiveStatusColor = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
      case "TRIAL":
        return "text-amber-400 bg-amber-500/10 border-amber-500/20";
      case "DISABLED":
        return "text-red-400 bg-red-500/10 border-red-500/20";
      default:
        return "text-zinc-500 bg-zinc-500/10 border-zinc-500/20";
    }
  };

  const getEffectiveAllowedToolsCount = (user: User) => {
    if (user.status === "DISABLED") return 0;
    const defaults = ROLE_DEFAULTS[user.role.key] || [];
    const base = user.status === "TRIAL" ? ["lms"] : defaults;
    const allowed = new Set(base);

    user.entitlements.forEach((ent) => {
      if (ent.granted) allowed.add(ent.toolKey);
      else allowed.delete(ent.toolKey);
    });

    return allowed.size;
  };

  const filteredUsers = users.filter((u) => {
    const term = searchQuery.toLowerCase();
    return (
      (u.name && u.name.toLowerCase().includes(term)) ||
      u.email.toLowerCase().includes(term) ||
      u.role.label.toLowerCase().includes(term)
    );
  });

  return (
    <div className="space-y-6 text-zinc-100 bg-[#09090b]">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#27272a] pb-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-500" />
            Users & Access
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Manage team roles, statuses, and custom permission overrides. New hires default to LMS-only.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchUsers}
            disabled={loading}
            className="p-2 border border-[#27272a] rounded-md hover:bg-zinc-900 transition disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2563eb] text-white rounded-md text-xs font-medium hover:bg-blue-700 transition"
          >
            <UserPlus className="w-3.5 h-3.5" />
            New User
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Users Table Column */}
        <div className="lg:col-span-2 space-y-4">
          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-500" />
            <input
              type="text"
              placeholder="Search user, email, or role..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#09090b] border border-[#27272a] rounded-md pl-9 pr-4 py-2 text-xs text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-[#2563eb] transition"
            />
          </div>

          {/* User List Panel */}
          <div className="border border-[#27272a] rounded-md bg-[#09090b] overflow-hidden">
            {loading && users.length === 0 ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 text-[#2563eb] animate-spin" />
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="text-center py-16 text-zinc-500 text-xs">
                No users found match your search criteria.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#27272a] text-zinc-500 font-semibold bg-zinc-950/20">
                      <th className="px-4 py-2.5">User</th>
                      <th className="px-4 py-2.5">Role</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5">Effective Access</th>
                      <th className="px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#27272a]">
                    {filteredUsers.map((u) => {
                      const isSelected = selectedUser?.id === u.id;
                      const allowedCount = getEffectiveAllowedToolsCount(u);
                      return (
                        <tr
                          key={u.id}
                          onClick={() => handleSelectUser(u)}
                          className={`hover:bg-zinc-900/30 transition cursor-pointer ${
                            isSelected ? "bg-zinc-900/50" : ""
                          }`}
                        >
                          <td className="px-4 py-3">
                            <div className="font-semibold text-zinc-200">{u.name || "Unnamed"}</div>
                            <div className="text-[10px] text-zinc-500 mt-0.5 font-mono">{u.email}</div>
                          </td>
                          <td className="px-4 py-3 text-zinc-300">
                            <span className="capitalize">{u.role.key.replace("_", " ")}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${getEffectiveStatusColor(
                                u.status
                              )}`}
                            >
                              {u.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-zinc-400">
                            {allowedCount} of {TOOLS.length} tools
                          </td>
                          <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => handleDeleteUser(u)}
                              className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-red-950/20 transition"
                              title="Delete user"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Access Overrides panel */}
        <div className="lg:col-span-1 border border-[#27272a] rounded-md bg-[#09090b] p-5 space-y-6">
          {!selectedUser ? (
            <div className="text-center py-20 space-y-2 text-zinc-500">
              <Shield className="w-10 h-10 mx-auto opacity-20" />
              <p className="text-xs">Select a user from the list to manage their roles, status, and custom overrides.</p>
            </div>
          ) : (
            <div className="space-y-5 animate-in fade-in duration-200">
              <div className="flex justify-between items-start border-b border-[#27272a] pb-4">
                <div>
                  <h2 className="text-sm font-bold text-zinc-200">{selectedUser.name || "Unnamed"}</h2>
                  <p className="text-[10px] font-mono text-zinc-500 mt-0.5">{selectedUser.email}</p>
                </div>
                <button
                  onClick={() => setSelectedUser(null)}
                  className="p-1 text-zinc-500 hover:text-zinc-300 rounded hover:bg-zinc-950"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Navigation Tabs */}
              <div className="flex border-b border-[#27272a] text-xs font-semibold gap-4">
                <button
                  type="button"
                  onClick={() => setActiveTab("system")}
                  className={`pb-2 border-b-2 transition ${
                    activeTab === "system"
                      ? "border-blue-500 text-white font-bold"
                      : "border-transparent text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  System & Tool Access
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab("vault");
                    fetchUserVaultAccess(selectedUser.id);
                  }}
                  className={`pb-2 border-b-2 transition ${
                    activeTab === "vault"
                      ? "border-blue-500 text-white font-bold"
                      : "border-transparent text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Vault Folder Access
                </button>
              </div>

              {activeTab === "system" ? (
                <>
                  {/* Status and Role selectors */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[9px] uppercase font-bold text-zinc-500">Role</label>
                      <select
                        value={editRoleKey}
                        onChange={(e) => setEditRoleKey(e.target.value)}
                        className="w-full bg-[#09090b] border border-[#27272a] rounded-md px-2 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-[#2563eb]"
                      >
                        <option value="admin">Administrator</option>
                        <option value="team_lead">Team Lead</option>
                        <option value="editor">Editor</option>
                        <option value="curator">Curator</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[9px] uppercase font-bold text-zinc-500">Status</label>
                      <select
                        value={editStatus}
                        onChange={(e) => setEditStatus(e.target.value as any)}
                        className="w-full bg-[#09090b] border border-[#27272a] rounded-md px-2 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-[#2563eb]"
                      >
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="TRIAL">TRIAL</option>
                        <option value="DISABLED">DISABLED</option>
                      </select>
                    </div>
                  </div>

                  {/* Specific Overrides Checklist */}
                  <div className="space-y-3 pt-2">
                    <h3 className="text-xs font-bold text-zinc-400 border-b border-[#27272a] pb-1.5">
                      Tool Permissions Overrides
                    </h3>

                    {selectedUser.status === "TRIAL" && (
                      <div className="p-2.5 bg-amber-950/20 border border-amber-900/50 text-amber-300 rounded text-[10px] flex items-start gap-1.5 leading-relaxed mb-4">
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-400" />
                        <span>
                          User status is <strong>TRIAL</strong>. Role defaults are locked down: they only have access to <strong>LMS Academy</strong> plus any tools explicitly marked <strong>Always Grant</strong>.
                        </span>
                      </div>
                    )}

                    <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
                      {TOOLS.map((tool) => {
                        const val = overrides[tool.key] || "default";
                        const isDefaultGranted = (ROLE_DEFAULTS[editRoleKey] || []).includes(tool.key);
                        
                        // Effective state
                        let isEffectiveAllowed = false;
                        if (editStatus === "DISABLED") {
                          isEffectiveAllowed = false;
                        } else if (editStatus === "TRIAL") {
                          isEffectiveAllowed = tool.key === "lms" || val === "grant";
                        } else {
                          isEffectiveAllowed = val === "grant" || (val === "default" && isDefaultGranted);
                        }

                        return (
                          <div
                            key={tool.key}
                            className="border border-[#27272a] rounded-md p-3 space-y-2 bg-zinc-950/10 text-xs flex flex-col justify-between"
                          >
                            <div className="flex justify-between items-start gap-2">
                              <div className="space-y-0.5">
                                <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                                  {tool.label}
                                  {isEffectiveAllowed ? (
                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" title="Allowed" />
                                  ) : (
                                    <span className="h-1.5 w-1.5 rounded-full bg-zinc-600 inline-block" title="Denied" />
                                  )}
                                </span>
                                <p className="text-[10px] text-zinc-500 leading-normal">{tool.desc}</p>
                              </div>
                            </div>

                            {/* Three Way Action Buttons */}
                            <div className="flex rounded border border-[#27272a] overflow-hidden text-[10px] bg-[#09090b] text-zinc-400">
                              <button
                                type="button"
                                onClick={() => handleOverrideChange(tool.key, "default")}
                                className={`flex-1 py-1 text-center font-medium border-r border-[#27272a] transition ${
                                  val === "default"
                                    ? "bg-zinc-800 text-zinc-200"
                                    : "hover:bg-zinc-900"
                                }`}
                              >
                                Inherit ({isDefaultGranted ? "Grant" : "Revoke"})
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOverrideChange(tool.key, "grant")}
                                className={`flex-1 py-1 text-center font-medium border-r border-[#27272a] transition ${
                                  val === "grant"
                                    ? "bg-emerald-950/40 text-emerald-400"
                                    : "hover:bg-zinc-900"
                                }`}
                              >
                                Always Grant
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOverrideChange(tool.key, "revoke")}
                                className={`flex-1 py-1 text-center font-medium transition ${
                                  val === "revoke"
                                    ? "bg-red-950/40 text-red-400"
                                    : "hover:bg-zinc-900"
                                }`}
                              >
                                Always Revoke
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Save Changes button */}
                  <div className="pt-4 border-t border-[#27272a] flex justify-end">
                    <button
                      onClick={handleSaveUser}
                      disabled={saving}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2563eb] text-white rounded-md text-xs font-semibold hover:bg-blue-700 transition disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      Save Access Config
                    </button>
                  </div>
                </>
              ) : (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-zinc-500" />
                    <input
                      type="text"
                      placeholder="Search folders..."
                      value={searchFolderQuery}
                      onChange={(e) => setSearchFolderQuery(e.target.value)}
                      className="w-full bg-[#09090b] border border-[#27272a] rounded-md pl-8 pr-4 py-1.5 text-xs text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-[#2563eb] transition"
                    />
                  </div>

                  {loadingVaultAccess ? (
                    <div className="flex flex-col items-center justify-center py-10 space-y-2">
                      <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                      <p className="text-[10px] text-zinc-500 font-bold uppercase">Loading folder access...</p>
                    </div>
                  ) : vaultAccessList.length === 0 ? (
                    <p className="text-xs text-zinc-500 italic text-center py-10">No folders configured in Data Vault.</p>
                  ) : (
                    <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                      {vaultAccessList
                        .filter((item) =>
                          item.folderName.toLowerCase().includes(searchFolderQuery.toLowerCase())
                        )
                        .map((item) => (
                          <div
                            key={item.folderId}
                            className="border border-[#27272a] rounded-md p-3 space-y-2.5 bg-zinc-950/20 text-xs"
                          >
                            <div className="flex justify-between items-start gap-2">
                              <div className="space-y-0.5">
                                <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                                  <Folder className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                                  {item.folderName}
                                </span>
                                
                                {item.isInherited && item.inheritedFromName && (
                                  <span className="inline-block text-[9px] text-zinc-500 font-bold uppercase mt-1 bg-zinc-900/60 px-1.5 py-0.5 rounded border border-zinc-850">
                                    Inherited from: {item.inheritedFromName}
                                  </span>
                                )}
                                {!item.isInherited && item.isExplicit && (
                                  <span className="inline-block text-[9px] text-blue-400 font-bold uppercase mt-1 bg-blue-950/20 px-1.5 py-0.5 rounded border border-blue-900/20">
                                    Explicit Override
                                  </span>
                                )}
                                {!item.isInherited && !item.isExplicit && item.permission && (
                                  <span className="inline-block text-[9px] text-emerald-400 font-bold uppercase mt-1 bg-emerald-950/20 px-1.5 py-0.5 rounded border border-emerald-900/20">
                                    Default Access
                                  </span>
                                )}
                              </div>

                              <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                                item.permission === "manage"
                                  ? "bg-purple-950/40 text-purple-400 border border-purple-900/30"
                                  : item.permission === "edit"
                                  ? "bg-blue-950/40 text-blue-400 border-blue-900/30"
                                  : item.permission === "view"
                                  ? "bg-zinc-900 text-zinc-400 border border-zinc-800"
                                  : "bg-red-950/40 text-red-400 border-red-900/30"
                              }`}>
                                {item.permission || "no access"}
                              </span>
                            </div>

                            <div className="pt-1.5 border-t border-zinc-900">
                              <label className="block text-[8px] uppercase font-bold text-zinc-500 mb-1">Set Access Override</label>
                              <select
                                value={item.isExplicit ? item.permission || "null" : "inherited"}
                                onChange={(e) => handleUpdateFolderPermission(item.folderId, e.target.value)}
                                className="w-full bg-[#09090b] border border-[#27272a] rounded px-2.5 py-1 text-xs text-zinc-300 focus:outline-none focus:border-[#2563eb]"
                              >
                                <option value="inherited">Inherited (Default)</option>
                                <option value="view">Explicit: View</option>
                                <option value="edit">Explicit: Edit</option>
                                <option value="manage">Explicit: Manage</option>
                                <option value="null">Explicit: No Access / Blocked</option>
                              </select>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="relative w-full max-w-sm bg-[#09090b] border border-[#27272a] rounded-lg overflow-hidden shadow-2xl flex flex-col animate-in zoom-in duration-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#27272a]">
              <h3 className="font-bold text-zinc-100 flex items-center gap-2 text-xs uppercase tracking-wider">
                <UserPlus className="w-4 h-4 text-blue-500" />
                Create New Member
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1 hover:bg-zinc-900 text-zinc-500 hover:text-zinc-200 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="p-5 space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-zinc-500">Name</label>
                <input
                  type="text"
                  required
                  placeholder="Enter full name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-[#09090b] border border-[#27272a] rounded-md px-3 py-2 text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-[#2563eb] transition"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-zinc-500">Email Address</label>
                <input
                  type="email"
                  required
                  placeholder="name@lvon.co"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full bg-[#09090b] border border-[#27272a] rounded-md px-3 py-2 text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-[#2563eb] transition"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-zinc-500">Password</label>
                <input
                  type="password"
                  required
                  placeholder="Minimum 6 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-[#09090b] border border-[#27272a] rounded-md px-3 py-2 text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-[#2563eb] transition"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-zinc-500">Default Role</label>
                <select
                  value={newRoleKey}
                  onChange={(e) => setNewRoleKey(e.target.value)}
                  className="w-full bg-[#09090b] border border-[#27272a] rounded-md px-2 py-2 text-zinc-300 focus:outline-none focus:border-[#2563eb]"
                >
                  <option value="admin">Administrator</option>
                  <option value="team_lead">Team Lead</option>
                  <option value="editor">Editor</option>
                  <option value="curator">Curator</option>
                </select>
              </div>

              <div className="p-3 bg-blue-950/20 border border-blue-900/50 text-blue-300 text-[10px] rounded leading-relaxed flex gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>
                  The new hire account will be initialized in <strong>TRIAL</strong> status. They will only have access to the LMS Academy lessons until explicitly granted additional access.
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-[#27272a]">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1.5 border border-[#27272a] text-zinc-400 hover:text-zinc-200 rounded-md font-semibold hover:bg-zinc-900 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-[#2563eb] text-white rounded-md font-semibold hover:bg-blue-700 transition disabled:opacity-50"
                >
                  {creating && <Loader2 className="w-3 h-3 animate-spin" />}
                  Create Member
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
