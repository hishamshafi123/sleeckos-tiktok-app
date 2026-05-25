"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { toast } from "sonner";
import {
  Upload, FileText, Play, Download, Trash2, Loader2,
  Check, X, Layers, RefreshCw, Palette, Move, Pause,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface MultiplierItem {
  id: string;
  hookText: string;
  status: string;
  renderedVideoUrl: string | null;
  errorMessage: string | null;
}

interface MultiplierBatch {
  id: string;
  name: string;
  sourceVideoUrl: string;
  totalItems: number;
  status: string;
  fontFamily: string;
  fontSize: number;
  fontColor: string;
  textCase: string;
  bgStripColor: string;
  bgStripOpacity: number;
  textPosition: string;
  stripPaddingY: number;
  positionYPercent: number;
  marginX: number;
  errorMessage: string | null;
  createdAt: string;
  items: MultiplierItem[];
  _count?: { items: number };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const FONT_OPTIONS = [
  "Outfit-Bold",
  "Inter-Bold",
  "PlayfairDisplay-Bold",
  "Anton-Regular",
  "Oswald-Bold",
  "Montserrat-Bold",
  "Caveat-Bold",
  "Lora-Bold",
  "GreatVibes-Regular",
];

const TEXT_CASE_OPTIONS = [
  { value: "UPPERCASE", label: "ABC" },
  { value: "lowercase", label: "abc" },
  { value: "capitalize", label: "Abc" },
  { value: "none", label: "As Is" },
];

// Output dimensions (TikTok 9:16)
const OUTPUT_W = 720;
const OUTPUT_H = 1280;

// ─── Helper for Safe Error Handling ──────────────────────────────────────────

async function getErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const contentType = res.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      const err = await res.json();
      return err.error || fallback;
    }
    const text = await res.text();
    if (text && text.length < 200 && !text.includes("<html") && !text.includes("<HTML")) {
      return text;
    }
    return `${fallback} (${res.status} ${res.statusText})`;
  } catch {
    return `${fallback} (${res.status} ${res.statusText})`;
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MultiplierPage() {
  // Batches list
  const [batches, setBatches] = useState<MultiplierBatch[]>([]);
  const [loading, setLoading] = useState(true);

  // Download states (batchId -> DownloadState)
  interface DownloadState {
    progress: number;
    totalSize: string;
    loadedSize: string;
  }
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});

  // Upload form
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [batchName, setBatchName] = useState("");
  const [parsedHooks, setParsedHooks] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  // Styling
  const [fontFamily, setFontFamily] = useState("Outfit-Bold");
  const [fontSize, setFontSize] = useState(42);
  const [fontColor, setFontColor] = useState("#FFFFFF");
  const [textCase, setTextCase] = useState("UPPERCASE");
  const [bgStripColor, setBgStripColor] = useState("#000000");
  const [bgStripOpacity, setBgStripOpacity] = useState(1.0);
  const [stripPaddingY, setStripPaddingY] = useState(20);
  const [positionYPercent, setPositionYPercent] = useState(5);
  const [marginX, setMarginX] = useState(0);
  const [borderRadius, setBorderRadius] = useState(12);

  // Rendering
  const [renderingBatchId, setRenderingBatchId] = useState<string | null>(null);
  const [pausingBatchId, setPausingBatchId] = useState<string | null>(null);

  // Preview
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [videoObjectUrl, setVideoObjectUrl] = useState<string | null>(null);

  // Refs
  const videoInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);

  // Dragging state
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ startY: number; startPercent: number } | null>(null);

  // ─── Video Object URL ─────────────────────────────────────────────────────

  useEffect(() => {
    if (videoFile) {
      const url = URL.createObjectURL(videoFile);
      setVideoObjectUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setVideoObjectUrl(null);
    }
  }, [videoFile]);

  // ─── Preview Text (apply casing) ─────────────────────────────────────────

  const previewText = useMemo(() => {
    const raw = parsedHooks[0] || "Sample hook text preview";
    switch (textCase) {
      case "UPPERCASE": return raw.toUpperCase();
      case "lowercase": return raw.toLowerCase();
      case "capitalize": return raw.replace(/\b\w/g, (c) => c.toUpperCase());
      default: return raw;
    }
  }, [parsedHooks, textCase]);

  // ─── Strip Geometry (mirroring FFmpeg logic) ──────────────────────────────

  const stripGeometry = useMemo(() => {
    // Estimate line count based on chars per line (matching FFmpeg logic)
    const paddingX = Math.max(stripPaddingY, 16);
    const effectiveTextWidth = OUTPUT_W - marginX * 2 - paddingX * 2;
    const charsPerLine = Math.max(10, Math.floor(effectiveTextWidth / (fontSize * 0.62)));
    const words = previewText.split(" ");
    let lines = 1;
    let currentLineLength = 0;
    for (const word of words) {
      if (currentLineLength + word.length + 1 > charsPerLine && currentLineLength > 0) {
        lines++;
        currentLineLength = word.length;
      } else {
        currentLineLength += (currentLineLength > 0 ? 1 : 0) + word.length;
      }
    }

    const lineHeight = fontSize * 1.4;
    const stripHeight = lines * lineHeight + stripPaddingY * 2 + 10;
    const maxY = OUTPUT_H - stripHeight;
    const yPercent = Math.max(0, Math.min(100, positionYPercent));
    const stripY = (maxY * yPercent) / 100;

    return {
      stripHeight,
      stripY,
      stripX: marginX,
      stripW: OUTPUT_W - marginX * 2,
      lines,
    };
  }, [fontSize, marginX, stripPaddingY, positionYPercent, previewText]);

  // ─── Drag to Position ─────────────────────────────────────────────────────

  const handlePreviewMouseDown = (e: React.MouseEvent) => {
    if (!previewContainerRef.current) return;
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      startY: e.clientY,
      startPercent: positionYPercent,
    };
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current || !previewContainerRef.current) return;
      const containerRect = previewContainerRef.current.getBoundingClientRect();
      const containerH = containerRect.height;
      const deltaY = e.clientY - dragStartRef.current.startY;
      const deltaPercent = (deltaY / containerH) * 100;
      const newPercent = Math.max(0, Math.min(100, dragStartRef.current.startPercent + deltaPercent));
      setPositionYPercent(Math.round(newPercent));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  // ─── Data Fetching ───────────────────────────────────────────────────────

  const fetchBatches = useCallback(async () => {
    try {
      const res = await fetch("/api/managed/multiplier");
      if (res.ok) {
        const data = await res.json();
        setBatches(data);
        const rendering = data.find((b: MultiplierBatch) => b.status === "RENDERING");
        if (rendering) {
          setRenderingBatchId(rendering.id);
        } else {
          setRenderingBatchId(null);
        }
      }
    } catch (err) {
      console.error("Error fetching batches:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBatches(); }, [fetchBatches]);

  // Poll while rendering
  useEffect(() => {
    if (renderingBatchId) {
      pollRef.current = setInterval(fetchBatches, 3000);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [renderingBatchId, fetchBatches]);

  // ─── CSV Parsing ─────────────────────────────────────────────────────────

  const handleCsvUpload = async (file: File) => {
    setCsvFile(file);
    const text = await file.text();
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) { setParsedHooks([]); return; }

    const firstLine = lines[0].toLowerCase();
    const isHeader = firstLine.includes("hook") || firstLine.includes("text") || firstLine === "caption" || firstLine === "title";
    const dataLines = isHeader ? lines.slice(1) : lines;

    const hooks = dataLines.map((line) => {
      if (line.startsWith('"') && line.endsWith('"')) return line.slice(1, -1).replace(/""/g, '"');
      if (line.includes(",")) {
        const first = line.split(",")[0].trim();
        return first.startsWith('"') && first.endsWith('"') ? first.slice(1, -1) : first;
      }
      return line;
    }).filter((h) => h.length > 0);
    setParsedHooks(hooks);
  };

  // ─── Upload & Create Batch ───────────────────────────────────────────────

  const handleCreateBatch = async () => {
    if (!videoFile || !csvFile) { toast.error("Please upload both a video and a CSV file"); return; }
    if (parsedHooks.length === 0) { toast.error("No text hooks found in the CSV"); return; }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("video", videoFile);
      formData.append("csv", csvFile);
      formData.append("name", batchName);
      formData.append("fontFamily", fontFamily);
      formData.append("fontSize", String(fontSize));
      formData.append("fontColor", fontColor);
      formData.append("textCase", textCase);
      formData.append("bgStripColor", bgStripColor);
      formData.append("bgStripOpacity", String(bgStripOpacity));
      formData.append("textPosition", positionYPercent <= 50 ? "TOP" : "BOTTOM");
      formData.append("stripPaddingY", String(stripPaddingY));
      formData.append("positionYPercent", String(positionYPercent));
      formData.append("marginX", String(marginX));
      formData.append("borderRadius", String(borderRadius));

      const res = await fetch("/api/managed/multiplier", { method: "POST", body: formData });
      if (!res.ok) {
        const errMsg = await getErrorMessage(res, "Upload failed");
        throw new Error(errMsg);
      }

      toast.success(`Batch created with ${parsedHooks.length} hooks!`);
      setVideoFile(null); setCsvFile(null); setBatchName(""); setParsedHooks([]);
      if (videoInputRef.current) videoInputRef.current.value = "";
      if (csvInputRef.current) csvInputRef.current.value = "";
      fetchBatches();
    } catch (err: any) {
      toast.error(err.message || "Failed to create batch");
    } finally {
      setUploading(false);
    }
  };

  // ─── Actions ──────────────────────────────────────────────────────────────

  const handleStartRender = async (batchId: string) => {
    try {
      const res = await fetch("/api/managed/multiplier/render", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId }),
      });
      if (!res.ok) {
        const errMsg = await getErrorMessage(res, "Render failed");
        throw new Error(errMsg);
      }
      toast.success("Rendering started!");
      setRenderingBatchId(batchId);
      fetchBatches();
    } catch (err: any) { toast.error(err.message || "Failed to start rendering"); }
  };

  const handlePauseRender = async (batchId: string) => {
    try {
      setPausingBatchId(batchId);
      const res = await fetch("/api/managed/multiplier/pause", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId }),
      });
      if (!res.ok) {
        const errMsg = await getErrorMessage(res, "Pause failed");
        throw new Error(errMsg);
      }
      toast.success("Batch paused/stopped. Active renders will stop at the next item.");
      fetchBatches();
    } catch (err: any) {
      toast.error(err.message || "Failed to pause rendering");
    } finally {
      setPausingBatchId(null);
    }
  };

  const handleDownload = async (batchId: string) => {
    try {
      setDownloads((prev) => ({
        ...prev,
        [batchId]: { progress: 0, totalSize: "Preparing...", loadedSize: "0%" }
      }));

      let isPrepared = false;
      let statusData: any = null;

      // Poll the status every 2 seconds
      while (!isPrepared) {
        const res = await fetch(`/api/managed/multiplier/download?batchId=${batchId}`);
        if (!res.ok) {
          const errMsg = await getErrorMessage(res, "Failed to prepare download");
          throw new Error(errMsg);
        }

        statusData = await res.json();

        if (statusData.status === "COMPLETED") {
          isPrepared = true;
          break;
        } else if (statusData.status === "FAILED") {
          throw new Error(statusData.message || "Archive preparation failed");
        } else if (statusData.status === "PREPARING") {
          setDownloads((prev) => ({
            ...prev,
            [batchId]: {
              progress: statusData.progress || 5,
              totalSize: "Preparing Archive...",
              loadedSize: statusData.message || "Processing...",
            }
          }));
          // Wait 2 seconds before the next status poll
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } else {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      if (statusData && statusData.downloadUrl) {
        setDownloads((prev) => ({
          ...prev,
          [batchId]: {
            progress: 100,
            totalSize: "Completed",
            loadedSize: "Downloading file...",
          }
        }));

        // Trigger a high-performance native browser download
        const fileUrl = `/api${statusData.downloadUrl}`;
        const link = document.createElement("a");
        link.href = fileUrl;
        link.download = statusData.downloadUrl.split("/").pop() || `multiplier_${batchId.substring(0, 8)}.tar.gz`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toast.success("Download started!");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to download");
    } finally {
      setDownloads((prev) => {
        const next = { ...prev };
        delete next[batchId];
        return next;
      });
    }
  };

  const triggerBlobDownload = (blob: Blob, batchId: string, res: Response) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const disposition = res.headers.get("Content-Disposition");
    const filenameMatch = disposition?.match(/filename="([^"]+)"/);
    a.download = filenameMatch?.[1] || `multiplier_${batchId.substring(0, 8)}.tar.gz`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDeleteBatch = async (batchId: string) => {
    if (!confirm("Delete this batch and all its rendered videos?")) return;
    try {
      const res = await fetch(`/api/managed/multiplier?batchId=${batchId}`, { method: "DELETE" });
      if (!res.ok) {
        const errMsg = await getErrorMessage(res, "Delete failed");
        throw new Error(errMsg);
      }
      toast.success("Batch deleted"); fetchBatches();
    } catch (err: any) { toast.error(err.message || "Failed to delete batch"); }
  };

  // ─── Status Helpers ────────────────────────────────────────────────────────

  const statusColor = (status: string) => {
    switch (status) {
      case "READY": return "text-blue-400 bg-blue-500/10 border-blue-500/20";
      case "RENDERING": return "text-amber-400 bg-amber-500/10 border-amber-500/20";
      case "COMPLETED": return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
      case "FAILED": return "text-red-400 bg-red-500/10 border-red-500/20";
      default: return "text-gray-500";
    }
  };

  const itemIcon = (status: string) => {
    switch (status) {
      case "RENDERED": return <Check className="w-3.5 h-3.5 text-emerald-400" />;
      case "RENDERING": return <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />;
      case "FAILED": return <X className="w-3.5 h-3.5 text-red-400" />;
      default: return <div className="w-3.5 h-3.5 rounded-full border border-gray-600" />;
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Layers className="w-7 h-7 text-cyan-400" />
          Video Multiplier
        </h1>
        <p className="text-gray-500 mt-1 text-sm">
          Upload one video + a CSV of text hooks → get N videos with different text overlays
        </p>
      </div>

      {/* ─── Upload Section ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="rounded-2xl border border-white/5 bg-[#111118] p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Upload className="w-4 h-4 text-cyan-400" />
            Upload Files
          </h2>
          {/* Batch Name */}
          <input
            type="text"
            value={batchName}
            onChange={(e) => setBatchName(e.target.value)}
            placeholder="Batch name (optional)"
            className="w-full px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-gray-600 focus:outline-none focus:border-cyan-500/50 text-sm"
          />
          {/* Video Upload */}
          <div
            onClick={() => videoInputRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-5 text-center transition-all ${
              videoFile ? "border-cyan-500/40 bg-cyan-500/5" : "border-white/10 hover:border-white/20 bg-white/[0.02]"
            }`}
          >
            <input ref={videoInputRef} type="file" accept="video/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) setVideoFile(f); }} className="hidden" />
            {videoFile ? (
              <div className="flex items-center justify-center gap-3">
                <Play className="w-4 h-4 text-cyan-400" />
                <span className="text-cyan-300 text-sm font-medium truncate">{videoFile.name}</span>
                <span className="text-gray-600 text-xs">({(videoFile.size / 1024 / 1024).toFixed(1)} MB)</span>
              </div>
            ) : (
              <div><Upload className="w-6 h-6 mx-auto text-gray-600 mb-1" /><p className="text-gray-500 text-xs">Upload base video (MP4, MOV)</p></div>
            )}
          </div>
          {/* CSV Upload */}
          <div
            onClick={() => csvInputRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-5 text-center transition-all ${
              csvFile ? "border-emerald-500/40 bg-emerald-500/5" : "border-white/10 hover:border-white/20 bg-white/[0.02]"
            }`}
          >
            <input ref={csvInputRef} type="file" accept=".csv,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCsvUpload(f); }} className="hidden" />
            {csvFile ? (
              <div className="flex items-center justify-center gap-3">
                <FileText className="w-4 h-4 text-emerald-400" />
                <span className="text-emerald-300 text-sm font-medium truncate">{csvFile.name}</span>
                <span className="text-gray-600 text-xs">({parsedHooks.length} hooks)</span>
              </div>
            ) : (
              <div><FileText className="w-6 h-6 mx-auto text-gray-600 mb-1" /><p className="text-gray-500 text-xs">Upload CSV / TXT (one hook per line)</p></div>
            )}
          </div>
        </div>

        {/* Parsed Hooks */}
        <div className="rounded-2xl border border-white/5 bg-[#111118] p-5 flex flex-col">
          <h2 className="text-sm font-semibold text-white mb-3">
            Parsed Hooks {parsedHooks.length > 0 && <span className="text-gray-500 font-normal">({parsedHooks.length})</span>}
          </h2>
          {parsedHooks.length > 0 ? (
            <div className="flex-1 max-h-64 overflow-y-auto rounded-xl bg-white/[0.02] border border-white/5 divide-y divide-white/5">
              {parsedHooks.map((hook, i) => (
                <div key={i} className="px-3.5 py-2 text-sm text-gray-300 flex items-start gap-2.5">
                  <span className="text-gray-600 text-xs font-mono w-5 text-right flex-shrink-0 mt-0.5">{i + 1}</span>
                  <span className="truncate">{hook}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-600 text-xs">
              Upload a CSV to see hooks here
            </div>
          )}
        </div>
      </div>

      {/* ─── Preview + Controls ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
        {/* Left: Live Preview (9:16 phone frame) */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Move className="w-4 h-4 text-cyan-400" />
            Live Preview
            <span className="text-gray-600 text-[10px] font-normal ml-1">Drag strip to position</span>
          </h2>
          <div
            ref={previewContainerRef}
            className="relative rounded-2xl overflow-hidden border-2 border-white/10 bg-black mx-auto select-none"
            style={{
              width: 300,
              height: 300 * (OUTPUT_H / OUTPUT_W), // 9:16 aspect
            }}
          >
            {/* Video Background */}
            {videoObjectUrl ? (
              <video
                src={videoObjectUrl}
                muted
                loop
                autoPlay
                playsInline
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-b from-gray-800 to-gray-900 flex items-center justify-center">
                <span className="text-gray-700 text-xs">Upload video to preview</span>
              </div>
            )}

            {/* Text Strip Overlay — Draggable */}
            <div
              onMouseDown={handlePreviewMouseDown}
              className="absolute left-0 right-0 flex items-center justify-center"
              style={{
                top: `${(stripGeometry.stripY / OUTPUT_H) * 100}%`,
                height: `${(stripGeometry.stripHeight / OUTPUT_H) * 100}%`,
                left: `${(stripGeometry.stripX / OUTPUT_W) * 100}%`,
                right: `${(stripGeometry.stripX / OUTPUT_W) * 100}%`,
                width: `${(stripGeometry.stripW / OUTPUT_W) * 100}%`,
                backgroundColor: bgStripColor,
                opacity: bgStripOpacity,
                cursor: isDragging ? "grabbing" : "grab",
                padding: `${Math.max(2, stripPaddingY * (300 / OUTPUT_W))}px ${Math.max(6, Math.max(stripPaddingY, 16) * (300 / OUTPUT_W))}px`,
                borderRadius: `${Math.max(0, borderRadius * (300 / OUTPUT_W))}px`,
                transition: isDragging ? "none" : "top 0.15s ease-out",
              }}
            >
              <span
                className="text-center leading-tight"
                style={{
                  color: fontColor,
                  fontSize: Math.max(8, fontSize * (300 / OUTPUT_W)),
                  fontWeight: "bold",
                  letterSpacing: "0.3px",
                  wordBreak: "break-word",
                }}
              >
                {previewText}
              </span>
            </div>

            {/* Drag indicator lines */}
            {isDragging && (
              <>
                <div className="absolute left-2 right-2 border-t border-cyan-500/50 border-dashed" style={{ top: `${(stripGeometry.stripY / OUTPUT_H) * 100}%` }} />
                <div className="absolute left-2 right-2 border-t border-cyan-500/50 border-dashed" style={{ top: `${((stripGeometry.stripY + stripGeometry.stripHeight) / OUTPUT_H) * 100}%` }} />
              </>
            )}

            {/* Position indicator */}
            <div className="absolute bottom-2 right-2 bg-black/70 text-gray-300 text-[9px] px-1.5 py-0.5 rounded font-mono">
              Y: {positionYPercent}%
            </div>
          </div>

          {/* Quick position buttons */}
          <div className="flex gap-1.5">
            {[
              { label: "Top", value: 0 },
              { label: "25%", value: 25 },
              { label: "Center", value: 50 },
              { label: "75%", value: 75 },
              { label: "Bottom", value: 100 },
            ].map((p) => (
              <button
                key={p.value}
                onClick={() => setPositionYPercent(p.value)}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-all border ${
                  positionYPercent === p.value
                    ? "bg-cyan-500/15 text-cyan-300 border-cyan-500/30"
                    : "bg-white/5 text-gray-600 border-white/5 hover:border-white/10 hover:text-gray-400"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Controls */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Text Controls */}
          <div className="rounded-2xl border border-white/5 bg-[#111118] p-5 space-y-4">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Palette className="w-4 h-4 text-cyan-400" />
              Text
            </h2>

            {/* Font Family */}
            <div>
              <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Font</label>
              <select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-cyan-500/50"
              >
                {FONT_OPTIONS.map((f) => (<option key={f} value={f}>{f}</option>))}
              </select>
            </div>

            {/* Font Size */}
            <div>
              <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Size: {fontSize}px</label>
              <input type="range" min={18} max={72} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} className="w-full accent-cyan-500" />
            </div>

            {/* Font Color */}
            <div>
              <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Color</label>
              <div className="flex items-center gap-2">
                <input type="color" value={fontColor} onChange={(e) => setFontColor(e.target.value)} className="w-8 h-7 rounded border border-white/10 cursor-pointer bg-transparent" />
                <input type="text" value={fontColor} onChange={(e) => setFontColor(e.target.value)} className="flex-1 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs font-mono" />
              </div>
            </div>

            {/* Text Case */}
            <div>
              <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Case</label>
              <div className="grid grid-cols-4 gap-1.5">
                {TEXT_CASE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setTextCase(opt.value)}
                    className={`px-2 py-1.5 rounded-lg text-[10px] font-medium transition-all border ${
                      textCase === opt.value
                        ? "bg-cyan-500/15 text-cyan-300 border-cyan-500/30"
                        : "bg-white/5 text-gray-500 border-white/5 hover:border-white/10"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Strip & Position Controls */}
          <div className="rounded-2xl border border-white/5 bg-[#111118] p-5 space-y-4">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Move className="w-4 h-4 text-cyan-400" />
              Strip & Position
            </h2>

            {/* Background Color */}
            <div>
              <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Background</label>
              <div className="flex items-center gap-2">
                <input type="color" value={bgStripColor} onChange={(e) => setBgStripColor(e.target.value)} className="w-8 h-7 rounded border border-white/10 cursor-pointer bg-transparent" />
                <input type="text" value={bgStripColor} onChange={(e) => setBgStripColor(e.target.value)} className="flex-1 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs font-mono" />
              </div>
            </div>

            {/* Opacity */}
            <div>
              <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Opacity: {Math.round(bgStripOpacity * 100)}%</label>
              <input type="range" min={0} max={100} value={Math.round(bgStripOpacity * 100)} onChange={(e) => setBgStripOpacity(Number(e.target.value) / 100)} className="w-full accent-cyan-500" />
            </div>

            {/* Vertical Position */}
            <div>
              <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Y Position: {positionYPercent}%</label>
              <input type="range" min={0} max={100} value={positionYPercent} onChange={(e) => setPositionYPercent(Number(e.target.value))} className="w-full accent-cyan-500" />
            </div>

            {/* Horizontal Margin */}
            <div>
              <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Horizontal Margin: {marginX}px</label>
              <input type="range" min={0} max={200} value={marginX} onChange={(e) => setMarginX(Number(e.target.value))} className="w-full accent-cyan-500" />
            </div>

            {/* Inner Padding */}
            <div>
              <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Inner Padding: {stripPaddingY}px</label>
              <input type="range" min={0} max={60} value={stripPaddingY} onChange={(e) => setStripPaddingY(Number(e.target.value))} className="w-full accent-cyan-500" />
            </div>

            {/* Border Radius */}
            <div>
              <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Corner Radius: {borderRadius}px</label>
              <input type="range" min={0} max={40} value={borderRadius} onChange={(e) => setBorderRadius(Number(e.target.value))} className="w-full accent-cyan-500" />
            </div>
          </div>
        </div>
      </div>

      {/* Create Button */}
      <button
        onClick={handleCreateBatch}
        disabled={uploading || !videoFile || !csvFile || parsedHooks.length === 0}
        className="w-full py-3.5 rounded-xl font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2"
      >
        {uploading ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</>
        ) : (
          <><Layers className="w-4 h-4" /> Create Batch {parsedHooks.length > 0 && `(${parsedHooks.length} videos)`}</>
        )}
      </button>

      {/* ─── Batches List ────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Batch History</h2>
          <button onClick={fetchBatches} className="p-2 rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-all">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-cyan-400 animate-spin" /></div>
        ) : batches.length === 0 ? (
          <div className="text-center py-12 text-gray-600">
            <Layers className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No multiplier batches yet</p>
          </div>
        ) : (
          <div className="space-y-4">
            {batches.map((batch) => {
              const renderedCount = batch.items.filter((i) => i.status === "RENDERED").length;
              const failedCount = batch.items.filter((i) => i.status === "FAILED").length;
              const totalCount = batch.items.length;
              const progress = totalCount > 0 ? Math.round((renderedCount / totalCount) * 100) : 0;

              return (
                <div key={batch.id} className="rounded-2xl border border-white/5 bg-[#111118] overflow-hidden">
                  {/* Batch Header */}
                  <div className="p-5 flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <h3 className="text-white font-semibold text-sm truncate">
                          {batch.name || `Batch ${batch.id.substring(0, 8)}`}
                        </h3>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${statusColor(batch.status)}`}>
                          {batch.status}
                        </span>
                      </div>
                      <p className="text-gray-600 text-xs mt-1">
                        {totalCount} hooks · {renderedCount} rendered
                        {failedCount > 0 && ` · ${failedCount} failed`}
                        {" · "}
                        {new Date(batch.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {(batch.status === "READY" || batch.status === "FAILED") && (
                        <button onClick={() => handleStartRender(batch.id)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-xs font-medium hover:from-cyan-400 hover:to-blue-500 transition-all">
                          <Play className="w-3.5 h-3.5" /> {batch.status === "FAILED" ? "Resume Render" : "Render All"}
                        </button>
                      )}
                      {batch.status === "RENDERING" && (
                        <button 
                          onClick={() => handlePauseRender(batch.id)} 
                          disabled={pausingBatchId !== null}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/20 text-xs font-medium hover:bg-amber-500/25 transition-all disabled:opacity-50"
                        >
                          {pausingBatchId === batch.id ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Pausing...
                            </>
                          ) : (
                            <>
                              <Pause className="w-3.5 h-3.5" /> Pause Render
                            </>
                          )}
                        </button>
                      )}
                      {batch.status === "COMPLETED" && renderedCount > 0 && (
                        <button 
                          onClick={() => handleDownload(batch.id)} 
                          disabled={batch.id in downloads}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/20 text-xs font-medium hover:bg-emerald-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {batch.id in downloads ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Downloading...
                            </>
                          ) : (
                            <>
                              <Download className="w-3.5 h-3.5" /> Download All
                            </>
                          )}
                        </button>
                      )}
                      <button onClick={() => handleDeleteBatch(batch.id)} className="p-2 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-all">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Download Progress Bar */}
                  {batch.id in downloads && (
                    <div className="px-5 pb-4 bg-emerald-500/5 border-t border-white/5 pt-3">
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="text-[10px] font-black text-emerald-400 uppercase tracking-wider flex items-center gap-1.5 animate-pulse">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Streaming Archive Chunks...
                        </span>
                        <span className="text-[10px] text-gray-500 font-semibold uppercase">
                          {downloads[batch.id].loadedSize} / {downloads[batch.id].totalSize}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div 
                          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-300" 
                          style={{ width: `${downloads[batch.id].progress || 5}%` }} 
                        />
                      </div>
                      <div className="flex justify-between items-center mt-1.5">
                        <span className="text-[9px] text-gray-600 font-semibold uppercase">Do not close this tab</span>
                        <span className="text-[10px] text-emerald-400 font-bold">{downloads[batch.id].progress}% Complete</span>
                      </div>
                    </div>
                  )}

                  {/* Progress Bar */}
                  {batch.status === "RENDERING" && (
                    <div className="px-5 pb-3">
                      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-500" style={{ width: `${progress}%` }} />
                      </div>
                      <p className="text-gray-600 text-[10px] mt-1.5 text-right">{progress}% complete</p>
                    </div>
                  )}

                  {/* Items List */}
                  <div className="border-t border-white/5 max-h-64 overflow-y-auto">
                    {batch.items.map((item, idx) => (
                      <div key={item.id} className="flex items-center gap-3 px-5 py-2.5 border-b border-white/[0.03] last:border-b-0 hover:bg-white/[0.02] transition-all">
                        <span className="text-gray-700 text-xs font-mono w-6 text-right flex-shrink-0">{idx + 1}</span>
                        {itemIcon(item.status)}
                        <span className="text-gray-400 text-sm flex-1 truncate">{item.hookText}</span>
                        {item.renderedVideoUrl && (
                          <button onClick={() => setPreviewUrl(item.renderedVideoUrl)} className="text-cyan-500 hover:text-cyan-300 transition-all">
                            <Play className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {item.status === "FAILED" && item.errorMessage && (
                          <span className="text-red-500 text-[10px] truncate max-w-[200px]" title={item.errorMessage}>
                            {item.errorMessage.substring(0, 40)}...
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Video Preview Modal ──────────────────────────────────────────── */}
      {previewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setPreviewUrl(null)}>
          <div className="bg-[#16161f] rounded-2xl border border-white/10 p-4 max-w-lg w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white text-sm font-medium">Video Preview</h3>
              <button onClick={() => setPreviewUrl(null)} className="text-gray-500 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <video src={`/api${previewUrl}`} controls autoPlay className="w-full rounded-xl" style={{ maxHeight: "70vh" }} />
          </div>
        </div>
      )}
    </div>
  );
}
