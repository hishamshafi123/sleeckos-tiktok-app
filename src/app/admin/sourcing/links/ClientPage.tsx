"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  History,
  Link2,
  Loader2,
  RotateCcw,
  Search,
  Send,
  Users,
  XCircle,
} from "lucide-react";
import AccountSelectorPanel, { AccountSelectorSelection } from "@/components/AccountSelectorPanel";

// ── API types (defensive: backend built in parallel) ─────────────────────────

type ParsedValid = { url: string; normalizedUrl: string; videoId: string; alreadyUsed: boolean };
type ParsedInvalid = { url: string; reason: string };
type ParseResult = { valid: ParsedValid[]; invalid: ParsedInvalid[]; newCount: number; dupCount: number };

type Assignment = {
  id: string;
  accountId?: string;
  status: string;
  error?: string | null;
  uploadedAt?: string | null;
  tiktokUsername?: string | null;
  account?: { id?: string; tiktokUsername?: string } | null;
  driveFolderName?: string | null;
};

type VideoMeta = { author?: string; title?: string; resolution?: string };

type RunVideo = {
  id: string;
  sourceUrl?: string;
  url?: string;
  normalizedUrl?: string;
  videoId?: string | null;
  status: string;
  error?: string | null;
  durationSec?: number | null;
  sizeBytes?: number | null;
  meta?: VideoMeta | null;
  width?: number | null;
  height?: number | null;
  authorUsername?: string | null;
  assignments?: Assignment[];
};

type RunDetail = {
  id: string;
  createdAt: string;
  status?: string;
  linkCount?: number;
  videos?: RunVideo[];
  statusCounts?: Record<string, number>;
};

type RunSummary = {
  id: string;
  createdAt: string;
  status?: string;
  linkCount?: number;
  statusCounts?: Record<string, number>;
};

type Feasibility = {
  available: number;
  requested: number;
  shortfall: { accountId: string; missing: number }[];
  ok: boolean;
};

type UrlHistoryItem = {
  id?: string;
  sourceUrl?: string;
  url?: string;
  normalizedUrl?: string;
  status?: string;
  createdAt?: string;
  assignments?: Assignment[];
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const norm = (s?: string | null) => (s || "").toUpperCase();
const isQueued = (s?: string | null) => ["QUEUED", "PENDING"].includes(norm(s));
const isDownloading = (s?: string | null) => ["DOWNLOADING", "PROCESSING", "ACTIVE", "RUNNING"].includes(norm(s));
const isDownloaded = (s?: string | null) => ["DOWNLOADED", "COMPLETED", "DONE", "READY", "ASSIGNED", "UPLOADED"].includes(norm(s));
const isFailed = (s?: string | null) => ["FAILED", "ERROR"].includes(norm(s));
const isUploading = (s?: string | null) => ["UPLOADING", "QUEUED", "PENDING", "PROCESSING"].includes(norm(s));
const isUploaded = (s?: string | null) => ["UPLOADED", "COMPLETED", "DONE"].includes(norm(s));

function formatDuration(sec?: number | null): string | null {
  if (sec == null || !isFinite(sec)) return null;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatSize(bytes?: number | null): string | null {
  if (bytes == null || !isFinite(bytes) || bytes <= 0) return null;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function videoUrl(v: RunVideo): string {
  return v.sourceUrl || v.url || v.normalizedUrl || "";
}

function videoMeta(v: RunVideo): string {
  const parts: string[] = [];
  const dur = formatDuration(v.durationSec);
  if (dur) parts.push(dur);
  const resolution = v.meta?.resolution || (v.width && v.height ? `${v.width}×${v.height}` : null);
  if (resolution) parts.push(resolution);
  const size = formatSize(v.sizeBytes);
  if (size) parts.push(size);
  const author = v.meta?.author || v.authorUsername;
  if (author) parts.push(author.startsWith("@") ? author : `@${author}`);
  return parts.join(" · ");
}

function assignmentAccountName(a: Assignment, nameById?: Map<string, string>): string {
  return (
    a.tiktokUsername ||
    a.account?.tiktokUsername ||
    (a.accountId ? nameById?.get(a.accountId) : undefined) ||
    (a.accountId ? a.accountId.slice(0, 8) : "—")
  );
}

function StepCard(props: {
  n: number;
  title: string;
  icon: React.ReactNode;
  hint?: string;
  locked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`bg-[#18181b] border border-[#27272a] rounded-xl overflow-hidden ${props.locked ? "opacity-60" : ""}`}
      aria-label={`Step ${props.n}: ${props.title}`}
    >
      <header className="flex items-center gap-3 px-4 py-3 border-b border-[#27272a]">
        <span className="w-6 h-6 rounded-md bg-[#E11D48] text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0">
          {props.n}
        </span>
        <span className="text-[#a1a1aa]">{props.icon}</span>
        <h2 className="text-sm font-bold text-white">{props.title}</h2>
        {props.hint && <p className="text-[10px] text-[#71717a] ml-auto text-right">{props.hint}</p>}
      </header>
      <div className="p-4">{props.children}</div>
    </section>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function LinkSourcingClientPage() {
  // Step 1 — paste & parse
  const [pasteText, setPasteText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [startingRun, setStartingRun] = useState(false);

  // Step 2 — run + downloads
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [retryingVideoId, setRetryingVideoId] = useState<string | null>(null);
  const [retryingAll, setRetryingAll] = useState(false);

  // Step 3 — accounts
  const [selected, setSelected] = useState<AccountSelectorSelection[]>([]);

  // Step 4 — preview & distribute
  const [allowReuse, setAllowReuse] = useState(false);
  const [acceptShortfall, setAcceptShortfall] = useState(false);
  const [previewResult, setPreviewResult] = useState<{ key: string; feasibility: Feasibility } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [distributing, setDistributing] = useState(false);
  const [distributed, setDistributed] = useState(false);
  const [retryingAssignmentId, setRetryingAssignmentId] = useState<string | null>(null);

  // Step 5 — history & URL search
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [expandedRun, setExpandedRun] = useState<RunDetail | null>(null);
  const [expandedLoading, setExpandedLoading] = useState(false);
  const [urlQuery, setUrlQuery] = useState("");
  const [urlResults, setUrlResults] = useState<UrlHistoryItem[]>([]);
  const [urlSearching, setUrlSearching] = useState(false);
  const [urlSearched, setUrlSearched] = useState(false);

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Data fetching ──

  const fetchRun = useCallback(async (id: string): Promise<RunDetail | null> => {
    try {
      const res = await fetch(`/api/sourcing/links/runs/${id}`);
      if (!res.ok) return null;
      const data = await res.json();
      const detail: RunDetail = data.run ?? data;
      setRun(detail);
      return detail;
    } catch {
      return null;
    }
  }, []);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/sourcing/links/runs");
      if (!res.ok) return;
      const data = await res.json();
      const list: RunSummary[] = Array.isArray(data) ? data : data.runs ?? [];
      setRuns(list);
    } catch {
      // keep stale list
    } finally {
      setRunsLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => fetchRuns(), 0);
    return () => clearTimeout(t);
  }, [fetchRuns]);

  const videos = run?.videos ?? [];
  const downloadedCount = videos.filter((v) => isDownloaded(v.status)).length;
  const failedVideos = videos.filter((v) => isFailed(v.status));
  const downloadsActive = videos.some((v) => isQueued(v.status) || isDownloading(v.status));

  const allAssignments: { video: RunVideo; assignment: Assignment }[] = videos.flatMap((v) =>
    (v.assignments ?? []).map((a) => ({ video: v, assignment: a }))
  );

  // Poll every 3s while downloads or uploads are active.
  useEffect(() => {
    if (!runId) return;
    let stopped = false;
    const tick = async () => {
      const detail = await fetchRun(runId);
      if (stopped) return;
      if (!detail) {
        pollTimerRef.current = setTimeout(tick, 3000);
        return;
      }
      const vids = detail.videos ?? [];
      const dActive = vids.some((v) => isQueued(v.status) || isDownloading(v.status));
      const uActive = vids.some((v) => (v.assignments ?? []).some((a) => isUploading(a.status)));
      if (dActive || uActive) {
        pollTimerRef.current = setTimeout(tick, 3000);
      } else {
        fetchRuns();
      }
    };
    tick();
    return () => {
      stopped = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [runId, distributed, fetchRun, fetchRuns]);

  // ── Step 1: parse & start run ──

  const handleParse = async () => {
    if (!pasteText.trim() || parsing) return;
    setParsing(true);
    setParsed(null);
    try {
      const res = await fetch("/api/sourcing/links/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pasteText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Parse failed");
      setParsed(data as ParseResult);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to parse links");
    } finally {
      setParsing(false);
    }
  };

  const newLinks = parsed ? parsed.valid.filter((v) => !v.alreadyUsed) : [];
  const alreadyUsedCount = parsed ? parsed.valid.length - newLinks.length : 0;

  const handleStartRun = async () => {
    if (newLinks.length === 0 || startingRun) return;
    setStartingRun(true);
    try {
      const res = await fetch("/api/sourcing/links/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links: newLinks.map((v) => v.normalizedUrl || v.url) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start run");
      setRunId(data.runId);
      setRun(null);
      setDistributed(false);
      setPreviewResult(null);
      setAcceptShortfall(false);
      toast.success(`Run started — ${newLinks.length} link${newLinks.length === 1 ? "" : "s"} queued`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start run");
    } finally {
      setStartingRun(false);
    }
  };

  // ── Step 2: retries ──

  const handleRetryVideo = async (videoId: string) => {
    if (retryingVideoId) return;
    setRetryingVideoId(videoId);
    try {
      const res = await fetch(`/api/sourcing/links/videos/${videoId}/retry`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Retry failed");
      if (runId) fetchRun(runId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetryingVideoId(null);
    }
  };

  const handleRetryAllFailed = async () => {
    if (!runId || retryingAll) return;
    setRetryingAll(true);
    try {
      const res = await fetch(`/api/sourcing/links/runs/${runId}/retry-failed`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Retry failed");
      toast.success("Failed downloads re-queued");
      fetchRun(runId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetryingAll(false);
    }
  };

  // ── Step 4: preview & distribute ──

  const accountCounts = selected.map((s) => ({ accountId: s.accountId, count: s.count }));
  const requestedTotal = selected.reduce((sum, s) => sum + s.count, 0);

  // Feasibility is keyed to its inputs so stale results are ignored automatically.
  const previewKey = `${runId}|${distributed}|${downloadedCount}|${allowReuse}|${JSON.stringify(accountCounts)}`;
  const feasibility = previewResult && previewResult.key === previewKey ? previewResult.feasibility : null;

  useEffect(() => {
    if (!runId || distributed || downloadedCount === 0 || selected.length === 0) return;
    const t = setTimeout(async () => {
      setPreviewing(true);
      try {
        const res = await fetch(`/api/sourcing/links/runs/${runId}/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountCounts, allowReuse }),
        });
        const data = await res.json();
        if (res.ok && data.feasibility) setPreviewResult({ key: previewKey, feasibility: data.feasibility as Feasibility });
      } catch {
        // leave feasibility null — distribute will surface errors
      } finally {
        setPreviewing(false);
      }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, selected.length]);

  const infeasible = feasibility ? !feasibility.ok : false;
  const canDistribute =
    !!runId &&
    !distributed &&
    !distributing &&
    !downloadsActive &&
    downloadedCount > 0 &&
    selected.length > 0 &&
    requestedTotal > 0 &&
    (!infeasible || (allowReuse && acceptShortfall));

  const handleDistribute = async () => {
    if (!runId || !canDistribute) return;
    setDistributing(true);
    try {
      const res = await fetch(`/api/sourcing/links/runs/${runId}/distribute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountCounts, allowReuse }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Distribution failed");
      setDistributed(true);
      toast.success("Distribution started — uploading to Drive folders");
      fetchRun(runId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Distribution failed");
    } finally {
      setDistributing(false);
    }
  };

  const handleRetryAssignment = async (assignmentId: string) => {
    if (retryingAssignmentId) return;
    setRetryingAssignmentId(assignmentId);
    try {
      const res = await fetch(`/api/sourcing/links/assignments/${assignmentId}/retry`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Retry failed");
      if (runId) fetchRun(runId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetryingAssignmentId(null);
    }
  };

  // ── Step 5: history & URL search ──

  const toggleHistoryRun = async (id: string) => {
    if (expandedRunId === id) {
      setExpandedRunId(null);
      setExpandedRun(null);
      return;
    }
    setExpandedRunId(id);
    setExpandedRun(null);
    setExpandedLoading(true);
    try {
      const res = await fetch(`/api/sourcing/links/runs/${id}`);
      if (res.ok) {
        const data = await res.json();
        setExpandedRun(data.run ?? data);
      }
    } catch {
      toast.error("Failed to load run details");
    } finally {
      setExpandedLoading(false);
    }
  };

  useEffect(() => {
    const q = urlQuery.trim();
    const t = setTimeout(async () => {
      if (!q) {
        setUrlResults([]);
        setUrlSearched(false);
        return;
      }
      setUrlSearching(true);
      try {
        const res = await fetch(`/api/sourcing/links/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data = await res.json();
          setUrlResults(Array.isArray(data) ? data : data.results ?? []);
        }
        setUrlSearched(true);
      } catch {
        setUrlSearched(true);
      } finally {
        setUrlSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [urlQuery]);

  // Account-id → username lookup from the current selection (assignments only carry accountId).
  const nameById = new Map(selected.map((s) => [s.accountId, s.username]));

  // Per-account upload summary for the active run.
  const accountSummary = new Map<string, { name: string; folder: string | null; uploaded: number; failed: number; pending: number }>();
  for (const { assignment: a } of allAssignments) {
    const key = a.accountId || assignmentAccountName(a, nameById);
    const entry = accountSummary.get(key) ?? {
      name: assignmentAccountName(a, nameById),
      folder: a.driveFolderName ?? null,
      uploaded: 0,
      failed: 0,
      pending: 0,
    };
    if (isUploaded(a.status)) entry.uploaded += 1;
    else if (isFailed(a.status)) entry.failed += 1;
    else entry.pending += 1;
    if (!entry.folder && a.driveFolderName) entry.folder = a.driveFolderName;
    accountSummary.set(key, entry);
  }

  const runTotalCount = (r: RunSummary): number =>
    r.linkCount ?? Object.values(r.statusCounts ?? {}).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#E11D48]/15 border border-[#E11D48]/30 flex items-center justify-center">
            <Link2 className="w-5 h-5 text-[#E11D48]" />
          </div>
          Bulk Link Sourcing
        </h1>
        <p className="text-[#71717a] mt-1 text-sm">
          Paste TikTok links → download → distribute to account Drive folders.
        </p>
      </div>

      {/* ── Step 1: Paste links ── */}
      <StepCard n={1} title="Paste links" icon={<Link2 className="w-4 h-4" />} hint="One TikTok URL per line (spaces and commas also work)">
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          rows={6}
          placeholder={"https://www.tiktok.com/@user/video/1234567890\nhttps://www.tiktok.com/@user/video/0987654321\n…"}
          className="w-full bg-[#09090b] border border-[#27272a] rounded-lg px-3 py-2 text-white placeholder-[#52525b] text-xs font-mono focus:outline-none focus:border-[#E11D48] resize-y"
          aria-label="TikTok links"
        />
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleParse}
            disabled={parsing || !pasteText.trim()}
            className="px-4 py-2 bg-[#27272a] hover:bg-[#3f3f46] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-2"
          >
            {parsing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            Parse
          </button>
          {parsed && (
            <>
              <span className="px-2.5 py-1 rounded-md bg-green-500/10 border border-green-500/30 text-green-400 text-[11px] font-semibold">
                {parsed.newCount} new
              </span>
              {alreadyUsedCount > 0 && (
                <span className="px-2.5 py-1 rounded-md bg-[#27272a] border border-[#3f3f46] text-[#a1a1aa] text-[11px] font-semibold">
                  {alreadyUsedCount} already downloaded
                </span>
              )}
              {parsed.dupCount > 0 && (
                <span className="px-2.5 py-1 rounded-md bg-[#27272a] border border-[#3f3f46] text-[#a1a1aa] text-[11px] font-semibold">
                  {parsed.dupCount} duplicate{parsed.dupCount === 1 ? "" : "s"} in paste
                </span>
              )}
              {parsed.invalid.length > 0 && (
                <span className="px-2.5 py-1 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-[11px] font-semibold">
                  {parsed.invalid.length} invalid
                </span>
              )}
              <button
                type="button"
                onClick={handleStartRun}
                disabled={startingRun || newLinks.length === 0}
                className="ml-auto px-4 py-2 bg-[#E11D48] hover:bg-[#be123c] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-2"
              >
                {startingRun ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                Start run — {newLinks.length} link{newLinks.length === 1 ? "" : "s"}
              </button>
            </>
          )}
        </div>

        {parsed && (
          <div className="mt-3 bg-[#09090b] border border-[#27272a] rounded-lg divide-y divide-[#27272a] max-h-64 overflow-y-auto custom-scrollbar">
            {parsed.valid.map((v, i) => (
              <div key={`v-${i}`} className={`flex items-center gap-2 px-3 py-1.5 text-[11px] ${v.alreadyUsed ? "opacity-50" : ""}`}>
                {v.alreadyUsed ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#71717a] flex-shrink-0" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                )}
                <span className="text-[#e4e4e7] font-mono truncate flex-1 min-w-0" title={v.url}>
                  {v.url}
                </span>
                {v.alreadyUsed ? (
                  <span className="text-[#71717a] italic flex-shrink-0">used before</span>
                ) : (
                  <span className="text-[#71717a] font-mono flex-shrink-0">{v.videoId}</span>
                )}
              </div>
            ))}
            {parsed.invalid.map((v, i) => (
              <div key={`i-${i}`} className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
                <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                <span className="text-[#e4e4e7] font-mono truncate flex-1 min-w-0" title={v.url}>
                  {v.url}
                </span>
                <span className="text-red-400 flex-shrink-0" title={v.reason}>
                  {v.reason}
                </span>
              </div>
            ))}
            {parsed.valid.length === 0 && parsed.invalid.length === 0 && (
              <p className="px-3 py-2 text-[11px] text-[#71717a] italic">No links found in the pasted text.</p>
            )}
          </div>
        )}
      </StepCard>

      {/* ── Step 2: Downloads ── */}
      <StepCard
        n={2}
        title="Downloads"
        icon={<Download className="w-4 h-4" />}
        hint={runId ? `${downloadedCount}/${videos.length} downloaded · updates every 3s` : "Start a run in step 1"}
      >
        {!runId ? (
          <p className="text-[11px] text-[#71717a] italic">No active run — parse links above and start a run to see download progress here.</p>
        ) : !run ? (
          <div className="flex items-center gap-2 text-[#71717a] text-[11px]">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading run…
          </div>
        ) : (
          <>
            {failedVideos.length > 0 && !downloadsActive && (
              <div className="mb-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRetryAllFailed}
                  disabled={retryingAll}
                  className="px-3 py-1.5 bg-[#27272a] hover:bg-[#3f3f46] disabled:opacity-40 text-white text-[11px] font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  {retryingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                  Retry all failed ({failedVideos.length})
                </button>
              </div>
            )}
            <div className="bg-[#09090b] border border-[#27272a] rounded-lg divide-y divide-[#27272a] max-h-80 overflow-y-auto custom-scrollbar">
              {videos.length === 0 ? (
                <p className="px-3 py-2 text-[11px] text-[#71717a] italic">No videos in this run yet.</p>
              ) : (
                videos.map((v) => {
                  const meta = videoMeta(v);
                  const failReason = v.error;
                  const url = videoUrl(v);
                  return (
                    <div key={v.id} className="flex items-center gap-2 px-3 py-2 text-[11px]">
                      {isQueued(v.status) && <span className="w-3.5 h-3.5 rounded-full border border-[#3f3f46] flex-shrink-0" title="Queued" />}
                      {isDownloading(v.status) && <Loader2 className="w-3.5 h-3.5 text-[#E11D48] animate-spin flex-shrink-0" />}
                      {isDownloaded(v.status) && <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />}
                      {isFailed(v.status) && <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
                      {!isQueued(v.status) && !isDownloading(v.status) && !isDownloaded(v.status) && !isFailed(v.status) && (
                        <Loader2 className="w-3.5 h-3.5 text-[#71717a] animate-spin flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-[#e4e4e7] font-mono truncate" title={url}>
                          {url}
                        </p>
                        {isDownloaded(v.status) && meta && <p className="text-[#71717a] text-[10px] mt-0.5">{meta}</p>}
                        {isFailed(v.status) && (
                          <p className="text-red-400 text-[10px] mt-0.5" title={failReason || "Download failed"}>
                            {failReason || "Download failed"}
                          </p>
                        )}
                      </div>
                      <span className="text-[10px] text-[#71717a] capitalize flex-shrink-0">{norm(v.status).toLowerCase() || "unknown"}</span>
                      {isFailed(v.status) && (
                        <button
                          type="button"
                          onClick={() => handleRetryVideo(v.id)}
                          disabled={retryingVideoId === v.id}
                          className="px-2 py-1 bg-[#27272a] hover:bg-[#3f3f46] disabled:opacity-40 text-white text-[10px] font-semibold rounded transition-colors cursor-pointer flex items-center gap-1 flex-shrink-0"
                        >
                          {retryingVideoId === v.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                          Retry
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </StepCard>

      {/* ── Step 3: Accounts ── */}
      <StepCard
        n={3}
        title="Accounts"
        icon={<Users className="w-4 h-4" />}
        hint={selected.length > 0 ? `${selected.length} accounts · ${requestedTotal} videos requested` : "Pick destination accounts"}
      >
        {downloadedCount === 0 ? (
          <p className="text-[11px] text-[#71717a] italic">Available once at least one video has downloaded.</p>
        ) : (
          <AccountSelectorPanel
            variant="inline"
            title="Destination accounts"
            subtitle="Click, drag across, shift-click a range, or paste a list. Red accounts and folders without a linked account are excluded."
            emptyMessage="No accounts with a connected Drive folder."
            selected={selected}
            onChange={setSelected}
            disableRow={(row) => (!row.driveFolderId ? "Account has no connected Drive folder" : null)}
          />
        )}
      </StepCard>

      {/* ── Step 4: Preview & run ── */}
      <StepCard n={4} title="Preview & distribute" icon={<Send className="w-4 h-4" />} hint="Check feasibility, then upload to Drive">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={allowReuse}
            onChange={(e) => setAllowReuse(e.target.checked)}
            className="accent-[#E11D48] w-3.5 h-3.5"
          />
          <span className="text-[11px] text-[#e4e4e7] font-medium">Allow same video on multiple accounts</span>
          <span title="Posting the same video to multiple accounts can trigger TikTok duplicate-content detection and reduce reach.">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          </span>
        </label>

        <div className="mt-3 bg-[#09090b] border border-[#27272a] rounded-lg p-3 text-[11px]">
          {selected.length === 0 ? (
            <p className="text-[#71717a] italic">Select accounts in step 3 to preview feasibility.</p>
          ) : previewing && !feasibility ? (
            <p className="text-[#71717a] flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking feasibility…
            </p>
          ) : feasibility ? (
            <div className="space-y-2">
              <p className="text-[#e4e4e7]">
                <span className="font-bold text-white">{feasibility.available}</span> available ·{" "}
                <span className="font-bold text-white">{feasibility.requested}</span> requested
                {feasibility.ok ? (
                  <span className="ml-2 text-green-400 font-semibold">— feasible</span>
                ) : (
                  <span className="ml-2 text-amber-400 font-semibold">— shortfall</span>
                )}
              </p>
              {feasibility.shortfall.length > 0 && (
                <div className="space-y-1">
                  {feasibility.shortfall.map((s) => {
                    const acc = selected.find((x) => x.accountId === s.accountId);
                    return (
                      <p key={s.accountId} className="flex items-center gap-1.5 text-amber-400">
                        <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                        @{acc?.username ?? s.accountId.slice(0, 8)} is short {s.missing} video{s.missing === 1 ? "" : "s"}
                      </p>
                    );
                  })}
                  {allowReuse && (
                    <label className="flex items-center gap-2 cursor-pointer select-none pt-1">
                      <input
                        type="checkbox"
                        checked={acceptShortfall}
                        onChange={(e) => setAcceptShortfall(e.target.checked)}
                        className="accent-amber-400 w-3.5 h-3.5"
                      />
                      <span className="text-amber-400">Accept shortfall — some accounts will receive fewer videos than requested</span>
                    </label>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-[#71717a] italic">Feasibility unavailable — distribution will validate again.</p>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={handleDistribute}
            disabled={!canDistribute}
            title={
              distributed
                ? "Already distributed"
                : selected.length === 0
                  ? "Select accounts first"
                  : infeasible && !(allowReuse && acceptShortfall)
                    ? "Infeasible — adjust counts or accept the shortfall"
                    : "Upload videos to the selected Drive folders"
            }
            className="px-4 py-2 bg-[#E11D48] hover:bg-[#be123c] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-2"
          >
            {distributing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {distributed ? "Distributed" : `Distribute ${requestedTotal} video${requestedTotal === 1 ? "" : "s"}`}
          </button>
          {downloadsActive && <p className="text-[10px] text-[#71717a]">Waiting for downloads to finish…</p>}
        </div>

        {distributed && (
          <div className="mt-3 bg-[#09090b] border border-[#27272a] rounded-lg divide-y divide-[#27272a] max-h-72 overflow-y-auto custom-scrollbar">
            {allAssignments.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-[#71717a] italic flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Waiting for assignments…
              </p>
            ) : (
              allAssignments.map(({ video, assignment: a }) => (
                <div key={a.id} className="flex items-center gap-2 px-3 py-2 text-[11px]">
                  {isUploading(a.status) && <Loader2 className="w-3.5 h-3.5 text-[#E11D48] animate-spin flex-shrink-0" />}
                  {isUploaded(a.status) && <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />}
                  {isFailed(a.status) && <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-[#e4e4e7] truncate">
                      <span className="font-semibold">@{assignmentAccountName(a, nameById)}</span>
                      {a.driveFolderName && <span className="text-[#71717a]"> → {a.driveFolderName}</span>}
                    </p>
                    <p className="text-[#71717a] font-mono text-[10px] truncate" title={videoUrl(video)}>
                      {videoUrl(video)}
                    </p>
                    {isFailed(a.status) && a.error && (
                      <p className="text-red-400 text-[10px] mt-0.5" title={a.error}>
                        {a.error}
                      </p>
                    )}
                  </div>
                  {isFailed(a.status) && (
                    <button
                      type="button"
                      onClick={() => handleRetryAssignment(a.id)}
                      disabled={retryingAssignmentId === a.id}
                      className="px-2 py-1 bg-[#27272a] hover:bg-[#3f3f46] disabled:opacity-40 text-white text-[10px] font-semibold rounded transition-colors cursor-pointer flex items-center gap-1 flex-shrink-0"
                    >
                      {retryingAssignmentId === a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                      Retry
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </StepCard>

      {/* ── Step 5: Summary + history ── */}
      <StepCard n={5} title="Summary & history" icon={<History className="w-4 h-4" />} hint="Per-account results and previous runs">
        {distributed && accountSummary.size > 0 && (
          <div className="mb-4">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-[#71717a] mb-2">This run</h3>
            <div className="flex flex-wrap gap-1.5">
              {[...accountSummary.entries()].map(([key, s]) => (
                <div key={key} className="px-2.5 py-1.5 rounded-md bg-[#09090b] border border-[#27272a] text-[11px]">
                  <span className="text-white font-semibold">@{s.name}</span>
                  {s.folder && <span className="text-[#71717a]"> · {s.folder}</span>}
                  <span className="text-green-400 font-semibold"> · {s.uploaded} uploaded</span>
                  {s.failed > 0 && <span className="text-red-400 font-semibold"> · {s.failed} failed</span>}
                  {s.pending > 0 && <span className="text-[#71717a]"> · {s.pending} pending</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Source URL search */}
        <div className="relative mb-4">
          <Search className="w-3.5 h-3.5 text-[#71717a] absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={urlQuery}
            onChange={(e) => setUrlQuery(e.target.value)}
            placeholder="Search source URL history (e.g. a TikTok username or video id)…"
            className="w-full bg-[#09090b] border border-[#27272a] rounded-lg pl-8 pr-3 py-1.5 text-white placeholder-[#71717a] text-[11px] focus:outline-none focus:border-[#E11D48]"
            aria-label="Search source URL history"
          />
        </div>
        {urlQuery.trim() && (
          <div className="mb-4 bg-[#09090b] border border-[#27272a] rounded-lg divide-y divide-[#27272a] max-h-56 overflow-y-auto custom-scrollbar">
            {urlSearching ? (
              <p className="px-3 py-2 text-[11px] text-[#71717a] flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching…
              </p>
            ) : urlResults.length === 0 && urlSearched ? (
              <p className="px-3 py-2 text-[11px] text-[#71717a] italic">No history matches “{urlQuery.trim()}”.</p>
            ) : (
              urlResults.map((item, i) => {
                const itemUrl = item.sourceUrl || item.url || item.normalizedUrl || "—";
                const folders = Array.from(
                  new Set((item.assignments ?? []).map((a) => a.driveFolderName).filter((f): f is string => !!f))
                );
                return (
                  <div key={item.id ?? i} className="px-3 py-2 text-[11px]">
                    <p className="text-[#e4e4e7] font-mono truncate" title={itemUrl}>
                      {itemUrl}
                    </p>
                    <p className="text-[#71717a] text-[10px] mt-0.5">
                      {formatDate(item.createdAt)}
                      {item.status && <span className="capitalize"> · {item.status}</span>}
                      {folders.length > 0 && ` · ${folders.slice(0, 3).join(", ")}${folders.length > 3 ? ", …" : ""}`}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Runs history */}
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-[#71717a] mb-2">Previous runs</h3>
        {runsLoading ? (
          <p className="text-[11px] text-[#71717a] flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading history…
          </p>
        ) : runs.length === 0 ? (
          <p className="text-[11px] text-[#71717a] italic">No runs yet — your first run will appear here.</p>
        ) : (
          <div className="bg-[#09090b] border border-[#27272a] rounded-lg divide-y divide-[#27272a]">
            {runs.map((r) => {
              const expanded = expandedRunId === r.id;
              const sc = r.statusCounts ?? {};
              const downloaded = (sc.downloaded ?? 0) + (sc.assigned ?? 0) + (sc.uploaded ?? 0);
              const failed = sc.failed ?? 0;
              const accountsInvolved = new Set(
                (expanded && expandedRun?.videos ? expandedRun.videos : []).flatMap((v) =>
                  (v.assignments ?? []).map((a) => assignmentAccountName(a, nameById))
                )
              );
              return (
                <div key={r.id}>
                  <button
                    type="button"
                    onClick={() => toggleHistoryRun(r.id)}
                    aria-expanded={expanded}
                    className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-left hover:bg-[#18181b] transition-colors cursor-pointer"
                  >
                    {expanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-[#71717a] flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-[#71717a] flex-shrink-0" />
                    )}
                    <span className="text-[#e4e4e7] flex-shrink-0">{formatDate(r.createdAt)}</span>
                    <span className="text-[#71717a]">·</span>
                    <span className="text-[#a1a1aa]">{runTotalCount(r)} links</span>
                    <span className="text-[#71717a]">·</span>
                    <span className="text-green-400">{downloaded} downloaded</span>
                    {failed > 0 && (
                      <>
                        <span className="text-[#71717a]">·</span>
                        <span className="text-red-400">{failed} failed</span>
                      </>
                    )}
                    {expanded && accountsInvolved.size > 0 && (
                      <>
                        <span className="text-[#71717a]">·</span>
                        <span className="text-[#a1a1aa] truncate">{accountsInvolved.size} accounts</span>
                      </>
                    )}
                    {r.id === runId && (
                      <span className="ml-auto px-1.5 py-0.5 rounded bg-[#E11D48]/15 border border-[#E11D48]/30 text-[#E11D48] text-[9px] font-bold flex-shrink-0">
                        CURRENT
                      </span>
                    )}
                  </button>
                  {expanded && (
                    <div className="border-t border-[#27272a] px-3 py-2">
                      {expandedLoading ? (
                        <p className="text-[11px] text-[#71717a] flex items-center gap-2 py-1">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading details…
                        </p>
                      ) : !expandedRun || (expandedRun.videos ?? []).length === 0 ? (
                        <p className="text-[11px] text-[#71717a] italic py-1">No videos recorded for this run.</p>
                      ) : (
                        <div className="divide-y divide-[#27272a] max-h-64 overflow-y-auto custom-scrollbar">
                          {(expandedRun.videos ?? []).map((v) => {
                            const dests = v.assignments ?? [];
                            return (
                              <div key={v.id} className="py-1.5 text-[11px]">
                                <div className="flex items-center gap-2">
                                  {isDownloaded(v.status) ? (
                                    <CheckCircle2 className="w-3 h-3 text-green-400 flex-shrink-0" />
                                  ) : isFailed(v.status) ? (
                                    <XCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
                                  ) : (
                                    <Loader2 className="w-3 h-3 text-[#71717a] flex-shrink-0" />
                                  )}
                                  <span className="text-[#e4e4e7] font-mono truncate flex-1 min-w-0" title={videoUrl(v)}>
                                    {videoUrl(v)}
                                  </span>
                                </div>
                                {dests.length > 0 && (
                                  <div className="ml-5 mt-1 space-y-0.5">
                                    {dests.map((a) => (
                                      <p key={a.id} className="text-[10px] text-[#a1a1aa] flex items-center gap-1.5">
                                        {isUploaded(a.status) ? (
                                          <CheckCircle2 className="w-2.5 h-2.5 text-green-400 flex-shrink-0" />
                                        ) : isFailed(a.status) ? (
                                          <XCircle className="w-2.5 h-2.5 text-red-400 flex-shrink-0" />
                                        ) : (
                                          <Loader2 className="w-2.5 h-2.5 text-[#71717a] flex-shrink-0" />
                                        )}
                                        <span className="font-semibold text-[#e4e4e7]">@{assignmentAccountName(a, nameById)}</span>
                                        {a.driveFolderName && <span className="text-[#71717a]">· {a.driveFolderName}</span>}
                                        <span className="text-[#71717a] capitalize">· {norm(a.status).toLowerCase()}</span>
                                      </p>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </StepCard>
    </div>
  );
}
