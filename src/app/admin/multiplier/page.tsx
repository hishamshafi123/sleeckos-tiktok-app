"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  Upload, FileText, Play, Download, Trash2, Loader2,
  Check, X, Layers, RefreshCw, Type, Palette, ArrowUp, ArrowDown,
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
  { value: "UPPERCASE", label: "UPPERCASE" },
  { value: "lowercase", label: "lowercase" },
  { value: "capitalize", label: "Title Case" },
  { value: "none", label: "As Is" },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function MultiplierPage() {
  // Batches list
  const [batches, setBatches] = useState<MultiplierBatch[]>([]);
  const [loading, setLoading] = useState(true);

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
  const [textPosition, setTextPosition] = useState("TOP");
  const [stripPaddingY, setStripPaddingY] = useState(20);

  // Rendering
  const [renderingBatchId, setRenderingBatchId] = useState<string | null>(null);

  // Preview
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Refs
  const videoInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // ─── Data Fetching ───────────────────────────────────────────────────────

  const fetchBatches = useCallback(async () => {
    try {
      const res = await fetch("/api/managed/multiplier");
      if (res.ok) {
        const data = await res.json();
        setBatches(data);

        // Check if any batch is still rendering
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

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  // Poll while rendering
  useEffect(() => {
    if (renderingBatchId) {
      pollRef.current = setInterval(fetchBatches, 3000);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [renderingBatchId, fetchBatches]);

  // ─── CSV Parsing ─────────────────────────────────────────────────────────

  const handleCsvUpload = async (file: File) => {
    setCsvFile(file);
    const text = await file.text();
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    if (lines.length === 0) {
      setParsedHooks([]);
      return;
    }

    const firstLine = lines[0].toLowerCase();
    const isHeader = firstLine.includes("hook") || firstLine.includes("text") || firstLine === "caption" || firstLine === "title";
    const dataLines = isHeader ? lines.slice(1) : lines;

    const hooks = dataLines
      .map((line) => {
        if (line.startsWith('"') && line.endsWith('"')) {
          return line.slice(1, -1).replace(/""/g, '"');
        }
        if (line.includes(",")) {
          const first = line.split(",")[0].trim();
          return first.startsWith('"') && first.endsWith('"') ? first.slice(1, -1) : first;
        }
        return line;
      })
      .filter((h) => h.length > 0);

    setParsedHooks(hooks);
  };

  // ─── Upload & Create Batch ───────────────────────────────────────────────

  const handleCreateBatch = async () => {
    if (!videoFile || !csvFile) {
      toast.error("Please upload both a video and a CSV file");
      return;
    }
    if (parsedHooks.length === 0) {
      toast.error("No text hooks found in the CSV");
      return;
    }

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
      formData.append("textPosition", textPosition);
      formData.append("stripPaddingY", String(stripPaddingY));

      const res = await fetch("/api/managed/multiplier", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }

      toast.success(`Batch created with ${parsedHooks.length} hooks!`);

      // Reset form
      setVideoFile(null);
      setCsvFile(null);
      setBatchName("");
      setParsedHooks([]);
      if (videoInputRef.current) videoInputRef.current.value = "";
      if (csvInputRef.current) csvInputRef.current.value = "";

      fetchBatches();
    } catch (err: any) {
      toast.error(err.message || "Failed to create batch");
    } finally {
      setUploading(false);
    }
  };

  // ─── Start Rendering ─────────────────────────────────────────────────────

  const handleStartRender = async (batchId: string) => {
    try {
      const res = await fetch("/api/managed/multiplier/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Render failed");
      }

      toast.success("Rendering started!");
      setRenderingBatchId(batchId);
      fetchBatches();
    } catch (err: any) {
      toast.error(err.message || "Failed to start rendering");
    }
  };

  // ─── Download ZIP ─────────────────────────────────────────────────────────

  const handleDownload = async (batchId: string) => {
    try {
      toast.info("Preparing ZIP download...");
      const res = await fetch(`/api/managed/multiplier/download?batchId=${batchId}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Download failed" }));
        throw new Error(err.error || "Download failed");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `multiplier_${batchId.substring(0, 8)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("Download started!");
    } catch (err: any) {
      toast.error(err.message || "Failed to download");
    }
  };

  // ─── Delete Batch ─────────────────────────────────────────────────────────

  const handleDeleteBatch = async (batchId: string) => {
    if (!confirm("Delete this batch and all its rendered videos?")) return;

    try {
      const res = await fetch(`/api/managed/multiplier?batchId=${batchId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      toast.success("Batch deleted");
      fetchBatches();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete batch");
    }
  };

  // ─── Status Helpers ────────────────────────────────────────────────────────

  const statusColor = (status: string) => {
    switch (status) {
      case "READY": return "text-blue-400 bg-blue-500/10 border-blue-500/20";
      case "RENDERING": return "text-amber-400 bg-amber-500/10 border-amber-500/20";
      case "COMPLETED": return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
      case "FAILED": return "text-red-400 bg-red-500/10 border-red-500/20";
      case "RENDERED": return "text-emerald-400";
      case "PENDING": return "text-gray-500";
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

      {/* ─── Upload & Configure Section ─────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Upload */}
        <div className="lg:col-span-2 space-y-5">
          <div className="rounded-2xl border border-white/5 bg-[#111118] p-6 space-y-5">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Upload className="w-5 h-5 text-cyan-400" />
              Upload Files
            </h2>

            {/* Batch Name */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wider">Batch Name (optional)</label>
              <input
                type="text"
                value={batchName}
                onChange={(e) => setBatchName(e.target.value)}
                placeholder="e.g., Campaign hooks v1"
                className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-gray-600 focus:outline-none focus:border-cyan-500/50 text-sm"
              />
            </div>

            {/* Video Upload */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wider">Base Video</label>
              <div
                onClick={() => videoInputRef.current?.click()}
                className={`relative cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-all ${
                  videoFile
                    ? "border-cyan-500/40 bg-cyan-500/5"
                    : "border-white/10 hover:border-white/20 bg-white/[0.02]"
                }`}
              >
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setVideoFile(f);
                  }}
                  className="hidden"
                />
                {videoFile ? (
                  <div className="flex items-center justify-center gap-3">
                    <Play className="w-5 h-5 text-cyan-400" />
                    <span className="text-cyan-300 text-sm font-medium">{videoFile.name}</span>
                    <span className="text-gray-600 text-xs">({(videoFile.size / 1024 / 1024).toFixed(1)} MB)</span>
                  </div>
                ) : (
                  <div>
                    <Upload className="w-8 h-8 mx-auto text-gray-600 mb-2" />
                    <p className="text-gray-500 text-sm">Click to upload video (MP4, MOV)</p>
                  </div>
                )}
              </div>
            </div>

            {/* CSV Upload */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wider">
                CSV File with Text Hooks
              </label>
              <div
                onClick={() => csvInputRef.current?.click()}
                className={`relative cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-all ${
                  csvFile
                    ? "border-emerald-500/40 bg-emerald-500/5"
                    : "border-white/10 hover:border-white/20 bg-white/[0.02]"
                }`}
              >
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv,.txt"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleCsvUpload(f);
                  }}
                  className="hidden"
                />
                {csvFile ? (
                  <div className="flex items-center justify-center gap-3">
                    <FileText className="w-5 h-5 text-emerald-400" />
                    <span className="text-emerald-300 text-sm font-medium">{csvFile.name}</span>
                    <span className="text-gray-600 text-xs">({parsedHooks.length} hooks found)</span>
                  </div>
                ) : (
                  <div>
                    <FileText className="w-8 h-8 mx-auto text-gray-600 mb-2" />
                    <p className="text-gray-500 text-sm">Click to upload CSV or TXT file</p>
                    <p className="text-gray-600 text-xs mt-1">One hook per line, or column &quot;hook&quot;</p>
                  </div>
                )}
              </div>
            </div>

            {/* Parsed Hooks Preview */}
            {parsedHooks.length > 0 && (
              <div>
                <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wider">
                  Parsed Hooks ({parsedHooks.length})
                </label>
                <div className="max-h-48 overflow-y-auto rounded-xl bg-white/[0.02] border border-white/5 divide-y divide-white/5">
                  {parsedHooks.map((hook, i) => (
                    <div key={i} className="px-4 py-2.5 text-sm text-gray-300 flex items-start gap-3">
                      <span className="text-gray-600 text-xs font-mono w-6 text-right flex-shrink-0 mt-0.5">{i + 1}</span>
                      <span>{hook}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Styling */}
        <div className="space-y-5">
          <div className="rounded-2xl border border-white/5 bg-[#111118] p-6 space-y-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Palette className="w-5 h-5 text-cyan-400" />
              Text Styling
            </h2>

            {/* Font Family */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Font Family</label>
              <select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-cyan-500/50"
              >
                {FONT_OPTIONS.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>

            {/* Font Size */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Font Size: {fontSize}px</label>
              <input
                type="range"
                min={18}
                max={72}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="w-full accent-cyan-500"
              />
            </div>

            {/* Font Color */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Font Color</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={fontColor}
                  onChange={(e) => setFontColor(e.target.value)}
                  className="w-10 h-8 rounded border border-white/10 cursor-pointer bg-transparent"
                />
                <input
                  type="text"
                  value={fontColor}
                  onChange={(e) => setFontColor(e.target.value)}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm font-mono"
                />
              </div>
            </div>

            {/* Text Case */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Text Case</label>
              <div className="grid grid-cols-2 gap-2">
                {TEXT_CASE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setTextCase(opt.value)}
                    className={`px-3 py-2 rounded-lg text-xs font-medium transition-all border ${
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

            <hr className="border-white/5" />

            {/* Background Strip Color */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Strip Background Color</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={bgStripColor}
                  onChange={(e) => setBgStripColor(e.target.value)}
                  className="w-10 h-8 rounded border border-white/10 cursor-pointer bg-transparent"
                />
                <input
                  type="text"
                  value={bgStripColor}
                  onChange={(e) => setBgStripColor(e.target.value)}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm font-mono"
                />
              </div>
            </div>

            {/* Strip Opacity */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Strip Opacity: {Math.round(bgStripOpacity * 100)}%</label>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(bgStripOpacity * 100)}
                onChange={(e) => setBgStripOpacity(Number(e.target.value) / 100)}
                className="w-full accent-cyan-500"
              />
            </div>

            {/* Text Position */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Text Position</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setTextPosition("TOP")}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium transition-all border ${
                    textPosition === "TOP"
                      ? "bg-cyan-500/15 text-cyan-300 border-cyan-500/30"
                      : "bg-white/5 text-gray-500 border-white/5 hover:border-white/10"
                  }`}
                >
                  <ArrowUp className="w-3.5 h-3.5" /> Top
                </button>
                <button
                  onClick={() => setTextPosition("BOTTOM")}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium transition-all border ${
                    textPosition === "BOTTOM"
                      ? "bg-cyan-500/15 text-cyan-300 border-cyan-500/30"
                      : "bg-white/5 text-gray-500 border-white/5 hover:border-white/10"
                  }`}
                >
                  <ArrowDown className="w-3.5 h-3.5" /> Bottom
                </button>
              </div>
            </div>

            {/* Strip Padding */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Strip Padding: {stripPaddingY}px</label>
              <input
                type="range"
                min={5}
                max={60}
                value={stripPaddingY}
                onChange={(e) => setStripPaddingY(Number(e.target.value))}
                className="w-full accent-cyan-500"
              />
            </div>

            {/* Live Preview Strip */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Preview</label>
              <div className="rounded-xl overflow-hidden border border-white/5 bg-gray-800 relative" style={{ height: 120 }}>
                <div
                  className="absolute left-0 right-0 flex items-center justify-center"
                  style={{
                    top: textPosition === "TOP" ? 0 : undefined,
                    bottom: textPosition === "BOTTOM" ? 0 : undefined,
                    backgroundColor: bgStripColor,
                    opacity: bgStripOpacity,
                    padding: `${stripPaddingY / 2}px 16px`,
                  }}
                >
                  <span
                    style={{
                      color: fontColor,
                      fontSize: Math.min(fontSize * 0.4, 18),
                      textTransform: textCase === "UPPERCASE" ? "uppercase" : textCase === "lowercase" ? "lowercase" : textCase === "capitalize" ? "capitalize" : "none",
                      fontWeight: "bold",
                      letterSpacing: "0.5px",
                    }}
                  >
                    {parsedHooks[0] || "Sample hook text preview"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Create Button */}
          <button
            onClick={handleCreateBatch}
            disabled={uploading || !videoFile || !csvFile || parsedHooks.length === 0}
            className="w-full py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Layers className="w-4 h-4" />
                Create Batch ({parsedHooks.length} videos)
              </>
            )}
          </button>
        </div>
      </div>

      {/* ─── Batches List ────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Batch History</h2>
          <button
            onClick={fetchBatches}
            className="p-2 rounded-lg hover:bg-white/5 text-gray-500 hover:text-white transition-all"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
          </div>
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
                <div
                  key={batch.id}
                  className="rounded-2xl border border-white/5 bg-[#111118] overflow-hidden"
                >
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
                      {batch.status === "READY" && (
                        <button
                          onClick={() => handleStartRender(batch.id)}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-xs font-medium hover:from-cyan-400 hover:to-blue-500 transition-all"
                        >
                          <Play className="w-3.5 h-3.5" />
                          Render All
                        </button>
                      )}

                      {batch.status === "COMPLETED" && renderedCount > 0 && (
                        <button
                          onClick={() => handleDownload(batch.id)}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/20 text-xs font-medium hover:bg-emerald-500/25 transition-all"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Download ZIP
                        </button>
                      )}

                      <button
                        onClick={() => handleDeleteBatch(batch.id)}
                        className="p-2 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  {batch.status === "RENDERING" && (
                    <div className="px-5 pb-3">
                      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-500"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <p className="text-gray-600 text-[10px] mt-1.5 text-right">{progress}% complete</p>
                    </div>
                  )}

                  {/* Items List */}
                  <div className="border-t border-white/5 max-h-64 overflow-y-auto">
                    {batch.items.map((item, idx) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 px-5 py-2.5 border-b border-white/[0.03] last:border-b-0 hover:bg-white/[0.02] transition-all"
                      >
                        <span className="text-gray-700 text-xs font-mono w-6 text-right flex-shrink-0">{idx + 1}</span>
                        {itemIcon(item.status)}
                        <span className="text-gray-400 text-sm flex-1 truncate">{item.hookText}</span>
                        {item.renderedVideoUrl && (
                          <button
                            onClick={() => setPreviewUrl(item.renderedVideoUrl)}
                            className="text-cyan-500 hover:text-cyan-300 transition-all"
                          >
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
              <button onClick={() => setPreviewUrl(null)} className="text-gray-500 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <video
              src={`/api/uploads${previewUrl}`}
              controls
              autoPlay
              className="w-full rounded-xl"
              style={{ maxHeight: "70vh" }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
