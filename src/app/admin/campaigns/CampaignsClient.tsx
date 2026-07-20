"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Search, HelpCircle, AlertCircle, X, Loader2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Campaign } from "@prisma/client";

interface CampaignsClientProps {
  initialCampaigns: any[];
}

export default function CampaignsClient({ initialCampaigns }: CampaignsClientProps) {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<any[]>(initialCampaigns);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  // Form State
  const [title, setTitle] = useState("");
  const [type, setType] = useState("other");
  const [status, setStatus] = useState("ACTIVE");
  const [description, setDescription] = useState("");
  const [brief, setBrief] = useState("");
  const [targetViews, setTargetViews] = useState(1000000);
  const [accountsCount, setAccountsCount] = useState(5);
  const [avgViewsPerVideo, setAvgViewsPerVideo] = useState(10000);
  const [videosPerAccountPerDay, setVideosPerAccountPerDay] = useState(2);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const STATUS_COLORS: Record<string, string> = {
    DRAFT: "text-zinc-400 bg-zinc-400/10 border-zinc-500/20",
    PENDING_REVIEW: "text-amber-400 bg-amber-400/10 border-amber-500/20",
    OPEN: "text-emerald-400 bg-emerald-400/10 border-emerald-500/20",
    CLOSED: "text-zinc-500 bg-zinc-500/10 border-zinc-600/20",
    COMPLETED: "text-blue-400 bg-blue-400/10 border-blue-500/20",
    CANCELLED: "text-red-400 bg-red-400/10 border-red-500/20",
    ACTIVE: "text-emerald-400 bg-emerald-400/10 border-emerald-500/20",
    PAUSED: "text-amber-400 bg-amber-400/10 border-amber-500/20",
    DONE: "text-blue-400 bg-blue-400/10 border-blue-500/20",
  };

  const TYPE_LABELS: Record<string, string> = {
    political: "Political Niche",
    music: "Music/Entertainment",
    other: "General/Other",
  };

  // Filter logic
  const filtered = campaigns.filter((c) => {
    const matchesSearch =
      (c.title || c.name || "").toLowerCase().includes(search.toLowerCase()) ||
      (c.description || "").toLowerCase().includes(search.toLowerCase());
    const matchesType = filterType === "all" || c.type === filterType;
    const matchesStatus = filterStatus === "all" || c.status === filterStatus;
    return matchesSearch && matchesType && matchesStatus;
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Campaign title is required");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          name: title.trim(),
          type,
          status,
          description: description.trim(),
          brief: brief.trim(),
          targetViews: Number(targetViews),
          accountsCount: Number(accountsCount),
          avgViewsPerVideo: Number(avgViewsPerVideo),
          videosPerAccountPerDay: Number(videosPerAccountPerDay),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create campaign");
      }

      const newCampaign = await res.json();
      setCampaigns([newCampaign, ...campaigns]);
      toast.success("Campaign created successfully");
      setIsCreateOpen(false);
      
      // Reset form
      setTitle("");
      setType("other");
      setStatus("ACTIVE");
      setDescription("");
      setBrief("");
      setTargetViews(1000000);
      setAccountsCount(5);
      setAvgViewsPerVideo(10000);
      setVideosPerAccountPerDay(2);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 text-zinc-100 bg-[#09090b]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#27272a] pb-5">
        <div className="space-y-1">
          <h1 className="text-xl font-bold tracking-tight">Campaigns</h1>
          <p className="text-xs text-zinc-400">
            Configure global post campaigns, view-goal calculations, and resources.
          </p>
        </div>
        <button
          onClick={() => setIsCreateOpen(true)}
          className="flex items-center gap-1.5 bg-zinc-100 text-zinc-950 hover:bg-zinc-200 transition text-xs font-semibold px-3 py-1.5 rounded"
        >
          <Plus size={14} />
          Create Campaign
        </button>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        {/* Search */}
        <div className="relative w-full sm:w-80">
          <span className="absolute inset-y-0 left-3 flex items-center text-zinc-500">
            <Search size={14} />
          </span>
          <input
            type="text"
            placeholder="Search campaigns..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#09090b] border border-[#27272a] rounded px-3 py-1.5 pl-9 text-xs focus:border-zinc-500 focus:outline-none transition"
          />
        </div>

        {/* Niche Type Filter */}
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="w-full sm:w-44 bg-[#09090b] border border-[#27272a] rounded px-2.5 py-1.5 text-xs focus:border-zinc-500 focus:outline-none text-zinc-300"
        >
          <option value="all">All Niches</option>
          <option value="political">Political Niche</option>
          <option value="music">Music/Entertainment</option>
          <option value="other">General/Other</option>
        </select>

        {/* Status Filter */}
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="w-full sm:w-44 bg-[#09090b] border border-[#27272a] rounded px-2.5 py-1.5 text-xs focus:border-zinc-500 focus:outline-none text-zinc-300"
        >
          <option value="all">All Statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="PAUSED">Paused</option>
          <option value="DONE">Done</option>
          <option value="DRAFT">Draft</option>
        </select>
      </div>

      {/* Campaigns Table */}
      <div className="border border-[#27272a] rounded-md bg-[#09090b] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#27272a] text-zinc-500 font-semibold bg-[#18181b]/20">
                <th className="py-3 px-4">Campaign Name</th>
                <th className="py-3 px-4">Niche Type</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Target Views</th>
                <th className="py-3 px-4 text-right">Accounts</th>
                <th className="py-3 px-4 text-right">Videos/Day</th>
                <th className="py-3 px-4 text-right">Days to Goal</th>
                <th className="py-3 px-4 text-right">Exported</th>
                <th className="py-3 px-4 text-right">Posted</th>
                <th className="py-3 px-4 text-right">Failed</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#27272a]">
              {filtered.map((c) => {
                // Calculate projected days to goal
                const totalVideosNeeded = c.avgViewsPerVideo > 0 ? Math.ceil(c.targetViews / c.avgViewsPerVideo) : 0;
                const videosPerDay = c.accountsCount * c.videosPerAccountPerDay;
                const daysToGoal = videosPerDay > 0 ? Math.ceil(totalVideosNeeded / videosPerDay) : 0;

                return (
                  <tr key={c.id} className="hover:bg-zinc-900/50 transition group">
                    <td className="py-3.5 px-4 font-medium text-zinc-100">
                      <Link href={`/admin/campaigns/${c.id}`} className="hover:underline block">
                        {c.title || c.name || "Untitled"}
                      </Link>
                    </td>
                    <td className="py-3.5 px-4 text-zinc-400">
                      {TYPE_LABELS[c.type] || "General"}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${STATUS_COLORS[c.status] || STATUS_COLORS.DRAFT}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right text-zinc-300 font-mono">
                      {c.targetViews ? c.targetViews.toLocaleString() : "—"}
                    </td>
                    <td className="py-3.5 px-4 text-right text-zinc-300 font-mono">
                      {c.accountsCount || "—"}
                    </td>
                    <td className="py-3.5 px-4 text-right text-zinc-300 font-mono">
                      {c.videosPerAccountPerDay ? `${c.videosPerAccountPerDay}/day` : "—"}
                    </td>
                    <td className="py-3.5 px-4 text-right text-emerald-400 font-semibold font-mono">
                      {daysToGoal ? `${daysToGoal} days` : "—"}
                    </td>
                    <td className="py-3.5 px-4 text-right text-emerald-400 font-mono">
                      {(c.exportedCount ?? 0).toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4 text-right text-emerald-400 font-mono">
                      {(c.postedCount ?? 0).toLocaleString()}
                    </td>
                    <td className={`py-3.5 px-4 text-right font-mono ${(c.failedCount ?? 0) > 0 ? "text-red-400" : "text-zinc-500"}`}>
                      {(c.failedCount ?? 0).toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <Link
                        href={`/admin/campaigns/${c.id}`}
                        className="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-100 transition text-[11px]"
                      >
                        Workspace
                        <ArrowRight size={12} className="opacity-0 group-hover:opacity-100 transition" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-zinc-500">
                    No campaigns found matching the search and filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Dialog Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-[#09090b] border border-[#27272a] rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-[#27272a] p-4 bg-zinc-950">
              <h2 className="text-sm font-semibold text-zinc-100">Create New Campaign</h2>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="text-zinc-400 hover:text-zinc-200 transition"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleCreate} className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
              {/* Name */}
              <div className="space-y-1.5">
                <label className="text-zinc-400 font-medium">Campaign Title / Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Political Hype Niche #3"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-[#09090b] border border-[#27272a] rounded px-3 py-1.5 text-zinc-100 focus:border-zinc-500 focus:outline-none"
                />
              </div>

              {/* Niche Type & Status */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-zinc-400 font-medium">Niche Type</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className="w-full bg-[#09090b] border border-[#27272a] rounded px-3 py-1.5 text-zinc-300 focus:border-zinc-500 focus:outline-none"
                  >
                    <option value="political">Political Niche</option>
                    <option value="music">Music/Entertainment</option>
                    <option value="other">General/Other</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-zinc-400 font-medium">Initial Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="w-full bg-[#09090b] border border-[#27272a] rounded px-3 py-1.5 text-zinc-300 focus:border-zinc-500 focus:outline-none"
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="DRAFT">Draft</option>
                    <option value="PAUSED">Paused</option>
                  </select>
                </div>
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <label className="text-zinc-400 font-medium">Brief Description (Optional)</label>
                <textarea
                  placeholder="Summarize the core theme or target demographics..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full bg-[#09090b] border border-[#27272a] rounded px-3 py-1.5 text-zinc-100 focus:border-zinc-500 focus:outline-none resize-none"
                />
              </div>

              {/* View-Goal Calculator Initial Parameters */}
              <div className="border-t border-[#27272a] pt-4 mt-2">
                <h3 className="text-zinc-300 font-semibold mb-3">View-Goal Projections</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-zinc-400 font-medium">Target Total Views</label>
                    <input
                      type="number"
                      required
                      min={1000}
                      value={targetViews}
                      onChange={(e) => setTargetViews(Number(e.target.value))}
                      className="w-full bg-[#09090b] border border-[#27272a] rounded px-3 py-1.5 text-zinc-100 font-mono focus:border-zinc-500 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-zinc-400 font-medium">Active Accounts Count</label>
                    <input
                      type="number"
                      required
                      min={1}
                      value={accountsCount}
                      onChange={(e) => setAccountsCount(Number(e.target.value))}
                      className="w-full bg-[#09090b] border border-[#27272a] rounded px-3 py-1.5 text-zinc-100 font-mono focus:border-zinc-500 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-zinc-400 font-medium">Avg Views / Video</label>
                    <input
                      type="number"
                      required
                      min={100}
                      value={avgViewsPerVideo}
                      onChange={(e) => setAvgViewsPerVideo(Number(e.target.value))}
                      className="w-full bg-[#09090b] border border-[#27272a] rounded px-3 py-1.5 text-zinc-100 font-mono focus:border-zinc-500 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-zinc-400 font-medium flex items-center justify-between">
                      <span>Videos / Account / Day</span>
                      {videosPerAccountPerDay > 3 && (
                        <span className="text-[10px] text-amber-500 flex items-center gap-0.5">
                          <AlertCircle size={10} /> Shadowban risk
                        </span>
                      )}
                    </label>
                    <input
                      type="number"
                      required
                      min={1}
                      max={10}
                      value={videosPerAccountPerDay}
                      onChange={(e) => setVideosPerAccountPerDay(Number(e.target.value))}
                      className={`w-full bg-[#09090b] border rounded px-3 py-1.5 text-zinc-100 font-mono focus:outline-none ${
                        videosPerAccountPerDay > 3 ? "border-amber-500/50 focus:border-amber-500" : "border-[#27272a] focus:border-zinc-500"
                      }`}
                    />
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 border-t border-[#27272a] pt-4 bg-[#09090b] w-full">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="bg-zinc-900 border border-[#27272a] hover:bg-zinc-850 hover:text-zinc-100 transition text-zinc-300 font-medium px-4 py-1.5 rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-950 font-semibold px-4 py-1.5 rounded disabled:opacity-50 transition"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={12} className="animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
