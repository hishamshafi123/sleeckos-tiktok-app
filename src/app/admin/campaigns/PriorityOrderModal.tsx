"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Loader2, GripVertical, ChevronUp, ChevronDown, Plus, Search, Zap } from "lucide-react";
import { toast } from "sonner";
import {
  allocatePriorityTargets,
  computePriorityWeights,
  type PriorityWeightEntry,
} from "@/lib/utils/priority-targets";

interface PoolEntry extends PriorityWeightEntry {
  title: string;
  postsToday: number;
  weight: number;
  sharePct: number;
  priorityQuota?: number | null;
}

interface PriorityOrderModalProps {
  campaigns: any[];
  onClose: () => void;
  onSaved: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "text-zinc-400 bg-zinc-400/10 border-zinc-500/20",
  PENDING_REVIEW: "text-amber-400 bg-amber-400/10 border-amber-500/20",
  OPEN: "text-emerald-400 bg-emerald-400/10 border-emerald-500/20",
  CLOSED: "text-zinc-500 bg-zinc-500/10 border-zinc-600/20",
  COMPLETED: "text-blue-400 bg-blue-400/10 border-blue-500/20",
  CANCELLED: "text-red-400 bg-red-400/10 border-red-500/20",
  ACTIVE: "text-emerald-400 bg-emerald-400/10 border-emerald-500/20",
  PAUSED: "text-zinc-500 bg-zinc-500/10 border-zinc-600/20",
  DONE: "text-blue-400 bg-blue-400/10 border-blue-500/20",
};

function priorityEntries(pool: PoolEntry[]): PriorityWeightEntry[] {
  return pool.map((p, i) => ({ id: p.id, status: p.status, priorityRank: i + 1 }));
}

function withShares(pool: PoolEntry[]): PoolEntry[] {
  const entries = priorityEntries(pool);
  const weights = computePriorityWeights(entries);
  const totalWeight = Array.from(weights.values()).reduce((sum, weight) => sum + weight, 0);
  return pool.map((p, i) => {
    const weight = weights.get(p.id) ?? 0;
    return {
      ...p,
      priorityRank: entries[i].priorityRank,
      weight,
      sharePct: totalWeight > 0 ? (weight / totalWeight) * 100 : 0,
    };
  });
}

export default function PriorityOrderModal({ campaigns, onClose, onSaved }: PriorityOrderModalProps) {
  const [pool, setPool] = useState<PoolEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [dailyTargetTotal, setDailyTargetTotal] = useState("");
  const [showTargetPreview, setShowTargetPreview] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch("/api/campaigns/priority-order");
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Failed to load priority order (${res.status})`);
        }
        const data = await res.json();
        if (!cancelled) {
          setPool(Array.isArray(data.pool) ? data.pool : []);
          setDailyTargetTotal(
            typeof data.dailyTargetTotal === "number" && Number.isFinite(data.dailyTargetTotal)
              ? String(data.dailyTargetTotal)
              : ""
          );
        }
      } catch (err: any) {
        if (!cancelled) {
          setLoadError(err.message || "Failed to load priority order");
          toast.error(err.message || "Failed to load priority order");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= pool.length || to >= pool.length) return;
    setPool((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return withShares(next);
    });
  };

  const addCampaign = (c: any) => {
    setPool((prev) =>
      withShares([
        ...prev,
        {
          id: c.id,
          title: c.title || c.name || "Untitled",
          status: c.status,
          priorityRank: prev.length + 1,
          postsToday: c.postsToday ?? 0,
          weight: 0,
          sharePct: 0,
          priorityQuota: c.priorityQuota ?? null,
        },
      ])
    );
  };

  const removeCampaign = (id: string) => {
    setPool((prev) => withShares(prev.filter((p) => p.id !== id)));
  };

  const poolIds = useMemo(() => new Set(pool.map((p) => p.id)), [pool]);
  const addCandidates = useMemo(
    () =>
      campaigns.filter(
        (c) =>
          c.status === "ACTIVE" &&
          !poolIds.has(c.id) &&
          (c.title || c.name || "").toLowerCase().includes(addSearch.toLowerCase())
      ),
    [campaigns, poolIds, addSearch]
  );
  const parsedDailyTargetTotal = Number(dailyTargetTotal);
  const hasValidDailyTargetTotal = Number.isSafeInteger(parsedDailyTargetTotal) && parsedDailyTargetTotal > 0;
  const hasActiveCampaigns = pool.some((p) => p.status === "ACTIVE");
  const targetPreviews = useMemo(
    () =>
      showTargetPreview && hasValidDailyTargetTotal && hasActiveCampaigns
        ? allocatePriorityTargets(priorityEntries(pool), parsedDailyTargetTotal)
        : null,
    [showTargetPreview, pool, hasValidDailyTargetTotal, hasActiveCampaigns, parsedDailyTargetTotal]
  );
  const busy = saving || splitting;

  const handleSplitDailyTargets = async () => {
    if (!hasValidDailyTargetTotal) {
      toast.error("Posts per day must be a positive whole number");
      return;
    }

    setSplitting(true);
    try {
      const res = await fetch("/api/campaigns/priority-targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "split", totalPosts: parsedDailyTargetTotal }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to split daily targets");
      }

      if (Array.isArray(data.pool)) setPool(data.pool);
      setShowTargetPreview(false);
      if (typeof data.dailyTargetTotal === "number" && Number.isFinite(data.dailyTargetTotal)) {
        setDailyTargetTotal(String(data.dailyTargetTotal));
      }
      toast.success("Daily targets split");
      onSaved();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to split daily targets");
    } finally {
      setSplitting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/campaigns/priority-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: pool.map((p) => p.id) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save priority order");
      }
      toast.success("Posting priority saved");
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-xl bg-[#09090b] border border-[#27272a] rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#27272a] p-4 bg-zinc-950">
          <div className="space-y-0.5">
            <h2 className="text-sm font-semibold text-zinc-100 flex items-center gap-1.5">
              <Zap size={14} className="text-[#E11D48]" />
              Posting priority
            </h2>
            <p className="text-[11px] text-zinc-500">
              Posts divide among these campaigns weighted by position — drag to reorder. Top campaigns get the largest daily share.
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200 transition">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1 text-xs">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-zinc-500">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : loadError ? (
            <div className="py-10 text-center text-zinc-500 space-y-1">
              <p className="text-zinc-400 font-medium">Could not load priority order</p>
              <p>{loadError}</p>
            </div>
          ) : (
            <>
              {/* Daily post targets */}
              <div className="border border-[#27272a] rounded p-3 space-y-3 bg-zinc-950/40">
                <div className="space-y-0.5">
                  <h3 className="text-zinc-300 font-semibold">Daily post targets</h3>
                  <p className="text-[11px] text-zinc-500">
                    Split posts across active campaigns by priority weight. Targets reset automatically each org-tz day; priority never turns off.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                  <div className="space-y-1.5 flex-1">
                    <label htmlFor="daily-target-total" className="text-zinc-400 font-medium">Posts per day</label>
                    <input
                      id="daily-target-total"
                      type="number"
                      min={1}
                      step={1}
                      placeholder="3000"
                      value={dailyTargetTotal}
                      onChange={(e) => {
                        setDailyTargetTotal(e.target.value);
                        setShowTargetPreview(true);
                      }}
                      disabled={busy}
                      className="w-full bg-[#09090b] border border-[#27272a] rounded px-3 py-1.5 text-zinc-100 font-mono focus:border-zinc-500 focus:outline-none disabled:opacity-50"
                    />
                  </div>
                  <button
                    onClick={handleSplitDailyTargets}
                    disabled={busy || !hasValidDailyTargetTotal || !hasActiveCampaigns}
                    title={!hasActiveCampaigns ? "Add an active campaign to the pool first" : undefined}
                    className="flex items-center justify-center gap-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-950 font-semibold px-3 py-1.5 rounded disabled:opacity-50 transition"
                  >
                    {splitting ? (
                      <>
                        <Loader2 size={12} className="animate-spin" />
                        Splitting...
                      </>
                    ) : (
                      "Split daily targets"
                    )}
                  </button>
                </div>
              </div>

              {/* Pool */}
              {pool.length === 0 ? (
                <div className="py-8 text-center text-zinc-500 border border-dashed border-[#27272a] rounded">
                  No priority campaigns — posts are distributed oldest-first across all campaigns.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {pool.map((p, i) => {
                    const dailyTarget = targetPreviews ? (targetPreviews.get(p.id) ?? 0) : p.priorityQuota;
                    const targetReached = dailyTarget != null && dailyTarget > 0 && p.postsToday >= dailyTarget;
                    return (
                      <div
                        key={p.id}
                        draggable={!busy}
                        onDragStart={(e) => {
                          if (busy) return;
                          setDragIndex(i);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (busy) return;
                          e.dataTransfer.dropEffect = "move";
                          setDragOverIndex(i);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (!busy && dragIndex != null) move(dragIndex, i);
                          setDragIndex(null);
                          setDragOverIndex(null);
                        }}
                        onDragEnd={() => {
                          setDragIndex(null);
                          setDragOverIndex(null);
                        }}
                        className={`flex items-center gap-2 border rounded px-2 py-2 bg-[#09090b] transition ${
                          dragOverIndex === i && dragIndex !== i
                            ? "border-[#E11D48]/60"
                            : "border-[#27272a]"
                        } ${dragIndex === i ? "opacity-40" : ""}`}
                      >
                        <span className="text-zinc-600 cursor-grab active:cursor-grabbing shrink-0" title="Drag to reorder">
                          <GripVertical size={14} />
                        </span>
                        <span className="w-5 text-center font-mono font-semibold text-amber-400 shrink-0">{i + 1}</span>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-medium text-zinc-100 truncate">{p.title}</span>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${STATUS_COLORS[p.status] || STATUS_COLORS.DRAFT}`}>
                              {p.status}
                            </span>
                            <span className="text-[10px] text-zinc-500 shrink-0">{p.postsToday} today</span>
                          </div>
                          {p.status === "ACTIVE" ? (
                            <div className="flex items-center gap-2">
                              <div className="h-1 flex-1 bg-zinc-800 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-emerald-500 rounded-full transition-all"
                                  style={{ width: `${Math.min(100, Math.max(0, p.sharePct))}%` }}
                                />
                              </div>
                              <span className="text-[10px] font-mono text-emerald-400 w-10 text-right shrink-0">
                                {p.sharePct.toFixed(1)}%
                              </span>
                            </div>
                          ) : (
                            <p className="text-[10px] text-zinc-600">paused — skipped</p>
                          )}
                          {dailyTarget != null && dailyTarget > 0 && (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between gap-2 text-[10px]">
                                <span className={targetReached ? "text-emerald-400 font-medium" : "text-zinc-400"}>
                                  {targetReached
                                    ? "Daily target reached · still prioritized"
                                    : `Target · ${p.postsToday.toLocaleString()}/${dailyTarget.toLocaleString()}`}
                                </span>
                                {targetPreviews && <span className="text-zinc-600 shrink-0">preview</span>}
                              </div>
                              <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${targetReached ? "bg-emerald-500" : "bg-[#E11D48]"}`}
                                  style={{ width: `${Math.min(100, Math.max(0, (p.postsToday / dailyTarget) * 100))}%` }}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col shrink-0">
                          <button
                            onClick={() => move(i, i - 1)}
                            disabled={busy || i === 0}
                            className="text-zinc-500 hover:text-zinc-200 transition disabled:opacity-30"
                            title="Move up"
                          >
                            <ChevronUp size={13} />
                          </button>
                          <button
                            onClick={() => move(i, i + 1)}
                            disabled={busy || i === pool.length - 1}
                            className="text-zinc-500 hover:text-zinc-200 transition disabled:opacity-30"
                            title="Move down"
                          >
                            <ChevronDown size={13} />
                          </button>
                        </div>
                        <button
                          onClick={() => removeCampaign(p.id)}
                          disabled={busy}
                          className="text-zinc-500 hover:text-red-400 transition shrink-0 disabled:opacity-30"
                          title="Remove from pool"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add campaign */}
              <div className="border-t border-[#27272a] pt-3 space-y-2">
                <h3 className="text-zinc-300 font-semibold">Add campaign</h3>
                <div className="relative">
                  <span className="absolute inset-y-0 left-3 flex items-center text-zinc-500">
                    <Search size={12} />
                  </span>
                  <input
                    type="text"
                    placeholder="Search active campaigns..."
                    value={addSearch}
                    onChange={(e) => setAddSearch(e.target.value)}
                    className="w-full bg-[#09090b] border border-[#27272a] rounded px-3 py-1.5 pl-8 text-xs focus:border-zinc-500 focus:outline-none transition"
                  />
                </div>
                {addCandidates.length === 0 ? (
                  <p className="text-zinc-600 py-1">No active campaigns available to add.</p>
                ) : (
                  <div className="max-h-36 overflow-y-auto space-y-1">
                    {addCandidates.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between gap-2 border border-[#27272a] rounded px-2 py-1.5"
                      >
                        <span className="text-zinc-300 truncate">{c.title || c.name || "Untitled"}</span>
                        <button
                          onClick={() => addCampaign(c)}
                          disabled={busy}
                          className="inline-flex items-center gap-1 text-zinc-400 hover:text-emerald-400 transition shrink-0 disabled:opacity-50"
                          title="Add to pool"
                        >
                          <Plus size={13} />
                          Add
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[#27272a] p-4 bg-zinc-950">
          <button
            onClick={onClose}
            className="bg-zinc-900 border border-[#27272a] hover:bg-zinc-850 hover:text-zinc-100 transition text-zinc-300 font-medium px-4 py-1.5 rounded"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={busy || loading || !!loadError}
            className="flex items-center gap-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-950 font-semibold px-4 py-1.5 rounded disabled:opacity-50 transition"
          >
            {saving ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Saving...
              </>
            ) : (
              "Save order"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
