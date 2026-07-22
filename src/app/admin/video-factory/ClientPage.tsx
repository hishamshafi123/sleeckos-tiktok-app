"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  Ban,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Eye,
  Factory,
  FileText,
  FolderOpen,
  History,
  Layers,
  Loader2,
  Music,
  Pause,
  Play,
  Quote,
  RefreshCw,
  Search,
  Shuffle,
  Trash2,
  Users,
  X,
} from "lucide-react";
import FactoryAccountsPanel, { FactoryAccountSelection } from "./AccountsPanel";
import TracksStep, { FactoryTrackRow } from "./TracksStep";

// ── Types ────────────────────────────────────────────────────────────────────

type FactoryMode = "lyric" | "quote";

interface CampaignRow {
  id: string;
  title: string;
  status?: string;
}

interface SavedStyleRow {
  id: string;
  templateKey: string;
  name: string;
  thumbnail: string | null;
  family?: string;
  tags?: string[];
}

interface SourceSyncResult {
  folderId: string;
  folderName: string;
  total: number;
  added: number;
  missing: number;
  unchanged: number;
  unused: number;
  used: number;
}

interface PreviewResult {
  sourceFolderId: string;
  totalVideos: number;
  filesNeeded: number;
  availableUnused: number;
  exhausted: boolean;
  stylesCount: number;
  estimatedSeconds: number;
  warnings: string[];
  canRender: boolean;
}

interface BatchListRow {
  id: string;
  name: string;
  mode: string;
  status: string;
  errorMessage: string | null;
  sourceFolderId: string | null;
  createdAt: string;
  updatedAt: string;
  itemCounts: { PENDING: number; RENDERING: number; COMPLETED: number; FAILED: number; CANCELED?: number };
  completedCount: number;
  totalItems: number;
}

interface DistributeAccountResult {
  accountId: string;
  tiktokUsername: string;
  requested: number;
  assigned: number;
  uploaded: number;
  failed: number;
  deliveryId: string | null;
  warnings: string[];
}

interface DistributeResult {
  results: DistributeAccountResult[];
  warnings: string[];
  alreadyDistributed: number;
  poolSize: number;
}

interface DownloadStatus {
  status: "PREPARING" | "COMPLETED" | "FAILED";
  progress: number;
  message: string;
  downloadUrl: string | null;
  size: number;
  completedCount: number;
  timestamp: number;
}

// ── Variation-strength copy (semantics ported from clip-mixer) ───────────────

const STRENGTH_INFO: Record<number, { label: string; desc: string; slices: string }> = {
  1: { label: "Deterministic", desc: "Clips play in sequence from the start — no shuffle, no trim offsets.", slices: "fixed 4s slices" },
  2: { label: "Subtle", desc: "Near-sequential order with start/middle/end trim picks and minimal shuffle.", slices: "3.5–4.5s slices, ±0.5s trims" },
  3: { label: "Balanced", desc: "Full shuffle with random trims. Default — good divergence for most batches.", slices: "3–5s slices, ±2s duration swing" },
  4: { label: "Bold", desc: "Shuffle plus wider variable slice lengths and bigger duration swings.", slices: "2.5–5.5s slices, ±4s duration swing" },
  5: { label: "Maximum divergence", desc: "Variable clip counts and slice lengths — no two videos look alike.", slices: "2–6s slices, ±6s duration swing" },
};

const STEPS = [
  { n: 1, label: "Source" },
  { n: 2, label: "Audio & Text" },
  { n: 3, label: "Style" },
  { n: 4, label: "Render" },
];

function fmtMinutes(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  return m < 60 ? `≈ ${m} min` : `≈ ${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function ClientPage({ session }: { session?: { userId: string; role: string } }) {
  const [view, setView] = useState<"wizard" | "history">("wizard");
  const [statusBatchId, setStatusBatchId] = useState<string | null>(null);

  // Wizard state (persists across steps — lives for the page's lifetime)
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [mixingEnabled, setMixingEnabled] = useState(true);
  const [variationStrength, setVariationStrength] = useState(3);
  const [targetDuration, setTargetDuration] = useState(30);
  const [allowReuse, setAllowReuse] = useState(false);
  // Source Drive folder (pasted per batch — THE render source)
  const [sourceInput, setSourceInput] = useState("");
  const [sourceSyncing, setSourceSyncing] = useState(false);
  const [source, setSource] = useState<SourceSyncResult | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [mode, setMode] = useState<FactoryMode>("lyric");
  const [factoryTracks, setFactoryTracks] = useState<FactoryTrackRow[]>([]);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>([]);
  const [quotesText, setQuotesText] = useState("");
  const [styles, setStyles] = useState<SavedStyleRow[]>([]);
  const [stylesLoading, setStylesLoading] = useState(false);
  const [selectedStyleIds, setSelectedStyleIds] = useState<string[]>([]);
  const [totalVideos, setTotalVideos] = useState(10);

  // Batch creation / pre-flight / render
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchDirty, setBatchDirty] = useState(true);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

  const parsedQuotes = useMemo(
    () => quotesText.split("\n").map((q) => q.trim()).filter(Boolean),
    [quotesText]
  );

  const markDirty = () => setBatchDirty(true);

  // ── Data loading ──

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/campaigns");
        if (res.ok) {
          const data = await res.json();
          setCampaigns(Array.isArray(data) ? data : []);
        }
      } catch {
        // Campaign is optional — a 403 here must not break the wizard.
      }
    })();
  }, []);

  const loadFactoryTracks = useCallback(async () => {
    setTracksLoading(true);
    try {
      const res = await fetch("/api/factory/tracks");
      if (res.ok) {
        const data = await res.json();
        setFactoryTracks(data.tracks || []);
      }
    } catch (err) {
      console.error("Failed to load factory tracks:", err);
    } finally {
      setTracksLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFactoryTracks();
  }, [loadFactoryTracks]);

  useEffect(() => {
    if (step !== 3 || styles.length > 0 || stylesLoading) return;
    (async () => {
      setStylesLoading(true);
      try {
        const res = await fetch("/api/managed/style-studio/saved-styles");
        if (res.ok) {
          const data = await res.json();
          setStyles(Array.isArray(data) ? data : []);
        } else {
          toast.error("Failed to load saved styles");
        }
      } catch {
        toast.error("Failed to load saved styles");
      } finally {
        setStylesLoading(false);
      }
    })();
  }, [step, styles.length, stylesLoading]);

  // Filter to the lyric/quote style families when the field exists, else show all.
  const filteredStyles = useMemo(
    () => styles.filter((s) => !("family" in s) || !s.family || s.family === mode),
    [styles, mode]
  );

  // Prune style selections that no longer match the mode's family.
  const prevModeRef = useRef(mode);
  useEffect(() => {
    if (prevModeRef.current !== mode) {
      prevModeRef.current = mode;
      const allowed = new Set(filteredStyles.map((s) => s.id));
      setSelectedStyleIds((prev) => {
        const next = prev.filter((id) => allowed.has(id));
        if (next.length !== prev.length) markDirty();
        return next;
      });
    }
  }, [mode, filteredStyles]);

  // ── Source folder sync ──

  const handleSourceSync = async () => {
    if (!sourceInput.trim() || sourceSyncing) return;
    setSourceSyncing(true);
    setSourceError(null);
    try {
      const res = await fetch("/api/factory/source/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId: sourceInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to sync folder");
      setSource(data as SourceSyncResult);
      markDirty();
      toast.success(`Synced "${data.folderName}" — ${data.unused} unused of ${data.total} clips`);
    } catch (err: any) {
      setSource(null);
      setSourceError(err.message || "Failed to sync folder");
    } finally {
      setSourceSyncing(false);
    }
  };

  const clearSource = () => {
    setSource(null);
    setSourceError(null);
    markDirty();
  };

  // ── Batch lifecycle ──

  /** Creates the DRAFT batch on first use; re-creates it when batch-level fields changed. */
  const ensureBatch = async (): Promise<string> => {
    if (batchId && !batchDirty) return batchId;
    const res = await fetch("/api/factory/batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        mode,
        mixingEnabled,
        variationStrength,
        targetDuration,
        campaignId: campaignId || null,
        styleIds: selectedStyleIds,
        sourceFolderId: source?.folderId ?? "",
        trackIds: mode === "lyric" ? selectedTrackIds : [],
        quotes: mode === "quote" ? parsedQuotes : [],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to create batch");
    setBatchId(data.batch.id);
    setBatchDirty(false);
    return data.batch.id as string;
  };

  const runPreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const id = await ensureBatch();
      const res = await fetch(`/api/factory/batches/${id}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ totalVideos, allowReuseWhenExhausted: allowReuse }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Preview failed");
      setPreview(data.preview);
    } catch (err: any) {
      setPreview(null);
      setPreviewError(err.message || "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId, batchDirty, name, mode, mixingEnabled, variationStrength, targetDuration, campaignId, selectedStyleIds, selectedTrackIds, parsedQuotes, source, totalVideos, allowReuse]);

  // Auto pre-flight on step 4 (debounced against input changes).
  useEffect(() => {
    if (step !== 4 || !source || totalVideos < 1) return;
    if (mode === "lyric" && selectedTrackIds.length === 0) return;
    if (mode === "quote" && parsedQuotes.length === 0) return;
    if (selectedStyleIds.length === 0) return;
    const t = setTimeout(() => runPreview(), 400);
    return () => clearTimeout(t);
  }, [step, source, totalVideos, selectedTrackIds, parsedQuotes, allowReuse, selectedStyleIds, mode, runPreview]);

  const handleRender = async () => {
    if (!preview?.canRender || rendering) return;
    setRendering(true);
    try {
      const id = await ensureBatch();
      const res = await fetch(`/api/factory/batches/${id}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ totalVideos, allowReuseWhenExhausted: allowReuse }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start render");
      toast.success(
        `Render queued — ${data.result.itemsCreated} videos` +
          (data.result.skippedDuplicates > 0 ? ` (${data.result.skippedDuplicates} skipped)` : "")
      );
      resetBatchLinkage(); // the batch is consumed — a later wizard run must create a fresh one
      setStatusBatchId(id);
    } catch (err: any) {
      toast.error(err.message || "Failed to start render");
    } finally {
      setRendering(false);
    }
  };

  /** Detaches the wizard from the created batch (field values are kept). */
  const resetBatchLinkage = () => {
    setBatchId(null);
    setBatchDirty(true);
    setPreview(null);
    setPreviewError(null);
  };

  const resetWizard = () => {
    setStep(1);
    setName("");
    setCampaignId("");
    setMixingEnabled(true);
    setVariationStrength(3);
    setTargetDuration(30);
    setAllowReuse(false);
    setSourceInput("");
    setSource(null);
    setSourceError(null);
    setSelectedTrackIds([]);
    setQuotesText("");
    setSelectedStyleIds([]);
    setTotalVideos(10);
    resetBatchLinkage();
    setStatusBatchId(null);
    setView("wizard");
  };

  // ── Step validation ──

  const step1Valid = name.trim().length > 0 && !!source && targetDuration >= 5 && targetDuration <= 600;
  const step2Valid = mode === "lyric" ? selectedTrackIds.length > 0 : parsedQuotes.length > 0;
  const step3Valid = selectedStyleIds.length > 0;
  const step4Ready = !!preview?.canRender && !previewLoading;

  const canContinue = step === 1 ? step1Valid : step === 2 ? step2Valid : step === 3 ? step3Valid : true;

  // ── Quote CSV upload ──

  const handleQuotesFile = async (file: File) => {
    const text = await file.text();
    const lines = text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((l) => l.trim().replace(/^"(.*)"$/, "$1").trim())
      .filter(Boolean);
    if (lines.length === 0) {
      toast.error("No quotes found in that file");
      return;
    }
    setQuotesText((prev) => (prev.trim() ? `${prev.trim()}\n${lines.join("\n")}` : lines.join("\n")));
    toast.success(`Added ${lines.length} quotes from ${file.name}`);
  };

  // ── Status view takes over the page ──

  if (statusBatchId) {
    return (
      <BatchStatusView
        batchId={statusBatchId}
        onNewBatch={resetWizard}
        onShowHistory={() => {
          setStatusBatchId(null);
          setView("history");
        }}
      />
    );
  }

  // ── Page ──

  return (
    <div className="p-4 md:p-6 max-w-[1100px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-[#E11D48]">
            <Factory className="w-4.5 h-4.5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight">Video Factory</h1>
            <p className="text-[11px] text-[#71717a]">
              Render a pool of lyric & quote videos first — distribute to accounts or download afterwards.
            </p>
          </div>
        </div>
        <div className="flex items-center bg-[#09090b] border border-[#27272a] rounded-lg overflow-hidden">
          {(["wizard", "history"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                if (v === "history") resetBatchLinkage();
                setView(v);
              }}
              className={`px-3 py-1.5 text-[11px] font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
                view === v ? "bg-[#E11D48] text-white" : "text-[#a1a1aa] hover:text-white"
              }`}
            >
              {v === "wizard" ? <Factory className="w-3 h-3" /> : <History className="w-3 h-3" />}
              {v === "wizard" ? "New Batch" : "Batch History"}
            </button>
          ))}
        </div>
      </div>

      {view === "history" ? (
        <BatchHistoryList onOpenBatch={(id) => setStatusBatchId(id)} />
      ) : (
        <>
          {/* Progress rail */}
          <div className="flex items-center gap-1">
            {STEPS.map((s, i) => {
              const done = step > s.n;
              const active = step === s.n;
              return (
                <React.Fragment key={s.n}>
                  {i > 0 && <div className={`flex-1 h-px ${step > i ? "bg-[#E11D48]" : "bg-[#27272a]"}`} />}
                  <button
                    type="button"
                    onClick={() => s.n < step && setStep(s.n)}
                    disabled={s.n >= step}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-colors ${
                      s.n < step ? "cursor-pointer hover:bg-[#18181b]" : "cursor-default"
                    }`}
                  >
                    <span
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                        done ? "bg-[#E11D48] text-white" : active ? "border-2 border-[#E11D48] text-[#E11D48]" : "border border-[#3f3f46] text-[#71717a]"
                      }`}
                    >
                      {done ? <Check className="w-3 h-3" /> : s.n}
                    </span>
                    <span className={`text-[11px] font-semibold ${active ? "text-white" : "text-[#71717a]"}`}>{s.label}</span>
                  </button>
                </React.Fragment>
              );
            })}
          </div>

          <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-4 md:p-5">
            {/* ── Step 1: Source ── */}
            {step === 1 && (
              <div className="space-y-5">
                {/* Source Drive folder */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[#71717a] mb-1.5">
                    Source Drive folder * — background clips for the whole batch
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <FolderOpen className="w-3.5 h-3.5 text-[#71717a] absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={sourceInput}
                        onChange={(e) => {
                          setSourceInput(e.target.value);
                          if (source) clearSource();
                        }}
                        placeholder="Paste a Drive folder URL or ID — e.g. an account's input clips folder…"
                        className="w-full bg-[#09090b] border border-[#27272a] rounded-lg pl-8 pr-3 py-2 text-white placeholder-[#71717a] text-[12px] focus:outline-none focus:border-[#E11D48]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleSourceSync}
                      disabled={sourceSyncing || !sourceInput.trim()}
                      className="px-3 py-2 bg-[#27272a] hover:bg-[#3f3f46] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 flex-shrink-0"
                    >
                      {sourceSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                      Sync & check
                    </button>
                  </div>
                  {sourceError && (
                    <p className="text-[10px] text-red-400 mt-1.5 flex items-center gap-1.5">
                      <AlertCircle className="w-3 h-3 flex-shrink-0" />
                      {sourceError}
                    </p>
                  )}
                  {source && (
                    <div className="mt-2 bg-[#09090b] border border-green-500/20 rounded-lg px-3 py-2 flex items-center gap-2 flex-wrap">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                      <span className="text-[11px] font-semibold text-white truncate">{source.folderName}</span>
                      <span className="text-[10px] font-mono text-[#a1a1aa]">
                        {source.total} clips · <span className="text-green-400">{source.unused} unused</span>
                        {source.used > 0 ? ` · ${source.used} used` : ""}
                        {source.added > 0 ? ` · +${source.added} new` : ""}
                      </span>
                      <button
                        type="button"
                        onClick={handleSourceSync}
                        className="ml-auto text-[10px] font-semibold text-[#71717a] hover:text-white transition-colors cursor-pointer flex items-center gap-1"
                        title="Re-sync"
                      >
                        <RefreshCw className="w-2.5 h-2.5" />
                        Re-sync
                      </button>
                    </div>
                  )}
                  {!source && !sourceError && (
                    <p className="text-[10px] text-[#71717a] mt-1.5 leading-relaxed">
                      The batch reads clips from this folder only — never from per-account input folders. Clip usage is
                      tracked per folder: unused clips are picked first, and nothing repeats until the pool runs dry.
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#71717a] mb-1.5">
                      Batch name *
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        markDirty();
                      }}
                      placeholder="e.g. Sad edits — week 30"
                      className="w-full bg-[#09090b] border border-[#27272a] rounded-lg px-3 py-2 text-white placeholder-[#71717a] text-[12px] focus:outline-none focus:border-[#E11D48]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#71717a] mb-1.5">
                      Campaign (optional — adds “(Campaign)” to file names at distribute time)
                    </label>
                    <select
                      value={campaignId}
                      onChange={(e) => {
                        setCampaignId(e.target.value);
                        markDirty();
                      }}
                      className="w-full bg-[#09090b] border border-[#27272a] rounded-lg px-3 py-2 text-white text-[12px] focus:outline-none focus:border-[#E11D48]"
                    >
                      <option value="">No campaign</option>
                      {campaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Mixing toggle */}
                <div className="flex items-center justify-between bg-[#09090b] border border-[#27272a] rounded-xl px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Shuffle className="w-4 h-4 text-[#E11D48]" />
                    <div>
                      <p className="text-[12px] font-semibold text-white">Clip mixing</p>
                      <p className="text-[10px] text-[#71717a]">
                        {mixingEnabled
                          ? "Each video stitches short slices from several source clips."
                          : "Whole clips as backgrounds — one full source clip per video, looped to the target duration."}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={mixingEnabled}
                    onClick={() => {
                      setMixingEnabled(!mixingEnabled);
                      markDirty();
                    }}
                    className={`w-10 h-5.5 rounded-full relative transition-colors cursor-pointer flex-shrink-0 ${
                      mixingEnabled ? "bg-[#E11D48]" : "bg-[#3f3f46]"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white transition-all ${
                        mixingEnabled ? "left-[20px]" : "left-0.5"
                      }`}
                    />
                  </button>
                </div>

                {mixingEnabled && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-[#71717a] mb-1.5">
                        Variation strength — {STRENGTH_INFO[variationStrength].label}
                      </label>
                      <input
                        type="range"
                        min={1}
                        max={5}
                        step={1}
                        value={variationStrength}
                        onChange={(e) => {
                          setVariationStrength(parseInt(e.target.value, 10));
                          markDirty();
                        }}
                        className="w-full accent-[#E11D48]"
                      />
                      <div className="flex justify-between text-[9px] font-mono text-[#71717a] mt-0.5">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <span key={n} className={n === variationStrength ? "text-[#E11D48] font-bold" : ""}>
                            {n}
                          </span>
                        ))}
                      </div>
                      <p className="text-[11px] text-[#a1a1aa] mt-2 leading-relaxed">{STRENGTH_INFO[variationStrength].desc}</p>
                      <p className="text-[10px] font-mono text-[#71717a] mt-1">{STRENGTH_INFO[variationStrength].slices}</p>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-[#71717a] mb-1.5">
                        Target duration (seconds)
                      </label>
                      <input
                        type="number"
                        min={5}
                        max={600}
                        value={targetDuration}
                        onChange={(e) => {
                          setTargetDuration(Math.max(5, Math.min(600, parseInt(e.target.value, 10) || 30)));
                          markDirty();
                        }}
                        className="w-full bg-[#09090b] border border-[#27272a] rounded-lg px-3 py-2 text-white text-[12px] focus:outline-none focus:border-[#E11D48]"
                      />
                      <p className="text-[10px] text-[#71717a] mt-2 leading-relaxed">
                        Lyric mode uses each track&apos;s trim window instead when it is shorter. Strength 3+ adds a
                        random swing around this target so durations diverge.
                      </p>
                    </div>
                  </div>
                )}

                {/* Ledger behavior info */}
                <div className="bg-[#09090b] border border-[#27272a] rounded-xl px-4 py-3 space-y-2">
                  <p className="text-[11px] text-[#a1a1aa] leading-relaxed">
                    Background clips are picked from the source folder <b className="text-white">unused-first</b>, so
                    nothing repeats until the pool runs dry. When it runs out, pre-flight stops with a warning — sync
                    more clips, or allow least-recently-used clips to repeat.
                  </p>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={allowReuse}
                      onChange={(e) => setAllowReuse(e.target.checked)}
                      className="accent-[#E11D48] w-3.5 h-3.5"
                    />
                    <span className="text-[11px] text-[#e4e4e7]">Allow reuse when exhausted</span>
                  </label>
                </div>
              </div>
            )}

            {/* ── Step 2: Audio & Text ── */}
            {step === 2 && (
              <div className="space-y-4">
                <div className="flex items-center bg-[#09090b] border border-[#27272a] rounded-lg overflow-hidden w-fit">
                  {(["lyric", "quote"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setMode(m);
                        markDirty();
                      }}
                      className={`px-4 py-2 text-[11px] font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
                        mode === m ? "bg-[#E11D48] text-white" : "text-[#a1a1aa] hover:text-white"
                      }`}
                    >
                      {m === "lyric" ? <Music className="w-3 h-3" /> : <Quote className="w-3 h-3" />}
                      {m === "lyric" ? "Lyric videos" : "Quote videos"}
                    </button>
                  ))}
                </div>

                {mode === "lyric" ? (
                  <TracksStep
                    tracks={factoryTracks}
                    tracksLoading={tracksLoading}
                    selectedIds={selectedTrackIds}
                    onToggleTrack={(id) =>
                      setSelectedTrackIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))
                    }
                    onTrackSaved={(track) => {
                      setFactoryTracks((prev) => [track, ...prev.filter((t) => t.id !== track.id)]);
                      setSelectedTrackIds((prev) => (prev.includes(track.id) ? prev : [...prev, track.id]));
                    }}
                  />
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-[#71717a]">
                        Quotes — one per line ({parsedQuotes.length} parsed)
                      </label>
                      <label className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#27272a] hover:bg-[#3f3f46] text-white text-[11px] font-semibold rounded-lg transition-colors cursor-pointer">
                        <FileText className="w-3 h-3" />
                        Upload CSV / TXT
                        <input
                          type="file"
                          accept=".csv,.txt,text/csv,text/plain"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleQuotesFile(f);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                    <textarea
                      value={quotesText}
                      onChange={(e) => setQuotesText(e.target.value)}
                      placeholder={"The night is darkest just before dawn\nStay hungry, stay foolish\n…"}
                      rows={9}
                      className="w-full bg-[#09090b] border border-[#27272a] rounded-xl px-3 py-2.5 text-white placeholder-[#71717a] text-[12px] focus:outline-none focus:border-[#E11D48] resize-y"
                    />
                    <p className="text-[10px] text-[#71717a] leading-relaxed">
                      Quotes distribute round-robin across videos. Quote mode renders without background music in v1 —
                      the overlay carries the video. Fewer quotes than videos means quotes repeat.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ── Step 3: Style ── */}
            {step === 3 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#71717a]">
                    {mode === "lyric" ? "Lyric" : "Quote"} styles — pick at least one ({selectedStyleIds.length} selected)
                  </p>
                  <p className="text-[10px] text-[#71717a]">Styles spread round-robin across the pool</p>
                </div>
                {stylesLoading ? (
                  <div className="flex items-center justify-center py-10 text-[#71717a]">
                    <Loader2 className="w-5 h-5 animate-spin" />
                  </div>
                ) : filteredStyles.length === 0 ? (
                  <div className="bg-[#09090b] border border-[#27272a] rounded-xl p-8 text-center">
                    <Layers className="w-6 h-6 text-[#3f3f46] mx-auto mb-2" />
                    <p className="text-[11px] text-[#71717a]">
                      No {mode} styles saved yet — create one in Style Studio, then come back.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
                    {filteredStyles.map((s) => {
                      const isSel = selectedStyleIds.includes(s.id);
                      const thumb =
                        s.thumbnail && /^(data:|\/|https?:)/.test(s.thumbnail) ? s.thumbnail : null;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setSelectedStyleIds((prev) =>
                              prev.includes(s.id) ? prev.filter((id) => id !== s.id) : [...prev, s.id]
                            );
                            markDirty();
                          }}
                          className={`text-left border rounded-xl overflow-hidden transition-colors cursor-pointer ${
                            isSel ? "border-[#E11D48] bg-[#E11D48]/5" : "border-[#27272a] bg-[#09090b] hover:border-[#3f3f46]"
                          }`}
                        >
                          <div className="aspect-[9/16] max-h-[160px] w-full bg-[#09090b] flex items-center justify-center overflow-hidden">
                            {thumb ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={thumb} alt={s.name} className="w-full h-full object-cover" />
                            ) : (
                              <Layers className="w-6 h-6 text-[#3f3f46]" />
                            )}
                          </div>
                          <div className="px-2.5 py-2 flex items-center gap-2">
                            <div
                              className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${
                                isSel ? "bg-[#E11D48] border-[#E11D48]" : "border-[#3f3f46]"
                              }`}
                            >
                              {isSel && <Check className="w-2.5 h-2.5 text-white" />}
                            </div>
                            <div className="min-w-0">
                              <p className="text-[11px] font-semibold text-white truncate">{s.name}</p>
                              <p className="text-[9px] font-mono text-[#71717a] truncate">{s.templateKey}</p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── Step 4: Render ── */}
            {step === 4 && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#71717a] mb-1.5">
                      Total videos to render
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={2000}
                      value={totalVideos}
                      onChange={(e) => setTotalVideos(Math.max(1, Math.min(2000, parseInt(e.target.value, 10) || 1)))}
                      className="w-full bg-[#09090b] border border-[#27272a] rounded-lg px-3 py-2 text-white text-[12px] focus:outline-none focus:border-[#E11D48]"
                    />
                  </div>
                  <div className="bg-[#09090b] border border-[#27272a] rounded-lg px-3 py-2">
                    <p className="text-[9px] uppercase font-bold text-[#71717a]">Source pool</p>
                    <p className="text-[11px] text-white font-semibold truncate">{source?.folderName}</p>
                    <p className="text-[10px] font-mono text-[#a1a1aa]">
                      {source ? `${source.unused} unused of ${source.total} clips` : ""}
                    </p>
                  </div>
                </div>

                <p className="text-[10px] text-[#71717a] leading-relaxed">
                  Videos render into a pool first — no accounts involved. When the batch finishes, distribute the pool
                  to accounts or download it as one archive from the status view.
                </p>

                {/* Pre-flight summary card */}
                <div className="bg-[#09090b] border border-[#27272a] rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-[#71717a]">Pre-flight summary</h4>
                    <button
                      type="button"
                      onClick={runPreview}
                      disabled={previewLoading}
                      className="flex items-center gap-1 text-[10px] font-semibold text-[#a1a1aa] hover:text-white transition-colors cursor-pointer disabled:opacity-40"
                    >
                      <RefreshCw className={`w-3 h-3 ${previewLoading ? "animate-spin" : ""}`} />
                      Refresh
                    </button>
                  </div>

                  {previewLoading && !preview && (
                    <div className="flex items-center justify-center py-6 text-[#71717a]">
                      <Loader2 className="w-4 h-4 animate-spin" />
                    </div>
                  )}

                  {previewError && (
                    <div className="text-[11px] text-red-400 font-semibold bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 flex items-center gap-2">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      {previewError}
                    </div>
                  )}

                  {preview && (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        {[
                          { label: "Videos", value: String(preview.totalVideos) },
                          { label: "Clips needed", value: String(preview.filesNeeded) },
                          {
                            label: "Unused available",
                            value: String(preview.availableUnused),
                            tone: preview.exhausted ? "text-amber-400" : "text-green-400",
                          },
                          { label: "Estimated time", value: fmtMinutes(preview.estimatedSeconds), icon: true },
                        ].map((c) => (
                          <div key={c.label} className="bg-[#18181b] border border-[#27272a] rounded-lg px-3 py-2">
                            <p className="text-[9px] uppercase font-bold text-[#71717a] flex items-center gap-1">
                              {c.icon && <Clock className="w-2.5 h-2.5" />}
                              {c.label}
                            </p>
                            <p className={`text-sm font-bold ${c.tone ?? "text-white"}`}>{c.value}</p>
                          </div>
                        ))}
                      </div>
                      <p className="text-[10px] font-mono text-[#71717a]">
                        {preview.stylesCount} style{preview.stylesCount === 1 ? "" : "s"} in rotation
                        {preview.exhausted ? " · source pool exhausted" : ""}
                      </p>
                      {preview.warnings.map((w, i) => (
                        <p key={i} className="text-[10px] text-amber-400 flex items-start gap-1.5">
                          <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                          {w}
                        </p>
                      ))}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Nav */}
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-[#27272a]">
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(1, s - 1))}
                disabled={step === 1}
                className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold text-[#a1a1aa] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Back
              </button>
              {step < 4 ? (
                <button
                  type="button"
                  onClick={() => canContinue && setStep((s) => s + 1)}
                  disabled={!canContinue}
                  className="flex items-center gap-1.5 px-4 py-2 bg-[#E11D48] hover:bg-[#be123c] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-bold rounded-lg transition-colors cursor-pointer"
                >
                  Continue
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleRender}
                  disabled={!step4Ready || rendering}
                  className="flex items-center gap-1.5 px-5 py-2 bg-[#E11D48] hover:bg-[#be123c] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-bold rounded-lg transition-colors cursor-pointer"
                >
                  {rendering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  Render {preview ? `${preview.totalVideos} videos` : ""}
                </button>
              )}
            </div>
            {step === 4 && preview && !preview.canRender && !previewLoading && (
              <p className="text-[10px] text-red-400 text-right mt-2">
                Pre-flight is blocking the render — resolve the warnings above or allow reuse.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Batch history ────────────────────────────────────────────────────────────

type HistoryFilter = "all" | "active" | "completed" | "failed" | "draft";

interface QueueState {
  paused: boolean;
  processing: boolean;
  staleRendering: number;
  pendingItems?: number;
  active?: {
    batchId: string;
    batchName: string;
    itemId: string;
    position: number;
    totalInBatch: number;
    startedAt: string;
  } | null;
  batchCounts?: Record<string, number>;
}

const HISTORY_FILTERS: { key: HistoryFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
  { key: "failed", label: "Failed" },
  { key: "draft", label: "Draft" },
];

/** Normalizes a list-API row into the final contract shape (tolerates the legacy lowercase itemCounts). */
function normalizeBatchRow(raw: any): BatchListRow {
  const ic = raw.itemCounts ?? {};
  const pending = ic.PENDING ?? ic.pending ?? 0;
  const rendering = ic.RENDERING ?? ic.rendering ?? 0;
  const completed = ic.COMPLETED ?? ic.completed ?? 0;
  const failed = ic.FAILED ?? ic.failed ?? 0;
  const canceled = ic.CANCELED ?? ic.canceled ?? 0;
  return {
    id: raw.id,
    name: raw.name ?? "Untitled batch",
    mode: raw.mode ?? "lyric",
    status: raw.status ?? "DRAFT",
    errorMessage: raw.errorMessage ?? null,
    sourceFolderId: raw.sourceFolderId ?? null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt ?? raw.createdAt,
    itemCounts: { PENDING: pending, RENDERING: rendering, COMPLETED: completed, FAILED: failed, CANCELED: canceled },
    completedCount: raw.completedCount ?? completed,
    totalItems: raw.totalItems ?? ic.total ?? pending + rendering + completed + failed + canceled,
  };
}

function fmtRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function isActiveStatus(status: string) {
  return status === "QUEUED" || status === "RENDERING";
}

function BatchHistoryList({ onOpenBatch }: { onOpenBatch: (id: string) => void }) {
  const [batches, setBatches] = useState<BatchListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Global render queue
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [queueBusy, setQueueBusy] = useState(false);

  // Filters / search / selection
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Per-batch Smart Download state
  const [dlMap, setDlMap] = useState<Record<string, DownloadStatus>>({});
  const [dlStarting, setDlStarting] = useState<Record<string, boolean>>({});
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  // Confirm dialog (cancel / delete / bulk-delete)
  const [confirm, setConfirm] = useState<{
    title: string;
    body: string;
    confirmLabel: string;
    action: () => Promise<void>;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Smart Export (distribute slide-over)
  const [distributeBatchId, setDistributeBatchId] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<FactoryAccountSelection[]>([]);
  const [allowRedistribute, setAllowRedistribute] = useState(false);
  const [distributing, setDistributing] = useState(false);

  // ── Loading ──

  const fetchBatches = useCallback(async (mode: "initial" | "poll" | "manual" = "initial") => {
    if (mode === "initial") setLoading(true);
    if (mode === "manual") setRefreshing(true);
    try {
      const res = await fetch("/api/factory/batches");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load batches");
      setBatches(((data.batches || []) as any[]).map(normalizeBatchRow));
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err.message || "Failed to load batches");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch("/api/factory/queue");
      if (res.ok) setQueue(await res.json());
    } catch {
      // transient — next tick retries
    }
  }, []);

  useEffect(() => {
    fetchBatches();
    fetchQueue();
  }, [fetchBatches, fetchQueue]);

  // Live queue state + silent list refresh while the history is visible.
  useEffect(() => {
    const t = setInterval(() => {
      fetchQueue();
      fetchBatches("poll");
    }, 5000);
    return () => clearInterval(t);
  }, [fetchQueue, fetchBatches]);

  // Prune selections for batches that disappeared.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const ids = new Set(batches.map((b) => b.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [batches]);

  // Poll Smart Download status for every batch with a PREPARING archive.
  useEffect(() => {
    const preparing = Object.entries(dlMap)
      .filter(([, s]) => s.status === "PREPARING")
      .map(([id]) => id);
    if (preparing.length === 0) return;
    const t = setInterval(async () => {
      for (const id of preparing) {
        try {
          const res = await fetch(`/api/factory/batches/${id}/download`);
          if (res.ok) {
            const s = (await res.json()) as DownloadStatus;
            setDlMap((prev) => ({ ...prev, [id]: s }));
          }
        } catch {
          // transient — next tick retries
        }
      }
    }, 3000);
    return () => clearInterval(t);
  }, [dlMap]);

  // ── Derived ──

  const filterCounts = useMemo(() => {
    const c: Record<HistoryFilter, number> = { all: batches.length, active: 0, completed: 0, failed: 0, draft: 0 };
    for (const b of batches) {
      if (isActiveStatus(b.status)) c.active++;
      else if (b.status === "COMPLETED") c.completed++;
      else if (b.status === "FAILED") c.failed++;
      else if (b.status === "DRAFT") c.draft++;
    }
    return c;
  }, [batches]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return batches.filter((b) => {
      if (filter === "active" && !isActiveStatus(b.status)) return false;
      if (filter === "completed" && b.status !== "COMPLETED") return false;
      if (filter === "failed" && b.status !== "FAILED") return false;
      if (filter === "draft" && b.status !== "DRAFT") return false;
      if (q && !b.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [batches, filter, search]);

  const selectedBatches = useMemo(() => batches.filter((b) => selectedIds.has(b.id)), [batches, selectedIds]);
  const singleSelected = selectedBatches.length === 1 ? selectedBatches[0] : null;
  const distributeBatch = distributeBatchId ? batches.find((b) => b.id === distributeBatchId) : null;

  // ── Actions ──

  const handleQueueControl = async (action: "pause" | "resume" | "recover") => {
    if (queueBusy) return;
    setQueueBusy(true);
    try {
      const res = await fetch("/api/factory/queue/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Queue control failed");
      if (data.state) setQueue(data.state);
      if (action === "recover") {
        toast.success(data.recovered > 0 ? `Recovered ${data.recovered} stuck items` : "No stuck items to recover");
        fetchBatches("poll");
      } else {
        toast.success(action === "pause" ? "Queue paused" : "Queue resumed");
      }
    } catch (err: any) {
      toast.error(err.message || "Queue control failed");
    } finally {
      setQueueBusy(false);
    }
  };

  const handleStartDownload = async (id: string) => {
    if (dlStarting[id]) return;
    setDlStarting((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(`/api/factory/batches/${id}/download`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to prepare download");
      setDlMap((prev) => ({ ...prev, [id]: data as DownloadStatus }));
    } catch (err: any) {
      toast.error(err.message || "Failed to prepare download");
    } finally {
      setDlStarting((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleRetryFailed = async (id: string) => {
    if (retryingId) return;
    setRetryingId(id);
    try {
      const res = await fetch(`/api/factory/batches/${id}/retry-failed`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Retry failed");
      toast.success(data.retried > 0 ? `Re-queued ${data.retried} items` : "No failed items to retry");
      fetchBatches("poll");
    } catch (err: any) {
      toast.error(err.message || "Retry failed");
    } finally {
      setRetryingId(null);
    }
  };

  const doCancel = async (b: BatchListRow) => {
    setCancelingId(b.id);
    try {
      const res = await fetch(`/api/factory/batches/${b.id}/cancel`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Cancel failed");
      toast.success(data.canceled > 0 ? `Canceled — ${data.canceled} pending items stopped` : "Batch canceled");
      fetchBatches("poll");
    } catch (err: any) {
      toast.error(err.message || "Cancel failed");
    } finally {
      setCancelingId(null);
    }
  };

  const doDelete = async (batchIds: string[]) => {
    try {
      const res = await fetch("/api/factory/batches/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      toast.success(`Deleted ${data.deletedBatches ?? batchIds.length} ${batchIds.length === 1 ? "batch" : "batches"}`);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        batchIds.forEach((id) => next.delete(id));
        return next;
      });
      fetchBatches("poll");
    } catch (err: any) {
      toast.error(err.message || "Delete failed");
    }
  };

  const openDistribute = (id: string) => {
    setDistributeBatchId(id);
    setAssignments([]);
    setAllowRedistribute(false);
  };

  const handleDistribute = async () => {
    if (!distributeBatchId || distributing || assignments.length === 0) return;
    setDistributing(true);
    try {
      const res = await fetch(`/api/factory/batches/${distributeBatchId}/distribute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignments: assignments.map((a) => ({ accountId: a.accountId, videoCount: a.count })),
          allowRedistribute,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Distribution failed");
      const result = data.result as DistributeResult;
      const uploaded = result.results.reduce((s, r) => s + r.uploaded, 0);
      const failed = result.results.reduce((s, r) => s + r.failed, 0);
      toast.success(`Distributed ${uploaded} videos${failed > 0 ? ` — ${failed} failed` : ""}`);
      setDistributeBatchId(null);
      setAssignments([]);
      fetchBatches("poll");
    } catch (err: any) {
      toast.error(err.message || "Distribution failed");
    } finally {
      setDistributing(false);
    }
  };

  const handleConfirm = async () => {
    if (!confirm || confirmBusy) return;
    setConfirmBusy(true);
    await confirm.action();
    setConfirmBusy(false);
    setConfirm(null);
  };

  // ── Render ──

  return (
    <div className="space-y-3">
      {/* Toolbar — queue controls */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <h2 className="text-[14px] font-bold text-white tracking-tight">Batch History</h2>
          {queue?.paused && (
            <span className="px-2 py-0.5 rounded-md border bg-amber-500/10 text-amber-400 border-amber-500/20 text-[9px] font-bold uppercase">
              Queue paused
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {queue && queue.staleRendering > 0 && (
            <button
              type="button"
              onClick={() => handleQueueControl("recover")}
              disabled={queueBusy}
              title="Reset items stuck in RENDERING back to the queue"
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 disabled:opacity-40 text-amber-400 text-[10px] font-bold rounded-lg transition-colors cursor-pointer"
            >
              {queueBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertTriangle className="w-3 h-3" />}
              Recover {queue.staleRendering} stuck
            </button>
          )}
          <button
            type="button"
            onClick={() => handleQueueControl(queue?.paused ? "resume" : "pause")}
            disabled={queueBusy || !queue}
            title={queue?.paused ? "Resume the render queue" : "Pause the render queue (running items finish)"}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#18181b] border border-[#27272a] hover:border-[#3f3f46] disabled:opacity-40 text-[#a1a1aa] hover:text-white text-[10px] font-semibold rounded-lg transition-colors cursor-pointer"
          >
            {queueBusy ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : queue?.paused ? (
              <Play className="w-3 h-3" />
            ) : (
              <Pause className="w-3 h-3" />
            )}
            {queue?.paused ? "Resume queue" : "Pause queue"}
          </button>
          <button
            type="button"
            onClick={() => {
              fetchBatches("manual");
              fetchQueue();
            }}
            title="Refresh"
            aria-label="Refresh"
            className="w-7 h-7 flex items-center justify-center bg-[#18181b] border border-[#27272a] hover:border-[#3f3f46] text-[#a1a1aa] hover:text-white rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Live queue status strip — what's happening right now */}
      {queue && (
        <div className="flex items-center gap-3 flex-wrap bg-[#18181b] border border-[#27272a] rounded-lg px-3 py-2">
          {queue.paused ? (
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-400">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Paused
            </span>
          ) : queue.active ? (
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Rendering
            </span>
          ) : (queue.pendingItems ?? 0) > 0 ? (
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-400">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" /> Queued
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-zinc-500">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" /> Idle
            </span>
          )}

          {queue.active && !queue.paused && (
            <span className="text-[11px] text-zinc-300 truncate min-w-0">
              <button
                type="button"
                onClick={() => onOpenBatch(queue.active!.batchId)}
                className="font-semibold text-white hover:text-[#E11D48] hover:underline underline-offset-2 transition-colors cursor-pointer"
                title="Open this batch"
              >
                {queue.active.batchName}
              </button>
              {" — video "}
              <span className="font-mono text-emerald-400">{queue.active.position}/{queue.active.totalInBatch}</span>
              {" · started "}
              {fmtRelative(queue.active.startedAt)}
            </span>
          )}

          <span className="text-[10px] text-zinc-500 ml-auto whitespace-nowrap">
            {(queue.pendingItems ?? 0) > 0 && <span className="text-amber-400/90 font-semibold">{queue.pendingItems} video{queue.pendingItems === 1 ? "" : "s"} queued · </span>}
            {(queue.batchCounts?.QUEUED ?? 0) + (queue.batchCounts?.RENDERING ?? 0) > 0 && (
              <span>{(queue.batchCounts?.QUEUED ?? 0) + (queue.batchCounts?.RENDERING ?? 0)} active batches · </span>
            )}
            {queue.batchCounts?.COMPLETED ? <span className="text-emerald-400/80">{queue.batchCounts.COMPLETED} completed</span> : null}
            {queue.batchCounts?.FAILED ? <span className="text-red-400/80"> · {queue.batchCounts.FAILED} failed</span> : null}
          </span>
        </div>
      )}

      {/* Toolbar — filter chips + search */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {HISTORY_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors cursor-pointer border ${
                filter === f.key
                  ? "bg-[#E11D48] border-[#E11D48] text-white"
                  : "bg-[#18181b] border-[#27272a] text-[#a1a1aa] hover:text-white hover:border-[#3f3f46]"
              }`}
            >
              {f.label}
              <span className={filter === f.key ? "text-white/70" : "text-[#71717a]"}> · {filterCounts[f.key]}</span>
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="w-3 h-3 text-[#71717a] absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search batches…"
            className="bg-[#09090b] border border-[#27272a] rounded-lg pl-7 pr-7 py-1.5 text-white placeholder-[#71717a] text-[11px] w-48 focus:outline-none focus:border-[#E11D48]"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              title="Clear search"
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-[#71717a] hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="space-y-2.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-[#18181b] border border-[#27272a] rounded-xl p-4 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-3.5 h-3.5 bg-[#27272a] rounded" />
                <div className="flex-1">
                  <div className="h-3 w-56 bg-[#27272a] rounded" />
                  <div className="h-2.5 w-80 max-w-full bg-[#27272a] rounded mt-2" />
                </div>
              </div>
              <div className="h-1.5 w-full bg-[#27272a] rounded-full mt-3.5" />
            </div>
          ))}
        </div>
      ) : loadError && batches.length === 0 ? (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[11px] text-red-400 font-semibold flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {loadError}
          </p>
          <button
            type="button"
            onClick={() => fetchBatches()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#27272a] hover:bg-[#3f3f46] text-white text-[11px] font-semibold rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            Try again
          </button>
        </div>
      ) : batches.length === 0 ? (
        <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-12 text-center">
          <History className="w-8 h-8 text-[#3f3f46] mx-auto mb-3" />
          <p className="text-[12px] text-[#a1a1aa] font-semibold">No batches yet</p>
          <p className="text-[11px] text-[#71717a] mt-1">Create one above — rendered batches show up here.</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-10 text-center">
          <Search className="w-6 h-6 text-[#3f3f46] mx-auto mb-2" />
          <p className="text-[11px] text-[#71717a]">No batches match this filter or search.</p>
          <button
            type="button"
            onClick={() => {
              setFilter("all");
              setSearch("");
            }}
            className="mt-3 px-3 py-1.5 bg-[#27272a] hover:bg-[#3f3f46] text-white text-[11px] font-semibold rounded-lg transition-colors cursor-pointer"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {visible.map((b) => (
            <BatchHistoryCard
              key={b.id}
              batch={b}
              selected={selectedIds.has(b.id)}
              onToggleSelect={() =>
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(b.id)) next.delete(b.id);
                  else next.add(b.id);
                  return next;
                })
              }
              onOpen={() => onOpenBatch(b.id)}
              live={queue?.active && queue.active.batchId === b.id ? { position: queue.active.position, totalInBatch: queue.active.totalInBatch } : null}
              dl={dlMap[b.id]}
              dlStarting={!!dlStarting[b.id]}
              onStartDownload={() => handleStartDownload(b.id)}
              onDistribute={() => openDistribute(b.id)}
              onCancel={() =>
                setConfirm({
                  title: `Cancel "${b.name}"?`,
                  body: "Pending items are stopped and the queue moves on. Videos already rendered are kept.",
                  confirmLabel: "Cancel batch",
                  action: () => doCancel(b),
                })
              }
              canceling={cancelingId === b.id}
              onRetryFailed={() => handleRetryFailed(b.id)}
              retrying={retryingId === b.id}
              onDelete={() =>
                setConfirm({
                  title: `Delete "${b.name}"?`,
                  body: "This removes the batch and its rendered files. This cannot be undone.",
                  confirmLabel: "Delete batch",
                  action: () => doDelete([b.id]),
                })
              }
            />
          ))}
          {selectedIds.size > 0 && <div className="h-16" />}
        </div>
      )}

      {/* Bulk bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-[#18181b] border border-[#E11D48]/30 rounded-full px-5 py-2.5 shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <span className="text-[11px] text-[#e4e4e7] font-semibold whitespace-nowrap">
            {selectedIds.size} selected
          </span>
          <div className="w-px h-4 bg-[#27272a]" />
          {singleSelected && singleSelected.completedCount > 0 && (
            <button
              type="button"
              onClick={() => handleStartDownload(singleSelected.id)}
              disabled={!!dlStarting[singleSelected.id] || dlMap[singleSelected.id]?.status === "PREPARING"}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#27272a] hover:bg-[#3f3f46] disabled:opacity-40 text-white text-[11px] font-semibold rounded-full transition-colors cursor-pointer whitespace-nowrap"
            >
              {dlStarting[singleSelected.id] || dlMap[singleSelected.id]?.status === "PREPARING" ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Archive className="w-3 h-3" />
              )}
              Smart Download
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              setConfirm({
                title: `Delete ${selectedIds.size} ${selectedIds.size === 1 ? "batch" : "batches"}?`,
                body: "This removes the selected batches and their rendered files. This cannot be undone.",
                confirmLabel: "Delete selected",
                action: () => doDelete([...selectedIds]),
              })
            }
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 text-red-400 text-[11px] font-bold rounded-full transition-colors cursor-pointer whitespace-nowrap"
          >
            <Trash2 className="w-3 h-3" />
            Delete selected
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[#a1a1aa] hover:text-white text-[11px] font-semibold rounded-full transition-colors cursor-pointer whitespace-nowrap"
          >
            <X className="w-3 h-3" />
            Clear
          </button>
        </div>
      )}

      {/* Confirm dialog */}
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ""}
        body={confirm?.body ?? ""}
        confirmLabel={confirm?.confirmLabel ?? "Confirm"}
        busy={confirmBusy}
        onConfirm={handleConfirm}
        onCancel={() => setConfirm(null)}
      />

      {/* Smart Export slide-over */}
      <FactoryAccountsPanel
        open={distributeBatchId !== null}
        onClose={() => setDistributeBatchId(null)}
        selected={assignments}
        onChange={setAssignments}
      />
      {distributeBatchId && (
        <div className="fixed inset-x-0 bottom-0 z-[60] flex justify-center pointer-events-none">
          <div className="pointer-auto w-full max-w-[560px] bg-[#18181b] border border-[#27272a] border-b-0 rounded-t-xl px-4 py-3 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-[#a1a1aa] min-w-0">
                <span className="font-bold text-white">{assignments.reduce((s, a) => s + a.count, 0)}</span> videos
                requested · <span className="font-bold text-white">{distributeBatch?.completedCount ?? 0}</span> in pool
                {distributeBatch ? <span className="text-[#71717a]"> · {distributeBatch.name}</span> : ""}
              </p>
              <button
                type="button"
                onClick={handleDistribute}
                disabled={distributing || assignments.length === 0}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#E11D48] hover:bg-[#be123c] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-bold rounded-lg transition-colors cursor-pointer flex-shrink-0"
              >
                {distributing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Users className="w-3 h-3" />}
                Distribute
              </button>
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allowRedistribute}
                onChange={(e) => setAllowRedistribute(e.target.checked)}
                className="accent-[#E11D48] w-3.5 h-3.5"
              />
              <span className="text-[10px] text-[#a1a1aa]">Re-distribute — include already-distributed videos</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Batch history card ───────────────────────────────────────────────────────

function BatchHistoryCard(props: {
  batch: BatchListRow;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  live?: { position: number; totalInBatch: number } | null;
  dl?: DownloadStatus;
  dlStarting: boolean;
  onStartDownload: () => void;
  onDistribute: () => void;
  onCancel: () => void;
  canceling: boolean;
  onRetryFailed: () => void;
  retrying: boolean;
  onDelete: () => void;
}) {
  const { batch: b, selected, dl } = props;
  const failed = b.itemCounts.FAILED;
  const canceled = b.itemCounts.CANCELED ?? 0;
  const inFlight = b.itemCounts.PENDING + b.itemCounts.RENDERING;
  const donePct = b.totalItems > 0 ? (b.completedCount / b.totalItems) * 100 : 0;
  const failPct = b.totalItems > 0 ? (failed / b.totalItems) * 100 : 0;
  const dlBusy = props.dlStarting || dl?.status === "PREPARING";

  return (
    <div
      className={`bg-[#18181b] border rounded-xl px-4 py-3 transition-colors ${
        selected ? "border-[#E11D48]/50" : "border-[#27272a]"
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={props.onToggleSelect}
          aria-label={`Select ${b.name}`}
          className="accent-[#E11D48] w-3.5 h-3.5 mt-1 flex-shrink-0 cursor-pointer"
        />
        <div className="min-w-0 flex-1">
          {/* Title line */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={props.onOpen}
              className="text-[12px] font-semibold text-white hover:text-[#E11D48] transition-colors cursor-pointer truncate max-w-[320px] text-left"
              title={`Open ${b.name}`}
            >
              {b.name}
            </button>
            <ModeChip mode={b.mode} />
            <BatchStatusChip status={b.status} live={props.live} />
          </div>
          {/* Meta line */}
          <p className="text-[10px] text-[#71717a] mt-1 flex items-center gap-1.5 flex-wrap">
            {b.sourceFolderId && (
              <span className="font-mono" title={`Source folder: ${b.sourceFolderId}`}>
                src {b.sourceFolderId.slice(0, 10)}…
              </span>
            )}
            <span title={new Date(b.createdAt).toLocaleString()}>{fmtRelative(b.createdAt)}</span>
            {b.errorMessage && (
              <span className="text-red-400 truncate max-w-[360px]" title={b.errorMessage}>
                · {b.errorMessage}
              </span>
            )}
          </p>
          {/* Progress line */}
          <div className="flex items-center gap-2.5 mt-2">
            <div className="flex-1 h-1.5 bg-[#27272a] rounded-full overflow-hidden flex">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${donePct}%` }} />
              <div className="h-full bg-red-500 transition-all" style={{ width: `${failPct}%` }} />
            </div>
            <p className="text-[10px] font-mono text-[#a1a1aa] whitespace-nowrap flex-shrink-0">
              {b.status === "COMPLETED" ? (
                <span className="text-emerald-400 font-bold text-[11px]">{b.completedCount} videos</span>
              ) : (
                <>
                  <span className="text-emerald-400">{b.completedCount}</span>/{b.totalItems}
                  {failed > 0 && <span className="text-red-400"> · {failed} failed</span>}
                  {canceled > 0 && <span className="text-[#71717a]"> · {canceled} canceled</span>}
                  {inFlight > 0 && <span> · {inFlight} queued</span>}
                </>
              )}
              {b.status === "COMPLETED" && failed > 0 && <span className="text-red-400"> · {failed} failed</span>}
            </p>
          </div>
        </div>
        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
          <IconAction title="View batch status" onClick={props.onOpen}>
            <Eye className="w-3.5 h-3.5" />
          </IconAction>
          {b.completedCount > 0 && (
            <>
              <IconAction title="Smart Download — one archive of the pool" onClick={props.onStartDownload} disabled={dlBusy}>
                {dlBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
              </IconAction>
              <IconAction title="Smart Export — distribute the pool to accounts" onClick={props.onDistribute} accent>
                <Users className="w-3.5 h-3.5" />
              </IconAction>
            </>
          )}
          {isActiveStatus(b.status) && (
            <IconAction title="Cancel — stop pending items" onClick={props.onCancel} disabled={props.canceling}>
              {props.canceling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
            </IconAction>
          )}
          {failed > 0 && (
            <IconAction title={`Retry ${failed} failed items`} onClick={props.onRetryFailed} disabled={props.retrying}>
              {props.retrying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </IconAction>
          )}
          <IconAction title="Delete batch and its rendered files" onClick={props.onDelete} danger>
            <Trash2 className="w-3.5 h-3.5" />
          </IconAction>
        </div>
      </div>

      {/* Smart Download status strip */}
      {dl && (
        <div className="mt-2.5 pt-2.5 border-t border-[#27272a]">
          {dl.status === "PREPARING" && (
            <div className="flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin text-[#a1a1aa] flex-shrink-0" />
              <span className="text-[10px] text-[#a1a1aa] truncate">{dl.message || "Preparing archive…"}</span>
              <div className="flex-1 h-1 bg-[#27272a] rounded-full overflow-hidden">
                <div className="h-full bg-[#E11D48] transition-all" style={{ width: `${dl.progress}%` }} />
              </div>
              <span className="text-[9px] font-mono text-[#71717a] flex-shrink-0">{dl.progress}%</span>
            </div>
          )}
          {dl.status === "COMPLETED" && dl.downloadUrl && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-[10px] text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
                Archive ready — {dl.completedCount} videos · {fmtBytes(dl.size)}
              </p>
              <a
                href={dl.downloadUrl}
                download
                className="flex items-center gap-1.5 px-2.5 py-1 bg-[#E11D48] hover:bg-[#be123c] text-white text-[10px] font-bold rounded-md transition-colors"
              >
                <Download className="w-3 h-3" />
                Download archive
              </a>
            </div>
          )}
          {dl.status === "FAILED" && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-[10px] text-red-400 flex items-center gap-1.5">
                <AlertCircle className="w-3 h-3 flex-shrink-0" />
                {dl.message || "Archive preparation failed"}
              </p>
              <button
                type="button"
                onClick={props.onStartDownload}
                className="flex items-center gap-1 px-2.5 py-1 bg-[#27272a] hover:bg-[#3f3f46] text-white text-[10px] font-semibold rounded-md transition-colors cursor-pointer"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                Try again
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IconAction(props: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  accent?: boolean;
  children: React.ReactNode;
}) {
  const tone = props.danger
    ? "border-red-500/30 text-red-400 hover:bg-red-500/10"
    : props.accent
      ? "border-[#E11D48]/40 text-[#E11D48] hover:bg-[#E11D48]/10"
      : "border-[#27272a] text-[#a1a1aa] hover:text-white hover:bg-[#27272a]";
  return (
    <button
      type="button"
      title={props.title}
      aria-label={props.title}
      onClick={props.onClick}
      disabled={props.disabled}
      className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${tone}`}
    >
      {props.children}
    </button>
  );
}

function ModeChip({ mode }: { mode: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#27272a]/60 border border-[#3f3f46] text-[9px] font-bold uppercase text-[#a1a1aa]">
      {mode === "lyric" ? <Music className="w-2.5 h-2.5" /> : <Quote className="w-2.5 h-2.5" />}
      {mode}
    </span>
  );
}

function ConfirmDialog(props: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={props.busy ? undefined : props.onCancel} />
      <div className="relative w-full max-w-[380px] bg-[#18181b] border border-[#27272a] rounded-xl p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[13px] font-bold text-white">{props.title}</h3>
          <button
            type="button"
            onClick={props.onCancel}
            disabled={props.busy}
            title="Close"
            aria-label="Close"
            className="w-6 h-6 flex items-center justify-center text-[#71717a] hover:text-white transition-colors cursor-pointer disabled:opacity-40 flex-shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-[11px] text-[#a1a1aa] leading-relaxed">{props.body}</p>
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={props.onCancel}
            disabled={props.busy}
            className="px-3 py-1.5 bg-[#27272a] hover:bg-[#3f3f46] disabled:opacity-40 text-white text-[11px] font-semibold rounded-lg transition-colors cursor-pointer"
          >
            Keep
          </button>
          <button
            type="button"
            onClick={props.onConfirm}
            disabled={props.busy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 disabled:opacity-40 text-red-400 text-[11px] font-bold rounded-lg transition-colors cursor-pointer"
          >
            {props.busy && <Loader2 className="w-3 h-3 animate-spin" />}
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function BatchStatusChip({ status, live }: { status: string; live?: { position: number; totalInBatch: number } | null }) {
  const cls =
    status === "COMPLETED"
      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
      : status === "FAILED"
        ? "bg-red-500/10 text-red-400 border-red-500/20"
        : status === "RENDERING" || status === "QUEUED"
          ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
          : "bg-[#27272a]/50 text-[#a1a1aa] border-[#3f3f46]";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[9px] font-bold uppercase ${cls}`}>
      {status === "RENDERING" && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
      {status}
      {live && status === "RENDERING" && (
        <span className="normal-case font-mono text-amber-300/90">{live.position}/{live.totalInBatch}</span>
      )}
    </span>
  );
}

// ── Batch status view (per-video workspace: preview, queue control, cleanup) ──

interface StatusItem {
  id: string;
  status: string; // PENDING | RENDERING | COMPLETED | FAILED | CANCELED
  error: string | null;
  outputRef: string | null;
  quoteText: string | null;
  distributedAt: string | null;
  distributedToAccountId: string | null;
  distributedToAccount: { id: string; tiktokUsername: string; color: string | null } | null;
  track: { id: string; title: string; artist: string | null } | null;
  style: { id: string; name: string; thumbnail: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

interface StatusBatch {
  id: string;
  name: string;
  mode: string;
  status: string;
  errorMessage: string | null;
  sourceFolderId: string | null;
  campaign: { id: string; title: string } | null;
  styles: { id: string; name: string; thumbnail: string | null }[];
  items: StatusItem[];
  createdAt: string;
  updatedAt: string;
}

type ItemFilter = "all" | "COMPLETED" | "FAILED" | "PENDING" | "RENDERING" | "CANCELED";

const ITEM_FILTERS: { key: ItemFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "COMPLETED", label: "Completed" },
  { key: "FAILED", label: "Failed" },
  { key: "PENDING", label: "Queued" },
  { key: "RENDERING", label: "Rendering" },
  { key: "CANCELED", label: "Canceled" },
];

function isTerminalItemStatus(status: string) {
  return status === "COMPLETED" || status === "FAILED" || status === "CANCELED";
}

function BatchStatusView(props: { batchId: string; onNewBatch: () => void; onShowHistory: () => void }) {
  const { batchId, onNewBatch, onShowHistory } = props;
  const [batch, setBatch] = useState<StatusBatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [retryingItemId, setRetryingItemId] = useState<string | null>(null);

  // Global render queue
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [queueBusy, setQueueBusy] = useState(false);

  // Item filter / selection / preview
  const [filter, setFilter] = useState<ItemFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewItem, setPreviewItem] = useState<StatusItem | null>(null);

  // Confirm dialog (cancel batch / delete items)
  const [confirm, setConfirm] = useState<{
    title: string;
    body: string;
    confirmLabel: string;
    action: () => Promise<void>;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Distribute state
  const [panelOpen, setPanelOpen] = useState(false);
  const [assignments, setAssignments] = useState<FactoryAccountSelection[]>([]);
  const [allowRedistribute, setAllowRedistribute] = useState(false);
  const [distributing, setDistributing] = useState(false);
  const [distributeResult, setDistributeResult] = useState<DistributeResult | null>(null);

  // Smart Download state
  const [dlStatus, setDlStatus] = useState<DownloadStatus | null>(null);
  const [dlStarting, setDlStarting] = useState(false);

  // ── Loading ──

  const fetchBatch = useCallback(async (mode: "initial" | "poll" = "poll") => {
    if (mode === "initial") setLoading(true);
    try {
      const res = await fetch(`/api/factory/batches/${batchId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load batch");
      setBatch(data.batch);
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err.message || "Failed to load batch");
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch("/api/factory/queue");
      if (res.ok) setQueue(await res.json());
    } catch {
      // transient — next tick retries
    }
  }, []);

  useEffect(() => {
    fetchBatch("initial");
  }, [fetchBatch]);

  // Poll the batch detail only while items are still in flight.
  const hasActiveItems = !!batch && batch.items.some((i) => i.status === "PENDING" || i.status === "RENDERING");
  useEffect(() => {
    if (!hasActiveItems) return;
    const t = setInterval(() => fetchBatch(), 5000);
    return () => clearInterval(t);
  }, [hasActiveItems, fetchBatch]);

  // Live queue state while the view is open.
  useEffect(() => {
    fetchQueue();
    const t = setInterval(fetchQueue, 5000);
    return () => clearInterval(t);
  }, [fetchQueue]);

  // Poll Smart Download status while preparing.
  useEffect(() => {
    if (!dlStatus || dlStatus.status !== "PREPARING") return;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/factory/batches/${batchId}/download`);
        if (res.ok) setDlStatus(await res.json());
      } catch {
        // transient — next tick retries
      }
    }, 3000);
    return () => clearInterval(t);
  }, [batchId, dlStatus]);

  // Prune selections for items that disappeared.
  useEffect(() => {
    if (!batch) return;
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const ids = new Set(batch.items.map((i) => i.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [batch]);

  // Close the preview if its item vanished or is no longer playable.
  useEffect(() => {
    if (previewItem && batch && !batch.items.some((i) => i.id === previewItem.id && i.status === "COMPLETED")) {
      setPreviewItem(null);
    }
  }, [batch, previewItem]);

  // ── Derived ──

  const counts = useMemo(() => {
    const c = { completed: 0, failed: 0, rendering: 0, pending: 0, canceled: 0 };
    if (!batch) return c;
    for (const i of batch.items) {
      if (i.status === "COMPLETED") c.completed++;
      else if (i.status === "FAILED") c.failed++;
      else if (i.status === "RENDERING") c.rendering++;
      else if (i.status === "PENDING") c.pending++;
      else if (i.status === "CANCELED") c.canceled++;
    }
    return c;
  }, [batch]);

  const filterCounts = useMemo(() => {
    const c: Record<ItemFilter, number> = {
      all: batch?.items.length ?? 0,
      COMPLETED: 0,
      FAILED: 0,
      PENDING: 0,
      RENDERING: 0,
      CANCELED: 0,
    };
    if (batch) {
      for (const i of batch.items) {
        if (i.status === "COMPLETED") c.COMPLETED++;
        else if (i.status === "FAILED") c.FAILED++;
        else if (i.status === "PENDING") c.PENDING++;
        else if (i.status === "RENDERING") c.RENDERING++;
        else if (i.status === "CANCELED") c.CANCELED++;
      }
    }
    return c;
  }, [batch]);

  const filteredItems = useMemo(() => {
    if (!batch) return [] as StatusItem[];
    if (filter === "all") return batch.items;
    return batch.items.filter((i) => i.status === filter);
  }, [batch, filter]);

  // ── Actions ──

  const handleQueueControl = async (action: "pause" | "resume" | "recover") => {
    if (queueBusy) return;
    setQueueBusy(true);
    try {
      const res = await fetch("/api/factory/queue/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Queue control failed");
      // The control endpoint returns a partial state — merge, the 5s poll refills the rest.
      if (data.state) setQueue((prev) => (prev ? { ...prev, ...data.state } : data.state));
      if (action === "recover") {
        toast.success(data.recovered > 0 ? `Recovered ${data.recovered} stuck items` : "No stuck items to recover");
        fetchBatch();
        fetchQueue();
      } else {
        toast.success(action === "pause" ? "Queue paused" : "Queue resumed");
      }
    } catch (err: any) {
      toast.error(err.message || "Queue control failed");
    } finally {
      setQueueBusy(false);
    }
  };

  const doCancel = async () => {
    setCanceling(true);
    try {
      const res = await fetch(`/api/factory/batches/${batchId}/cancel`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Cancel failed");
      toast.success(data.canceled > 0 ? `Canceled — ${data.canceled} pending items stopped` : "Batch canceled");
      fetchBatch();
      fetchQueue();
    } catch (err: any) {
      toast.error(err.message || "Cancel failed");
    } finally {
      setCanceling(false);
    }
  };

  const handleRetryItem = async (itemId: string) => {
    if (retryingItemId) return;
    setRetryingItemId(itemId);
    try {
      const res = await fetch(`/api/factory/items/${itemId}/retry`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Retry failed");
      fetchBatch();
    } catch (err: any) {
      toast.error(err.message || "Retry failed");
    } finally {
      setRetryingItemId(null);
    }
  };

  const handleRetryFailed = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      const res = await fetch(`/api/factory/batches/${batchId}/retry-failed`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Retry failed");
      toast.success(data.retried > 0 ? `Re-queued ${data.retried} items` : "No failed items to retry");
      fetchBatch();
    } catch (err: any) {
      toast.error(err.message || "Retry failed");
    } finally {
      setRetrying(false);
    }
  };

  const doDeleteItems = async (itemIds: string[]) => {
    try {
      const res = await fetch("/api/factory/items/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      const deleted = data.deletedItems ?? itemIds.length;
      const skipped = data.skipped ?? 0;
      toast.success(
        `Deleted ${deleted} ${deleted === 1 ? "video" : "videos"}${skipped > 0 ? ` — ${skipped} skipped (still active)` : ""}`
      );
      setSelectedIds((prev) => {
        const next = new Set(prev);
        itemIds.forEach((id) => next.delete(id));
        return next;
      });
      fetchBatch();
    } catch (err: any) {
      toast.error(err.message || "Delete failed");
    }
  };

  const handleConfirm = async () => {
    if (!confirm || confirmBusy) return;
    setConfirmBusy(true);
    await confirm.action();
    setConfirmBusy(false);
    setConfirm(null);
  };

  const handleDistribute = async () => {
    if (distributing || assignments.length === 0) return;
    setDistributing(true);
    setDistributeResult(null);
    try {
      const res = await fetch(`/api/factory/batches/${batchId}/distribute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignments: assignments.map((a) => ({ accountId: a.accountId, videoCount: a.count })),
          allowRedistribute,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Distribution failed");
      const result = data.result as DistributeResult;
      setDistributeResult(result);
      const uploaded = result.results.reduce((s, r) => s + r.uploaded, 0);
      const failed = result.results.reduce((s, r) => s + r.failed, 0);
      toast.success(`Distributed ${uploaded} videos${failed > 0 ? ` — ${failed} failed` : ""}`);
      setPanelOpen(false);
      setAssignments([]);
      fetchBatch();
    } catch (err: any) {
      toast.error(err.message || "Distribution failed");
    } finally {
      setDistributing(false);
    }
  };

  const handleStartDownload = async () => {
    if (dlStarting) return;
    setDlStarting(true);
    try {
      const res = await fetch(`/api/factory/batches/${batchId}/download`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to prepare download");
      setDlStatus(data as DownloadStatus);
    } catch (err: any) {
      toast.error(err.message || "Failed to prepare download");
    } finally {
      setDlStarting(false);
    }
  };

  // ── States ──

  if (loading && !batch) {
    return (
      <div className="p-4 md:p-6 max-w-[1100px] mx-auto space-y-4 animate-pulse">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-2">
            <div className="h-5 w-64 max-w-full bg-[#27272a] rounded" />
            <div className="h-3 w-80 max-w-full bg-[#27272a] rounded" />
          </div>
          <div className="flex items-center gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-8 w-24 bg-[#27272a] rounded-lg" />
            ))}
          </div>
        </div>
        <div className="h-1.5 w-full bg-[#27272a] rounded-full" />
        <div className="bg-[#18181b] border border-[#27272a] rounded-xl overflow-hidden divide-y divide-[#27272a]">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="px-4 py-3 flex items-center gap-3">
              <div className="w-3.5 h-3.5 bg-[#27272a] rounded" />
              <div className="h-4 w-[72px] bg-[#27272a] rounded-md" />
              <div className="flex-1 h-3 bg-[#27272a] rounded" />
              <div className="h-6 w-20 bg-[#27272a] rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (loadError && !batch) {
    return (
      <div className="p-4 md:p-6 max-w-[1100px] mx-auto">
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[11px] text-red-400 font-semibold flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {loadError}
          </p>
          <button
            type="button"
            onClick={() => fetchBatch("initial")}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#27272a] hover:bg-[#3f3f46] text-white text-[11px] font-semibold rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!batch) return null;

  const total = batch.items.length;
  const distributedCount = batch.items.filter((i) => i.distributedAt).length;
  const undistributedCompleted = counts.completed - distributedCount;
  const inFlight = counts.pending + counts.rendering;
  const donePct = total > 0 ? (counts.completed / total) * 100 : 0;
  const failPct = total > 0 ? (counts.failed / total) * 100 : 0;
  const live =
    queue?.active && queue.active.batchId === batch.id
      ? { position: queue.active.position, totalInBatch: queue.active.totalInBatch }
      : null;
  const allVisibleSelected = filteredItems.length > 0 && filteredItems.every((i) => selectedIds.has(i.id));

  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) filteredItems.forEach((i) => next.delete(i.id));
      else filteredItems.forEach((i) => next.add(i.id));
      return next;
    });
  };

  // ── Render ──

  return (
    <div className="p-4 md:p-6 max-w-[1100px] mx-auto space-y-4">
      {/* Header block + global actions */}
      <div className="space-y-2.5">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-bold text-white tracking-tight truncate max-w-[420px]" title={batch.name}>
                {batch.name}
              </h1>
              <ModeChip mode={batch.mode} />
              <BatchStatusChip status={batch.status} live={live} />
              {queue?.paused && (
                <span className="px-2 py-0.5 rounded-md border bg-amber-500/10 text-amber-400 border-amber-500/20 text-[9px] font-bold uppercase">
                  Queue paused
                </span>
              )}
            </div>
            <p className="text-[10px] text-[#71717a] mt-1.5 flex items-center gap-1.5 flex-wrap">
              {batch.campaign && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-[#27272a]/60 border border-[#3f3f46] text-[9px] font-semibold text-[#a1a1aa]">
                  {batch.campaign.title}
                </span>
              )}
              {batch.sourceFolderId && (
                <span className="font-mono" title={`Source folder: ${batch.sourceFolderId}`}>
                  src {batch.sourceFolderId.slice(0, 10)}…
                </span>
              )}
              <span title={new Date(batch.createdAt).toLocaleString()}>created {fmtRelative(batch.createdAt)}</span>
              <span title={new Date(batch.updatedAt).toLocaleString()}>· updated {fmtRelative(batch.updatedAt)}</span>
            </p>
          </div>

          {/* Global actions */}
          <div className="flex items-center gap-2 flex-wrap">
            {queue && queue.staleRendering > 0 && (
              <button
                type="button"
                onClick={() => handleQueueControl("recover")}
                disabled={queueBusy}
                title="Reset items stuck in RENDERING back to the queue"
                className="flex items-center gap-1.5 px-3 py-2 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 disabled:opacity-40 text-amber-400 text-[11px] font-bold rounded-lg transition-colors cursor-pointer"
              >
                {queueBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertTriangle className="w-3 h-3" />}
                Recover {queue.staleRendering} stuck
              </button>
            )}
            <button
              type="button"
              onClick={() => handleQueueControl(queue?.paused ? "resume" : "pause")}
              disabled={queueBusy || !queue}
              title={queue?.paused ? "Resume the render queue" : "Pause the render queue (running items finish)"}
              className="flex items-center gap-1.5 px-3 py-2 bg-[#27272a] hover:bg-[#3f3f46] disabled:opacity-40 text-white text-[11px] font-semibold rounded-lg transition-colors cursor-pointer"
            >
              {queueBusy ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : queue?.paused ? (
                <Play className="w-3 h-3" />
              ) : (
                <Pause className="w-3 h-3" />
              )}
              {queue?.paused ? "Resume queue" : "Pause queue"}
            </button>
            {isActiveStatus(batch.status) && (
              <button
                type="button"
                onClick={() =>
                  setConfirm({
                    title: `Cancel "${batch.name}"?`,
                    body: "Pending items are stopped and the queue moves on. Videos already rendered are kept.",
                    confirmLabel: "Cancel batch",
                    action: doCancel,
                  })
                }
                disabled={canceling}
                title="Stop pending items — rendered videos are kept"
                className="flex items-center gap-1.5 px-3 py-2 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 disabled:opacity-40 text-red-400 text-[11px] font-bold rounded-lg transition-colors cursor-pointer"
              >
                {canceling ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />}
                Cancel batch
              </button>
            )}
            {counts.failed > 0 && (
              <button
                type="button"
                onClick={handleRetryFailed}
                disabled={retrying}
                className="flex items-center gap-1.5 px-3 py-2 bg-[#27272a] hover:bg-[#3f3f46] disabled:opacity-40 text-white text-[11px] font-semibold rounded-lg transition-colors cursor-pointer"
              >
                {retrying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Retry failed ({counts.failed})
              </button>
            )}
            {counts.completed > 0 && (
              <>
                <button
                  type="button"
                  onClick={handleStartDownload}
                  disabled={dlStarting || dlStatus?.status === "PREPARING"}
                  title="Smart Download — one archive of the pool"
                  className="flex items-center gap-1.5 px-3 py-2 bg-[#27272a] hover:bg-[#3f3f46] disabled:opacity-40 text-white text-[11px] font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  {dlStarting || dlStatus?.status === "PREPARING" ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Download className="w-3 h-3" />
                  )}
                  Smart Download
                </button>
                <button
                  type="button"
                  onClick={() => setPanelOpen(true)}
                  title="Smart Export — distribute the pool to accounts"
                  className="flex items-center gap-1.5 px-3 py-2 bg-[#E11D48] hover:bg-[#be123c] text-white text-[11px] font-bold rounded-lg transition-colors cursor-pointer"
                >
                  <Users className="w-3.5 h-3.5" />
                  Smart Export{undistributedCompleted > 0 ? ` (${undistributedCompleted})` : ""}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onShowHistory}
              className="flex items-center gap-1.5 px-3 py-2 bg-[#27272a] hover:bg-[#3f3f46] text-white text-[11px] font-semibold rounded-lg transition-colors cursor-pointer"
            >
              <History className="w-3 h-3" />
              History
            </button>
            <button
              type="button"
              onClick={onNewBatch}
              className="px-3 py-2 bg-[#27272a] hover:bg-[#3f3f46] text-white text-[11px] font-semibold rounded-lg transition-colors cursor-pointer"
            >
              New batch
            </button>
          </div>
        </div>

        {/* Two-segment progress + counts */}
        <div className="flex items-center gap-2.5">
          <div className="flex-1 h-1.5 bg-[#27272a] rounded-full overflow-hidden flex">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${donePct}%` }} />
            <div className="h-full bg-red-500 transition-all" style={{ width: `${failPct}%` }} />
          </div>
          <p className="text-[10px] font-mono text-[#a1a1aa] whitespace-nowrap flex-shrink-0">
            <span className="text-emerald-400">{counts.completed}</span>/{total}
            {counts.failed > 0 && <span className="text-red-400"> · {counts.failed} failed</span>}
            {counts.canceled > 0 && <span className="text-[#71717a]"> · {counts.canceled} canceled</span>}
            {inFlight > 0 && <span> · {inFlight} queued</span>}
            {distributedCount > 0 && <span className="text-[#71717a]"> · {distributedCount} distributed</span>}
          </p>
        </div>

        {batch.errorMessage && (
          <p className="text-[10px] text-red-400 flex items-start gap-1.5">
            <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
            {batch.errorMessage}
          </p>
        )}
      </div>

      {batch.status === "COMPLETED" && (
        <div className="text-[11px] text-green-400 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2 flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
          Batch rendered. Distribute the pool to accounts or grab it as one archive with Smart Download.
        </div>
      )}

      {/* Smart Download status */}
      {dlStatus && (
        <div className="bg-[#18181b] border border-[#27272a] rounded-xl px-4 py-3">
          {dlStatus.status === "PREPARING" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[#a1a1aa] flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {dlStatus.message || "Preparing archive…"}
                </span>
                <span className="font-mono text-[#71717a]">{dlStatus.progress}%</span>
              </div>
              <div className="h-1 bg-[#27272a] rounded-full overflow-hidden">
                <div className="h-full bg-[#E11D48] transition-all" style={{ width: `${dlStatus.progress}%` }} />
              </div>
            </div>
          )}
          {dlStatus.status === "COMPLETED" && dlStatus.downloadUrl && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-[11px] text-green-400 flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                Archive ready — {dlStatus.completedCount} videos · {fmtBytes(dlStatus.size)}
              </p>
              <a
                href={dlStatus.downloadUrl}
                download
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#E11D48] hover:bg-[#be123c] text-white text-[11px] font-bold rounded-lg transition-colors"
              >
                <Download className="w-3 h-3" />
                Download archive
              </a>
            </div>
          )}
          {dlStatus.status === "FAILED" && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-[11px] text-red-400 flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {dlStatus.message || "Archive preparation failed"}
              </p>
              <button
                type="button"
                onClick={handleStartDownload}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#27272a] hover:bg-[#3f3f46] text-white text-[11px] font-semibold rounded-lg transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                Try again
              </button>
            </div>
          )}
        </div>
      )}

      {/* Distribute result summary */}
      {distributeResult && (
        <div className="bg-[#18181b] border border-[#27272a] rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#27272a] flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#71717a]">Last distribution</p>
            <p className="text-[10px] font-mono text-[#a1a1aa]">
              {distributeResult.results.reduce((s, r) => s + r.uploaded, 0)} uploaded of {distributeResult.poolSize} in pool
            </p>
          </div>
          <div className="divide-y divide-[#27272a]">
            {distributeResult.warnings.map((w, i) => (
              <p key={i} className="px-4 py-2 text-[10px] text-amber-400 flex items-start gap-1.5">
                <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                {w}
              </p>
            ))}
            {distributeResult.results.map((r) => (
              <div key={r.accountId} className="px-4 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-white">@{r.tiktokUsername}</span>
                  <span className={`text-[10px] font-mono ${r.failed > 0 ? "text-amber-400" : "text-green-400"}`}>
                    {r.uploaded}/{r.assigned} uploaded
                    {r.failed > 0 ? ` · ${r.failed} failed` : ""}
                    {r.deliveryId ? " · delivery recorded" : ""}
                  </span>
                </div>
                {r.warnings.map((w, i) => (
                  <p key={i} className="text-[10px] text-amber-400 mt-0.5 flex items-start gap-1.5">
                    <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                    {w}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Item workspace */}
      <div className="bg-[#18181b] border border-[#27272a] rounded-xl overflow-hidden">
        {/* Toolbar — status filters + select-all */}
        <div className="px-4 py-2.5 border-b border-[#27272a] flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            {ITEM_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors cursor-pointer border ${
                  filter === f.key
                    ? "bg-[#E11D48] border-[#E11D48] text-white"
                    : "bg-[#09090b] border-[#27272a] text-[#a1a1aa] hover:text-white hover:border-[#3f3f46]"
                }`}
              >
                {f.label}
                <span className={filter === f.key ? "text-white/70" : "text-[#71717a]"}> · {filterCounts[f.key]}</span>
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none flex-shrink-0" title="Select all visible items">
            <span className="text-[10px] text-[#71717a]">All visible</span>
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleSelectAllVisible}
              disabled={filteredItems.length === 0}
              aria-label="Select all visible items"
              className="accent-[#E11D48] w-3.5 h-3.5 cursor-pointer disabled:opacity-40"
            />
          </label>
        </div>

        {/* Bulk bar */}
        {selectedIds.size > 0 && (
          <div className="px-4 py-2 border-b border-[#27272a] bg-[#E11D48]/5 flex items-center gap-2.5 flex-wrap">
            <span className="text-[11px] text-[#e4e4e7] font-semibold whitespace-nowrap">{selectedIds.size} selected</span>
            <div className="w-px h-4 bg-[#27272a]" />
            <button
              type="button"
              onClick={() =>
                setConfirm({
                  title: `Delete ${selectedIds.size} ${selectedIds.size === 1 ? "video" : "videos"}?`,
                  body: "The selected items and their rendered files are removed. Items still rendering are skipped. This cannot be undone.",
                  confirmLabel: "Delete selected",
                  action: () => doDeleteItems([...selectedIds]),
                })
              }
              className="flex items-center gap-1.5 px-2.5 py-1 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 text-red-400 text-[10px] font-bold rounded-lg transition-colors cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
              Delete selected ({selectedIds.size})
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="flex items-center gap-1 px-2 py-1 text-[#a1a1aa] hover:text-white text-[10px] font-semibold rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          </div>
        )}

        {/* Rows */}
        <div className="divide-y divide-[#27272a] max-h-[560px] overflow-y-auto custom-scrollbar">
          {filteredItems.map((item) => {
            const selected = selectedIds.has(item.id);
            return (
              <div key={item.id} className={`px-4 py-2 flex items-center gap-3 transition-colors ${selected ? "bg-[#E11D48]/5" : ""}`}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() =>
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(item.id)) next.delete(item.id);
                      else next.add(item.id);
                      return next;
                    })
                  }
                  aria-label={`Select item ${item.id}`}
                  className="accent-[#E11D48] w-3.5 h-3.5 flex-shrink-0 cursor-pointer"
                />
                <ItemStatusChip status={item.status} />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-[#e4e4e7] truncate">
                    <span className="text-[#a1a1aa]">{item.style?.name || "no style"}</span>
                    <span className="text-[#3f3f46]">{" · "}</span>
                    {item.track
                      ? `${item.track.title}${item.track.artist ? ` — ${item.track.artist}` : ""}`
                      : item.quoteText || "—"}
                  </p>
                  {item.status === "FAILED" && item.error && (
                    <p className="text-[9px] text-red-400 truncate mt-0.5" title={item.error}>
                      {item.error}
                    </p>
                  )}
                </div>
                {item.distributedToAccount && (
                  <span
                    className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#27272a]/60 border border-[#3f3f46] text-[9px] font-semibold text-[#a1a1aa] whitespace-nowrap flex-shrink-0"
                    title={item.distributedAt ? `Distributed ${new Date(item.distributedAt).toLocaleString()}` : "Distributed"}
                  >
                    {item.distributedToAccount.color && (
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: item.distributedToAccount.color }}
                      />
                    )}
                    → @{item.distributedToAccount.tiktokUsername}
                  </span>
                )}
                <span
                  className="text-[9px] font-mono text-[#71717a] whitespace-nowrap flex-shrink-0"
                  title={new Date(item.updatedAt).toLocaleString()}
                >
                  {fmtRelative(item.updatedAt)}
                </span>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {item.status === "COMPLETED" && item.outputRef && (
                    <IconAction title="Preview render" onClick={() => setPreviewItem(item)}>
                      <Eye className="w-3.5 h-3.5" />
                    </IconAction>
                  )}
                  {item.status === "FAILED" && (
                    <IconAction
                      title="Retry this item"
                      onClick={() => handleRetryItem(item.id)}
                      disabled={retryingItemId === item.id}
                    >
                      {retryingItemId === item.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                    </IconAction>
                  )}
                  {isTerminalItemStatus(item.status) && (
                    <IconAction
                      title="Delete this video"
                      danger
                      onClick={() =>
                        setConfirm({
                          title: "Delete this video?",
                          body: "The item and its rendered file are removed. This cannot be undone.",
                          confirmLabel: "Delete video",
                          action: () => doDeleteItems([item.id]),
                        })
                      }
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </IconAction>
                  )}
                </div>
              </div>
            );
          })}
          {total === 0 && (
            <p className="px-4 py-10 text-center text-[11px] text-[#71717a]">No items yet — this batch is still a draft.</p>
          )}
          {total > 0 && filteredItems.length === 0 && (
            <div className="px-4 py-10 text-center">
              <p className="text-[11px] text-[#71717a]">No items with this status.</p>
              <button
                type="button"
                onClick={() => setFilter("all")}
                className="mt-3 px-3 py-1.5 bg-[#27272a] hover:bg-[#3f3f46] text-white text-[11px] font-semibold rounded-lg transition-colors cursor-pointer"
              >
                Show all
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Distribute slide-over */}
      <FactoryAccountsPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        selected={assignments}
        onChange={setAssignments}
      />
      {panelOpen && (
        <div className="fixed inset-x-0 bottom-0 z-[60] flex justify-center pointer-events-none">
          <div className="pointer-auto w-full max-w-[560px] bg-[#18181b] border border-[#27272a] border-b-0 rounded-t-xl px-4 py-3 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-[#a1a1aa]">
                <span className="font-bold text-white">{assignments.reduce((s, a) => s + a.count, 0)}</span> videos
                requested · <span className="font-bold text-white">{undistributedCompleted}</span> undistributed in pool
              </p>
              <button
                type="button"
                onClick={handleDistribute}
                disabled={distributing || assignments.length === 0}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#E11D48] hover:bg-[#be123c] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-bold rounded-lg transition-colors cursor-pointer flex-shrink-0"
              >
                {distributing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Users className="w-3 h-3" />}
                Distribute
              </button>
            </div>
            {distributedCount > 0 && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={allowRedistribute}
                  onChange={(e) => setAllowRedistribute(e.target.checked)}
                  className="accent-[#E11D48] w-3.5 h-3.5"
                />
                <span className="text-[10px] text-[#a1a1aa]">
                  Re-distribute — include the {distributedCount} already-distributed videos
                </span>
              </label>
            )}
          </div>
        </div>
      )}

      {/* Confirm dialog (cancel batch / delete items) */}
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ""}
        body={confirm?.body ?? ""}
        confirmLabel={confirm?.confirmLabel ?? "Confirm"}
        busy={confirmBusy}
        onConfirm={handleConfirm}
        onCancel={() => setConfirm(null)}
      />

      {/* Video preview modal */}
      {previewItem && <ItemPreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />}
    </div>
  );
}

function ItemStatusChip({ status }: { status: string }) {
  const cls =
    status === "COMPLETED"
      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
      : status === "FAILED"
        ? "bg-red-500/10 text-red-400 border-red-500/20"
        : status === "RENDERING"
          ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
          : "bg-[#27272a]/50 text-[#a1a1aa] border-[#3f3f46]";
  return (
    <span
      className={`inline-flex items-center justify-center gap-1 w-[72px] px-1.5 py-0.5 rounded-md border text-[8px] font-bold uppercase flex-shrink-0 ${cls}`}
    >
      {status === "RENDERING" && <span className="w-1 h-1 rounded-full bg-amber-400 animate-pulse" />}
      {status === "PENDING" ? "Queued" : status}
    </span>
  );
}

function ItemPreviewModal({ item, onClose }: { item: StatusItem; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div className="relative flex flex-col items-center gap-2 max-w-full">
        <button
          type="button"
          onClick={onClose}
          title="Close preview"
          aria-label="Close preview"
          className="absolute -top-2 -right-2 z-10 w-7 h-7 flex items-center justify-center bg-[#18181b] border border-[#27272a] hover:border-[#3f3f46] text-[#a1a1aa] hover:text-white rounded-full transition-colors cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
        <video
          src={`/api${item.outputRef}`}
          controls
          autoPlay
          playsInline
          className="h-[80vh] max-w-[92vw] aspect-[9/16] rounded-xl border border-[#27272a] bg-black"
        />
        <p className="text-[10px] text-[#a1a1aa] text-center truncate max-w-[80vw]">
          {item.style?.name || "no style"}
          {item.track
            ? ` · ${item.track.title}${item.track.artist ? ` — ${item.track.artist}` : ""}`
            : item.quoteText
              ? ` · ${item.quoteText}`
              : ""}
        </p>
      </div>
    </div>
  );
}
