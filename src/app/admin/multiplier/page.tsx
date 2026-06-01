"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { toast } from "sonner";
import {
  Upload, FileText, Play, Download, Trash2, Loader2,
  Check, X, Layers, RefreshCw, Palette, Move, Pause,
  Plus, FolderOpen, Cloud, CloudOff, Search, LogIn,
  Copy, Sparkles, Wand2,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface MultiplierItem {
  id: string;
  hookText: string;
  status: string;
  renderedVideoUrl: string | null;
  errorMessage: string | null;
  templateId: string | null;
  driveFolderId: string | null;
  driveFolderName: string | null;
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
  driveFolderId: string | null;
  driveFolderName: string | null;
  driveExportStatus: string | null;
}

interface DesignTemplate {
  id: string;
  name: string;
  // Typography
  fontFamily: string;
  fontSize: number;
  fontColor: string;
  textCase: string;
  letterSpacing: number;
  lineHeight: number;
  // Text Effects
  strokeEnabled: boolean;
  strokeColor: string;
  strokeWidth: number;
  shadowEnabled: boolean;
  shadowColor: string;
  shadowX: number;
  shadowY: number;
  glowEnabled: boolean;
  glowColor: string;
  glowIntensity: number;
  // Strip
  bgStripColor: string;
  bgStripOpacity: number;
  stripWidthMode: string;
  stripWidthPercent: number;
  borderRadius: number;
  stripBorderEnabled: boolean;
  stripBorderColor: string;
  stripBorderWidth: number;
  stripShadowEnabled: boolean;
  stripShadowColor: string;
  stripShadowOffset: number;
  // Layout
  positionYPercent: number;
  marginX: number;
  paddingY: number;
  paddingX: number;
  textAlign: string;
  // Advanced
  stripGradientEnabled: boolean;
  stripGradientColor2: string;
  stripGradientAngle: number;
  stripShape: string;
  animationType: string;
  animationDuration: number;
  backdropBlurEnabled: boolean;
  backdropBlurRadius: number;
  textGradientEnabled: boolean;
  textGradientColor1: string;
  textGradientColor2: string;
  textGradientAngle: number;
  doubleTextEnabled: boolean;
  doubleTextOutlineColor: string;
  doubleTextOutlineWidth: number;
  isPreset: boolean;
  presetCategory: string | null;
  createdAt: string;
}

interface DriveFolder {
  id: string;
  name: string;
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

  // Design studio tab
  const [designTab, setDesignTab] = useState<"typography" | "effects" | "strip" | "animation">("typography");

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

  // ─── Design Templates ────────────────────────────────────────────────────────
  const [templates, setTemplates] = useState<DesignTemplate[]>([]);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Partial<DesignTemplate> | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);

  const defaultTemplateValues = (): Partial<DesignTemplate> => ({
    name: "",
    fontFamily: "Outfit-Bold", fontSize: 42, fontColor: "#FFFFFF",
    textCase: "UPPERCASE", letterSpacing: 1.0, lineHeight: 1.4,
    strokeEnabled: false, strokeColor: "#000000", strokeWidth: 2,
    shadowEnabled: false, shadowColor: "#000000", shadowX: 2, shadowY: 2,
    glowEnabled: false, glowColor: "#FF00FF", glowIntensity: 2,
    bgStripColor: "#000000", bgStripOpacity: 1.0,
    stripWidthMode: "FULL", stripWidthPercent: 100, borderRadius: 12,
    stripBorderEnabled: false, stripBorderColor: "#FFFFFF", stripBorderWidth: 1,
    stripShadowEnabled: false, stripShadowColor: "#000000", stripShadowOffset: 4,
    positionYPercent: 5, marginX: 0, paddingY: 20, paddingX: 20,
    textAlign: "CENTER",
    // Advanced
    stripGradientEnabled: false, stripGradientColor2: "#333333", stripGradientAngle: 90,
    stripShape: "FULL",
    animationType: "NONE", animationDuration: 0.5,
    backdropBlurEnabled: false, backdropBlurRadius: 10,
    textGradientEnabled: false, textGradientColor1: "#FFFFFF", textGradientColor2: "#00FFFF", textGradientAngle: 180,
    doubleTextEnabled: false, doubleTextOutlineColor: "#000000", doubleTextOutlineWidth: 4,
    isPreset: false, presetCategory: null,
  });

  // ─── Google Drive ───────────────────────────────────────────────────────────
  const [driveConnected, setDriveConnected] = useState(false);
  const [driveEmail, setDriveEmail] = useState("");
  // Folder picker target: { type: 'batch' | 'item', id: string }
  const [folderPickerTarget, setFolderPickerTarget] = useState<{ type: "batch" | "item"; id: string } | null>(null);
  const showFolderPicker = folderPickerTarget?.id || null; // backward compat for modal
  const [driveFolders, setDriveFolders] = useState<DriveFolder[]>([]);
  const [folderSearch, setFolderSearch] = useState("");
  const [searchingFolders, setSearchingFolders] = useState(false);
  const [exportingBatches, setExportingBatches] = useState<Set<string>>(new Set());
  const [renamingBatchId, setRenamingBatchId] = useState<string | null>(null);
  const [renamingBatchValue, setRenamingBatchValue] = useState("");
  // Multi-folder batch assignment
  const [multiFolderPickerBatchId, setMultiFolderPickerBatchId] = useState<string | null>(null);
  const [batchSelectedFolders, setBatchSelectedFolders] = useState<Record<string, DriveFolder[]>>({});
  const [multiFolderSearch, setMultiFolderSearch] = useState("");
  const [multiFolderResults, setMultiFolderResults] = useState<DriveFolder[]>([]);
  const [searchingMultiFolders, setSearchingMultiFolders] = useState(false);

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
    // Adaptive char width: must match FFmpeg logic exactly
    const isUppercase = textCase.trim().toLowerCase() === "uppercase";
    const charWidthMultiplier = isUppercase ? 0.65 : 0.55;
    const paddingX = Math.max(stripPaddingY, 16);
    const effectiveTextWidth = OUTPUT_W - marginX * 2 - paddingX * 2;
    const charsPerLine = Math.max(8, Math.floor(effectiveTextWidth / (fontSize * charWidthMultiplier)));
    const words = previewText.split(" ");
    let lines = 1;
    let currentLineLength = 0;
    for (const word of words) {
      // Handle words longer than charsPerLine (force break)
      if (word.length > charsPerLine) {
        if (currentLineLength > 0) {
          lines++;
          currentLineLength = 0;
        }
        const chunks = Math.ceil(word.length / charsPerLine);
        lines += chunks - 1; // first chunk is the current line
        currentLineLength = word.length % charsPerLine || charsPerLine;
        continue;
      }
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
  }, [fontSize, marginX, stripPaddingY, positionYPercent, previewText, textCase]);

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

  useEffect(() => {
    // Reset any batches stuck at "EXPORTING" from previous failed sessions
    fetch("/api/managed/multiplier/export", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset-stuck" }),
    }).catch(() => {});
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
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [renderingBatchId, fetchBatches]);

  // ─── Design Templates Data ────────────────────────────────────────────────

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/managed/multiplier/templates");
      if (res.ok) setTemplates(await res.json());
    } catch {}
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const openTemplateEditor = (tmpl?: DesignTemplate) => {
    if (tmpl) {
      setEditingTemplate({ ...tmpl });
    } else {
      setEditingTemplate(defaultTemplateValues());
    }
    setShowTemplateEditor(true);
  };

  const updateEditingField = (key: string, value: any) => {
    setEditingTemplate((prev) => prev ? { ...prev, [key]: value } : prev);
  };

  const handleSaveTemplate = async () => {
    if (!editingTemplate?.name?.trim()) {
      toast.error("Template name is required");
      return;
    }
    setSavingTemplate(true);
    try {
      const isUpdate = !!editingTemplate.id;
      const res = await fetch("/api/managed/multiplier/templates", {
        method: isUpdate ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingTemplate),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success(isUpdate ? "Template updated!" : "Template saved!");
      setShowTemplateEditor(false);
      setEditingTemplate(null);
      fetchTemplates();
    } catch (err: any) {
      toast.error(err.message || "Failed to save template");
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    if (!confirm("Delete this design template?")) return;
    try {
      await fetch(`/api/managed/multiplier/templates?id=${id}`, { method: "DELETE" });
      toast.success("Template deleted");
      setSelectedTemplateIds((prev) => prev.filter((t) => t !== id));
      fetchTemplates();
    } catch {
      toast.error("Failed to delete");
    }
  };

  const handleDuplicateTemplate = async (id: string) => {
    try {
      const res = await fetch(`/api/managed/multiplier/templates?action=duplicate&id=${id}`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Template duplicated!");
      fetchTemplates();
    } catch (err: any) {
      toast.error(err.message || "Failed to duplicate");
    }
  };

  const seedPresets = async () => {
    try {
      const res = await fetch("/api/managed/multiplier/templates?action=seed-presets", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.count > 0) {
          toast.success(`${data.count} preset designs loaded!`);
          fetchTemplates();
        }
      }
    } catch {}
  };

  // Auto-seed presets on first load if no templates exist
  useEffect(() => {
    if (templates.length === 0 && !loading) {
      seedPresets();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates.length, loading]);

  const toggleTemplateSelection = (id: string) => {
    setSelectedTemplateIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  };

  // ─── Google Drive ────────────────────────────────────────────────────────

  const fetchDriveStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/managed/multiplier/google/status");
      if (res.ok) {
        const data = await res.json();
        setDriveConnected(data.connected);
        setDriveEmail(data.email || "");
      }
    } catch {}
  }, []);

  useEffect(() => { fetchDriveStatus(); }, [fetchDriveStatus]);

  const handleDisconnectDrive = async () => {
    if (!confirm("Disconnect Google Drive?")) return;
    try {
      await fetch("/api/managed/multiplier/google/status", { method: "DELETE" });
      setDriveConnected(false);
      setDriveEmail("");
      toast.success("Drive disconnected");
    } catch {
      toast.error("Failed to disconnect");
    }
  };

  const searchDriveFolders = async (query: string) => {
    setSearchingFolders(true);
    try {
      const res = await fetch(`/api/managed/multiplier/google/folders?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        setDriveFolders(data.folders || []);
      }
    } catch {} finally {
      setSearchingFolders(false);
    }
  };

  const searchMultiFolders = async (query: string) => {
    setSearchingMultiFolders(true);
    try {
      const res = await fetch(`/api/managed/multiplier/google/folders?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        setMultiFolderResults(data.folders || []);
      }
    } catch {} finally {
      setSearchingMultiFolders(false);
    }
  };

  const handleAssignFolder = async (targetId: string, folderId: string, folderName: string) => {
    const isItem = folderPickerTarget?.type === "item";
    // Optimistic local state update — prevents scroll jump
    setBatches((prev) =>
      prev.map((b) => {
        if (isItem) {
          return {
            ...b,
            items: b.items.map((item) =>
              item.id === targetId ? { ...item, driveFolderId: folderId, driveFolderName: folderName } : item
            ),
          };
        } else if (b.id === targetId) {
          return { ...b, driveFolderId: folderId, driveFolderName: folderName };
        }
        return b;
      })
    );
    setFolderPickerTarget(null);
    toast.success(`Folder "${folderName}" assigned`);

    // Persist to server in background (no refetch)
    try {
      await fetch("/api/managed/multiplier", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isItem
            ? { itemId: targetId, driveFolderId: folderId, driveFolderName: folderName }
            : { batchId: targetId, driveFolderId: folderId, driveFolderName: folderName }
        ),
      });
    } catch {
      toast.error("Failed to save folder — please refresh");
    }
  };

  // ─── Multi-folder batch assignment (round-robin) ──────────────────────────

  const handleBatchMultiFolderSelect = (batchId: string, folder: DriveFolder) => {
    setBatchSelectedFolders((prev) => {
      const existing = prev[batchId] || [];
      // Toggle: add if not present, remove if already selected
      const isSelected = existing.some((f) => f.id === folder.id);
      if (isSelected) {
        return { ...prev, [batchId]: existing.filter((f) => f.id !== folder.id) };
      }
      return { ...prev, [batchId]: [...existing, folder] };
    });
  };

  const handleBatchMultiFolderAssign = async (batchId: string) => {
    const folders = batchSelectedFolders[batchId] || [];
    if (folders.length === 0) { toast.error("Select at least one folder"); return; }

    const batch = batches.find((b) => b.id === batchId);
    if (!batch) return;

    const renderedItems = batch.items.filter((i) => i.status === "RENDERED");
    if (renderedItems.length === 0) { toast.error("No rendered videos to assign"); return; }

    // Round-robin: assign folders cyclically to rendered items
    const assignments: { itemId: string; folderId: string; folderName: string }[] = [];
    renderedItems.forEach((item, idx) => {
      const folder = folders[idx % folders.length];
      assignments.push({ itemId: item.id, folderId: folder.id, folderName: folder.name });
    });

    // Optimistic local state update
    setBatches((prev) =>
      prev.map((b) => {
        if (b.id !== batchId) return b;
        return {
          ...b,
          items: b.items.map((item) => {
            const assignment = assignments.find((a) => a.itemId === item.id);
            if (assignment) {
              return { ...item, driveFolderId: assignment.folderId, driveFolderName: assignment.folderName };
            }
            return item;
          }),
        };
      })
    );

    setMultiFolderPickerBatchId(null);
    setBatchSelectedFolders((prev) => { const copy = { ...prev }; delete copy[batchId]; return copy; });
    toast.success(`${folders.length} folder(s) assigned to ${renderedItems.length} videos (round-robin)`);

    // Persist all to server in background
    try {
      await Promise.all(
        assignments.map((a) =>
          fetch("/api/managed/multiplier", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ itemId: a.itemId, driveFolderId: a.folderId, driveFolderName: a.folderName }),
          })
        )
      );
    } catch {
      toast.error("Some folder assignments failed — please refresh");
    }
  };

  const handleRenameBatch = async (batchId: string, newName: string) => {
    // Optimistic local state update
    setBatches((prev) => prev.map((b) => (b.id === batchId ? { ...b, name: newName } : b)));
    setRenamingBatchId(null);
    toast.success("Batch renamed");

    try {
      await fetch("/api/managed/multiplier", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId, name: newName }),
      });
    } catch {
      toast.error("Failed to save name — please refresh");
    }
  };

  const handleExportToDrive = async (batchId: string) => {
    setExportingBatches((prev) => new Set([...prev, batchId]));
    try {
      const res = await fetch("/api/managed/multiplier/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      toast.success("Export started! Videos uploading to Drive...");
      // Poll for completion (max 10 minutes)
      let pollCount = 0;
      const maxPolls = 200; // 200 * 3s = 10 min
      const pollExport = setInterval(async () => {
        pollCount++;
        if (pollCount > maxPolls) {
          clearInterval(pollExport);
          setExportingBatches((prev) => { const next = new Set(prev); next.delete(batchId); return next; });
          toast.error("Export timed out — check batches for status");
          fetchBatches();
          return;
        }
        try {
          const statusRes = await fetch(`/api/managed/multiplier/export?batchId=${batchId}`);
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            if (statusData.status === "EXPORTED") {
              clearInterval(pollExport);
              setExportingBatches((prev) => { const next = new Set(prev); next.delete(batchId); return next; });
              toast.success("Export completed!");
              fetchBatches();
            } else if (statusData.status === "FAILED" || statusData.status === null) {
              clearInterval(pollExport);
              setExportingBatches((prev) => { const next = new Set(prev); next.delete(batchId); return next; });
              toast.error(statusData.error ? `Export failed: ${statusData.error}` : "Export failed — you can retry");
              fetchBatches();
            }
          }
        } catch {}
      }, 3000);
    } catch (err: any) {
      toast.error(err.message || "Export failed");
      setExportingBatches((prev) => { const next = new Set(prev); next.delete(batchId); return next; });
    }
  };

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
    if (!videoFile) { toast.error("Please upload a video file"); return; }
    if (!csvFile || parsedHooks.length === 0) { toast.error("Please upload a CSV with text hooks"); return; }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("video", videoFile);
      formData.append("csv", csvFile!);
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
      if (selectedTemplateIds.length > 0) {
        formData.append("templateIds", JSON.stringify(selectedTemplateIds));
      }

      const res = await fetch("/api/managed/multiplier", { method: "POST", body: formData });
      if (!res.ok) {
        const errMsg = await getErrorMessage(res, "Upload failed");
        throw new Error(errMsg);
      }

      toast.success(`Batch created!`);
      setVideoFile(null); setCsvFile(null); setBatchName(""); setParsedHooks([]); setSelectedTemplateIds([]);
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

  const handleRetryFailed = async (batchId: string) => {
    try {
      // Reset failed items to PENDING first
      const resetRes = await fetch("/api/managed/multiplier/render", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId, action: "retry-failed" }),
      });
      if (!resetRes.ok) {
        const errMsg = await getErrorMessage(resetRes, "Reset failed");
        throw new Error(errMsg);
      }

      // Now start the render (it will skip already-RENDERED items)
      const res = await fetch("/api/managed/multiplier/render", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId }),
      });
      if (!res.ok) {
        const errMsg = await getErrorMessage(res, "Render failed");
        throw new Error(errMsg);
      }
      toast.success("Retrying failed renders!");
      setRenderingBatchId(batchId);
      fetchBatches();
    } catch (err: any) { toast.error(err.message || "Failed to retry rendering"); }
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

      {/* ─── Google Drive Connection ──────────────────────────────────────── */}
      <div className="rounded-2xl border border-white/5 bg-[#111118] p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {driveConnected ? (
            <Cloud className="w-5 h-5 text-emerald-400" />
          ) : (
            <CloudOff className="w-5 h-5 text-gray-600" />
          )}
          <div>
            <p className="text-sm font-medium text-white">
              {driveConnected ? "Google Drive Connected" : "Google Drive Not Connected"}
            </p>
            {driveEmail && <p className="text-xs text-gray-500">{driveEmail}</p>}
            {!driveConnected && <p className="text-xs text-gray-500">Connect Google Drive from the Manage section first</p>}
          </div>
        </div>
        {!driveConnected && (
          <a href="/admin/accounts" className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 text-white text-xs font-medium hover:from-blue-400 hover:to-cyan-400 transition-all">
            <LogIn className="w-3.5 h-3.5" /> Go to Manage
          </a>
        )}
      </div>

      {/* ─── Design Templates ─────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-white/5 bg-[#111118] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Palette className="w-4 h-4 text-violet-400" />
            Design Templates
          </h2>
          <button
            onClick={() => openTemplateEditor()}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-violet-500/15 text-violet-300 border border-violet-500/20 text-xs font-medium hover:bg-violet-500/25 transition-all"
          >
            <Plus className="w-3 h-3" /> New Design
          </button>
        </div>

        {templates.length === 0 ? (
          <p className="text-xs text-gray-600 text-center py-4">No design templates yet. Create one to apply different visual styles to your batches.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {templates.map((tmpl) => {
              const isSelected = selectedTemplateIds.includes(tmpl.id);
              // Build CSS preview style
              const previewStyle: React.CSSProperties = {
                fontFamily: tmpl.fontFamily.includes("Outfit") ? "Outfit, sans-serif"
                  : tmpl.fontFamily.includes("Inter") ? "Inter, sans-serif"
                  : tmpl.fontFamily.includes("Anton") ? "Anton, sans-serif"
                  : tmpl.fontFamily.includes("Montserrat") ? "Montserrat, sans-serif"
                  : "sans-serif",
                fontSize: Math.min(tmpl.fontSize * 0.35, 18),
                color: tmpl.fontColor,
                textTransform: tmpl.textCase === "UPPERCASE" ? "uppercase"
                  : tmpl.textCase === "LOWERCASE" ? "lowercase"
                  : tmpl.textCase === "CAPITALIZE" ? "capitalize" : "none",
                letterSpacing: `${(tmpl.letterSpacing - 1) * 4}px`,
                textAlign: (tmpl.textAlign || "CENTER").toLowerCase() as any,
                ...(tmpl.strokeEnabled ? {
                  WebkitTextStroke: `${tmpl.strokeWidth}px ${tmpl.strokeColor}`,
                } : {}),
                ...(tmpl.shadowEnabled ? {
                  textShadow: `${tmpl.shadowX}px ${tmpl.shadowY}px 2px ${tmpl.shadowColor}`,
                } : {}),
                ...(tmpl.glowEnabled ? {
                  textShadow: `0 0 ${tmpl.glowIntensity * 4}px ${tmpl.glowColor}, 0 0 ${tmpl.glowIntensity * 8}px ${tmpl.glowColor}`,
                } : {}),
              };
              const stripStyle: React.CSSProperties = {
                backgroundColor: `${tmpl.bgStripColor}${Math.round(tmpl.bgStripOpacity * 255).toString(16).padStart(2, "0")}`,
                borderRadius: `${tmpl.borderRadius}px`,
                padding: `${Math.min(tmpl.paddingY, 10) * 0.5}px ${Math.min(tmpl.paddingX, 10) * 0.5}px`,
                ...(tmpl.stripBorderEnabled ? {
                  border: `${tmpl.stripBorderWidth}px solid ${tmpl.stripBorderColor}`,
                } : {}),
                ...(tmpl.stripShadowEnabled ? {
                  boxShadow: `${tmpl.stripShadowOffset}px ${tmpl.stripShadowOffset}px 8px ${tmpl.stripShadowColor}`,
                } : {}),
              };

              return (
                <div
                  key={tmpl.id}
                  className={`rounded-xl border overflow-hidden transition-all cursor-pointer ${
                    isSelected
                      ? "border-violet-500/50 shadow-lg shadow-violet-500/10 ring-1 ring-violet-500/30"
                      : "border-white/5 hover:border-white/15"
                  }`}
                >
                  {/* Visual Preview Area */}
                  <div
                    className="h-20 flex items-center justify-center relative"
                    style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #0d0d15 100%)" }}
                    onClick={() => toggleTemplateSelection(tmpl.id)}
                  >
                    {tmpl.stripShape !== "NONE" && (
                      <div style={{
                        ...stripStyle,
                        ...(tmpl.stripGradientEnabled ? {
                          background: `linear-gradient(${tmpl.stripGradientAngle}deg, ${tmpl.bgStripColor}, ${tmpl.stripGradientColor2})`,
                        } : {}),
                        ...(tmpl.stripShape === "PILL" ? {
                          borderRadius: "999px",
                          padding: `${Math.min(tmpl.paddingY, 10) * 0.3}px ${Math.min(tmpl.paddingX, 10) * 0.8}px`,
                        } : {}),
                        ...(tmpl.backdropBlurEnabled ? {
                          backdropFilter: `blur(${tmpl.backdropBlurRadius}px)`,
                        } : {}),
                      }}>
                        <span style={previewStyle}>Sample Text</span>
                      </div>
                    )}
                    {tmpl.stripShape === "NONE" && (
                      <span style={previewStyle}>Sample Text</span>
                    )}
                    {tmpl.isPreset && (
                      <span className="absolute top-1 right-1 text-[8px] bg-violet-500/20 text-violet-300 px-1.5 py-0.5 rounded-full">
                        Preset
                      </span>
                    )}
                  </div>

                  {/* Template Info */}
                  <div className="p-2.5 bg-[#0c0c12] flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0" onClick={() => toggleTemplateSelection(tmpl.id)}>
                      <div className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                        isSelected ? "bg-violet-500 border-violet-500" : "border-gray-600"
                      }`}>
                        {isSelected && <Check className="w-2 h-2 text-white" />}
                      </div>
                      <p className="text-xs text-white font-medium truncate">{tmpl.name}</p>
                    </div>
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDuplicateTemplate(tmpl.id); }}
                        className="p-1 rounded text-gray-600 hover:text-green-400 transition-all"
                        title="Duplicate"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); openTemplateEditor(tmpl); }}
                        className="p-1 rounded text-gray-600 hover:text-cyan-400 transition-all"
                        title="Edit"
                      >
                        <Palette className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(tmpl.id); }}
                        className="p-1 rounded text-gray-600 hover:text-red-400 transition-all"
                        title="Delete"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {selectedTemplateIds.length > 0 && (
          <p className="text-xs text-violet-300 font-medium">
            ✓ {selectedTemplateIds.length} design{selectedTemplateIds.length > 1 ? "s" : ""} selected — designs cycle across hooks ({parsedHooks.length > 0 ? `${parsedHooks.length} videos, cycling ${selectedTemplateIds.length} designs` : "upload hooks to see total"})
          </p>
        )}
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
      {showTemplateEditor && editingTemplate ? (
        /* ═══ FULL INLINE DESIGN STUDIO ═══ */
        <div className="space-y-4">
          {/* Template Name + Actions Bar */}
          <div className="flex items-center gap-3 bg-[#111118] rounded-xl border border-violet-500/20 p-3">
            <Palette className="w-5 h-5 text-violet-400 flex-shrink-0" />
            <input
              type="text"
              placeholder="Template name (e.g. Neon Pink, Bold Shadow)"
              value={editingTemplate.name || ""}
              onChange={(e) => updateEditingField("name", e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-violet-500/50"
            />
            <button
              onClick={() => { setShowTemplateEditor(false); setEditingTemplate(null); }}
              className="px-3 py-2 rounded-lg text-gray-500 text-xs hover:text-white hover:bg-white/5 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveTemplate}
              disabled={savingTemplate}
              className="px-5 py-2 rounded-lg bg-gradient-to-r from-violet-500 to-purple-600 text-white text-xs font-semibold hover:from-violet-400 hover:to-purple-500 transition-all disabled:opacity-50 flex items-center gap-1.5"
            >
              {savingTemplate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {editingTemplate.id ? "Update" : "Save"} Template
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
            {/* Left: Enhanced 9:16 Preview */}
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-violet-400" />
                Design Preview
                <span className="text-gray-600 text-[10px] font-normal ml-1">Drag to position</span>
              </h2>
              <div
                ref={previewContainerRef}
                className="relative rounded-2xl overflow-hidden border-2 border-violet-500/20 bg-black mx-auto select-none"
                style={{ width: 300, height: 300 * (OUTPUT_H / OUTPUT_W) }}
              >
                {/* Video Background */}
                {videoObjectUrl ? (
                  <video src={videoObjectUrl} muted loop autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-b from-gray-800 to-gray-900 flex items-center justify-center">
                    <span className="text-gray-700 text-xs">Upload video to preview</span>
                  </div>
                )}

                {/* Text Strip Overlay — uses editingTemplate values */}
                {(editingTemplate.stripShape || "FULL") !== "NONE" && (
                  <div
                    onMouseDown={handlePreviewMouseDown}
                    className="absolute left-0 right-0 flex items-center justify-center"
                    style={{
                      top: `${editingTemplate.positionYPercent ?? 5}%`,
                      padding: `${Math.max(2, (editingTemplate.paddingY ?? 20) * (300 / OUTPUT_W))}px ${Math.max(6, (editingTemplate.paddingX ?? 20) * (300 / OUTPUT_W))}px`,
                      marginLeft: `${(editingTemplate.marginX ?? 0) * (300 / OUTPUT_W)}px`,
                      marginRight: `${(editingTemplate.marginX ?? 0) * (300 / OUTPUT_W)}px`,
                      backgroundColor: editingTemplate.stripGradientEnabled
                        ? undefined
                        : `${editingTemplate.bgStripColor || "#000"}${Math.round((editingTemplate.bgStripOpacity ?? 1) * 255).toString(16).padStart(2, "0")}`,
                      background: editingTemplate.stripGradientEnabled
                        ? `linear-gradient(${editingTemplate.stripGradientAngle ?? 90}deg, ${editingTemplate.bgStripColor || "#000"}${Math.round((editingTemplate.bgStripOpacity ?? 1) * 255).toString(16).padStart(2, "0")}, ${editingTemplate.stripGradientColor2 || "#333"}${Math.round((editingTemplate.bgStripOpacity ?? 1) * 255).toString(16).padStart(2, "0")})`
                        : undefined,
                      borderRadius: (editingTemplate.stripShape || "FULL") === "PILL" ? "999px" : `${Math.max(0, (editingTemplate.borderRadius ?? 12) * (300 / OUTPUT_W))}px`,
                      cursor: isDragging ? "grabbing" : "grab",
                      transition: isDragging ? "none" : "top 0.15s ease-out",
                      ...(editingTemplate.stripBorderEnabled ? { border: `${editingTemplate.stripBorderWidth}px solid ${editingTemplate.stripBorderColor}` } : {}),
                      ...(editingTemplate.stripShadowEnabled ? { boxShadow: `${editingTemplate.stripShadowOffset}px ${editingTemplate.stripShadowOffset}px 8px ${editingTemplate.stripShadowColor}` } : {}),
                      ...(editingTemplate.backdropBlurEnabled ? { backdropFilter: `blur(${editingTemplate.backdropBlurRadius ?? 10}px)` } : {}),
                      overflow: "hidden",
                    }}
                  >
                    <span
                      className="text-center leading-tight"
                      style={{
                        color: editingTemplate.fontColor || "#FFF",
                        fontSize: Math.max(8, (editingTemplate.fontSize ?? 42) * (300 / OUTPUT_W)),
                        fontFamily: (editingTemplate.fontFamily || "Outfit-Bold").includes("Outfit") ? "Outfit, sans-serif" : "sans-serif",
                        fontWeight: "bold",
                        textTransform: editingTemplate.textCase === "UPPERCASE" ? "uppercase" : editingTemplate.textCase === "LOWERCASE" ? "lowercase" : "none",
                        letterSpacing: `${((editingTemplate.letterSpacing ?? 1) - 1) * 4}px`,
                        wordBreak: "break-word",
                        ...(editingTemplate.doubleTextEnabled ? {
                          WebkitTextStroke: `${editingTemplate.doubleTextOutlineWidth ?? 4}px ${editingTemplate.doubleTextOutlineColor || "#000"}`,
                          paintOrder: "stroke fill",
                        } : editingTemplate.strokeEnabled ? {
                          WebkitTextStroke: `${editingTemplate.strokeWidth}px ${editingTemplate.strokeColor}`,
                        } : {}),
                        ...(editingTemplate.glowEnabled ? {
                          textShadow: `0 0 ${(editingTemplate.glowIntensity ?? 2) * 4}px ${editingTemplate.glowColor}, 0 0 ${(editingTemplate.glowIntensity ?? 2) * 8}px ${editingTemplate.glowColor}`,
                        } : editingTemplate.shadowEnabled ? {
                          textShadow: `${editingTemplate.shadowX}px ${editingTemplate.shadowY}px 2px ${editingTemplate.shadowColor}`,
                        } : {}),
                        ...(editingTemplate.textGradientEnabled ? {
                          background: `linear-gradient(${editingTemplate.textGradientAngle ?? 180}deg, ${editingTemplate.textGradientColor1 || "#FFF"}, ${editingTemplate.textGradientColor2 || "#0FF"})`,
                          WebkitBackgroundClip: "text",
                          WebkitTextFillColor: "transparent",
                          backgroundClip: "text",
                        } : {}),
                      }}
                    >
                      {previewText}
                    </span>
                  </div>
                )}
                {(editingTemplate.stripShape || "FULL") === "NONE" && (
                  <div
                    onMouseDown={handlePreviewMouseDown}
                    className="absolute left-0 right-0 flex items-center justify-center"
                    style={{
                      top: `${editingTemplate.positionYPercent ?? 5}%`,
                      padding: `8px ${Math.max(6, (editingTemplate.paddingX ?? 20) * (300 / OUTPUT_W))}px`,
                      cursor: isDragging ? "grabbing" : "grab",
                      transition: isDragging ? "none" : "top 0.15s ease-out",
                    }}
                  >
                    <span
                      className="text-center leading-tight"
                      style={{
                        color: editingTemplate.fontColor || "#FFF",
                        fontSize: Math.max(8, (editingTemplate.fontSize ?? 42) * (300 / OUTPUT_W)),
                        fontFamily: (editingTemplate.fontFamily || "Outfit-Bold").includes("Outfit") ? "Outfit, sans-serif" : "sans-serif",
                        fontWeight: "bold",
                        textTransform: editingTemplate.textCase === "UPPERCASE" ? "uppercase" : editingTemplate.textCase === "LOWERCASE" ? "lowercase" : "none",
                        wordBreak: "break-word",
                        ...(editingTemplate.strokeEnabled ? { WebkitTextStroke: `${editingTemplate.strokeWidth}px ${editingTemplate.strokeColor}` } : {}),
                        ...(editingTemplate.glowEnabled ? { textShadow: `0 0 ${(editingTemplate.glowIntensity ?? 2) * 4}px ${editingTemplate.glowColor}` } : {}),
                        ...(editingTemplate.textGradientEnabled ? {
                          background: `linear-gradient(${editingTemplate.textGradientAngle ?? 180}deg, ${editingTemplate.textGradientColor1 || "#FFF"}, ${editingTemplate.textGradientColor2 || "#0FF"})`,
                          WebkitBackgroundClip: "text",
                          WebkitTextFillColor: "transparent",
                          backgroundClip: "text",
                        } : {}),
                      }}
                    >
                      {previewText}
                    </span>
                  </div>
                )}

                {/* Position indicator */}
                <div className="absolute bottom-2 right-2 bg-black/70 text-gray-300 text-[9px] px-1.5 py-0.5 rounded font-mono">
                  Y: {editingTemplate.positionYPercent ?? 5}%
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
                    onClick={() => updateEditingField("positionYPercent", p.value)}
                    className={`flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-all border ${
                      (editingTemplate.positionYPercent ?? 5) === p.value
                        ? "bg-violet-500/15 text-violet-300 border-violet-500/30"
                        : "bg-white/5 text-gray-600 border-white/5 hover:border-white/10 hover:text-gray-400"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Right: Tabbed Controls */}
            <div className="space-y-3">
              {/* Tab Bar */}
              <div className="flex gap-1 bg-[#0c0c12] rounded-xl p-1 border border-white/5">
                {([
                  { key: "typography" as const, label: "Typography", icon: "Aa" },
                  { key: "effects" as const, label: "Effects", icon: "✦" },
                  { key: "strip" as const, label: "Strip & Layout", icon: "▬" },
                  { key: "animation" as const, label: "Animation", icon: "⚡" },
                ]).map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setDesignTab(tab.key)}
                    className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all ${
                      designTab === tab.key
                        ? "bg-violet-500/15 text-violet-300 border border-violet-500/30"
                        : "text-gray-500 hover:text-white border border-transparent"
                    }`}
                  >
                    <span className="mr-1.5">{tab.icon}</span>
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              <div className="rounded-2xl border border-white/5 bg-[#111118] p-5">

                {/* ═══ TYPOGRAPHY TAB ═══ */}
                {designTab === "typography" && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Font</label>
                      <select value={editingTemplate.fontFamily || "Outfit-Bold"} onChange={(e) => updateEditingField("fontFamily", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-violet-500/50">
                        {FONT_OPTIONS.map((f) => <option key={f} value={f} className="bg-[#111]">{f}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Size: {editingTemplate.fontSize}px</label>
                      <input type="range" min={16} max={120} value={editingTemplate.fontSize ?? 42} onChange={(e) => updateEditingField("fontSize", Number(e.target.value))} className="w-full accent-violet-500" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Color</label>
                      <div className="flex items-center gap-2">
                        <input type="color" value={editingTemplate.fontColor || "#FFFFFF"} onChange={(e) => updateEditingField("fontColor", e.target.value)} className="w-8 h-7 rounded cursor-pointer bg-transparent border border-white/10" />
                        <input type="text" value={editingTemplate.fontColor || "#FFFFFF"} onChange={(e) => updateEditingField("fontColor", e.target.value)} className="flex-1 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs font-mono" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Case</label>
                      <div className="grid grid-cols-4 gap-1.5">
                        {["UPPERCASE", "LOWERCASE", "CAPITALIZE", "NONE"].map((c) => (
                          <button key={c} onClick={() => updateEditingField("textCase", c)} className={`py-1.5 rounded-lg text-[10px] font-medium transition-all border ${editingTemplate.textCase === c ? "bg-violet-500/15 text-violet-300 border-violet-500/30" : "bg-white/5 text-gray-500 border-white/5 hover:text-white"}`}>
                            {c === "NONE" ? "As is" : c === "CAPITALIZE" ? "Abc" : c === "LOWERCASE" ? "abc" : "ABC"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Letter Spacing: {editingTemplate.letterSpacing?.toFixed(1)}×</label>
                        <input type="range" min={0.5} max={2} step={0.1} value={editingTemplate.letterSpacing ?? 1} onChange={(e) => updateEditingField("letterSpacing", Number(e.target.value))} className="w-full accent-violet-500" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Line Height: {editingTemplate.lineHeight?.toFixed(1)}×</label>
                        <input type="range" min={1.0} max={2.5} step={0.1} value={editingTemplate.lineHeight ?? 1.4} onChange={(e) => updateEditingField("lineHeight", Number(e.target.value))} className="w-full accent-violet-500" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Alignment</label>
                      <div className="flex gap-1">
                        {["LEFT", "CENTER", "RIGHT"].map((a) => (
                          <button key={a} onClick={() => updateEditingField("textAlign", a)} className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${editingTemplate.textAlign === a ? "bg-violet-500/20 text-violet-300 border border-violet-500/30" : "bg-white/5 text-gray-500 border border-white/5 hover:text-white"}`}>
                            {a}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* ═══ EFFECTS TAB ═══ */}
                {designTab === "effects" && (
                  <div className="space-y-4">
                    {/* Stroke */}
                    <div className="rounded-xl border border-white/5 p-3 space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={editingTemplate.strokeEnabled ?? false} onChange={(e) => updateEditingField("strokeEnabled", e.target.checked)} className="accent-violet-500" />
                        <span className="text-xs text-white font-medium">Text Stroke / Outline</span>
                      </label>
                      {editingTemplate.strokeEnabled && (
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <label className="block text-[10px] text-gray-500 mb-1">Color</label>
                            <div className="flex gap-1">
                              <input type="color" value={editingTemplate.strokeColor || "#000000"} onChange={(e) => updateEditingField("strokeColor", e.target.value)} className="w-7 h-7 rounded cursor-pointer bg-transparent" />
                              <input type="text" value={editingTemplate.strokeColor || "#000000"} onChange={(e) => updateEditingField("strokeColor", e.target.value)} className="flex-1 px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white text-xs font-mono" />
                            </div>
                          </div>
                          <div className="w-24">
                            <label className="block text-[10px] text-gray-500 mb-1">Width: {editingTemplate.strokeWidth}px</label>
                            <input type="range" min={1} max={8} value={editingTemplate.strokeWidth ?? 2} onChange={(e) => updateEditingField("strokeWidth", Number(e.target.value))} className="w-full accent-violet-500" />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Shadow */}
                    <div className="rounded-xl border border-white/5 p-3 space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={editingTemplate.shadowEnabled ?? false} onChange={(e) => updateEditingField("shadowEnabled", e.target.checked)} className="accent-violet-500" />
                        <span className="text-xs text-white font-medium">Drop Shadow</span>
                      </label>
                      {editingTemplate.shadowEnabled && (
                        <div className="space-y-2">
                          <div>
                            <label className="block text-[10px] text-gray-500 mb-1">Color</label>
                            <div className="flex gap-1">
                              <input type="color" value={editingTemplate.shadowColor || "#000000"} onChange={(e) => updateEditingField("shadowColor", e.target.value)} className="w-7 h-7 rounded cursor-pointer bg-transparent" />
                              <input type="text" value={editingTemplate.shadowColor || "#000000"} onChange={(e) => updateEditingField("shadowColor", e.target.value)} className="flex-1 px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white text-xs font-mono" />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <label className="block text-[10px] text-gray-500 mb-1">X: {editingTemplate.shadowX}px</label>
                              <input type="range" min={0} max={10} value={editingTemplate.shadowX ?? 2} onChange={(e) => updateEditingField("shadowX", Number(e.target.value))} className="w-full accent-violet-500" />
                            </div>
                            <div className="flex-1">
                              <label className="block text-[10px] text-gray-500 mb-1">Y: {editingTemplate.shadowY}px</label>
                              <input type="range" min={0} max={10} value={editingTemplate.shadowY ?? 2} onChange={(e) => updateEditingField("shadowY", Number(e.target.value))} className="w-full accent-violet-500" />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Neon Glow */}
                    <div className="rounded-xl border border-white/5 p-3 space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={editingTemplate.glowEnabled ?? false} onChange={(e) => updateEditingField("glowEnabled", e.target.checked)} className="accent-violet-500" />
                        <span className="text-xs text-white font-medium">Neon Glow</span>
                      </label>
                      {editingTemplate.glowEnabled && (
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <label className="block text-[10px] text-gray-500 mb-1">Color</label>
                            <div className="flex gap-1">
                              <input type="color" value={editingTemplate.glowColor || "#FF00FF"} onChange={(e) => updateEditingField("glowColor", e.target.value)} className="w-7 h-7 rounded cursor-pointer bg-transparent" />
                              <input type="text" value={editingTemplate.glowColor || "#FF00FF"} onChange={(e) => updateEditingField("glowColor", e.target.value)} className="flex-1 px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white text-xs font-mono" />
                            </div>
                          </div>
                          <div className="w-24">
                            <label className="block text-[10px] text-gray-500 mb-1">Intensity: {editingTemplate.glowIntensity}</label>
                            <input type="range" min={1} max={5} value={editingTemplate.glowIntensity ?? 2} onChange={(e) => updateEditingField("glowIntensity", Number(e.target.value))} className="w-full accent-violet-500" />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Double Text */}
                    <div className="rounded-xl border border-white/5 p-3 space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={editingTemplate.doubleTextEnabled ?? false} onChange={(e) => updateEditingField("doubleTextEnabled", e.target.checked)} className="accent-violet-500" />
                        <span className="text-xs text-white font-medium">Double Text (Outline + Fill)</span>
                      </label>
                      {editingTemplate.doubleTextEnabled && (
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <label className="block text-[10px] text-gray-500 mb-1">Outline Color</label>
                            <div className="flex gap-1">
                              <input type="color" value={editingTemplate.doubleTextOutlineColor || "#000000"} onChange={(e) => updateEditingField("doubleTextOutlineColor", e.target.value)} className="w-7 h-7 rounded cursor-pointer bg-transparent" />
                              <input type="text" value={editingTemplate.doubleTextOutlineColor || "#000000"} onChange={(e) => updateEditingField("doubleTextOutlineColor", e.target.value)} className="flex-1 px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white text-xs font-mono" />
                            </div>
                          </div>
                          <div className="w-24">
                            <label className="block text-[10px] text-gray-500 mb-1">Outline: {editingTemplate.doubleTextOutlineWidth}px</label>
                            <input type="range" min={1} max={10} value={editingTemplate.doubleTextOutlineWidth ?? 4} onChange={(e) => updateEditingField("doubleTextOutlineWidth", Number(e.target.value))} className="w-full accent-violet-500" />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Text Gradient */}
                    <div className="rounded-xl border border-white/5 p-3 space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={editingTemplate.textGradientEnabled ?? false} onChange={(e) => updateEditingField("textGradientEnabled", e.target.checked)} className="accent-violet-500" />
                        <span className="text-xs text-white font-medium">Text Gradient</span>
                      </label>
                      {editingTemplate.textGradientEnabled && (
                        <div className="space-y-2">
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <label className="block text-[10px] text-gray-500 mb-1">Color 1</label>
                              <div className="flex gap-1">
                                <input type="color" value={editingTemplate.textGradientColor1 || "#FFFFFF"} onChange={(e) => updateEditingField("textGradientColor1", e.target.value)} className="w-7 h-7 rounded cursor-pointer bg-transparent" />
                                <input type="text" value={editingTemplate.textGradientColor1 || "#FFFFFF"} onChange={(e) => updateEditingField("textGradientColor1", e.target.value)} className="flex-1 px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white text-xs font-mono" />
                              </div>
                            </div>
                            <div className="flex-1">
                              <label className="block text-[10px] text-gray-500 mb-1">Color 2</label>
                              <div className="flex gap-1">
                                <input type="color" value={editingTemplate.textGradientColor2 || "#00FFFF"} onChange={(e) => updateEditingField("textGradientColor2", e.target.value)} className="w-7 h-7 rounded cursor-pointer bg-transparent" />
                                <input type="text" value={editingTemplate.textGradientColor2 || "#00FFFF"} onChange={(e) => updateEditingField("textGradientColor2", e.target.value)} className="flex-1 px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white text-xs font-mono" />
                              </div>
                            </div>
                          </div>
                          <div>
                            <label className="block text-[10px] text-gray-500 mb-1">Angle: {editingTemplate.textGradientAngle}°</label>
                            <input type="range" min={0} max={360} value={editingTemplate.textGradientAngle ?? 180} onChange={(e) => updateEditingField("textGradientAngle", Number(e.target.value))} className="w-full accent-violet-500" />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ═══ STRIP & LAYOUT TAB ═══ */}
                {designTab === "strip" && (
                  <div className="space-y-4">
                    {/* Strip Shape */}
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Strip Shape</label>
                      <div className="flex gap-1">
                        {["FULL", "PILL", "NONE"].map((s) => (
                          <button key={s} onClick={() => updateEditingField("stripShape", s)} className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${(editingTemplate.stripShape || "FULL") === s ? "bg-violet-500/20 text-violet-300 border border-violet-500/30" : "bg-white/5 text-gray-500 border border-white/5 hover:text-white"}`}>
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* Background Color */}
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Background</label>
                      <div className="flex items-center gap-2">
                        <input type="color" value={editingTemplate.bgStripColor || "#000000"} onChange={(e) => updateEditingField("bgStripColor", e.target.value)} className="w-8 h-7 rounded border border-white/10 cursor-pointer bg-transparent" />
                        <input type="text" value={editingTemplate.bgStripColor || "#000000"} onChange={(e) => updateEditingField("bgStripColor", e.target.value)} className="flex-1 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-xs font-mono" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Opacity: {Math.round((editingTemplate.bgStripOpacity ?? 1) * 100)}%</label>
                      <input type="range" min={0} max={100} value={Math.round((editingTemplate.bgStripOpacity ?? 1) * 100)} onChange={(e) => updateEditingField("bgStripOpacity", Number(e.target.value) / 100)} className="w-full accent-violet-500" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Corner Radius: {editingTemplate.borderRadius}px</label>
                      <input type="range" min={0} max={40} value={editingTemplate.borderRadius ?? 12} onChange={(e) => updateEditingField("borderRadius", Number(e.target.value))} className="w-full accent-violet-500" />
                    </div>
                    {/* Gradient Strip */}
                    <div className="rounded-xl border border-white/5 p-3 space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={editingTemplate.stripGradientEnabled ?? false} onChange={(e) => updateEditingField("stripGradientEnabled", e.target.checked)} className="accent-violet-500" />
                        <span className="text-xs text-white font-medium">Gradient Strip</span>
                      </label>
                      {editingTemplate.stripGradientEnabled && (
                        <div className="space-y-2">
                          <div>
                            <label className="block text-[10px] text-gray-500 mb-1">Color 2</label>
                            <div className="flex gap-1">
                              <input type="color" value={editingTemplate.stripGradientColor2 || "#333333"} onChange={(e) => updateEditingField("stripGradientColor2", e.target.value)} className="w-7 h-7 rounded cursor-pointer bg-transparent" />
                              <input type="text" value={editingTemplate.stripGradientColor2 || "#333333"} onChange={(e) => updateEditingField("stripGradientColor2", e.target.value)} className="flex-1 px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white text-xs font-mono" />
                            </div>
                          </div>
                          <div>
                            <label className="block text-[10px] text-gray-500 mb-1">Angle: {editingTemplate.stripGradientAngle}°</label>
                            <input type="range" min={0} max={360} value={editingTemplate.stripGradientAngle ?? 90} onChange={(e) => updateEditingField("stripGradientAngle", Number(e.target.value))} className="w-full accent-violet-500" />
                          </div>
                        </div>
                      )}
                    </div>
                    {/* Backdrop Blur */}
                    <div className="rounded-xl border border-white/5 p-3 space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={editingTemplate.backdropBlurEnabled ?? false} onChange={(e) => updateEditingField("backdropBlurEnabled", e.target.checked)} className="accent-violet-500" />
                        <span className="text-xs text-white font-medium">Backdrop Blur</span>
                      </label>
                      {editingTemplate.backdropBlurEnabled && (
                        <div>
                          <label className="block text-[10px] text-gray-500 mb-1">Radius: {editingTemplate.backdropBlurRadius}px</label>
                          <input type="range" min={2} max={30} value={editingTemplate.backdropBlurRadius ?? 10} onChange={(e) => updateEditingField("backdropBlurRadius", Number(e.target.value))} className="w-full accent-violet-500" />
                        </div>
                      )}
                    </div>
                    {/* Strip Border */}
                    <div className="rounded-xl border border-white/5 p-3 space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={editingTemplate.stripBorderEnabled ?? false} onChange={(e) => updateEditingField("stripBorderEnabled", e.target.checked)} className="accent-violet-500" />
                        <span className="text-xs text-white font-medium">Strip Border</span>
                      </label>
                      {editingTemplate.stripBorderEnabled && (
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <label className="block text-[10px] text-gray-500 mb-1">Color</label>
                            <div className="flex gap-1">
                              <input type="color" value={editingTemplate.stripBorderColor || "#FFFFFF"} onChange={(e) => updateEditingField("stripBorderColor", e.target.value)} className="w-7 h-7 rounded cursor-pointer bg-transparent" />
                              <input type="text" value={editingTemplate.stripBorderColor || "#FFFFFF"} onChange={(e) => updateEditingField("stripBorderColor", e.target.value)} className="flex-1 px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white text-xs font-mono" />
                            </div>
                          </div>
                          <div className="w-20">
                            <label className="block text-[10px] text-gray-500 mb-1">Width: {editingTemplate.stripBorderWidth}px</label>
                            <input type="range" min={1} max={5} value={editingTemplate.stripBorderWidth ?? 1} onChange={(e) => updateEditingField("stripBorderWidth", Number(e.target.value))} className="w-full accent-violet-500" />
                          </div>
                        </div>
                      )}
                    </div>
                    {/* Strip Shadow */}
                    <div className="rounded-xl border border-white/5 p-3 space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={editingTemplate.stripShadowEnabled ?? false} onChange={(e) => updateEditingField("stripShadowEnabled", e.target.checked)} className="accent-violet-500" />
                        <span className="text-xs text-white font-medium">Strip Shadow</span>
                      </label>
                      {editingTemplate.stripShadowEnabled && (
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <label className="block text-[10px] text-gray-500 mb-1">Color</label>
                            <div className="flex gap-1">
                              <input type="color" value={editingTemplate.stripShadowColor || "#000000"} onChange={(e) => updateEditingField("stripShadowColor", e.target.value)} className="w-7 h-7 rounded cursor-pointer bg-transparent" />
                              <input type="text" value={editingTemplate.stripShadowColor || "#000000"} onChange={(e) => updateEditingField("stripShadowColor", e.target.value)} className="flex-1 px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white text-xs font-mono" />
                            </div>
                          </div>
                          <div className="w-20">
                            <label className="block text-[10px] text-gray-500 mb-1">Offset: {editingTemplate.stripShadowOffset}px</label>
                            <input type="range" min={1} max={12} value={editingTemplate.stripShadowOffset ?? 4} onChange={(e) => updateEditingField("stripShadowOffset", Number(e.target.value))} className="w-full accent-violet-500" />
                          </div>
                        </div>
                      )}
                    </div>
                    {/* Layout Controls */}
                    <div className="border-t border-white/5 pt-4 space-y-3">
                      <h4 className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">Position & Spacing</h4>
                      <div>
                        <label className="block text-[10px] text-gray-500 mb-1">Y Position: {editingTemplate.positionYPercent}%</label>
                        <input type="range" min={0} max={100} value={editingTemplate.positionYPercent ?? 5} onChange={(e) => updateEditingField("positionYPercent", Number(e.target.value))} className="w-full accent-violet-500" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-500 mb-1">Horizontal Margin: {editingTemplate.marginX}px</label>
                        <input type="range" min={0} max={200} value={editingTemplate.marginX ?? 0} onChange={(e) => updateEditingField("marginX", Number(e.target.value))} className="w-full accent-violet-500" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] text-gray-500 mb-1">Padding Y: {editingTemplate.paddingY}px</label>
                          <input type="range" min={0} max={60} value={editingTemplate.paddingY ?? 20} onChange={(e) => updateEditingField("paddingY", Number(e.target.value))} className="w-full accent-violet-500" />
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-500 mb-1">Padding X: {editingTemplate.paddingX}px</label>
                          <input type="range" min={0} max={60} value={editingTemplate.paddingX ?? 20} onChange={(e) => updateEditingField("paddingX", Number(e.target.value))} className="w-full accent-violet-500" />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ═══ ANIMATION TAB ═══ */}
                {designTab === "animation" && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Entrance Type</label>
                      <div className="grid grid-cols-4 gap-1.5">
                        {["NONE", "FADE_IN", "SLIDE_UP", "SCALE_IN"].map((a) => (
                          <button key={a} onClick={() => updateEditingField("animationType", a)} className={`py-2 rounded-lg text-[10px] font-medium transition-all border ${(editingTemplate.animationType || "NONE") === a ? "bg-amber-500/15 text-amber-300 border-amber-500/30" : "bg-white/5 text-gray-500 border-white/5 hover:text-white"}`}>
                            {a.replace("_", " ")}
                          </button>
                        ))}
                      </div>
                    </div>
                    {editingTemplate.animationType && editingTemplate.animationType !== "NONE" && (
                      <div>
                        <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Duration: {editingTemplate.animationDuration?.toFixed(1)}s</label>
                        <input type="range" min={0.2} max={1.5} step={0.1} value={editingTemplate.animationDuration ?? 0.5} onChange={(e) => updateEditingField("animationDuration", Number(e.target.value))} className="w-full accent-amber-500" />
                      </div>
                    )}
                    <p className="text-[10px] text-gray-600">
                      Animation controls how the text hook appears when the video plays. The effect is applied during FFmpeg rendering.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ═══ NORMAL INLINE CONTROLS (no template editing) ═══ */
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
                  overflow: "hidden",
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
      )}

      {/* Create Button */}
      <button
        onClick={handleCreateBatch}
        disabled={uploading || !videoFile || !csvFile || parsedHooks.length === 0}
        className="w-full py-3.5 rounded-xl font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2"
      >
        {uploading ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</>
        ) : (
          <><Layers className="w-4 h-4" /> Create Batch {parsedHooks.length > 0 && `(${parsedHooks.length} video${parsedHooks.length > 1 ? "s" : ""}${selectedTemplateIds.length > 1 ? `, cycling ${selectedTemplateIds.length} designs` : ""})`}</>
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
                        {renamingBatchId === batch.id ? (
                          <input
                            autoFocus
                            className="bg-white/5 border border-white/10 rounded-lg px-2 py-0.5 text-white text-sm font-semibold outline-none focus:border-cyan-500/50 w-48"
                            value={renamingBatchValue}
                            onChange={(e) => setRenamingBatchValue(e.target.value)}
                            onBlur={() => { if (renamingBatchValue.trim()) handleRenameBatch(batch.id, renamingBatchValue.trim()); else setRenamingBatchId(null); }}
                            onKeyDown={(e) => { if (e.key === "Enter" && renamingBatchValue.trim()) handleRenameBatch(batch.id, renamingBatchValue.trim()); if (e.key === "Escape") setRenamingBatchId(null); }}
                          />
                        ) : (
                          <h3
                            className="text-white font-semibold text-sm truncate cursor-pointer hover:text-cyan-300 transition-colors"
                            onDoubleClick={() => { setRenamingBatchId(batch.id); setRenamingBatchValue(batch.name || `Batch ${batch.id.substring(0, 8)}`); }}
                            title="Double-click to rename"
                          >
                            {batch.name || `Batch ${batch.id.substring(0, 8)}`}
                          </h3>
                        )}
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
                      {batch.status === "COMPLETED" && failedCount > 0 && (
                        <button onClick={() => handleRetryFailed(batch.id)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 text-white text-xs font-medium hover:from-amber-400 hover:to-orange-500 transition-all">
                          <RefreshCw className="w-3.5 h-3.5" /> Retry Failed ({failedCount})
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
                      {/* Drive Folders + Export */}
                      {driveConnected && renderedCount > 0 && (
                        <>
                          <button
                            onClick={() => { setMultiFolderPickerBatchId(batch.id); setMultiFolderSearch(""); setMultiFolderResults([]); searchMultiFolders(""); }}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500/10 text-blue-300 border border-blue-500/20 text-xs font-medium hover:bg-blue-500/20 transition-all"
                          >
                            <FolderOpen className="w-3.5 h-3.5" />
                            Select Folders
                            {(batchSelectedFolders[batch.id]?.length || 0) > 0 && (
                              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-blue-500/30 text-[9px] font-bold">{batchSelectedFolders[batch.id].length}</span>
                            )}
                          </button>
                          <button
                            onClick={() => handleExportToDrive(batch.id)}
                            disabled={exportingBatches.has(batch.id) || batch.driveExportStatus === "EXPORTING" || !batch.items.some((i: any) => i.driveFolderId || batch.driveFolderId)}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-50 ${
                              batch.driveExportStatus === "FAILED"
                                ? "bg-red-500/10 text-red-300 border border-red-500/20 hover:bg-red-500/20"
                                : "bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 hover:bg-cyan-500/20"
                            }`}
                            title={batch.items.some((i: any) => i.driveFolderId || batch.driveFolderId) ? "Export all to assigned Drive folders" : "Assign Drive folders to items first"}
                          >
                            {exportingBatches.has(batch.id) || batch.driveExportStatus === "EXPORTING" ? (
                              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Exporting...</>
                            ) : batch.driveExportStatus === "EXPORTED" ? (
                              <><Check className="w-3.5 h-3.5" /> Exported</>
                            ) : batch.driveExportStatus === "FAILED" ? (
                              <><RefreshCw className="w-3.5 h-3.5" /> Retry Export</>
                            ) : (
                              <><Cloud className="w-3.5 h-3.5" /> Export All</>
                            )}
                          </button>
                        </>
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
                  <div className="border-t border-white/5 max-h-80 overflow-y-auto">
                    {batch.items.map((item, idx) => (
                      <div key={item.id} className="flex items-center gap-3 px-5 py-2.5 border-b border-white/[0.03] last:border-b-0 hover:bg-white/[0.02] transition-all">
                        <span className="text-gray-700 text-xs font-mono w-6 text-right flex-shrink-0">{idx + 1}</span>
                        {itemIcon(item.status)}
                        <span className="text-gray-400 text-sm flex-1 truncate">{item.hookText}</span>
                        {/* Per-item Drive folder selector */}
                        {driveConnected && item.status === "RENDERED" && (
                          <button
                            onClick={() => { setFolderPickerTarget({ type: "item", id: item.id }); setFolderSearch(""); setDriveFolders([]); searchDriveFolders(""); }}
                            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all flex-shrink-0 ${
                              item.driveFolderId
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20"
                                : "bg-white/5 text-gray-500 border border-white/10 hover:bg-white/10 hover:text-gray-300"
                            }`}
                            title={item.driveFolderName || "Select Drive folder"}
                          >
                            <FolderOpen className="w-3 h-3" />
                            {item.driveFolderName ? item.driveFolderName.substring(0, 12) : "Folder"}
                          </button>
                        )}
                        {item.renderedVideoUrl && (
                          <button onClick={() => setPreviewUrl(item.renderedVideoUrl)} className="text-cyan-500 hover:text-cyan-300 transition-all flex-shrink-0">
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
      {/* ─── Folder Picker Modal ──────────────────────────────────────────── */}
      {folderPickerTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setFolderPickerTarget(null)}>
          <div className="bg-[#16161f] rounded-2xl border border-white/10 p-5 max-w-md w-full mx-4 shadow-2xl space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-white text-sm font-semibold flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-blue-400" /> Select Drive Folder
                <span className="text-gray-600 text-[10px] font-normal">
                  ({folderPickerTarget.type === "item" ? "for video" : "for batch"})
                </span>
              </h3>
              <button onClick={() => setFolderPickerTarget(null)} className="text-gray-500 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Search folders..."
                value={folderSearch}
                onChange={(e) => setFolderSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchDriveFolders(folderSearch)}
                className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-blue-500/50"
              />
              <button
                onClick={() => searchDriveFolders(folderSearch)}
                disabled={searchingFolders}
                className="px-3 py-2 rounded-lg bg-blue-500/15 text-blue-300 border border-blue-500/20 text-xs font-medium hover:bg-blue-500/25 transition-all disabled:opacity-50"
              >
                {searchingFolders ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </button>
            </div>

            <div className="max-h-64 overflow-y-auto space-y-1">
              {driveFolders.length === 0 ? (
                <p className="text-xs text-gray-600 text-center py-6">
                  {searchingFolders ? "Searching..." : "Type to search for folders"}
                </p>
              ) : (
                driveFolders.map((folder) => (
                  <button
                    key={folder.id}
                    onClick={() => handleAssignFolder(folderPickerTarget.id, folder.id, folder.name)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/5 text-left transition-all group"
                  >
                    <FolderOpen className="w-4 h-4 text-blue-400 flex-shrink-0" />
                    <span className="text-sm text-gray-300 group-hover:text-white truncate">{folder.name}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      {/* ─── Multi-Folder Picker Modal ──────────────────────────────────── */}
      {multiFolderPickerBatchId && (() => {
        const targetBatch = batches.find((b) => b.id === multiFolderPickerBatchId);
        const renderedCount = targetBatch?.items.filter((i) => i.status === "RENDERED").length || 0;
        const selectedFolders = batchSelectedFolders[multiFolderPickerBatchId] || [];
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setMultiFolderPickerBatchId(null)}>
            <div className="bg-[#16161f] rounded-2xl border border-white/10 p-5 max-w-md w-full mx-4 shadow-2xl space-y-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-white text-sm font-semibold flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-blue-400" /> Select Multiple Folders
                </h3>
                <button onClick={() => setMultiFolderPickerBatchId(null)} className="text-gray-500 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-gray-500 text-[11px]">
                Select folders and they will be distributed round-robin across {renderedCount} rendered videos.
                {selectedFolders.length > 0 && (
                  <span className="text-blue-400 ml-1">{selectedFolders.length} folder(s) selected</span>
                )}
              </p>

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Search folders..."
                  value={multiFolderSearch}
                  onChange={(e) => setMultiFolderSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && searchMultiFolders(multiFolderSearch)}
                  className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-blue-500/50"
                />
                <button
                  onClick={() => searchMultiFolders(multiFolderSearch)}
                  disabled={searchingMultiFolders}
                  className="px-3 py-2 rounded-lg bg-blue-500/15 text-blue-300 border border-blue-500/20 text-xs font-medium hover:bg-blue-500/25 transition-all disabled:opacity-50"
                >
                  {searchingMultiFolders ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                </button>
              </div>

              {/* Selected folders chips */}
              {selectedFolders.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedFolders.map((f, idx) => (
                    <span
                      key={f.id}
                      className="flex items-center gap-1 px-2 py-1 rounded-md bg-blue-500/15 text-blue-300 text-[10px] font-medium border border-blue-500/20"
                    >
                      <span className="text-blue-500/50 font-mono">{idx + 1}.</span>
                      {f.name.substring(0, 18)}
                      <button onClick={() => handleBatchMultiFolderSelect(multiFolderPickerBatchId, f)} className="ml-0.5 text-blue-400/50 hover:text-red-400">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="max-h-48 overflow-y-auto space-y-1">
                {multiFolderResults.length === 0 ? (
                  <p className="text-xs text-gray-600 text-center py-6">
                    {searchingMultiFolders ? "Searching..." : "Type to search for folders"}
                  </p>
                ) : (
                  multiFolderResults.map((folder) => {
                    const isSelected = selectedFolders.some((f) => f.id === folder.id);
                    return (
                      <button
                        key={folder.id}
                        onClick={() => handleBatchMultiFolderSelect(multiFolderPickerBatchId, folder)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all group ${isSelected ? "bg-blue-500/10 border border-blue-500/20" : "hover:bg-white/5"}`}
                      >
                        <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${isSelected ? "bg-blue-500 border-blue-500" : "border-white/20"}`}>
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <FolderOpen className="w-4 h-4 text-blue-400 flex-shrink-0" />
                        <span className={`text-sm truncate ${isSelected ? "text-white" : "text-gray-300 group-hover:text-white"}`}>{folder.name}</span>
                      </button>
                    );
                  })
                )}
              </div>

              {/* Assign button */}
              <button
                onClick={() => handleBatchMultiFolderAssign(multiFolderPickerBatchId)}
                disabled={selectedFolders.length === 0}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-500 text-white text-sm font-semibold hover:from-blue-400 hover:to-cyan-400 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Assign {selectedFolders.length} Folder{selectedFolders.length !== 1 ? "s" : ""} to {renderedCount} Videos
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
