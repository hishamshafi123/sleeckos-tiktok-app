"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Factory,
  FileText,
  History,
  Layers,
  Loader2,
  Music,
  Play,
  Quote,
  RefreshCw,
  Shuffle,
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

interface PreviewAccountResult {
  accountId: string;
  tiktokUsername: string;
  videoCount: number;
  filesNeeded: number;
  availableUnused: number;
  exhausted: boolean;
  hasInputFolder: boolean;
  hasOutputFolder: boolean;
  isActive: boolean;
  warnings: string[];
}

interface PreviewResult {
  totalVideos: number;
  totalFilesNeeded: number;
  stylesCount: number;
  estimatedSeconds: number;
  accounts: PreviewAccountResult[];
  warnings: string[];
  canRender: boolean;
}

interface BatchListRow {
  id: string;
  name: string;
  mode: string;
  status: string;
  createdAt: string;
  itemCounts: { total: number; pending: number; rendering: number; completed: number; failed: number };
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
  { n: 4, label: "Output" },
];

function fmtMinutes(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  return m < 60 ? `≈ ${m} min` : `≈ ${Math.floor(m / 60)}h ${m % 60}m`;
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
  const [mode, setMode] = useState<FactoryMode>("lyric");
  const [factoryTracks, setFactoryTracks] = useState<FactoryTrackRow[]>([]);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>([]);
  const [quotesText, setQuotesText] = useState("");
  const [styles, setStyles] = useState<SavedStyleRow[]>([]);
  const [stylesLoading, setStylesLoading] = useState(false);
  const [selectedStyleIds, setSelectedStyleIds] = useState<string[]>([]);
  const [accountsPanelOpen, setAccountsPanelOpen] = useState(false);
  const [assignments, setAssignments] = useState<FactoryAccountSelection[]>([]);

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
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to create batch");
    setBatchId(data.batch.id);
    setBatchDirty(false);
    return data.batch.id as string;
  };

  const renderPoolPayload = () => ({
    assignments: assignments.map((a) => ({ accountId: a.accountId, videoCount: a.count })),
    trackIds: mode === "lyric" ? selectedTrackIds : undefined,
    quotes: mode === "quote" ? parsedQuotes : undefined,
    allowReuseWhenExhausted: allowReuse,
  });

  const runPreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const id = await ensureBatch();
      const res = await fetch(`/api/factory/batches/${id}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(renderPoolPayload()),
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
  }, [batchId, batchDirty, name, mode, mixingEnabled, variationStrength, targetDuration, campaignId, selectedStyleIds, assignments, selectedTrackIds, parsedQuotes, allowReuse]);

  // Auto pre-flight on step 4 (debounced against selection changes).
  useEffect(() => {
    if (step !== 4 || assignments.length === 0) return;
    if (mode === "lyric" && selectedTrackIds.length === 0) return;
    if (mode === "quote" && parsedQuotes.length === 0) return;
    if (selectedStyleIds.length === 0) return;
    const t = setTimeout(() => runPreview(), 400);
    return () => clearTimeout(t);
  }, [step, assignments, selectedTrackIds, parsedQuotes, allowReuse, selectedStyleIds, mode, runPreview]);

  const handleRender = async () => {
    if (!preview?.canRender || rendering) return;
    setRendering(true);
    try {
      const id = await ensureBatch();
      const res = await fetch(`/api/factory/batches/${id}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(renderPoolPayload()),
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
    setSelectedTrackIds([]);
    setQuotesText("");
    setSelectedStyleIds([]);
    setAssignments([]);
    resetBatchLinkage();
    setStatusBatchId(null);
    setView("wizard");
  };

  // ── Step validation ──

  const step1Valid = name.trim().length > 0 && targetDuration >= 5 && targetDuration <= 600;
  const step2Valid = mode === "lyric" ? selectedTrackIds.length > 0 : parsedQuotes.length > 0;
  const step3Valid = selectedStyleIds.length > 0;
  const step4Ready = assignments.length > 0 && !!preview?.canRender && !previewLoading;

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
              Mass-produce lyric & quote videos straight into each account&apos;s posting folder.
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
        <BatchHistoryList
          onOpenBatch={(id) => setStatusBatchId(id)}
        />
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
                      Campaign (optional — adds “(Campaign)” to file names)
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
                    Background clips are picked from each account&apos;s input Drive folder <b className="text-white">unused-first</b>,
                    so nothing repeats until the pool runs dry. When an account runs out of unused clips, pre-flight
                    stops with a warning — sync more clips, or allow least-recently-used clips to repeat.
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
                      the overlay carries the video. Fewer quotes than videos means quotes repeat across accounts.
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
                  <p className="text-[10px] text-[#71717a]">Styles distribute round-robin across each account&apos;s videos</p>
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

            {/* ── Step 4: Output & Accounts ── */}
            {step === 4 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="text-[12px] font-semibold text-white">
                      {assignments.length === 0
                        ? "No accounts selected yet"
                        : `${assignments.length} accounts · ${assignments.reduce((s, a) => s + a.count, 0)} videos`}
                    </p>
                    <p className="text-[10px] text-[#71717a]">
                      Finished videos land in each account&apos;s output Drive folder; deliveries are recorded automatically.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAccountsPanelOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-[#E11D48] hover:bg-[#be123c] text-white text-[11px] font-bold rounded-lg transition-colors cursor-pointer"
                  >
                    <Users className="w-3.5 h-3.5" />
                    Select accounts
                  </button>
                </div>

                {assignments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {assignments.map((a) => (
                      <span
                        key={a.accountId}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-[#27272a] bg-[#09090b] text-[10px] font-medium text-[#e4e4e7]"
                      >
                        @{a.username}
                        <span className="font-mono text-[#71717a]">×{a.count}</span>
                        <button
                          type="button"
                          onClick={() => setAssignments((prev) => prev.filter((x) => x.accountId !== a.accountId))}
                          className="text-[#71717a] hover:text-white transition-colors cursor-pointer"
                          title="Remove"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Pre-flight summary card */}
                {assignments.length > 0 && (
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
                            { label: "Source clips needed", value: String(preview.totalFilesNeeded) },
                            { label: "Styles", value: String(preview.stylesCount) },
                            { label: "Estimated time", value: fmtMinutes(preview.estimatedSeconds), icon: true },
                          ].map((c) => (
                            <div key={c.label} className="bg-[#18181b] border border-[#27272a] rounded-lg px-3 py-2">
                              <p className="text-[9px] uppercase font-bold text-[#71717a] flex items-center gap-1">
                                {c.icon && <Clock className="w-2.5 h-2.5" />}
                                {c.label}
                              </p>
                              <p className="text-sm font-bold text-white">{c.value}</p>
                            </div>
                          ))}
                        </div>

                        <div className="divide-y divide-[#18181b] border border-[#27272a] rounded-lg overflow-hidden">
                          {preview.accounts.map((a) => (
                            <div key={a.accountId} className="px-3 py-2 bg-[#09090b]">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-semibold text-white">@{a.tiktokUsername}</span>
                                <span
                                  className={`text-[10px] font-mono ${
                                    a.exhausted ? "text-amber-400" : "text-green-400"
                                  }`}
                                >
                                  {a.videoCount} videos · needs {a.filesNeeded} clips · {a.availableUnused} unused
                                  {a.exhausted ? " — exhausted" : ""}
                                </span>
                              </div>
                              {a.warnings.map((w, i) => (
                                <p key={i} className="text-[10px] text-amber-400 mt-1 flex items-start gap-1.5">
                                  <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                                  {w}
                                </p>
                              ))}
                            </div>
                          ))}
                        </div>

                        {preview.warnings.map((w, i) => (
                          <p key={i} className="text-[10px] text-amber-400 flex items-start gap-1.5">
                            <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                            {w}
                          </p>
                        ))}
                      </>
                    )}
                  </div>
                )}
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
            {step === 4 && assignments.length > 0 && preview && !preview.canRender && !previewLoading && (
              <p className="text-[10px] text-red-400 text-right mt-2">
                Pre-flight is blocking the render — resolve the warnings above or adjust the selection.
              </p>
            )}
          </div>
        </>
      )}

      <FactoryAccountsPanel
        open={accountsPanelOpen}
        onClose={() => setAccountsPanelOpen(false)}
        selected={assignments}
        onChange={setAssignments}
      />
    </div>
  );
}

// ── Batch history ────────────────────────────────────────────────────────────

function BatchHistoryList({ onOpenBatch }: { onOpenBatch: (id: string) => void }) {
  const [batches, setBatches] = useState<BatchListRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/factory/batches");
        if (res.ok) {
          const data = await res.json();
          setBatches(data.batches || []);
        } else {
          toast.error("Failed to load batches");
        }
      } catch {
        toast.error("Failed to load batches");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-[#71717a]">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (batches.length === 0) {
    return (
      <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-12 text-center">
        <History className="w-8 h-8 text-[#3f3f46] mx-auto mb-3" />
        <p className="text-[12px] text-[#71717a]">No factory batches yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-[#18181b] border border-[#27272a] rounded-xl divide-y divide-[#27272a] overflow-hidden">
      {batches.map((b) => (
        <button
          key={b.id}
          type="button"
          onClick={() => onOpenBatch(b.id)}
          className="w-full flex items-center gap-4 px-4 py-3 hover:bg-[#09090b] transition-colors cursor-pointer text-left"
        >
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-white truncate">{b.name}</p>
            <p className="text-[10px] text-[#71717a]">
              {b.mode} · {new Date(b.createdAt).toLocaleString()}
            </p>
          </div>
          <div className="flex items-center gap-3 text-[10px] font-mono flex-shrink-0">
            <span className="text-green-400">{b.itemCounts.completed} done</span>
            {b.itemCounts.failed > 0 && <span className="text-red-400">{b.itemCounts.failed} failed</span>}
            {b.itemCounts.pending + b.itemCounts.rendering > 0 && (
              <span className="text-[#a1a1aa]">{b.itemCounts.pending + b.itemCounts.rendering} queued</span>
            )}
            <BatchStatusChip status={b.status} />
          </div>
        </button>
      ))}
    </div>
  );
}

function BatchStatusChip({ status }: { status: string }) {
  const cls =
    status === "COMPLETED"
      ? "bg-green-500/10 text-green-400 border-green-500/20"
      : status === "FAILED"
        ? "bg-red-500/10 text-red-400 border-red-500/20"
        : status === "RENDERING" || status === "QUEUED"
          ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
          : "bg-[#27272a]/50 text-[#a1a1aa] border-[#3f3f46]";
  return <span className={`px-2 py-0.5 rounded-md border text-[9px] font-bold uppercase ${cls}`}>{status}</span>;
}

// ── Batch status view (per-item progress + retries) ─────────────────────────

interface StatusItem {
  id: string;
  accountId: string | null;
  status: string;
  error: string | null;
  outputRef: string | null;
  quoteText: string | null;
  account: { id: string; tiktokUsername: string; tiktokDisplayName: string; color: string } | null;
  track: { id: string; title: string; artist: string | null } | null;
  style: { id: string; name: string } | null;
}

interface StatusBatch {
  id: string;
  name: string;
  mode: string;
  status: string;
  campaign: { id: string; title: string } | null;
  items: StatusItem[];
}

function BatchStatusView(props: { batchId: string; onNewBatch: () => void; onShowHistory: () => void }) {
  const { batchId, onNewBatch, onShowHistory } = props;
  const [batch, setBatch] = useState<StatusBatch | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const fetchBatch = useCallback(async () => {
    try {
      const res = await fetch(`/api/factory/batches/${batchId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load batch");
      setBatch(data.batch);
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err.message || "Failed to load batch");
    }
  }, [batchId]);

  useEffect(() => {
    fetchBatch();
    const t = setInterval(fetchBatch, 4000);
    return () => clearInterval(t);
  }, [fetchBatch]);

  const handleRetryItem = async (itemId: string) => {
    try {
      const res = await fetch(`/api/factory/items/${itemId}/retry`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Retry failed");
      }
      fetchBatch();
    } catch (err: any) {
      toast.error(err.message || "Retry failed");
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

  if (loadError && !batch) {
    return (
      <div className="p-6 max-w-[1100px] mx-auto">
        <div className="text-[11px] text-red-400 font-semibold bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {loadError}
        </div>
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="flex items-center justify-center py-24 text-[#71717a]">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  const counts = {
    completed: batch.items.filter((i) => i.status === "COMPLETED").length,
    failed: batch.items.filter((i) => i.status === "FAILED").length,
    rendering: batch.items.filter((i) => i.status === "RENDERING").length,
    pending: batch.items.filter((i) => i.status === "PENDING").length,
  };
  const active = counts.pending + counts.rendering > 0 || batch.status === "QUEUED" || batch.status === "RENDERING";

  const byAccount = new Map<string, StatusItem[]>();
  for (const item of batch.items) {
    const key = item.account?.tiktokUsername || "unknown";
    const list = byAccount.get(key) ?? [];
    list.push(item);
    byAccount.set(key, list);
  }

  return (
    <div className="p-4 md:p-6 max-w-[1100px] mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg font-bold text-white tracking-tight">{batch.name}</h1>
            <BatchStatusChip status={batch.status} />
          </div>
          <p className="text-[11px] text-[#71717a] mt-0.5">
            {batch.mode}
            {batch.campaign ? ` · ${batch.campaign.title}` : ""} · {counts.completed}/{batch.items.length} videos done
            {counts.failed > 0 ? ` · ${counts.failed} failed` : ""}
            {active ? " · rendering…" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
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
          <button
            type="button"
            onClick={onShowHistory}
            className="px-3 py-2 bg-[#27272a] hover:bg-[#3f3f46] text-white text-[11px] font-semibold rounded-lg transition-colors cursor-pointer"
          >
            History
          </button>
          <button
            type="button"
            onClick={onNewBatch}
            className="px-3 py-2 bg-[#E11D48] hover:bg-[#be123c] text-white text-[11px] font-bold rounded-lg transition-colors cursor-pointer"
          >
            New batch
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-[#27272a] rounded-full overflow-hidden">
        <div
          className={`h-full transition-all ${counts.failed > 0 && counts.completed === 0 ? "bg-red-500" : "bg-[#E11D48]"}`}
          style={{ width: `${batch.items.length > 0 ? Math.round(((counts.completed + counts.failed) / batch.items.length) * 100) : 0}%` }}
        />
      </div>

      {batch.status === "COMPLETED" && (
        <div className="text-[11px] text-green-400 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2 flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
          Batch finished. Deliveries were recorded per account — track them in the Distribution tracker.
        </div>
      )}

      {/* Per-account item groups */}
      <div className="space-y-3">
        {[...byAccount.entries()].map(([username, items]) => (
          <div key={username} className="bg-[#18181b] border border-[#27272a] rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#27272a] flex items-center justify-between">
              <p className="text-[12px] font-bold text-white">@{username}</p>
              <p className="text-[10px] font-mono text-[#71717a]">
                {items.filter((i) => i.status === "COMPLETED").length}/{items.length} done
              </p>
            </div>
            <div className="divide-y divide-[#27272a]">
              {items.map((item) => (
                <div key={item.id} className="px-4 py-2 flex items-center gap-3">
                  <ItemStatusDot status={item.status} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-[#e4e4e7] truncate">
                      {item.track ? `${item.track.title}${item.track.artist ? ` — ${item.track.artist}` : ""}` : item.quoteText || "—"}
                    </p>
                    <p className="text-[9px] font-mono text-[#71717a] truncate">
                      {item.style?.name || "no style"}
                      {item.outputRef ? ` · ${item.outputRef}` : ""}
                    </p>
                    {item.status === "FAILED" && item.error && (
                      <p className="text-[9px] text-red-400 truncate mt-0.5" title={item.error}>
                        {item.error}
                      </p>
                    )}
                  </div>
                  {item.status === "FAILED" && (
                    <button
                      type="button"
                      onClick={() => handleRetryItem(item.id)}
                      className="flex items-center gap-1 px-2 py-1 bg-[#27272a] hover:bg-[#3f3f46] text-white text-[10px] font-semibold rounded-md transition-colors cursor-pointer flex-shrink-0"
                    >
                      <RefreshCw className="w-2.5 h-2.5" />
                      Retry
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        {batch.items.length === 0 && (
          <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-10 text-center">
            <p className="text-[11px] text-[#71717a]">No items yet — this batch is still a draft.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ItemStatusDot({ status }: { status: string }) {
  if (status === "COMPLETED") return <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />;
  if (status === "FAILED") return <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />;
  if (status === "RENDERING") return <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin flex-shrink-0" />;
  return <Clock className="w-3.5 h-3.5 text-[#71717a] flex-shrink-0" />;
}
