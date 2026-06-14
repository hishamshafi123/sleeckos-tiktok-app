"use client";

import React, { useState, useEffect } from "react";
import { UserPlus, Trash2, Loader2, Mail, Key, User, UserCog, X, RefreshCw, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface TeamMember {
  id: string;
  name: string | null;
  email: string;
  status: string;
  createdAt: string;
}

interface TeamClientPageProps {
  currentUser: {
    userId: string;
    email: string;
  };
}

export default function TeamClientPage({ currentUser }: TeamClientPageProps) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  // Form states
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/team");
      if (!res.ok) throw new Error("Failed to fetch team members");
      const data = await res.json();
      setMembers(data);
    } catch (err: any) {
      toast.error(err.message || "Failed to load team members");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, []);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !password || !confirmPassword) {
      toast.error("Please fill in all fields");
      return;
    }

    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    if (password.length < 6) {
      toast.error("Password must be at least 6 characters long");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add team member");

      toast.success("Team member created successfully!");
      setShowModal(false);
      // Reset form
      setName("");
      setEmail("");
      setPassword("");
      setConfirmPassword("");
      fetchMembers();
    } catch (err: any) {
      toast.error(err.message || "Failed to create team member");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteMember = async (id: string, name: string | null, email: string) => {
    const displayName = name || email;
    if (!confirm(`Are you sure you want to delete ${displayName}? They will immediately lose access to the admin panel.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/team?id=${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete team member");

      toast.success(`${displayName} has been removed from the team.`);
      fetchMembers();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete team member");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <UserCog className="w-7 h-7 text-amber-500" />
            Team Management
          </h1>
          <p className="text-gray-500 mt-1 text-sm">
            Create and manage administrator credentials for accessing the admin panel.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchMembers}
            disabled={loading}
            className="p-2 rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-all disabled:opacity-40"
            title="Refresh list"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-white text-xs font-semibold shadow-lg shadow-amber-500/10 transition-all"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Add Team Member
          </button>
        </div>
      </div>

      {/* Main Members Table Card */}
      <div className="rounded-2xl border border-white/5 bg-[#111118] overflow-hidden">
        {loading && members.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
          </div>
        ) : members.length === 0 ? (
          <div className="text-center py-20 text-gray-600">
            <UserCog className="w-16 h-16 mx-auto mb-3 opacity-20" />
            <p className="text-sm">No other team members found</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.01]">
                <th className="text-left px-5 py-3 text-gray-400 font-medium">Name</th>
                <th className="text-left px-5 py-3 text-gray-400 font-medium">Email Address</th>
                <th className="text-left px-5 py-3 text-gray-400 font-medium">Role</th>
                <th className="text-left px-5 py-3 text-gray-400 font-medium">Date Added</th>
                <th className="text-right px-5 py-3 text-gray-400 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const isSelf = member.id === currentUser.userId;
                return (
                  <tr
                    key={member.id}
                    className="border-b border-white/5 last:border-0 hover:bg-white/[0.01] transition-colors"
                  >
                    {/* Name */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-amber-500/10 border border-amber-500/25 flex items-center justify-center text-amber-400 font-bold text-sm">
                          {member.name ? member.name.charAt(0).toUpperCase() : "?"}
                        </div>
                        <div>
                          <p className="text-white font-medium flex items-center gap-1.5">
                            {member.name || "Unnamed Administrator"}
                            {isSelf && (
                              <span className="text-[10px] bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded-full border border-amber-500/20 font-bold">
                                You
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Email */}
                    <td className="px-5 py-4 text-gray-300 font-mono text-xs">
                      {member.email}
                    </td>

                    {/* Role */}
                    <td className="px-5 py-4">
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 uppercase tracking-wide">
                        ADMIN
                      </span>
                    </td>

                    {/* Date Added */}
                    <td className="px-5 py-4 text-gray-500 text-xs">
                      {new Date(member.createdAt).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </td>

                    {/* Actions */}
                    <td className="px-5 py-4 text-right">
                      {isSelf ? (
                        <span className="text-xs text-gray-600 italic">Self (active session)</span>
                      ) : (
                        <button
                          onClick={() => handleDeleteMember(member.id, member.name, member.email)}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-all"
                          title="Remove team member"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Team Member Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          {/* Modal Container */}
          <div className="relative w-full max-w-md bg-[#0c0c14] border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col animate-in zoom-in duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/[0.01]">
              <h3 className="font-bold text-white flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-amber-500" />
                Add Team Member
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleAddMember} className="p-6 space-y-4">
              {/* Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                  Name:
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-3.5 w-4 h-4 text-gray-600" />
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter name"
                    className="w-full bg-[#0f0f18] border border-white/5 rounded-xl pl-9 pr-4 py-2.5 text-white placeholder:text-gray-600 focus:outline-none focus:border-amber-500 transition-all text-sm"
                  />
                </div>
              </div>

              {/* Email */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                  Email Address:
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3.5 w-4 h-4 text-gray-600" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter email address"
                    className="w-full bg-[#0f0f18] border border-white/5 rounded-xl pl-9 pr-4 py-2.5 text-white placeholder:text-gray-600 focus:outline-none focus:border-amber-500 transition-all text-sm"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                  Password:
                </label>
                <div className="relative">
                  <Key className="absolute left-3 top-3.5 w-4 h-4 text-gray-600" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="w-full bg-[#0f0f18] border border-white/5 rounded-xl pl-9 pr-4 py-2.5 text-white placeholder:text-gray-600 focus:outline-none focus:border-amber-500 transition-all text-sm"
                  />
                </div>
              </div>

              {/* Confirm Password */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                  Confirm Password:
                </label>
                <div className="relative">
                  <Key className="absolute left-3 top-3.5 w-4 h-4 text-gray-600" />
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat password"
                    className="w-full bg-[#0f0f18] border border-white/5 rounded-xl pl-9 pr-4 py-2.5 text-white placeholder:text-gray-600 focus:outline-none focus:border-amber-500 transition-all text-sm"
                  />
                </div>
              </div>

              <div className="p-3 bg-amber-500/5 border border-amber-500/15 text-amber-300 text-xs rounded-xl flex items-start gap-2 leading-relaxed">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>
                  Creating this login will grant full access to all dashboards, styling customizer layouts, batch generators, and publish configurations.
                </span>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-2.5 pt-4 border-t border-white/5 mt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-xl border border-white/10 hover:bg-white/5 text-gray-400 hover:text-white transition-all text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-white text-xs font-semibold shadow-lg shadow-amber-500/10 transition-all disabled:opacity-50"
                >
                  {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Create Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
