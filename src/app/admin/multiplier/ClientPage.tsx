"use client";

import React, { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { naturalCompare } from "@/lib/utils/sorting";
import {
  Layers,
  Video,
  Sparkles,
  Upload,
  Play,
  Check,
  X,
  Trash,
  Plus,
  RefreshCw,
  FileSpreadsheet,
  Settings2,
  AlertCircle,
  PlusCircle,
  CheckCircle2,
  Loader2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  Search,
  Download,
  Eye,
  Trash2,
  CheckSquare,
  Square,
  Minus,
  Pause,
  ChevronRight,
} from "lucide-react";

const COLOR_MAP: Record<string, string> = {
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#f59e0b",
  green: "#10b981",
  blue: "#3b82f6",
  purple: "#8b5cf6",
  pink: "#ec4899",
  zinc: "#71717a",
  gray: "#71717a",
};

interface Campaign {
  id: string;
  title: string;
  type: string;
  description: string;
  brief: string;
  infoContent?: string | null;
}

interface MultiplierHook {
  id: string;
  text: string;
  source: string;
  order: number;
}

interface MultiplierVariation {
  id: string;
  videoRef: string;
  order: number;
}

interface MultiplierOutput {
  id: string;
  variationId: string;
  hookId: string;
  status: "PENDING" | "RENDERING" | "COMPLETED" | "FAILED";
  outputRef: string | null;
  driveFolderId: string | null;
  driveFolderName: string | null;
  googleEmail: string | null;
  errorMessage: string | null;
  exportedAt: string | null;
  exportStatus?: "not_exported" | "exporting" | "exported";
  exportDestinationFolderId?: string | null;
  exportDestinationFolderName?: string | null;
  variation: { videoRef: string };
  hook: { text: string };
}

interface MultiplierGroup {
  id: string;
  name: string;
  campaignId: string;
  campaign: { id: string; title: string } | null;
  transcript: string | null;
  transcriptStatus: "PENDING" | "TRANSCRIBING" | "TRANSCRIBED" | "FAILED";
  styleId: string;
  mappingMode: "each" | "distribute";
  settings: any;
  status: "DRAFT" | "QUEUED" | "RENDERING" | "COMPLETED" | "FAILED";
  errorMessage: string | null;
  variations: MultiplierVariation[];
  hooks: MultiplierHook[];
  outputs: MultiplierOutput[];
  createdAt: string;
}

interface BulkBatchItem {
  id: string;
  fileName: string;
  status: "TRANSCRIBING" | "GENERATING_HOOKS" | "READY" | "FAILED";
  groupId: string | null;
  error: string | null;
}

interface BulkBatchJob {
  id: string;
  status: "PROCESSING" | "COMPLETED" | "FAILED";
  items: BulkBatchItem[];
}

interface ClientPageProps {
  session?: {
    userId: string;
    role: string;
  };
}

export default function ClientPage({ session }: ClientPageProps = {}) {
  const getServeUrl = (path: string | null | undefined) => {
    if (!path) return "";
    if (path.startsWith("/uploads/")) {
      return path.replace("/uploads/", "/api/uploads/");
    }
    return path;
  };

  const [activeTab, setActiveTab] = useState<"builder" | "queue" | "bulk">("builder");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [groups, setGroups] = useState<MultiplierGroup[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [loadingGroups, setLoadingGroups] = useState(true);

  // Builder state
  const [selectedGroup, setSelectedGroup] = useState<MultiplierGroup | null>(null);
  const [groupName, setGroupName] = useState("");
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [styleId, setStyleId] = useState<"news-lower-third" | "breaking-headline" | "subtitle-box" | "quote-card">("news-lower-third");
  const [mappingMode, setMappingMode] = useState<"each" | "distribute">("each");

  // Style Settings state
  const [fontSize, setFontSize] = useState(32);
  const [fontColor, setFontColor] = useState("#FFFFFF");
  const [bgStripColor, setBgStripColor] = useState("#000000");
  const [bgStripOpacity, setBgStripOpacity] = useState(0.85);
  const [positionYPercent, setPositionYPercent] = useState(75);
  const [accentColor, setAccentColor] = useState("#E11D48");
  const [author, setAuthor] = useState("");
  const [fontFamily, setFontFamily] = useState("Inter");
  const [previewVariationIndex, setPreviewVariationIndex] = useState<number>(0);

  // Template/Style Preset CRUD state
  const [savedStyles, setSavedStyles] = useState<any[]>([]);
  const [selectedSavedStyleId, setSelectedSavedStyleId] = useState<string>("");
  const [newTemplateName, setNewTemplateName] = useState<string>("");
  const [showTemplateSaveModal, setShowTemplateSaveModal] = useState<boolean>(false);
  const [isSavingTemplate, setIsSavingTemplate] = useState<boolean>(false);
  const [showWarnInUseDialog, setShowWarnInUseDialog] = useState<boolean>(false);

  // Rendering Settings
  const [hookDuration, setHookDuration] = useState(5);
  const [animationType, setAnimationType] = useState<"NONE" | "FADE_IN" | "SLIDE_UP">("NONE");
  const [animationDuration, setAnimationDuration] = useState(0.5);

  // Variations & manual hooks inputs
  const [filesToUpload, setFilesToUpload] = useState<File[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [newHookText, setNewHookText] = useState("");
  const [aiHookCount, setAiHookCount] = useState<number>(15);
  const [generatingAiHooks, setGeneratingAiHooks] = useState(false);
  const [aiHooks, setAiHooks] = useState<string[]>([]);
  const [customPrompt, setCustomPrompt] = useState<string>("");
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [hasManuallyEditedPrompt, setHasManuallyEditedPrompt] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Reset selected variation preview on group switch
  useEffect(() => {
    setPreviewVariationIndex(0);
  }, [selectedGroup?.id]);

  // Dynamically initialize customPrompt with campaign markdown and transcription
  useEffect(() => {
    if (!selectedGroup) {
      setCustomPrompt("");
      setHasManuallyEditedPrompt(false);
      return;
    }
    const campaign = campaigns.find((c) => c.id === selectedGroup.campaignId);
    const campaignMarkdown = campaign
      ? `# ${campaign.title}\n\n**Type:** ${campaign.type}\n**Description:** ${campaign.description}\n**Brief:** ${campaign.brief}\n**Info Context:**\n${campaign.infoContent || "None"}`
      : "No campaign linked.";

    let transcriptionText = "";
    if (selectedGroup.transcript) {
      try {
        const wordList = JSON.parse(selectedGroup.transcript);
        if (Array.isArray(wordList)) {
          transcriptionText = wordList.map((w: any) => w.word || w.text || "").join(" ");
        } else {
          transcriptionText = String(selectedGroup.transcript);
        }
      } catch {
        transcriptionText = selectedGroup.transcript;
      }
    }

    const defaultPrompt = `Generate exactly ${aiHookCount} unique video captions or hook headlines summarizing this video transcript.

CAMPAIGN CONTEXT:
${campaignMarkdown}

VIDEO TRANSCRIPT:
"${transcriptionText}"

Format your response strictly as a JSON array of strings, like this:
["First hook headline", "Second hook headline", "Third hook headline"]
Do not add any other markdown wrapper like \`\`\`json or text blocks. Generate only the raw JSON array.`;

    if (!hasManuallyEditedPrompt) {
      setCustomPrompt(defaultPrompt);
    } else {
      // If manually edited, just update the count in-place without wiping out their changes
      setCustomPrompt((prev) => prev.replace(/Generate exactly \d+/i, `Generate exactly ${aiHookCount}`));
    }
  }, [selectedGroup?.id, selectedGroup?.transcript, campaigns, aiHookCount, hasManuallyEditedPrompt]);

  // File Drag-Drop Ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Poll state
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Google Drive state
  const [driveConnected, setDriveConnected] = useState(false);
  const [driveEmail, setDriveEmail] = useState("");
  const [folderPickerTarget, setFolderPickerTarget] = useState<{ type: "group" | "output" | "batch" | "item"; id: string } | null>(null);
  const [driveFolders, setDriveFolders] = useState<{ id: string; name: string }[]>([]);
  const [folderSearch, setFolderSearch] = useState("");
  const [searchingFolders, setSearchingFolders] = useState(false);
  const [currentPickerEmail, setCurrentPickerEmail] = useState<string | null>(null);
  const [syncingOutputs, setSyncingOutputs] = useState<Set<string>>(new Set());
  const [selectedPickerFolders, setSelectedPickerFolders] = useState<{ id: string; name: string }[]>([]);
  const [downloads, setDownloads] = useState<Record<string, { progress: number; message: string }>>({});
  const [exportingGroups, setExportingGroups] = useState<Set<string>>(new Set());
  const [campaignUpdating, setCampaignUpdating] = useState<Set<string>>(new Set());
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);

  // Multi-select + Smart Download state
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [showSmartDownload, setShowSmartDownload] = useState(false);
  const [smartDownloading, setSmartDownloading] = useState(false);
  const [smartDownloadProgress, setSmartDownloadProgress] = useState("");
  const [smartAccounts, setSmartAccounts] = useState(5);
  const [smartVidsPerAccount, setSmartVidsPerAccount] = useState(3);
  const [includeExported, setIncludeExported] = useState(false);

  // Builder sidebar checkbox selection + filter (separate from the queue selection above)
  const [builderSelectedIds, setBuilderSelectedIds] = useState<Set<string>>(new Set());
  const [builderGroupSearch, setBuilderGroupSearch] = useState("");
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Smart Export state
  const [showSmartExport, setShowSmartExport] = useState(false);
  const [smartExportSearch, setSmartExportSearch] = useState("");
  const [searchingExportFolders, setSearchingExportFolders] = useState(false);
  const [searchedExportFolders, setSearchedExportFolders] = useState<{ id: string; name: string; defaultPostCount: number; mappedAccount: { id: string; tiktokUsername: string; color?: string } | null }[]>([]);
  const [selectedExportFolders, setSelectedExportFolders] = useState<{ id: string; name: string; count: number; defaultPostCount?: number; mappedAccount: { id: string; tiktokUsername: string; color?: string } | null }[]>([]);
  const [includeExportedSmartExport, setIncludeExportedSmartExport] = useState(false);
  const [exportPreview, setExportPreview] = useState<{
    videoBudget: { totalAvailable: number; assigned: number; videosLeft: number };
    assignments: { driveFolderId: string; driveFolderName: string; videoIds: string[] }[];
    unfulfillable: { driveFolderId: string; driveFolderName: string; requestedCount: number; assignedCount: number; reason: string }[];
  } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [exportingJobId, setExportingJobId] = useState<string | null>(null);
  const [exportJobDetails, setExportJobDetails] = useState<any | null>(null);
  const [pollingJobDetails, setPollingJobDetails] = useState(false);
  const [exportDays, setExportDays] = useState(1);
  const [exportRunError, setExportRunError] = useState<string | null>(null);

  // Bulk intake state
  const [bulkCampaignId, setBulkCampaignId] = useState("");
  const [bulkStyleId, setBulkStyleId] = useState("");
  const [bulkNamePrefix, setBulkNamePrefix] = useState("");
  const [bulkFiles, setBulkFiles] = useState<File[]>([]);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkUploadProgress, setBulkUploadProgress] = useState<{ current: number; total: number; fileName: string } | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [batchJobs, setBatchJobs] = useState<BulkBatchJob[]>([]);
  const bulkFileInputRef = useRef<HTMLInputElement>(null);

  // Bulk render state
  const [bulkRendering, setBulkRendering] = useState(false);

  // Render queue control (pause/resume) + collapsed queue rows
  const [queueControl, setQueueControl] = useState<{ paused: boolean; processing: boolean; staleRendering: number } | null>(null);
  const [queueControlLoading, setQueueControlLoading] = useState(false);
  const [expandedQueueGroups, setExpandedQueueGroups] = useState<Set<string>>(new Set());

  const toggleQueueGroupExpanded = (groupId: string) => {
    setExpandedQueueGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const handleQueueControl = async (action: "pause" | "resume" | "recover") => {
    setQueueControlLoading(true);
    try {
      const res = await fetch("/api/multiplier/queue/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to ${action} queue`);
      if (data.state) setQueueControl((prev) => ({ staleRendering: 0, ...prev, ...data.state }));
      toast.success(
        action === "pause"
          ? "Render queue paused — current video will finish, then rendering stops."
          : action === "resume"
          ? "Render queue resumed."
          : `Recovered ${data.recovered ?? 0} stuck video(s).`
      );
      fetchData();
    } catch (err: any) {
      toast.error(err.message || `Failed to ${action} queue`);
    } finally {
      setQueueControlLoading(false);
    }
  };

  // Poll queue worker state while the queue tab is open
  useEffect(() => {
    if (activeTab !== "queue") return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/multiplier/queue");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.state) setQueueControl(data.state);
      } catch {}
    };
    poll();
    const intervalId = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [activeTab]);

  // Per-video delete state
  const [deletingOutputs, setDeletingOutputs] = useState<Set<string>>(new Set());
  const [previewLoading, setPreviewLoading] = useState(false);

  // Smart Export logic
  useEffect(() => {
    if (!showSmartExport || selectedGroupIds.size === 0 || selectedExportFolders.length === 0) {
      setExportPreview(null);
      return;
    }

    const timer = setTimeout(() => {
      const getPreview = async () => {
        setLoadingPreview(true);
        try {
          const res = await fetch("/api/managed/multiplier/smart-export/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              groupIds: Array.from(selectedGroupIds),
              folderCounts: selectedExportFolders.map((f) => ({
                id: f.id,
                name: f.name,
                count: f.count,
              })),
              days: exportDays,
              includeExported: includeExportedSmartExport,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            setExportPreview(data);
          }
        } catch (err) {
          console.error("Preview failed:", err);
        } finally {
          setLoadingPreview(false);
        }
      };
      getPreview();
    }, 300); // 300ms debounce

    return () => clearTimeout(timer);
  }, [showSmartExport, selectedGroupIds, selectedExportFolders, includeExportedSmartExport]);

  const handleSearchExportFolders = async (val: string) => {
    setSmartExportSearch(val);
    if (!val.trim()) {
      setSearchedExportFolders([]);
      return;
    }
    setSearchingExportFolders(true);
    try {
      const res = await fetch(`/api/managed/multiplier/smart-export/folders?q=${encodeURIComponent(val)}`);
      if (res.ok) {
        const data = await res.json();
        setSearchedExportFolders(data.folders || []);
      }
    } catch (err) {
      console.error("Folder search failed:", err);
    } finally {
      setSearchingExportFolders(false);
    }
  };

  const handleStartSmartExport = async () => {
    if (!exportPreview || exportPreview.unfulfillable.length > 0) return;
    if (exportPreview.videoBudget.assigned > exportPreview.videoBudget.totalAvailable) {
      toast.error("Cannot export: Over-allocated video budget!");
      return;
    }

    setExportRunError(null);
    try {
      const res = await fetch("/api/multiplier/smart-export/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupIds: Array.from(selectedGroupIds),
          accounts: selectedExportFolders.map((f) => ({
            driveFolderId: f.id,
            name: f.name,
            count: f.count,
          })),
          days: exportDays,
          includeExported: includeExportedSmartExport,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        // 400 = nothing fulfillable — surface inline so the user can adjust counts
        setExportRunError(data.error || "Nothing in the current selection can be fulfilled.");
        return;
      }

      toast.success("Smart Export queued successfully!");
      setExportingJobId(data.jobId);
      setShowSmartExport(false);
      fetchData();
    } catch (err: any) {
      setExportRunError(err.message || "Failed to start export");
    }
  };

  // Days change resets every folder count to its defaultPostCount × days, clamped to
  // the selected group count — manual stepper overrides are intentionally not preserved
  // (predictable: days is the single source of truth until the user edits a stepper again).
  const handleExportDaysChange = (days: number) => {
    const d = Math.max(1, days || 1);
    setExportDays(d);
    setSelectedExportFolders((prev) =>
      prev.map((f) => ({
        ...f,
        count: Math.max(1, Math.min((f.defaultPostCount ?? 1) * d, selectedGroupIds.size)),
      }))
    );
  };

  useEffect(() => {
    if (!exportingJobId) {
      setExportJobDetails(null);
      return;
    }

    let active = true;
    const fetchProgress = async () => {
      try {
        const res = await fetch(`/api/managed/multiplier/smart-export/jobs/${exportingJobId}`);
        if (res.ok) {
          const data = await res.json();
          if (active) {
            setExportJobDetails(data.job);
            if (data.job.status === "done" || data.job.status === "failed") {
              fetchData();
            } else {
              setTimeout(fetchProgress, 3000);
            }
          }
        }
      } catch (err) {
        console.error("Failed to poll export progress:", err);
        if (active) {
          setTimeout(fetchProgress, 5000);
        }
      }
    };

    fetchProgress();

    return () => {
      active = false;
    };
  }, [exportingJobId]);

  const handleRetryAssignment = async (assignmentId: string) => {
    try {
      const res = await fetch(`/api/managed/multiplier/smart-export/assignments/${assignmentId}/retry`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Retry failed");
      toast.success("Upload retry queued");
      
      if (exportingJobId) {
        const detailRes = await fetch(`/api/managed/multiplier/smart-export/jobs/${exportingJobId}`);
        if (detailRes.ok) {
          const detailData = await detailRes.json();
          setExportJobDetails(detailData.job);
        }
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to retry upload");
    }
  };

  const fetchData = async () => {
    try {
      const campRes = await fetch("/api/managed/campaigns");
      if (campRes.ok) {
        const data = await campRes.json();
        setCampaigns(data);
      }
    } catch (err) {
      console.error("Error loading campaigns:", err);
    } finally {
      setLoadingCampaigns(false);
    }

    try {
      const driveRes = await fetch("/api/managed/multiplier/google/status");
      if (driveRes.ok) {
        const data = await driveRes.json();
        setDriveConnected(data.connected);
        setDriveEmail(data.email || "");
      }
    } catch (err) {
      console.error("Error loading drive status:", err);
    }

    try {
      const stylesRes = await fetch("/api/managed/style-studio/saved-styles");
      if (stylesRes.ok) {
        const data = await stylesRes.json();
        setSavedStyles(data || []);
      }
    } catch (err) {
      console.error("Error loading saved styles:", err);
    }

    try {
      const groupRes = await fetch("/api/managed/multiplier");
      if (groupRes.ok) {
        const data = await groupRes.json();
        setGroups(data);
        // Sync selectedGroup with the new data
        setSelectedGroup((prev) => {
          if (!prev) return null;
          const updated = data.find((g: any) => g.id === prev.id);
          return updated || prev;
        });
        return data; // Return the fresh data array!
      }
    } catch (err) {
      console.error("Error loading groups:", err);
    } finally {
      setLoadingGroups(false);
    }
    return null;
  };

  // ── Bulk intake ───────────────────────────────────────────────────────────
  const handleBulkFilesPicked = (files: File[]) => {
    const videos = files.filter((f) => f.type.startsWith("video/") || /\.(mp4|mov|webm|mkv)$/i.test(f.name));
    if (videos.length === 0) {
      toast.error("Please select video files only.");
      return;
    }
    setBulkError(null);
    setBulkFiles((prev) => [...prev, ...videos]);
  };

  // Uploads one file per request — a single multi-file multipart body can
  // exceed proxy body-size limits (nginx client_max_body_size → 413).
  const handleBulkUpload = async () => {
    if (bulkFiles.length === 0) {
      toast.error("Please select at least one video file.");
      return;
    }
    setBulkUploading(true);
    setBulkError(null);
    const total = bulkFiles.length;
    const failedUploads: string[] = [];
    let jobId: string | null = null;
    let finalized = false;
    try {
      for (let i = 0; i < bulkFiles.length; i++) {
        const file = bulkFiles[i];
        const isLast = i === bulkFiles.length - 1;
        setBulkUploadProgress({ current: i + 1, total, fileName: file.name });

        const formData = new FormData();
        formData.append("files", file);
        if (jobId) {
          formData.append("jobId", jobId);
        } else {
          if (bulkCampaignId) formData.append("campaignId", bulkCampaignId);
          if (bulkStyleId) formData.append("styleId", bulkStyleId);
          if (bulkNamePrefix.trim()) formData.append("namePrefix", bulkNamePrefix.trim());
        }
        if (isLast) formData.append("finalize", "true");

        try {
          const res = await fetch("/api/multiplier/bulk-upload", { method: "POST", body: formData });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Upload failed");
          jobId = data.jobId;
          if (isLast) finalized = true;
        } catch (err: any) {
          failedUploads.push(`${file.name}: ${err.message || "upload failed"}`);
          // If the very first file failed there is no batch to append to — stop.
          if (!jobId) throw new Error(failedUploads[0]);
        }
      }

      if (!jobId) throw new Error("No files could be uploaded.");

      // The last file's request carries finalize — if it failed, finalize separately
      // so the batch doesn't sit unprocessed.
      if (!finalized) {
        const formData = new FormData();
        formData.append("jobId", jobId);
        formData.append("finalize", "true");
        const res = await fetch("/api/multiplier/bulk-upload", { method: "POST", body: formData });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to start batch processing");
        }
      }

      // Seed batch history with the fresh job state so polling picks it up
      const jobRes = await fetch(`/api/multiplier/batch-jobs/${jobId}`);
      if (jobRes.ok) {
        const job = await jobRes.json();
        setBatchJobs((prev) => [{ id: job.id, status: job.status, items: job.items || [] }, ...prev]);
      } else {
        setBatchJobs((prev) => [{ id: jobId!, status: "PROCESSING", items: [] }, ...prev]);
      }
      setBulkFiles([]);
      if (failedUploads.length > 0) {
        toast.warning(`Uploaded ${total - failedUploads.length}/${total} videos. Failed: ${failedUploads.join("; ")}`);
      } else {
        toast.success(`Uploaded ${total} video${total > 1 ? "s" : ""} — processing started.`);
      }
    } catch (err: any) {
      setBulkError(err.message || "Bulk upload failed");
    } finally {
      setBulkUploading(false);
      setBulkUploadProgress(null);
    }
  };

  // Poll active batch jobs every 3s while PROCESSING
  useEffect(() => {
    const processing = batchJobs.filter((j) => j.status === "PROCESSING");
    if (processing.length === 0) return;

    const intervalId = setInterval(async () => {
      let anyFinished = false;
      let anyNewlyReady = false;
      for (const job of processing) {
        try {
          const res = await fetch(`/api/multiplier/batch-jobs/${job.id}`);
          if (!res.ok) continue;
          const data = await res.json();
          const prevReady = job.items.filter((i) => i.status === "READY").length;
          const nextReady = (data.items || []).filter((i: BulkBatchItem) => i.status === "READY").length;
          if (nextReady > prevReady) anyNewlyReady = true;
          setBatchJobs((prev) =>
            prev.map((j) => (j.id === job.id ? { id: data.id, status: data.status, items: data.items || [] } : j))
          );
          if (data.status !== "PROCESSING") anyFinished = true;
        } catch (err) {
          console.error("Batch job polling failed:", err);
        }
      }
      // Refresh the group list as items become READY (and when a job finishes)
      // so processed groups show up in the builder right away
      if (anyFinished || anyNewlyReady) fetchData();
    }, 3000);

    return () => clearInterval(intervalId);
  }, [batchJobs]);

  const handleViewGroupInBuilder = async (groupId: string) => {
    let target = groups.find((g) => g.id === groupId);
    if (!target) {
      const fresh = await fetchData();
      target = fresh?.find((g: MultiplierGroup) => g.id === groupId);
    }
    if (target) {
      handleSelectGroup(target);
      setActiveTab("builder");
    } else {
      toast.error("Group not found yet — it may still be processing.");
    }
  };

  // ── Bulk render ───────────────────────────────────────────────────────────
  // Render-ready = at least one variation and one hook, not already queued/rendering
  const isGroupRenderReady = (g: MultiplierGroup) =>
    g.variations.length > 0 && g.hooks.length > 0 && g.status !== "QUEUED" && g.status !== "RENDERING";

  const toggleSelectRenderReady = () => {
    const ready = groups.filter(isGroupRenderReady);
    const allSelected = ready.length > 0 && ready.every((g) => selectedGroupIds.has(g.id));
    setSelectedGroupIds(allSelected ? new Set() : new Set(ready.map((g) => g.id)));
  };

  const handleBulkRenderSelected = async () => {
    const ids = groups.filter((g) => selectedGroupIds.has(g.id) && isGroupRenderReady(g)).map((g) => g.id);
    if (ids.length === 0) {
      toast.error("No render-ready groups selected (need at least 1 variation and 1 hook).");
      return;
    }
    setBulkRendering(true);
    try {
      const res = await fetch("/api/multiplier/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupIds: ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to queue renders");

      toast.success(`Queued ${data.queued?.length ?? 0} group${(data.queued?.length ?? 0) !== 1 ? "s" : ""} for rendering.`);
      if (data.skipped?.length > 0) {
        toast.warning(
          `Skipped ${data.skipped.length}: ${data.skipped.map((s: any) => s.reason).join("; ")}`
        );
      }
      setSelectedGroupIds(new Set());
      await fetchData();
      setActiveTab("queue");
    } catch (err: any) {
      toast.error(err.message || "Failed to queue renders");
    } finally {
      setBulkRendering(false);
    }
  };

  const searchDriveFolders = async (query: string) => {
    setSearchingFolders(true);
    try {
      const res = await fetch(`/api/managed/multiplier/google/folders?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        setDriveFolders(data.folders || []);
        setCurrentPickerEmail(data.googleEmail || null);
      }
    } catch {
      toast.error("Failed to query Google Drive folders");
    } finally {
      setSearchingFolders(false);
    }
  };

  const handleToggleFolder = (folder: { id: string; name: string }) => {
    setSelectedPickerFolders((prev) => {
      const exists = prev.some((f) => f.id === folder.id);
      if (exists) {
        return prev.filter((f) => f.id !== folder.id);
      }
      return [...prev, folder];
    });
  };

  const handleAssignFolder = async (targetId: string, folderId?: string, folderName?: string) => {
    if (!folderPickerTarget) return;
    const { type } = folderPickerTarget;

    try {
      if (type === "group" || type === "batch") {
        if (selectedPickerFolders.length === 0) {
          toast.error("Please select at least one folder first.");
          return;
        }

        const groupObj = groups.find((g) => g.id === targetId);
        if (!groupObj) throw new Error("Group not found");

        const assignments: any[] = [];
        const isLegacy = groupObj.campaignId === "";

        if (isLegacy) {
          groupObj.outputs.forEach((item, idx) => {
            const folder = selectedPickerFolders[idx % selectedPickerFolders.length];
            assignments.push({
              itemId: item.id,
              driveFolderId: folder.id,
              driveFolderName: folder.name,
              googleEmail: currentPickerEmail || null,
            });
          });
        } else {
          groupObj.outputs.forEach((item, idx) => {
            const folder = selectedPickerFolders[idx % selectedPickerFolders.length];
            assignments.push({
              outputId: item.id,
              driveFolderId: folder.id,
              driveFolderName: folder.name,
              googleEmail: currentPickerEmail || null,
            });
          });
        }

        const displayNames = selectedPickerFolders.map((f) => f.name).join(", ");
        const firstFolderId = selectedPickerFolders[0].id;

        const res = await fetch("/api/managed/multiplier", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            groupId: !isLegacy ? targetId : undefined,
            batchId: isLegacy ? targetId : undefined,
            driveFolderId: firstFolderId,
            driveFolderName: displayNames,
            googleEmail: currentPickerEmail || null,
            assignments,
          }),
        });

        if (!res.ok) throw new Error("Failed to distribute folders on server");

        toast.success(`Distributed ${selectedPickerFolders.length} folders across ${groupObj.outputs.length} videos.`);
      } else {
        if (!folderId || !folderName) return;

        const res = await fetch("/api/managed/multiplier", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outputId: type === "output" ? targetId : undefined,
            itemId: type === "item" ? targetId : undefined,
            driveFolderId: folderId,
            driveFolderName: folderName,
            googleEmail: currentPickerEmail || null,
          }),
        });

        if (!res.ok) throw new Error("Failed to assign folder on server");

        toast.success(`Folder "${folderName}" assigned to video.`);
      }

      setFolderPickerTarget(null);
      setSelectedPickerFolders([]);
      await fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to save folder");
    }
  };

  const handleSyncToDrive = async (group: MultiplierGroup, outId: string) => {
    setSyncingOutputs((prev) => new Set([...prev, outId]));
    const isLegacy = group.campaignId === "";
    
    try {
      const res = await fetch("/api/managed/multiplier/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isLegacy ? { itemId: outId } : { outputId: outId }
        ),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to upload");
      }

      toast.success("Successfully uploaded to Google Drive!");
      await fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to upload to Google Drive");
    } finally {
      setSyncingOutputs((prev) => {
        const next = new Set(prev);
        next.delete(outId);
        return next;
      });
    }
  };

  const handleExportGroupToDrive = async (group: MultiplierGroup) => {
    const isLegacy = group.campaignId === "";
    const settingsObj: any = typeof group.settings === "string"
      ? JSON.parse(group.settings)
      : (group.settings || {});

    // Filter outputs to check if any have an assigned folder (or fallback to group default)
    const exportableOutputs = group.outputs.filter((out) => {
      return out.driveFolderId || settingsObj.driveFolderId;
    });

    if (exportableOutputs.length === 0) {
      toast.error("No videos in this batch have a Drive folder assigned. Select a folder first.");
      return;
    }

    setExportingGroups((prev) => new Set([...prev, group.id]));
    try {
      const res = await fetch("/api/managed/multiplier/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isLegacy ? { batchId: group.id } : { groupId: group.id }
        ),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to trigger bulk export");
      }

      const data = await res.json();
      toast.success(data.message || "Bulk export successfully queued in the background!");
      await fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to run export");
    } finally {
      setExportingGroups((prev) => {
        const next = new Set(prev);
        next.delete(group.id);
        return next;
      });
    }
  };

  useEffect(() => {
    fetchData();
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  // Auto-query folders on opening folder picker modal
  useEffect(() => {
    if (folderPickerTarget) {
      searchDriveFolders("");
    }
  }, [folderPickerTarget]);

  // Poll active rendering groups
  useEffect(() => {
    const activeGroups = groups.filter(
      (g) => g.status === "QUEUED" || g.status === "RENDERING" || g.transcriptStatus === "TRANSCRIBING"
    );

    let intervalId: NodeJS.Timeout | null = null;

    if (activeGroups.length > 0) {
      intervalId = setInterval(async () => {
        try {
          const res = await fetch("/api/managed/multiplier");
          if (res.ok) {
            const data = await res.json();
            setGroups(data);
            // Update selected group in real-time
            if (selectedGroup) {
              const updated = data.find((g: MultiplierGroup) => g.id === selectedGroup.id);
              if (updated) setSelectedGroup(updated);
            }
          }
        } catch (err) {
          console.error("Polling failed:", err);
        }
      }, 3000);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [groups, selectedGroup]);

  // Load selected group details into form
  const handleSelectGroup = (group: MultiplierGroup) => {
    setSelectedGroup(group);
    setGroupName(group.name);
    setSelectedCampaignId(group.campaignId);
    setStyleId(group.styleId as any);
    setHasManuallyEditedPrompt(false);
    setMappingMode(group.mappingMode as any);

    let parsedSettings = {};
    try {
      parsedSettings = typeof group.settings === "string" 
        ? JSON.parse(group.settings) 
        : (group.settings || {});
    } catch {}

    const s: any = parsedSettings;
    setFontSize(s.fontSize ?? 32);
    setFontColor(s.fontColor ?? "#FFFFFF");
    setBgStripColor(s.bgStripColor ?? "#000000");
    setBgStripOpacity(s.bgStripOpacity ?? 0.85);
    setPositionYPercent(s.positionYPercent ?? 75);
    setAccentColor(s.accentColor ?? "#E11D48");
    setAuthor(s.author ?? "");
    setFontFamily(s.fontFamily ?? "Inter");
    setHookDuration(s.hookDuration ?? 5);
    setAnimationType(s.animationType ?? "NONE");
    setAnimationDuration(s.animationDuration ?? 0.5);

    if (savedStyles.some(style => style.id === group.styleId)) {
      setSelectedSavedStyleId(group.styleId);
    } else {
      setSelectedSavedStyleId("");
    }

    setFilesToUpload([]);
  };

  const handleCreateNewGroup = async () => {
    if (!groupName.trim()) {
      toast.error("Please enter a group name");
      return;
    }
    if (!selectedCampaignId) {
      toast.error("Please select a Campaign");
      return;
    }

    const settingsObj = {
      fontSize,
      fontColor,
      bgStripColor,
      bgStripOpacity,
      positionYPercent,
      accentColor,
      author,
      fontFamily,
      hookDuration,
      animationType,
      animationDuration,
    };

    try {
      const res = await fetch("/api/managed/multiplier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: groupName,
          campaignId: selectedCampaignId,
          styleId: selectedSavedStyleId || styleId,
          mappingMode,
          settings: settingsObj,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create group");
      }

      const newGroup = await res.json();
      toast.success("Group created successfully! Now upload video variations.");
      await fetchData();
      handleSelectGroup(newGroup);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleUpdateGroupSettings = async () => {
    if (!selectedGroup) return;

    const settingsObj = {
      fontSize,
      fontColor,
      bgStripColor,
      bgStripOpacity,
      positionYPercent,
      accentColor,
      author,
      fontFamily,
      hookDuration,
      animationType,
      animationDuration,
    };

    try {
      const res = await fetch(`/api/managed/multiplier/groups/${selectedGroup.id}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mappingMode,
          styleId: selectedSavedStyleId || styleId,
          settings: settingsObj,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save settings");
      }

      toast.success("Group configuration updated.");
      const freshGroups = await fetchData();
      if (freshGroups) {
        const updated = freshGroups.find((g: any) => g.id === selectedGroup.id);
        if (updated) setSelectedGroup(updated);
      }
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // Template CRUD Operations
  const handleSaveNewPreset = async () => {
    if (!newTemplateName.trim()) {
      toast.error("Please enter a name for the new style preset");
      return;
    }

    setIsSavingTemplate(true);
    try {
      const paramsObj = {
        fontSize,
        fontColor,
        bgStripColor,
        bgStripOpacity,
        positionYPercent,
        accentColor,
        author,
        fontFamily,
      };

      const res = await fetch("/api/managed/style-studio/saved-styles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateKey: styleId,
          name: newTemplateName,
          params: paramsObj,
          tags: ["multiplier"],
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save style preset");
      }

      const created = await res.json();
      toast.success("Style preset saved successfully!");
      setShowTemplateSaveModal(false);
      
      // Refresh presets
      const listRes = await fetch("/api/managed/style-studio/saved-styles");
      if (listRes.ok) {
        const data = await listRes.json();
        setSavedStyles(data || []);
      }
      setSelectedSavedStyleId(created.id);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const handlePromptUpdatePreset = () => {
    // Check if in use by active groups
    const inUse = groups.some(
      (g) => g.styleId === selectedSavedStyleId && g.status !== "COMPLETED" && g.status !== "FAILED"
    );
    if (inUse) {
      setShowWarnInUseDialog(true);
    } else {
      handleUpdatePresetConfirm();
    }
  };

  const handleUpdatePresetConfirm = async () => {
    setShowWarnInUseDialog(false);
    setIsSavingTemplate(true);
    try {
      const paramsObj = {
        fontSize,
        fontColor,
        bgStripColor,
        bgStripOpacity,
        positionYPercent,
        accentColor,
        author,
        fontFamily,
      };

      const res = await fetch("/api/managed/style-studio/saved-styles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedSavedStyleId,
          name: savedStyles.find(s => s.id === selectedSavedStyleId)?.name,
          params: paramsObj,
          tags: ["multiplier"],
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update style preset");
      }

      toast.success("Style preset updated successfully!");
      
      // Refresh presets
      const listRes = await fetch("/api/managed/style-studio/saved-styles");
      if (listRes.ok) {
        const data = await listRes.json();
        setSavedStyles(data || []);
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const handleDeletePreset = async () => {
    if (!confirm("Are you sure you want to delete this style preset?")) return;

    try {
      const res = await fetch(`/api/managed/style-studio/saved-styles?id=${selectedSavedStyleId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete style preset");
      }

      toast.success("Style preset deleted successfully!");
      setSelectedSavedStyleId("");
      
      // Refresh presets
      const listRes = await fetch("/api/managed/style-studio/saved-styles");
      if (listRes.ok) {
        const data = await listRes.json();
        setSavedStyles(data || []);
      }
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDeleteVariation = async (v: any) => {
    if (!selectedGroup) return;

    const hasRendered = (selectedGroup as any).outputs?.some(
      (out: any) => out.variationId === v.id && (out.status === "COMPLETED" || out.outputRef)
    );

    const message = hasRendered
      ? "This variation already has completed outputs. Deleting it will clean up those outputs and remove their local/Drive files. Are you sure you want to proceed?"
      : "Are you sure you want to delete this variation video? Any pending outputs for this variation will be removed.";

    if (!confirm(message)) return;

    try {
      const res = await fetch(`/api/managed/multiplier/groups/${selectedGroup.id}/variations?variationId=${v.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete variation");
      }

      toast.success("Variation deleted successfully");
      
      const freshGroups = await fetchData();
      if (freshGroups) {
        const updated = freshGroups.find((g: any) => g.id === selectedGroup.id);
        if (updated) {
          setSelectedGroup(updated);
        }
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to delete variation");
    }
  };

  // Upload video variations
  const handleUploadVariationsDirectly = async (files: File[]) => {
    if (!selectedGroup || files.length === 0) return;

    setUploadingFiles(true);
    const formData = new FormData();
    files.forEach((f) => {
      formData.append("file", f);
    });

    try {
      const res = await fetch(`/api/managed/multiplier/groups/${selectedGroup.id}/variations`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        let errMsg = `Upload failed (${res.status})`;
        try {
          const contentType = res.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const err = await res.json();
            errMsg = err.error || errMsg;
          } else {
            const text = await res.text();
            if (res.status === 413) {
              errMsg = "File is too large (413 Payload Too Large). Please make sure Nginx 'client_max_body_size' is configured to allow large video uploads (e.g. 250m).";
            } else {
              errMsg = text.substring(0, 150) || errMsg;
            }
          }
        } catch {}
        throw new Error(errMsg);
      }

      toast.success("Video variations uploaded and processed successfully.");
      const freshGroups = await fetchData();
      if (freshGroups && selectedGroup) {
        const updated = freshGroups.find((g: any) => g.id === selectedGroup.id);
        if (updated) {
          setSelectedGroup(updated);
          // Auto Whisper Transcription trigger
          if (!updated.transcriptStatus || updated.transcriptStatus === "PENDING" || updated.transcriptStatus === "FAILED") {
            fetch(`/api/managed/multiplier/groups/${updated.id}/transcribe`, { method: "POST" })
              .then(() => fetchData())
              .catch(console.error);
          }
        }
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUploadingFiles(false);
    }
  };

  // Trigger Whisper stable-ts Transcription (Once per group)
  const handleTranscribeGroup = async () => {
    if (!selectedGroup) return;

    setTranscribing(true);
    try {
      const res = await fetch(`/api/managed/multiplier/groups/${selectedGroup.id}/transcribe`, {
        method: "POST",
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Transcription initiation failed");
      }

      toast.success("Whisper transcription alignment queued. Processing in background...");
      // Immediately refresh groups state
      await fetchData();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setTranscribing(false);
    }
  };

  // AI Hook Generation via Gemini
  const handleGenerateAiHooks = async () => {
    if (!selectedGroup) return;

    setGeneratingAiHooks(true);
    try {
      let adjustedPrompt = customPrompt;
      if (adjustedPrompt) {
        adjustedPrompt = adjustedPrompt.replace(/Generate exactly \d+/i, `Generate exactly ${aiHookCount}`);
      }
      const res = await fetch(`/api/managed/multiplier/groups/${selectedGroup.id}/hooks/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          count: aiHookCount,
          useCampaignContext: true,
          customPrompt: adjustedPrompt || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Gemini hook generator failed");
      }

      toast.success(`Successfully generated ${aiHookCount} AI captions.`);
      const freshGroups = await fetchData();
      if (freshGroups && selectedGroup) {
        const updated = freshGroups.find((g: any) => g.id === selectedGroup.id);
        if (updated) setSelectedGroup(updated);
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setGeneratingAiHooks(false);
    }
  };

  // Add a manual hook
  const handleAddManualHook = async () => {
    if (!selectedGroup || !newHookText.trim()) return;

    try {
      const res = await fetch(`/api/managed/multiplier/groups/${selectedGroup.id}/hooks/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: newHookText }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to add manual hook");
      }

      setNewHookText("");
      toast.success("Manual hook added.");
      const freshGroups = await fetchData();
      if (freshGroups && selectedGroup) {
        const updated = freshGroups.find((g: any) => g.id === selectedGroup.id);
        if (updated) setSelectedGroup(updated);
      }
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // Import CSV Hooks
  const handleCSVImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedGroup || !e.target.files?.[0]) return;
    const file = e.target.files[0];
    const text = await file.text();

    // Basic CSV line parser
    const hooks = text
      .split(/\r?\n/)
      .map((l) => l.trim().replace(/^"/, "").replace(/"$/, ""))
      .filter((l) => l.length > 2);

    if (hooks.length === 0) {
      toast.error("No valid lines found in CSV file");
      return;
    }

    try {
      let count = 0;
      for (const h of hooks) {
        await fetch(`/api/managed/multiplier/groups/${selectedGroup.id}/hooks/manual`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: h }),
        });
        count++;
      }
      toast.success(`Imported ${count} hooks from CSV successfully.`);
      const freshGroups = await fetchData();
      if (freshGroups && selectedGroup) {
        const updated = freshGroups.find((g: any) => g.id === selectedGroup.id);
        if (updated) setSelectedGroup(updated);
      }
    } catch (err) {
      toast.error("Error importing CSV hooks");
    }
  };

  // Delete hook
  const handleDeleteHook = async (hookId: string) => {
    if (!selectedGroup) return;

    try {
      const res = await fetch(`/api/managed/multiplier/groups/${selectedGroup.id}/hooks/manual?hookId=${hookId}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to delete hook");

      toast.success("Hook removed.");
      const freshGroups = await fetchData();
      if (freshGroups && selectedGroup) {
        const updated = freshGroups.find((g: any) => g.id === selectedGroup.id);
        if (updated) setSelectedGroup(updated);
      }
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // Trigger Rendering Queue Start
  const handleStartRendering = async () => {
    if (!selectedGroup) return;

    try {
      const settingsObj = {
        fontSize,
        fontColor,
        bgStripColor,
        bgStripOpacity,
        positionYPercent,
        accentColor,
        author,
        hookDuration,
        animationType,
        animationDuration,
      };

      const res = await fetch(`/api/managed/multiplier/groups/${selectedGroup.id}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mappingMode,
          styleId,
          settings: settingsObj,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to trigger rendering batch");
      }

      toast.success("Group output rendering batch queued! Redirecting to Queue...");
      await fetchData();
      setActiveTab("queue");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // Retry output row
  const handleRetryOutput = async (group: MultiplierGroup, outputId: string) => {
    try {
      const res = await fetch(`/api/managed/multiplier/groups/${group.id}/render`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outputId }),
      });

      if (!res.ok) throw new Error("Retry request failed");

      toast.success("Output render retried.");
      await fetchData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // ── Bulk delete / clear outputs ─────────────────────────────────────────
  // Goes through POST /api/multiplier/groups/bulk-delete:
  //   mode "outputs" — delete only rendered videos; groups stay in the builder as DRAFT
  //   mode "full"    — delete the groups entirely (source videos, hooks, outputs)
  const bulkDeleteGroups = async (groupIds: string[], mode: "outputs" | "full") => {
    if (groupIds.length === 0) return;
    setBulkDeleting(true);
    try {
      const res = await fetch("/api/multiplier/groups/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupIds, mode }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Delete request failed");

      if (mode === "outputs") {
        toast.success(`Cleared ${data.deletedOutputs ?? 0} rendered video(s) across ${data.clearedGroups ?? groupIds.length} group(s). The groups stay in the builder as drafts.`);
      } else {
        toast.success(`Permanently deleted ${data.deletedGroups ?? groupIds.length} group(s).`);
      }

      // Drop the affected ids from both selection sets
      setSelectedGroupIds((prev) => {
        const next = new Set(prev);
        groupIds.forEach((id) => next.delete(id));
        return next;
      });
      setBuilderSelectedIds((prev) => {
        const next = new Set(prev);
        groupIds.forEach((id) => next.delete(id));
        return next;
      });

      // Full delete removes the group everywhere — reset the wizard if it was loaded
      // (fetchData keeps a stale selectedGroup for missing ids, so clear it explicitly)
      if (mode === "full" && selectedGroup && groupIds.includes(selectedGroup.id)) {
        setSelectedGroup(null);
      }

      await fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete groups");
    } finally {
      setBulkDeleting(false);
    }
  };

  // Delete entire Group (permanent — removes it from the builder too)
  const handleDeleteGroup = async (groupId: string) => {
    if (!confirm("Permanently delete this group including source videos, hooks and all rendered videos? This cannot be undone.")) return;
    await bulkDeleteGroups([groupId], "full");
  };

  // Queue selection: clear only the rendered videos, keep the groups in the builder
  const handleClearSelectedOutputs = async () => {
    const ids = Array.from(selectedGroupIds);
    if (ids.length === 0) return;
    if (!confirm(`Delete the rendered videos of ${ids.length} group(s)? The groups themselves stay in the builder.`)) return;
    await bulkDeleteGroups(ids, "outputs");
  };

  // Queue selection: permanently delete the selected groups
  const handleDeleteSelectedGroups = async () => {
    const ids = Array.from(selectedGroupIds);
    if (ids.length === 0) return;
    if (!confirm(`Permanently delete ${ids.length} group(s) including source videos, hooks and all rendered videos? This cannot be undone.`)) return;
    await bulkDeleteGroups(ids, "full");
  };

  // Builder sidebar selection: permanently delete the checked groups
  const handleDeleteBuilderSelectedGroups = async () => {
    const ids = Array.from(builderSelectedIds);
    if (ids.length === 0) return;
    if (!confirm(`Permanently delete ${ids.length} group(s) including source videos, hooks and all rendered videos? This cannot be undone.`)) return;
    await bulkDeleteGroups(ids, "full");
  };

  const handleDeleteAllGroups = async () => {
    if (!confirm("Are you sure you want to delete ALL multiplier groups/batches and all associated video files? This deletes EVERYTHING everywhere — including every group and its source data in the Group Builder. This action is permanent and cannot be undone.")) return;

    try {
      const res = await fetch("/api/managed/multiplier?groupId=all", {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Bulk deletion failed");

      toast.success("All batches and groups deleted successfully.");
      setSelectedGroup(null);
      await fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete batches");
    }
  };

  // Reassign a group's campaign from the Queue dashboard.
  // Smart Export reads the campaign at export time, so future exports
  // automatically use the new campaign name in file names.
  const handleChangeGroupCampaign = async (group: MultiplierGroup, newCampaignId: string) => {
    const prevCampaignId = group.campaignId || "";
    if (prevCampaignId === newCampaignId) return;

    const nextCampaign = campaigns.find((c) => c.id === newCampaignId) || null;

    // Optimistic update
    setGroups((prev) =>
      prev.map((g) =>
        g.id === group.id ? { ...g, campaignId: newCampaignId, campaign: nextCampaign } : g
      )
    );
    setCampaignUpdating((prev) => new Set(prev).add(group.id));

    try {
      const res = await fetch(`/api/multiplier/groups/${group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: newCampaignId || null }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update campaign");
      }

      toast.success(nextCampaign ? `Campaign set to "${nextCampaign.title}".` : "Campaign removed.");
      await fetchData(); // Authoritative refresh (also syncs selectedGroup)
    } catch (err: any) {
      // Revert optimistic update
      setGroups((prev) =>
        prev.map((g) =>
          g.id === group.id ? { ...g, campaignId: prevCampaignId, campaign: group.campaign } : g
        )
      );
      toast.error(err.message || "Failed to update campaign");
    } finally {
      setCampaignUpdating((prev) => {
        const next = new Set(prev);
        next.delete(group.id);
        return next;
      });
    }
  };

  const handleDownloadArchive = async (groupId: string) => {
    try {
      setDownloads((prev) => ({
        ...prev,
        [groupId]: { progress: 0, message: "Preparing archive..." }
      }));

      let isPrepared = false;
      let statusData: any = null;

      while (!isPrepared) {
        const res = await fetch(`/api/managed/multiplier/download?groupId=${groupId}`);
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(errText || "Failed to prepare download");
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
            [groupId]: {
              progress: statusData.progress || 10,
              message: statusData.message || "Processing..."
            }
          }));
          await new Promise((resolve) => setTimeout(resolve, 2500));
        } else {
          await new Promise((resolve) => setTimeout(resolve, 2500));
        }
      }

      if (statusData && statusData.downloadUrl) {
        setDownloads((prev) => ({
          ...prev,
          [groupId]: { progress: 100, message: "Starting download..." }
        }));

        const link = document.createElement("a");
        link.href = `/api${statusData.downloadUrl}`;
        link.download = statusData.downloadUrl.split("/").pop() || `archive_${groupId}.tar`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toast.success("Download started!");
        setTimeout(() => {
          setDownloads((prev) => {
            const next = { ...prev };
            delete next[groupId];
            return next;
          });
        }, 3000);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to download archive");
      setDownloads((prev) => {
        const next = { ...prev };
        delete next[groupId];
        return next;
      });
    }
  };

  // ── Multi-select toggle ─────────────────────────────────────────────────
  const toggleGroupSelection = (groupId: string) => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    const selectableGroups = groups.filter((g) => {
      const total = g.outputs.length;
      return total > 0 || g.status === "RENDERING" || g.transcriptStatus === "TRANSCRIBING";
    });
    if (selectedGroupIds.size === selectableGroups.length) {
      setSelectedGroupIds(new Set());
    } else {
      setSelectedGroupIds(new Set(selectableGroups.map((g) => g.id)));
    }
  };

  // ── Smart Download (cross-group shuffled archive) ───────────────────────
  const handleSmartDownload = async () => {
    if (selectedGroupIds.size === 0) return;

    setSmartDownloading(true);
    setSmartDownloadProgress("Building archive...");

    try {
      const res = await fetch("/api/managed/multiplier/smart-download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupIds: Array.from(selectedGroupIds),
          accountCount: smartAccounts,
          videosPerAccount: smartVidsPerAccount,
          includeExported,
        }),
      });

      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch (e) {
        if (text.trim().startsWith("<")) {
          const titleMatch = text.match(/<title>(.*?)<\/title>/i);
          const title = titleMatch ? titleMatch[1] : "HTML Error Page";
          throw new Error(`Server error (${res.status}): ${title}`);
        }
        throw new Error(`Server returned invalid response: ${text.substring(0, 100)}`);
      }

      if (!res.ok) {
        throw new Error(data.error || "Failed to create archive");
      }

      if (data.status === "COMPLETED" && data.downloadUrl) {
        setSmartDownloadProgress("Starting browser download...");
        const fileUrl = `/api${data.downloadUrl}`;
        const link = document.createElement("a");
        link.href = fileUrl;
        link.download = data.downloadUrl.split("/").pop() || "smart_multiplier_download.tar";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toast.success(`Smart Download started! (${data.message || "Archive compiled successfully!"})`);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } else {
        throw new Error("Archive creation failed — no download URL returned");
      }
    } catch (err: any) {
      toast.error(err.message || "Smart download failed");
    } finally {
      setSmartDownloading(false);
      setSmartDownloadProgress("");
      setShowSmartDownload(false);
      setIncludeExported(false);
      await fetchData(); // Refresh to show exportedAt badges
    }
  };

  // ── Preview Output ──────────────────────────────────────────────────────
  const handlePreviewOutput = async (outputId: string) => {
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/managed/multiplier/preview?outputId=${outputId}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to fetch preview");
      }
      const data = await res.json();
      setPreviewVideoUrl(getServeUrl(data.url));
    } catch (err: any) {
      toast.error(err.message || "Video unavailable");
    } finally {
      setPreviewLoading(false);
    }
  };

  // ── Delete Output ───────────────────────────────────────────────────────
  const handleDeleteOutput = async (outputId: string, status: string) => {
    const label = status === "PENDING" || status === "RENDERING" ? "cancel" : "delete";
    if (!confirm(`Are you sure you want to ${label} this video output?`)) return;

    setDeletingOutputs((prev) => new Set([...prev, outputId]));
    try {
      const res = await fetch(`/api/managed/multiplier?outputId=${outputId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete output");
      }

      toast.success("Output deleted successfully.");
      await fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete output");
    } finally {
      setDeletingOutputs((prev) => {
        const next = new Set(prev);
        next.delete(outputId);
        return next;
      });
    }
  };

  // Live output computation
  const getEstimatedOutputs = () => {
    if (!selectedGroup) return 0;
    const vCount = selectedGroup.variations.length;
    const hCount = selectedGroup.hooks.length;

    if (mappingMode === "distribute") {
      return hCount; // each hook distributed round-robin once
    }
    return vCount * hCount; // M variations × H hooks
  };

  const getStylePreviewSnippet = () => {
    switch (styleId) {
      case "breaking-headline":
        return "★ BREAKING NEWS\n[UPPERCASE HEADLINE STATEMENT]";
      case "subtitle-box":
        return "[Clean Rounded Box Subtitle]";
      case "quote-card":
        return "“ [Testimonial statement / Quotation italic text] ”\n— Author Name";
      case "news-lower-third":
      default:
        return "[Editorial news-bar headline text]";
    }
  };

  return (
    <div className="flex-1 bg-[#09090b] text-[#fafafa] min-h-screen p-8 flex flex-col font-sans select-none">
      {/* Header section */}
      <div className="flex justify-between items-center mb-8 border-b border-[#27272a] pb-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-3">
            <Layers className="text-[#E11D48] w-8 h-8" />
            Multiplier Setup Studio
          </h1>
          <p className="text-[#a1a1aa] text-sm mt-1">
            Group-based batch video generator with transcription-once workflow and Remotion news card styles.
          </p>
        </div>

        {/* Tab Selection */}
        <div className="bg-[#18181b] p-1 rounded-lg border border-[#27272a] flex gap-1">
          <button
            onClick={() => setActiveTab("builder")}
            className={`px-4 py-2 text-sm font-semibold rounded-md transition-all ${
              activeTab === "builder"
                ? "bg-[#E11D48] text-white shadow-lg"
                : "text-[#a1a1aa] hover:text-white"
            }`}
          >
            Group Builder
          </button>
          <button
            onClick={() => setActiveTab("bulk")}
            className={`px-4 py-2 text-sm font-semibold rounded-md transition-all ${
              activeTab === "bulk"
                ? "bg-[#E11D48] text-white shadow-lg"
                : "text-[#a1a1aa] hover:text-white"
            }`}
          >
            Bulk Intake
          </button>
          <button
            onClick={() => setActiveTab("queue")}
            className={`px-4 py-2 text-sm font-semibold rounded-md transition-all ${
              activeTab === "queue"
                ? "bg-[#E11D48] text-white shadow-lg"
                : "text-[#a1a1aa] hover:text-white"
            }`}
          >
            Queue Dashboard
          </button>
        </div>
      </div>

      {activeTab === "builder" ? (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Sidebar list of existing groups */}
          <div className="lg:col-span-1 bg-[#18181b] rounded-xl border border-[#27272a] p-6 flex flex-col h-[calc(100vh-220px)] overflow-hidden">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-sm text-[#a1a1aa] uppercase tracking-wider">Active Groups</h3>
              <button
                onClick={() => {
                  setSelectedGroup(null);
                  setGroupName("");
                  setSelectedCampaignId("");
                }}
                className="text-xs font-semibold text-[#E11D48] hover:underline flex items-center gap-1"
              >
                <PlusCircle className="w-4 h-4" /> New Group
              </button>
            </div>

            {loadingGroups ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-[#E11D48]" />
              </div>
            ) : groups.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-4 text-[#71717a]">
                <Layers className="w-10 h-10 mb-2 opacity-30" />
                <p className="text-xs">No active groups.</p>
                <p className="text-[10px] mt-1 opacity-70">Create one with New Group to get started.</p>
              </div>
            ) : (() => {
              const query = builderGroupSearch.trim().toLowerCase();
              // Groups arrive newest-first — filtering preserves that order
              const filteredGroups = query
                ? groups.filter((g) => g.name.toLowerCase().includes(query))
                : groups;
              const allFilteredSelected =
                filteredGroups.length > 0 && filteredGroups.every((g) => builderSelectedIds.has(g.id));
              return (
                <>
                  {/* Filter */}
                  <div className="relative mb-3">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#71717a] pointer-events-none" />
                    <input
                      type="text"
                      value={builderGroupSearch}
                      onChange={(e) => setBuilderGroupSearch(e.target.value)}
                      placeholder="Filter groups..."
                      className="w-full bg-[#09090b] border border-[#27272a] rounded-lg pl-8 pr-3 py-2 text-xs focus:outline-none focus:border-[#E11D48] placeholder:text-[#52525b]"
                    />
                  </div>

                  {/* List header: select-all (filtered) + count */}
                  <div className="flex items-center justify-between mb-2 px-1">
                    <button
                      onClick={() => {
                        if (allFilteredSelected) {
                          setBuilderSelectedIds(new Set());
                        } else {
                          setBuilderSelectedIds(new Set(filteredGroups.map((g) => g.id)));
                        }
                      }}
                      className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#71717a] hover:text-[#fafafa] transition-colors cursor-pointer"
                    >
                      {allFilteredSelected ? (
                        <CheckSquare className="w-3.5 h-3.5 text-[#E11D48]" />
                      ) : (
                        <Square className="w-3.5 h-3.5" />
                      )}
                      Select All
                    </button>
                    <span className="text-[10px] text-[#52525b]">
                      {filteredGroups.length} group{filteredGroups.length !== 1 ? "s" : ""}
                    </span>
                  </div>

                  {/* Bulk action bar */}
                  {builderSelectedIds.size > 0 && (
                    <div className="mb-3 flex items-center justify-between gap-2 bg-[#09090b] border border-[#27272a] rounded-lg px-3 py-2">
                      <span className="text-[10px] font-semibold text-[#a1a1aa]">
                        {builderSelectedIds.size} selected
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleDeleteBuilderSelectedGroups}
                          disabled={bulkDeleting}
                          className="px-2 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 rounded text-[10px] font-semibold flex items-center gap-1 transition-all disabled:opacity-50 cursor-pointer"
                        >
                          {bulkDeleting ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Trash className="w-3 h-3" />
                          )}
                          Delete ({builderSelectedIds.size})
                        </button>
                        <button
                          onClick={() => setBuilderSelectedIds(new Set())}
                          className="text-[10px] text-[#71717a] hover:text-[#fafafa] transition-colors font-medium cursor-pointer"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  )}

                  {filteredGroups.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-4 text-[#71717a]">
                      <Search className="w-8 h-8 mb-2 opacity-30" />
                      <p className="text-xs">No groups match &quot;{builderGroupSearch.trim()}&quot;.</p>
                    </div>
                  ) : (
                    <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                      {filteredGroups.map((group) => {
                        const isSel = selectedGroup?.id === group.id;
                        const isChecked = builderSelectedIds.has(group.id);
                        return (
                          <div
                            key={group.id}
                            onClick={() => handleSelectGroup(group)}
                            className={`p-3 rounded-lg border cursor-pointer transition-all flex items-start gap-2.5 ${
                              isSel
                                ? "bg-[#27272a] border-[#E11D48]"
                                : "bg-[#09090b] border-[#27272a] hover:bg-[#18181b]"
                            }`}
                          >
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setBuilderSelectedIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(group.id)) {
                                    next.delete(group.id);
                                  } else {
                                    next.add(group.id);
                                  }
                                  return next;
                                });
                              }}
                              className="mt-0.5 text-[#71717a] hover:text-[#fafafa] transition-colors flex-shrink-0 cursor-pointer"
                              title={isChecked ? "Deselect group" : "Select group"}
                            >
                              {isChecked ? (
                                <CheckSquare className="w-4 h-4 text-[#E11D48]" />
                              ) : (
                                <Square className="w-4 h-4" />
                              )}
                            </button>
                            <div className="truncate flex-1 min-w-0">
                              <p className="font-semibold text-sm truncate">{group.name}</p>
                              <p className="text-xs text-[#71717a] truncate mt-0.5">
                                {group.campaign?.title || "No Campaign"}
                              </p>
                              <div className="flex items-center gap-2 mt-1.5">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[9px] uppercase font-extrabold ${
                                    group.status === "COMPLETED"
                                      ? "bg-green-500/10 text-green-500"
                                      : group.status === "FAILED"
                                      ? "bg-red-500/10 text-red-500"
                                      : group.status === "RENDERING" || group.status === "QUEUED"
                                      ? "bg-amber-500/10 text-amber-500"
                                      : "bg-zinc-500/10 text-zinc-400"
                                  }`}
                                >
                                  {group.status}
                                </span>
                                <span className="text-[10px] text-[#52525b] whitespace-nowrap">
                                  {group.variations.length} videos · {group.hooks.length} hooks
                                </span>
                              </div>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteGroup(group.id);
                              }}
                              className="text-[#71717a] hover:text-red-500 transition-colors p-1 flex-shrink-0"
                              title="Permanently delete this group"
                            >
                              <Trash className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          {/* Group Editor / Setup Cockpit */}
          <div className="lg:col-span-3 bg-[#18181b] rounded-xl border border-[#27272a] p-8 space-y-8 overflow-y-auto h-[calc(100vh-220px)] custom-scrollbar">
            {/* Step 1: Base settings */}
            <div>
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <span className="bg-[#E11D48] text-white text-xs w-5 h-5 flex items-center justify-center rounded-full font-bold">1</span>
                Group Setup
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-[#a1a1aa] mb-2">Group Name</label>
                  <input
                    type="text"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    placeholder="e.g. Political Clips Batch #12"
                    className="w-full bg-[#09090b] border border-[#27272a] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#E11D48]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-[#a1a1aa] mb-2">Associated Campaign</label>
                  {loadingCampaigns ? (
                    <div className="h-10 flex items-center">
                      <Loader2 className="w-4 h-4 animate-spin text-[#E11D48]" />
                    </div>
                  ) : (
                    <select
                      value={selectedCampaignId}
                      onChange={(e) => setSelectedCampaignId(e.target.value)}
                      className="w-full bg-[#09090b] border border-[#27272a] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#E11D48] text-[#fafafa]"
                    >
                      <option value="">Select campaign context...</option>
                      {campaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title} ({c.type})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
              {!selectedGroup && (
                <button
                  onClick={handleCreateNewGroup}
                  className="mt-4 px-5 py-2.5 bg-[#E11D48] hover:bg-rose-700 text-white font-semibold rounded-lg text-sm transition-all"
                >
                  Create Group
                </button>
              )}
            </div>

            {selectedGroup && (
              <>
                {/* Step 2: Upload Video variations */}
                <div className="border-t border-[#27272a] pt-6">
                  <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <span className="bg-[#E11D48] text-white text-xs w-5 h-5 flex items-center justify-center rounded-full font-bold">2</span>
                    Upload Edited Video Variations
                  </h2>
                  <div
                    onClick={() => !uploadingFiles && fileInputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (uploadingFiles) return;
                      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                        const mp4Files = Array.from(e.dataTransfer.files).filter((f) => f.type === "video/mp4" || f.name.endsWith(".mp4"));
                        if (mp4Files.length > 0) {
                          handleUploadVariationsDirectly(mp4Files);
                        } else {
                          toast.error("Please drop MP4 video files only.");
                        }
                      }
                    }}
                    className={`border-2 border-dashed rounded-xl p-8 text-center transition-all bg-[#09090b] flex flex-col items-center justify-center ${
                      uploadingFiles
                        ? "border-[#E11D48]/30 cursor-not-allowed opacity-60"
                        : "border-[#27272a] hover:border-[#E11D48] cursor-pointer"
                    }`}
                  >
                    {uploadingFiles ? (
                      <>
                        <Loader2 className="w-8 h-8 text-[#E11D48] mb-2 animate-spin" />
                        <p className="text-sm font-semibold">Uploading and processing video variations...</p>
                        <p className="text-xs text-[#71717a] mt-1">Videos over 20MB will be automatically compressed for optimal rendering speed</p>
                        <div className="w-full max-w-xs mt-4 relative">
                          <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                            <div className="h-full bg-[#E11D48] rounded-full animate-pulse w-2/3" />
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <Upload className="w-8 h-8 text-[#71717a] mb-2" />
                        <p className="text-sm font-semibold">Click to browse or drop video files</p>
                        <p className="text-xs text-[#71717a] mt-1">Accepts multiple .mp4 variations</p>
                      </>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="video/mp4"
                      disabled={uploadingFiles}
                      onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) {
                          handleUploadVariationsDirectly(Array.from(e.target.files));
                        }
                      }}
                      className="hidden"
                    />
                  </div>

                  {selectedGroup.variations.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-semibold text-[#a1a1aa] mb-2">Uploaded Variations ({selectedGroup.variations.length}):</p>
                      <div className="flex flex-wrap gap-3">
                        {selectedGroup.variations.map((v, i) => (
                          <div
                            key={v.id}
                            className="flex items-center gap-1 bg-[#09090b] hover:bg-[#18181b] px-3 py-2 rounded-lg border border-[#27272a] transition-all"
                          >
                            <button
                              type="button"
                              onClick={() => setPreviewVideoUrl(getServeUrl(v.videoRef))}
                              className="group flex items-center gap-2 text-left"
                              title="Click to play preview"
                            >
                              <Play className="w-3.5 h-3.5 text-[#71717a] group-hover:text-[#E11D48] transition-colors" />
                              <span className="text-xs font-semibold text-[#fafafa] group-hover:text-white">Variation #{i + 1}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteVariation(v)}
                              className="p-1 text-[#71717a] hover:text-[#E11D48] hover:bg-red-500/5 rounded transition-all cursor-pointer"
                              title="Delete variation"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Step 3: Speech Transcription */}
                <div className="border-t border-[#27272a] pt-6">
                  <div className="bg-[#09090b] border border-[#27272a] rounded-xl p-4 flex items-center justify-between gap-4">
                    <div className="flex-1 flex items-center gap-3">
                      <span className="bg-[#E11D48] text-white text-[10px] w-4.5 h-4.5 flex items-center justify-center rounded-full font-bold">3</span>
                      <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">Whisper Alignment:</span>
                      
                      {selectedGroup.transcriptStatus === "TRANSCRIBED" && (
                        <span className="inline-flex items-center gap-1.5 text-xs text-green-500 font-semibold bg-green-500/10 px-2.5 py-1 rounded-full">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Completed
                        </span>
                      )}
                      
                      {selectedGroup.transcriptStatus === "TRANSCRIBING" && (
                        <div className="flex-1 flex items-center gap-3">
                          <span className="inline-flex items-center gap-1 text-xs text-amber-500 font-semibold animate-pulse">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing...
                          </span>
                          <div className="flex-1 max-w-xs h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div className="h-full bg-amber-500 rounded-full animate-pulse w-3/4" />
                          </div>
                        </div>
                      )}
                      
                      {selectedGroup.transcriptStatus === "FAILED" && (
                        <span className="inline-flex items-center gap-1.5 text-xs text-red-500 font-semibold bg-red-500/10 px-2.5 py-1 rounded-full">
                          <AlertCircle className="w-3.5 h-3.5" /> Failed: {selectedGroup.errorMessage || "System error"}
                        </span>
                      )}
                      
                      {(!selectedGroup.transcriptStatus || selectedGroup.transcriptStatus === "PENDING") && (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-500 font-semibold">
                          <AlertCircle className="w-3.5 h-3.5" /> Idle (No transcription yet)
                        </span>
                      )}
                    </div>

                    <button
                      onClick={handleTranscribeGroup}
                      disabled={transcribing || selectedGroup.variations.length === 0 || selectedGroup.transcriptStatus === "TRANSCRIBING"}
                      className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-white font-bold rounded-lg text-xs transition-all disabled:opacity-50 flex items-center gap-1.5"
                      title="Trigger or reload transcription alignment"
                    >
                      {transcribing ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin text-[#E11D48]" /> Transcribing...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-3 h-3" />
                          {selectedGroup.transcriptStatus === "FAILED" ? "Retry Transcription" : "Reload / Realign"}
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Step 4: Craft Hooks / Captions */}
                <div className="border-t border-[#27272a] pt-6">
                  <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <span className="bg-[#E11D48] text-white text-xs w-5 h-5 flex items-center justify-center rounded-full font-bold">4</span>
                    Caption Hooks List
                  </h2>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                     {/* AI Generator Box */}
                     <div className="md:col-span-2 bg-[#09090b] border border-[#27272a] rounded-xl p-6 flex flex-col justify-between">
                       <div>
                         <div className="flex justify-between items-start mb-4 gap-4">
                           <div>
                             <p className="text-sm font-semibold flex items-center gap-1.5">
                               <Sparkles className="w-4.5 h-4.5 text-[#E11D48]" /> Gemini AI Hook Generator
                             </p>
                             <p className="text-xs text-[#71717a] mt-1">
                               Synthesizes the transcript text with the campaign brief messaging context to draft premium news-style hooks.
                             </p>
                           </div>
                           <button
                             onClick={() => setIsEditingPrompt(true)}
                             disabled={selectedGroup.transcriptStatus !== "TRANSCRIBED" || generatingAiHooks}
                             className="px-3.5 py-1.5 bg-[#18181b] hover:bg-zinc-800 text-[#fafafa] font-bold rounded-lg text-xs transition-all disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap cursor-pointer shadow-sm border border-[#27272a]"
                             type="button"
                             title="Edit prompt instructions and template variables sent to Gemini"
                           >
                             <Sparkles className="w-3.5 h-3.5 text-[#E11D48]" /> Edit Prompt
                           </button>
                         </div>

                         {/* Side-by-Side Context Previews */}
                         <div className="grid grid-cols-2 gap-4 mb-4">
                           <div className="bg-[#18181b]/50 border border-[#27272a]/50 rounded-lg p-3">
                             <p className="text-[9px] uppercase font-bold text-zinc-500 mb-1">Campaign Markdown</p>
                             <div className="max-h-[85px] overflow-y-auto text-[10px] text-zinc-400 font-mono custom-scrollbar whitespace-pre-line leading-relaxed">
                               {(() => {
                                 const campaign = campaigns.find((c) => c.id === selectedGroup.campaignId);
                                 return campaign
                                   ? `# ${campaign.title}\nDescription: ${campaign.description}\nBrief: ${campaign.brief}`
                                   : "No linked campaign details.";
                               })()}
                             </div>
                           </div>
                           <div className="bg-[#18181b]/50 border border-[#27272a]/50 rounded-lg p-3">
                             <p className="text-[9px] uppercase font-bold text-zinc-500 mb-1">Raw Audio Transcription</p>
                             <div className="max-h-[85px] overflow-y-auto text-[10px] text-zinc-400 font-mono custom-scrollbar leading-relaxed">
                               {(() => {
                                 if (!selectedGroup.transcript) return "Pending transcription alignment.";
                                 try {
                                   const wordList = JSON.parse(selectedGroup.transcript);
                                   if (Array.isArray(wordList)) {
                                     return wordList.map((w: any) => w.word || w.text || "").join(" ");
                                   }
                                   return String(selectedGroup.transcript);
                                 } catch {
                                   return selectedGroup.transcript;
                                 }
                               })()}
                             </div>
                           </div>
                         </div>
                       </div>

                       <div className="flex items-center gap-4 border-t border-[#27272a] pt-4 mt-2">
                         <div className="w-24">
                           <label className="block text-[10px] text-[#71717a] uppercase font-bold mb-1">Hooks Count</label>
                           <input
                             type="number"
                             min={1}
                             max={20}
                             value={aiHookCount}
                             onChange={(e) => setAiHookCount(parseInt(e.target.value) || 15)}
                             className="w-full bg-[#18181b] border border-[#27272a] rounded px-3 py-1.5 text-xs text-center focus:outline-none"
                             disabled={generatingAiHooks}
                           />
                         </div>
                         <button
                           onClick={handleGenerateAiHooks}
                           disabled={generatingAiHooks || selectedGroup.transcriptStatus !== "TRANSCRIBED"}
                           className="flex-1 py-2 bg-[#E11D48] hover:bg-rose-700 text-white font-semibold rounded-lg text-xs transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                         >
                           {generatingAiHooks ? (
                             <>
                               <Loader2 className="w-4 h-4 animate-spin" /> Generating AI Hooks...
                             </>
                           ) : (
                             <>
                               <Sparkles className="w-3.5 h-3.5" /> Generate AI hooks with Campaign context
                             </>
                           )}
                         </button>
                       </div>
                     </div>

                    {/* CSV / Manual Box */}
                    <div className="bg-[#09090b] border border-[#27272a] rounded-xl p-6 flex flex-col justify-between">
                      <div>
                        <p className="text-sm font-semibold flex items-center gap-1.5">
                          <FileSpreadsheet className="w-4.5 h-4.5 text-green-500" /> Import Hook CSV
                        </p>
                        <p className="text-xs text-[#71717a] mt-1">Select file to parse newline-separated text rows</p>
                      </div>

                      <div>
                        <input
                          type="file"
                          accept=".csv,.txt"
                          id="csv-file-input"
                          onChange={handleCSVImport}
                          className="hidden"
                        />
                        <button
                          onClick={() => document.getElementById("csv-file-input")?.click()}
                          className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-white font-semibold rounded-lg text-xs transition-all"
                        >
                          Choose CSV File
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Manual add input */}
                  <div className="flex gap-3 mb-6 bg-[#09090b] border border-[#27272a] p-3 rounded-xl">
                    <input
                      type="text"
                      value={newHookText}
                      onChange={(e) => setNewHookText(e.target.value)}
                      placeholder="Add custom manual headline/hook caption..."
                      className="flex-1 bg-[#18181b] border border-[#27272a] rounded-lg px-4 py-2 text-xs focus:outline-none"
                    />
                    <button
                      onClick={handleAddManualHook}
                      className="px-4 py-2 bg-[#E11D48] hover:bg-rose-700 text-white font-semibold rounded-lg text-xs transition-all flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add
                    </button>
                  </div>

                  {/* Existing Hooks list */}
                  {selectedGroup.hooks.length > 0 ? (
                    <div className="space-y-2.5 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                      {selectedGroup.hooks.map((h, i) => (
                        <div
                          key={h.id}
                          className="bg-[#09090b] p-3 rounded-lg border border-[#27272a] flex justify-between items-center gap-4"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-bold text-[#E11D48] bg-[#E11D48]/10 px-2 py-0.5 rounded">
                              #{i + 1}
                            </span>
                            <span className="text-xs text-[#fafafa] font-medium">{h.text}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] uppercase font-bold text-[#71717a] bg-[#18181b] px-2 py-0.5 rounded border border-[#27272a]">
                              {h.source}
                            </span>
                            <button
                              onClick={() => handleDeleteHook(h.id)}
                              className="text-[#71717a] hover:text-red-500 p-1"
                            >
                              <Trash className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center p-8 bg-[#09090b] border border-[#27272a] rounded-xl text-[#71717a] text-xs">
                      No caption hooks loaded yet.
                    </div>
                  )}
                </div>

                {/* Step 5: Caption Style Picker */}
                <div className="border-t border-[#27272a] pt-6">
                  <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <span className="bg-[#E11D48] text-white text-xs w-5 h-5 flex items-center justify-center rounded-full font-bold">5</span>
                    Select Editorial Still Caption Style
                  </h2>

                  {/* Load/CRUD Presets Panel */}
                  <div className="flex flex-wrap items-center gap-4 mb-6 p-4 bg-[#18181b] rounded-xl border border-[#27272a]">
                    <div className="flex-1 min-w-[200px]">
                      <label className="block text-[10px] uppercase font-bold text-[#a1a1aa] mb-1">Load Style Preset</label>
                      <select
                        value={selectedSavedStyleId}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSelectedSavedStyleId(val);
                          if (val === "") return;
                          const found = savedStyles.find(s => s.id === val);
                          if (found) {
                            setStyleId(found.templateKey as any);
                            let p = found.params;
                            if (typeof p === "string") {
                              try {
                                p = JSON.parse(p);
                                if (typeof p === "string") {
                                  p = JSON.parse(p);
                                }
                              } catch {
                                p = {};
                              }
                            }
                            if (!p) p = {};
                            setFontSize(p.fontSize ?? 32);
                            setFontColor(p.fontColor ?? p.textColor ?? "#FFFFFF");
                            setBgStripColor(p.bgStripColor ?? p.bgColor ?? "#000000");
                            setBgStripOpacity(p.bgStripOpacity ?? p.bgOpacity ?? 0.85);
                            setPositionYPercent(p.positionYPercent ?? p.positionY ?? 75);
                            setAccentColor(p.accentColor ?? "#E11D48");
                            setAuthor(p.author ?? "");
                            setFontFamily(p.fontFamily ?? "Inter");
                          }
                        }}
                        className="w-full bg-[#09090b] border border-[#27272a] rounded px-3 py-1.5 text-xs text-[#fafafa] focus:outline-none"
                      >
                        <option value="">-- Custom Settings (No Preset Loaded) --</option>
                        {savedStyles.map((style) => (
                          <option key={style.id} value={style.id}>
                            {style.name} ({style.templateKey})
                          </option>
                        ))}
                      </select>
                    </div>

                    {(session?.role === "admin" || session?.role === "team_lead") && (
                      <div className="flex gap-2 self-end">
                        <button
                          type="button"
                          onClick={() => {
                            setNewTemplateName("");
                            setShowTemplateSaveModal(true);
                          }}
                          className="px-3 py-1.5 text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded flex items-center gap-1 transition-colors"
                        >
                          <PlusCircle className="w-3.5 h-3.5" /> Save As Preset
                        </button>

                        {selectedSavedStyleId && (
                          <button
                            type="button"
                            onClick={handlePromptUpdatePreset}
                            className="px-3 py-1.5 text-[11px] font-semibold text-white bg-[#E11D48] hover:bg-[#E11D48]/90 rounded flex items-center gap-1 transition-colors"
                          >
                            <RefreshCw className="w-3.5 h-3.5" /> Update Preset
                          </button>
                        )}

                        {selectedSavedStyleId && (
                          <button
                            type="button"
                            onClick={handleDeletePreset}
                            className="px-3 py-1.5 text-[11px] font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded flex items-center gap-1 transition-colors"
                          >
                            <Trash className="w-3.5 h-3.5" /> Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    {(
                      [
                        { id: "news-lower-third", label: "News Lower-Third", desc: "Solid translucent bar spanning lower frame" },
                        { id: "breaking-headline", label: "Breaking News Headline", desc: "Bold uppercase headline strip with warning star" },
                        { id: "subtitle-box", label: "Subtitle Caption Box", desc: "Simple clean reader subtitle box" },
                        { id: "quote-card", label: "Quote / Statement Card", desc: "Serif testimonial quotes layout" }
                      ] as const
                    ).map((style) => {
                      const isSel = styleId === style.id;
                      return (
                        <div
                          key={style.id}
                          onClick={() => setStyleId(style.id)}
                          className={`p-4 rounded-xl border cursor-pointer text-left transition-all ${
                            isSel
                              ? "bg-[#27272a] border-[#E11D48] ring-1 ring-[#E11D48]"
                              : "bg-[#09090b] border-[#27272a] hover:bg-[#18181b]"
                          }`}
                        >
                          <p className="font-semibold text-xs text-[#fafafa] mb-1">{style.label}</p>
                          <p className="text-[10px] text-[#71717a]">{style.desc}</p>
                        </div>
                      );
                    })}
                  </div>

                  {/* Settings tweaking sliders */}
                  <div className="bg-[#09090b] border border-[#27272a] rounded-xl p-6 space-y-6">
                    <div className="flex justify-between items-center cursor-pointer border-b border-[#27272a] pb-4" onClick={() => setShowAdvanced(!showAdvanced)}>
                      <p className="text-sm font-semibold flex items-center gap-1">
                        <Settings2 className="w-4 h-4" /> Layout Settings & Customizations
                      </p>
                      {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>

                    <div className={`grid grid-cols-1 md:grid-cols-2 gap-6 ${showAdvanced ? "" : "hidden"}`}>
                      <div>
                        <label className="block text-[10px] uppercase font-bold text-[#a1a1aa] mb-2">Font Family</label>
                        <select
                          value={fontFamily}
                          onChange={(e) => setFontFamily(e.target.value)}
                          className="w-full bg-[#18181b] border border-[#27272a] rounded-lg px-4 py-2 text-xs text-[#fafafa] focus:outline-none"
                        >
                          <option value="Inter">Inter</option>
                          <option value="IBM Plex Sans">IBM Plex Sans</option>
                          <option value="Source Sans 3">Source Sans 3</option>
                          <option value="Libre Franklin">Libre Franklin</option>
                          <option value="Archivo">Archivo</option>
                          <option value="Barlow">Barlow</option>
                          <option value="Barlow Condensed">Barlow Condensed</option>
                          <option value="Roboto">Roboto</option>
                          <option value="Roboto Condensed">Roboto Condensed</option>
                          <option value="Oswald">Oswald</option>
                          <option value="Anton">Anton</option>
                          <option value="Public Sans">Public Sans</option>
                          <option value="Lora">Lora</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] uppercase font-bold text-[#a1a1aa] mb-2">Font Size (px)</label>
                        <input
                          type="range"
                          min={20}
                          max={70}
                          value={fontSize}
                          onChange={(e) => setFontSize(parseInt(e.target.value))}
                          className="w-full accent-[#E11D48] bg-[#18181b]"
                        />
                        <div className="flex justify-between text-[10px] text-[#71717a] mt-1">
                          <span>20px</span>
                          <span className="text-[#fafafa] font-semibold">{fontSize}px</span>
                          <span>70px</span>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] uppercase font-bold text-[#a1a1aa] mb-2">Vertical Alignment (Percent Y)</label>
                        <input
                          type="range"
                          min={10}
                          max={90}
                          value={positionYPercent}
                          onChange={(e) => setPositionYPercent(parseInt(e.target.value))}
                          className="w-full accent-[#E11D48] bg-[#18181b]"
                        />
                        <div className="flex justify-between text-[10px] text-[#71717a] mt-1">
                          <span>10% (Top)</span>
                          <span className="text-[#fafafa] font-semibold">{positionYPercent}%</span>
                          <span>90% (Bottom)</span>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] uppercase font-bold text-[#a1a1aa] mb-2">Accent Strip Color</label>
                        <div className="flex items-center gap-3">
                          <input
                            type="color"
                            value={accentColor}
                            onChange={(e) => setAccentColor(e.target.value)}
                            className="bg-transparent border-0 w-8 h-8 rounded cursor-pointer"
                          />
                          <input
                            type="text"
                            value={accentColor}
                            onChange={(e) => setAccentColor(e.target.value)}
                            className="bg-[#18181b] border border-[#27272a] rounded px-3 py-1.5 text-xs text-center text-[#fafafa] w-28"
                          />
                        </div>
                      </div>

                      {styleId === "quote-card" && (
                        <div>
                          <label className="block text-[10px] uppercase font-bold text-[#a1a1aa] mb-2">Author Name</label>
                          <input
                            type="text"
                            value={author}
                            onChange={(e) => setAuthor(e.target.value)}
                            placeholder="e.g. Ronald Reagan"
                            className="w-full bg-[#18181b] border border-[#27272a] rounded-lg px-4 py-2 text-xs focus:outline-none"
                          />
                        </div>
                      )}

                      <div>
                        <label className="block text-[10px] uppercase font-bold text-[#a1a1aa] mb-2">Text Color</label>
                        <div className="flex items-center gap-3">
                          <input
                            type="color"
                            value={fontColor}
                            onChange={(e) => setFontColor(e.target.value)}
                            className="bg-transparent border-0 w-8 h-8 rounded cursor-pointer"
                          />
                          <span className="text-xs font-semibold">{fontColor}</span>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] uppercase font-bold text-[#a1a1aa] mb-2">Background Card Color</label>
                        <div className="flex items-center gap-3">
                          <input
                            type="color"
                            value={bgStripColor}
                            onChange={(e) => setBgStripColor(e.target.value)}
                            className="bg-transparent border-0 w-8 h-8 rounded cursor-pointer"
                          />
                          <span className="text-xs font-semibold">{bgStripColor}</span>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] uppercase font-bold text-[#a1a1aa] mb-2">Card Opacity</label>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={Math.round(bgStripOpacity * 100)}
                          onChange={(e) => setBgStripOpacity(parseFloat((parseInt(e.target.value) / 100).toFixed(2)))}
                          className="w-full accent-[#E11D48] bg-[#18181b]"
                        />
                        <div className="flex justify-between text-[10px] text-[#71717a] mt-1">
                          <span>Transparent</span>
                          <span className="text-[#fafafa] font-semibold">{Math.round(bgStripOpacity * 100)}%</span>
                          <span>Solid</span>
                        </div>
                      </div>
                    </div>

                    {/* Quick Live Preview Box */}
                    <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-5">
                      <p className="text-[10px] uppercase font-bold text-[#71717a] mb-2">Layout Preview Canvas (Stills)</p>
                      <div className="aspect-[9/16] max-w-[200px] mx-auto bg-[#09090b] rounded border border-[#27272a] relative overflow-hidden flex flex-col justify-center">
                        {selectedGroup?.variations && selectedGroup.variations.length > 0 ? (
                          <video
                            key={selectedGroup.variations[previewVariationIndex]?.videoRef}
                            src={getServeUrl(selectedGroup.variations[previewVariationIndex]?.videoRef)}
                            className="absolute inset-0 w-full h-full object-cover"
                            autoPlay
                            muted
                            loop
                            playsInline
                          />
                        ) : (
                          <div className="absolute inset-0 bg-neutral-900/10 flex items-center justify-center text-[10px] text-[#27272a] pointer-events-none">
                            Background Video Frame
                          </div>
                        )}
                        {/* Live CSS approximate preview */}
                        <div
                          style={{
                            position: "absolute",
                            top: `${positionYPercent}%`,
                            left: "11px",
                            right: "11px",
                            transform: "translateY(-50%)",
                            backgroundColor: bgStripColor,
                            opacity: bgStripOpacity,
                            borderLeft: styleId === "news-lower-third" || styleId === "breaking-headline" ? `2px solid ${accentColor}` : "none",
                            borderRadius: styleId === "subtitle-box" ? "2px" : styleId === "quote-card" ? "3px" : "0",
                            padding: "5.5px 6.6px",
                            boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
                          }}
                        >
                          <p
                            style={{
                              color: fontColor,
                              fontSize: `${fontSize / 3.6}px`,
                              lineHeight: "1.2",
                              fontWeight: "bold",
                              textAlign: styleId === "subtitle-box" ? "center" : "left",
                              fontFamily: fontFamily ? `'${fontFamily}', sans-serif` : (styleId === "quote-card" ? "Georgia, serif" : "sans-serif"),
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {getStylePreviewSnippet()}
                          </p>
                        </div>
                      </div>

                      {/* Variation Selector if multiple variations are present */}
                      {selectedGroup?.variations && selectedGroup.variations.length > 1 && (
                        <div className="mt-3 flex items-center justify-between text-xs text-[#a1a1aa] bg-[#09090b] border border-[#27272a] rounded-lg p-2">
                          <span>Preview Variation:</span>
                          <select
                            value={previewVariationIndex}
                            onChange={(e) => setPreviewVariationIndex(parseInt(e.target.value))}
                            className="bg-[#18181b] border border-[#27272a] rounded px-2.5 py-1 text-xs focus:outline-none text-[#fafafa] font-semibold"
                          >
                            {selectedGroup.variations.map((v: any, idx: number) => (
                              <option key={v.id} value={idx}>
                                Variation #{idx + 1}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Step 6: Rendering Trigger */}
                <div className="border-t border-[#27272a] pt-6 bg-[#E11D48]/5 -mx-8 -mb-8 p-8 rounded-b-xl border-t border-[#27272a]">
                  <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <span className="bg-[#E11D48] text-white text-xs w-5 h-5 flex items-center justify-center rounded-full font-bold">6</span>
                    Render Queue Setup & Trigger
                  </h2>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-[#a1a1aa] mb-2">Output Mapping Mode</label>
                      <select
                        value={mappingMode}
                        onChange={(e) => setMappingMode(e.target.value as any)}
                        className="w-full bg-[#09090b] border border-[#27272a] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#E11D48] text-[#fafafa]"
                      >
                        <option value="each">Multiply: Render each hook onto each variation (M x H)</option>
                        <option value="distribute">Distribute: Spread hooks round-robin across variations (H total)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-[#a1a1aa] mb-2">Overlay Duration (Seconds)</label>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={hookDuration}
                        onChange={(e) => setHookDuration(parseInt(e.target.value) || 5)}
                        className="w-full bg-[#09090b] border border-[#27272a] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#E11D48]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-[#a1a1aa] mb-2">Animation Effect</label>
                      <select
                        value={animationType}
                        onChange={(e) => setAnimationType(e.target.value as any)}
                        className="w-full bg-[#09090b] border border-[#27272a] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#E11D48]"
                      >
                        <option value="NONE">None: Instant static overlay</option>
                        <option value="FADE_IN">Fade-In: Smooth transition</option>
                        <option value="SLIDE_UP">Slide-Up: Fades and shifts upward</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-[#a1a1aa] mb-2">Animation Duration (Seconds)</label>
                      <input
                        type="number"
                        step={0.1}
                        min={0.1}
                        max={2.0}
                        value={animationDuration}
                        onChange={(e) => setAnimationDuration(parseFloat(e.target.value) || 0.5)}
                        className="w-full bg-[#09090b] border border-[#27272a] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#E11D48]"
                      />
                    </div>
                  </div>

                  <div className="flex justify-between items-center bg-[#09090b] p-4 rounded-xl border border-[#27272a]">
                    <div>
                      <p className="text-xs text-[#a1a1aa]">Estimated Batch Size:</p>
                      <p className="text-xl font-black text-[#fafafa] flex items-center gap-1.5">
                        <Video className="w-5 h-5 text-[#E11D48]" /> {getEstimatedOutputs()} Finished MP4s
                      </p>
                    </div>

                    <div className="flex gap-3">
                      <button
                        onClick={handleUpdateGroupSettings}
                        className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white font-semibold rounded-lg text-sm transition-all"
                      >
                        Save Configuration
                      </button>
                      <button
                        onClick={handleStartRendering}
                        disabled={selectedGroup.variations.length === 0 || selectedGroup.hooks.length === 0}
                        className="px-6 py-2.5 bg-[#E11D48] hover:bg-rose-700 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-all shadow-lg flex items-center gap-2"
                      >
                        <Play className="w-4 h-4" /> Start Rendering
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      ) : activeTab === "bulk" ? (
        /* Bulk Intake Tab */
        <div className="max-w-4xl mx-auto w-full space-y-6">
          {/* Upload card */}
          <div className="bg-[#18181b] rounded-xl border border-[#27272a] p-6 space-y-5">
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Video className="text-[#E11D48] w-5 h-5" /> Bulk Intake
              </h2>
              <p className="text-xs text-[#71717a] mt-1">
                Upload videos to auto-create groups — each file is transcribed and gets AI hooks generated automatically.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#a1a1aa] mb-2">Campaign</label>
                <select
                  value={bulkCampaignId}
                  onChange={(e) => setBulkCampaignId(e.target.value)}
                  className="w-full bg-[#09090b] border border-[#27272a] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#E11D48] text-[#fafafa]"
                >
                  <option value="">Select campaign context...</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title} ({c.type})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#a1a1aa] mb-2">Style Preset (optional)</label>
                <select
                  value={bulkStyleId}
                  onChange={(e) => setBulkStyleId(e.target.value)}
                  className="w-full bg-[#09090b] border border-[#27272a] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#E11D48] text-[#fafafa]"
                >
                  <option value="">Default style</option>
                  {savedStyles.map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#a1a1aa] mb-2">Group Name Prefix (optional)</label>
              <input
                type="text"
                value={bulkNamePrefix}
                onChange={(e) => setBulkNamePrefix(e.target.value)}
                placeholder="e.g. Campaign Alpha — groups become “Campaign Alpha 01, 02, 03…”"
                className="w-full bg-[#09090b] border border-[#27272a] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#E11D48] text-[#fafafa] placeholder:text-[#52525b]"
              />
              <p className="text-[10px] text-[#71717a] mt-1.5">Leave empty to name groups after their file names.</p>
            </div>

            {/* Dropzone */}
            <div
              onClick={() => !bulkUploading && bulkFileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (bulkUploading) return;
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  handleBulkFilesPicked(Array.from(e.dataTransfer.files));
                }
              }}
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-all bg-[#09090b] flex flex-col items-center justify-center ${
                bulkUploading
                  ? "border-[#E11D48]/30 cursor-not-allowed opacity-60"
                  : "border-[#27272a] hover:border-[#E11D48] cursor-pointer"
              }`}
            >
              {bulkUploading ? (
                <>
                  <Loader2 className="w-8 h-8 text-[#E11D48] mb-2 animate-spin" />
                  <p className="text-sm font-semibold">
                    {bulkUploadProgress
                      ? `Uploading ${bulkUploadProgress.current}/${bulkUploadProgress.total} — ${bulkUploadProgress.fileName}`
                      : `Uploading ${bulkFiles.length} video${bulkFiles.length !== 1 ? "s" : ""}…`}
                  </p>
                  <p className="text-xs text-[#71717a] mt-1">Keep this tab open while the files upload</p>
                  {bulkUploadProgress && (
                    <div className="w-full max-w-xs mt-3 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#E11D48] rounded-full transition-all"
                        style={{ width: `${Math.round((bulkUploadProgress.current / bulkUploadProgress.total) * 100)}%` }}
                      />
                    </div>
                  )}
                </>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-[#71717a] mb-2" />
                  <p className="text-sm font-semibold">Click to browse or drop video files</p>
                  <p className="text-xs text-[#71717a] mt-1">Accepts multiple videos — one group per file</p>
                </>
              )}
              <input
                ref={bulkFileInputRef}
                type="file"
                multiple
                accept="video/*"
                disabled={bulkUploading}
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleBulkFilesPicked(Array.from(e.target.files));
                  }
                  e.target.value = "";
                }}
                className="hidden"
              />
            </div>

            {/* Selected files list */}
            {bulkFiles.length > 0 && !bulkUploading && (
              <div className="bg-[#09090b] border border-[#27272a] rounded-xl divide-y divide-[#27272a] max-h-48 overflow-y-auto custom-scrollbar">
                {bulkFiles.map((f, idx) => (
                  <div key={`${f.name}-${idx}`} className="flex items-center justify-between px-3 py-2">
                    <p className="text-xs text-[#e4e4e7] truncate" title={f.name}>{f.name}</p>
                    <button
                      onClick={() => setBulkFiles((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-[#71717a] hover:text-red-500 transition-colors p-1 cursor-pointer"
                      title="Remove file"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {bulkError && (
              <div className="text-xs text-red-500 font-semibold bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 flex-shrink-0" /> {bulkError}
              </div>
            )}

            <button
              onClick={handleBulkUpload}
              disabled={bulkUploading || bulkFiles.length === 0}
              className="px-5 py-2.5 bg-[#E11D48] hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg text-sm transition-all flex items-center gap-2"
            >
              {bulkUploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {bulkUploadProgress ? `Uploading ${bulkUploadProgress.current}/${bulkUploadProgress.total}…` : "Uploading…"}
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" /> Upload &amp; Create Groups{bulkFiles.length > 0 ? ` (${bulkFiles.length})` : ""}
                </>
              )}
            </button>
          </div>

          {/* Batch history */}
          <div className="bg-[#18181b] rounded-xl border border-[#27272a] p-6 space-y-4">
            <h3 className="font-bold text-sm text-[#a1a1aa] uppercase tracking-wider">Recent Batches</h3>
            {batchJobs.length === 0 ? (
              <div className="text-center p-10 text-[#71717a]">
                <Video className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-xs">No batches yet. Upload videos above to auto-create groups.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {batchJobs.map((job) => {
                  const readyCount = job.items.filter((i) => i.status === "READY").length;
                  const failedCount = job.items.filter((i) => i.status === "FAILED").length;
                  return (
                    <div key={job.id} className="bg-[#09090b] border border-[#27272a] rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-semibold text-[#71717a] font-mono truncate">Batch {job.id.slice(0, 8)}</p>
                        <span
                          className={`text-xs font-semibold px-2.5 py-0.5 rounded-full flex-shrink-0 ${
                            job.status === "COMPLETED"
                              ? "bg-green-500/10 text-green-500"
                              : job.status === "FAILED"
                              ? "bg-red-500/10 text-red-500"
                              : "bg-amber-500/10 text-amber-500 animate-pulse"
                          }`}
                        >
                          {job.status}
                          {job.status !== "PROCESSING" && ` · ${readyCount}/${job.items.length} ready`}
                          {failedCount > 0 && ` · ${failedCount} failed`}
                        </span>
                      </div>
                      <div className="divide-y divide-[#27272a]">
                        {job.items.map((item) => {
                          const steps = [
                            { key: "TRANSCRIBING", label: "Transcribing" },
                            { key: "GENERATING_HOOKS", label: "Generating hooks" },
                            { key: "READY", label: "Ready" },
                          ];
                          const failed = item.status === "FAILED";
                          const activeIdx = steps.findIndex((s) => s.key === item.status);
                          return (
                            <div key={item.id} className="flex items-center justify-between gap-4 py-2.5">
                              <p className="text-xs text-[#e4e4e7] truncate flex-1 min-w-0" title={item.fileName}>
                                {item.fileName}
                              </p>
                              {failed ? (
                                <span
                                  className="flex items-center gap-1.5 text-[10px] text-red-500 font-semibold flex-shrink-0 max-w-[50%] truncate"
                                  title={item.error || "Processing failed"}
                                >
                                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                                  Failed{item.error ? ` — ${item.error}` : ""}
                                </span>
                              ) : (
                                <div className="flex items-center gap-3 flex-shrink-0">
                                  {steps.map((s, i) => {
                                    const done = item.status === "READY" || i < activeIdx;
                                    const active = !done && i === activeIdx;
                                    return (
                                      <div key={s.key} className="flex items-center gap-1.5">
                                        {done ? (
                                          <Check className="w-3 h-3 text-green-500" />
                                        ) : active ? (
                                          <Loader2 className="w-3 h-3 animate-spin text-amber-500" />
                                        ) : (
                                          <span className="w-1.5 h-1.5 rounded-full bg-[#3f3f46]" />
                                        )}
                                        <span
                                          className={`text-[10px] font-medium ${
                                            done ? "text-green-500" : active ? "text-amber-500" : "text-[#52525b]"
                                          }`}
                                        >
                                          {s.label}
                                        </span>
                                      </div>
                                    );
                                  })}
                                  {item.status === "READY" && item.groupId && (
                                    <button
                                      onClick={() => handleViewGroupInBuilder(item.groupId!)}
                                      className="text-[10px] font-semibold text-[#E11D48] hover:underline flex-shrink-0 cursor-pointer"
                                    >
                                      View in builder
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Queue Dashboard Tab */
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Layers className="text-[#E11D48] w-5 h-5" /> Rendering Batches Progress Board
            </h2>
            <div className="flex items-center gap-2">
              {queueControl && (
                <>
                  {queueControl.staleRendering > 0 && (
                    <button
                      onClick={() => handleQueueControl("recover")}
                      disabled={queueControlLoading}
                      className="px-3 py-2 bg-amber-500/10 text-amber-500 border border-amber-500/20 hover:bg-amber-500/20 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50"
                      title={`${queueControl.staleRendering} video(s) stuck in RENDERING (e.g. after a restart) — reset them to pending`}
                    >
                      <AlertCircle className="w-4 h-4" /> Recover {queueControl.staleRendering} Stuck
                    </button>
                  )}
                  <button
                    onClick={() => handleQueueControl(queueControl.paused ? "resume" : "pause")}
                    disabled={queueControlLoading}
                    className={`px-3 py-2 border rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50 ${
                      queueControl.paused
                        ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/20"
                        : "bg-amber-500/10 text-amber-500 border-amber-500/20 hover:bg-amber-500/20"
                    }`}
                    title={queueControl.paused ? "Resume rendering (also recovers stuck videos)" : "Pause rendering after the current video finishes"}
                  >
                    {queueControl.paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                    {queueControl.paused ? "Resume Rendering" : "Pause Rendering"}
                  </button>
                  {queueControl.paused && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500">Paused</span>
                  )}
                </>
              )}
              {groups.length > 0 && (
                <button
                  onClick={toggleSelectAll}
                  className={`px-3 py-2 border rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                    selectedGroupIds.size > 0
                      ? "bg-[#E11D48]/10 text-[#E11D48] border-[#E11D48]/20 hover:bg-[#E11D48]/20"
                      : "bg-[#18181b] text-[#a1a1aa] border-[#27272a] hover:bg-[#27272a]"
                  }`}
                >
                  {selectedGroupIds.size > 0 ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                  {selectedGroupIds.size > 0 ? `Clear (${selectedGroupIds.size})` : "Select All"}
                </button>
              )}
              {groups.some(isGroupRenderReady) && (
                <button
                  onClick={toggleSelectRenderReady}
                  className="px-3 py-2 bg-[#18181b] text-[#a1a1aa] border border-[#27272a] hover:bg-[#27272a] rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all"
                  title="Select all groups with at least 1 variation and 1 hook that are not yet queued"
                >
                  <Play className="w-4 h-4" /> Select Render-Ready
                </button>
              )}
              {groups.length > 0 && (
                <button
                  onClick={handleDeleteAllGroups}
                  className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all"
                >
                  <Trash className="w-4 h-4" /> Delete All Batches
                </button>
              )}
              <button
                onClick={fetchData}
                className="p-2 bg-[#18181b] border border-[#27272a] rounded-lg hover:bg-[#27272a] transition-all"
                title="Refresh Board"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {loadingGroups ? (
            <div className="flex justify-center p-12">
              <Loader2 className="w-8 h-8 animate-spin text-[#E11D48]" />
            </div>
          ) : groups.length === 0 ? (
            <div className="text-center p-12 bg-[#18181b] border border-[#27272a] rounded-xl text-[#71717a]">
              No rendering queue batches running.
            </div>
          ) : (
            <div className="space-y-2">
              {groups.map((group) => {
                const pendingOutputs = group.outputs.filter((o) => o.status === "PENDING" || o.status === "RENDERING");
                const completedOutputs = group.outputs.filter((o) => o.status === "COMPLETED");
                const failedOutputs = group.outputs.filter((o) => o.status === "FAILED");
                const totalOutputs = group.outputs.length;

                const percent = totalOutputs > 0 ? Math.round((completedOutputs.length / totalOutputs) * 100) : 0;

                // Hide completely raw draft groups without outputs from queue dashboard unless they are transcribing
                if (totalOutputs === 0 && group.status !== "RENDERING" && group.transcriptStatus !== "TRANSCRIBING") return null;

                const isExpanded = expandedQueueGroups.has(group.id);

                // Collapsed: one-line summary row — expand via the chevron to see videos
                if (!isExpanded) {
                  return (
                    <div key={group.id} className="bg-[#18181b] rounded-lg border border-[#27272a] px-3 py-2 flex items-center gap-3">
                      <button
                        onClick={() => toggleQueueGroupExpanded(group.id)}
                        className="text-[#71717a] hover:text-[#fafafa] transition-colors cursor-pointer flex-shrink-0"
                        title="Show videos"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => toggleGroupSelection(group.id)}
                        className="text-[#71717a] hover:text-[#fafafa] transition-colors cursor-pointer flex-shrink-0"
                      >
                        {selectedGroupIds.has(group.id) ? (
                          <CheckSquare className="w-4 h-4 text-[#E11D48]" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                      <span className="font-semibold text-sm text-[#fafafa] truncate min-w-0">{group.name}</span>
                      <span className="text-[10px] text-[#71717a] truncate hidden md:inline flex-shrink-0 max-w-[140px]">
                        {group.campaign?.title || "No Campaign"}
                      </span>
                      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden min-w-[50px]">
                        <div
                          className={`h-full rounded-full transition-all ${failedOutputs.length > 0 && pendingOutputs.length === 0 ? "bg-red-500" : "bg-emerald-500"}`}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-[#a1a1aa] whitespace-nowrap flex-shrink-0">
                        {completedOutputs.length}/{totalOutputs} done{failedOutputs.length > 0 ? ` · ${failedOutputs.length} failed` : ""}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] uppercase font-extrabold flex-shrink-0 ${
                          group.status === "COMPLETED"
                            ? "bg-green-500/10 text-green-500"
                            : group.status === "FAILED"
                            ? "bg-red-500/10 text-red-500"
                            : "bg-amber-500/10 text-amber-500"
                        }`}
                      >
                        {group.status}
                      </span>
                    </div>
                  );
                }

                return (
                  <div key={group.id} className="bg-[#18181b] rounded-xl border border-[#27272a] p-6 space-y-4">
                    {/* Header */}
                    <div className="flex justify-between items-start gap-4">
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() => toggleQueueGroupExpanded(group.id)}
                          className="mt-1 text-[#71717a] hover:text-[#fafafa] transition-colors cursor-pointer"
                          title="Collapse"
                        >
                          <ChevronDown className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => toggleGroupSelection(group.id)}
                          className="mt-1 text-[#71717a] hover:text-[#fafafa] transition-colors cursor-pointer"
                        >
                          {selectedGroupIds.has(group.id) ? (
                            <CheckSquare className="w-5 h-5 text-[#E11D48]" />
                          ) : (
                            <Square className="w-5 h-5" />
                          )}
                        </button>
                        <div>
                          <h3 className="font-extrabold text-lg flex items-center gap-2">
                            {group.name}
                            <span className="flex items-center gap-1.5 text-xs text-[#a1a1aa] font-medium">
                              Campaign:
                              <select
                                value={group.campaignId || ""}
                                disabled={campaignUpdating.has(group.id)}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => handleChangeGroupCampaign(group, e.target.value)}
                                title="Reassign this group's campaign"
                                className="bg-[#09090b] border border-[#27272a] rounded-lg px-2 py-0.5 text-xs font-medium text-[#fafafa] focus:outline-none focus:border-[#E11D48] disabled:opacity-50 cursor-pointer max-w-[180px] truncate"
                              >
                                <option value="">No Campaign</option>
                                {campaigns.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.title}
                                  </option>
                                ))}
                              </select>
                            </span>
                          </h3>
                          <p className="text-xs text-[#71717a] mt-1">
                            Mode: {group.mappingMode === "each" ? "Multiply" : "Distribute"} | Preset: {group.styleId}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {driveConnected && (
                          <button
                            onClick={() => {
                              const isLegacy = group.campaignId === "";
                              setFolderPickerTarget({
                                type: isLegacy ? "batch" : "group",
                                id: group.id
                              });
                              setFolderSearch("");
                              setDriveFolders([]);
                            }}
                            className="px-2.5 py-1 bg-[#18181b] hover:bg-[#27272a] text-[#e4e4e7] hover:text-[#fafafa] font-semibold rounded text-[10px] transition-all flex items-center gap-1.5 border border-[#27272a] shadow-sm"
                          >
                            <FolderOpen className="w-3.5 h-3.5 text-rose-500" />
                            {(() => {
                              const s: any = typeof group.settings === "string" 
                                ? JSON.parse(group.settings) 
                                : (group.settings || {});
                              return s.driveFolderName || "Group Default Drive Folder";
                            })()}
                          </button>
                        )}
                        {completedOutputs.length > 0 && (
                          <button
                            onClick={() => handleDownloadArchive(group.id)}
                            disabled={!!downloads[group.id]}
                            className="px-2.5 py-1 bg-[#E11D48] hover:bg-rose-700 text-white font-semibold rounded text-[10px] transition-all flex items-center gap-1 shadow-sm disabled:opacity-50"
                            title="Download all videos as a Tar Archive"
                          >
                            {downloads[group.id] ? (
                              <>
                                <Loader2 className="w-3 h-3 animate-spin" />
                                {downloads[group.id].progress}%
                              </>
                            ) : (
                              <>
                                <Download className="w-3 h-3" />
                                Download All ({completedOutputs.length})
                              </>
                            )}
                          </button>
                        )}
                        {driveConnected && completedOutputs.length > 0 && (
                          <button
                            onClick={() => handleExportGroupToDrive(group)}
                            disabled={exportingGroups.has(group.id)}
                            className="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded text-[10px] transition-all flex items-center gap-1 shadow-sm disabled:opacity-50"
                            title="Export all videos with assigned Drive folders to Google Drive"
                          >
                            {exportingGroups.has(group.id) ? (
                              <>
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Exporting...
                              </>
                            ) : (
                              <>
                                <FolderOpen className="w-3 h-3 text-cyan-200" />
                                Export All Drive
                              </>
                            )}
                          </button>
                        )}
                        <span
                          className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                            group.status === "COMPLETED"
                              ? "bg-green-500/10 text-green-500"
                              : group.status === "FAILED"
                              ? "bg-red-500/10 text-red-500"
                              : "bg-amber-500/10 text-amber-500 animate-pulse"
                          }`}
                        >
                          {group.status}
                        </span>
                        <button
                          onClick={() => handleDeleteGroup(group.id)}
                          className="p-1 bg-[#18181b] hover:bg-red-500/10 text-[#71717a] hover:text-red-500 border border-[#27272a] rounded-lg transition-all flex items-center justify-center"
                          title="Permanently delete this group (source videos, hooks and rendered videos)"
                        >
                          <Trash className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs font-semibold">
                        <span className="text-[#a1a1aa]">
                          {completedOutputs.length} / {totalOutputs} Completed
                          {failedOutputs.length > 0 && ` (${failedOutputs.length} Failed)`}
                        </span>
                        <span>{percent}%</span>
                      </div>
                      <div className="w-full bg-[#09090b] rounded-full h-2 overflow-hidden border border-[#27272a]">
                        <div
                          className="bg-[#E11D48] h-full transition-all duration-500"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>

                    {/* Group specific transcribing indicators */}
                    {group.transcriptStatus === "TRANSCRIBING" && (
                      <div className="text-xs text-amber-500 flex items-center gap-1.5 animate-pulse bg-amber-500/5 p-2 rounded">
                        <Loader2 className="w-4.5 h-4.5 animate-spin" /> Whispering alignment transcription in progress...
                      </div>
                    )}

                    {/* Outputs grid */}
                    {group.outputs.length > 0 && (
                      <div className="border-t border-[#27272a] pt-4 mt-2">
                        <p className="text-xs font-bold text-[#a1a1aa] mb-3 uppercase tracking-wider">Output Compositions:</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {group.outputs.map((out) => (
                            <div
                              key={out.id}
                              className="bg-[#09090b] p-3 rounded-lg border border-[#27272a] flex flex-col justify-between gap-3 text-xs"
                            >
                              <div className="space-y-1">
                                <p className="font-semibold truncate text-[#fafafa]">
                                  Hook: "{out.hook?.text || "..."}"
                                </p>
                                <p className="text-[10px] text-[#71717a] truncate">
                                  Source: {out.variation?.videoRef || "..."}
                                </p>
                              </div>

                              <div className="flex justify-between items-center">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={`px-2 py-0.5 rounded text-[10px] uppercase font-extrabold ${
                                      out.status === "COMPLETED"
                                        ? "bg-green-500/10 text-green-500"
                                        : out.status === "FAILED"
                                        ? "bg-red-500/10 text-red-500"
                                        : "bg-amber-500/10 text-amber-500 animate-pulse"
                                    }`}
                                  >
                                    {out.status}
                                  </span>
                                  {out.exportedAt && (
                                    <span className="px-2 py-0.5 rounded text-[10px] bg-blue-500/10 text-blue-400 font-bold border border-blue-500/20" title={`Exported at ${new Date(out.exportedAt).toLocaleString()}`}>
                                      Exported ✓
                                    </span>
                                  )}
                                  {(out.exportDestinationFolderName || out.driveFolderName) && (
                                    <span
                                      className="px-2 py-0.5 rounded text-[10px] bg-zinc-500/10 text-zinc-300 font-semibold border border-zinc-500/20 truncate max-w-[140px]"
                                      title={`Google Drive folder: ${out.exportDestinationFolderName || out.driveFolderName}`}
                                    >
                                      {out.exportDestinationFolderName || out.driveFolderName}
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-1.5">
                                  {out.status === "FAILED" && (
                                    <button
                                      onClick={() => handleRetryOutput(group, out.id)}
                                      className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-[#fafafa] font-semibold rounded text-[10px] transition-all cursor-pointer"
                                    >
                                      Retry
                                    </button>
                                  )}
                                  {out.status === "COMPLETED" && (
                                    <button
                                      onClick={() => handlePreviewOutput(out.id)}
                                      disabled={previewLoading}
                                      className="p-1 bg-zinc-800 hover:bg-zinc-700 text-white rounded transition-all flex items-center justify-center cursor-pointer disabled:opacity-50"
                                      title="Preview Video"
                                    >
                                      {previewLoading ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      ) : (
                                        <Eye className="w-3.5 h-3.5" />
                                      )}
                                    </button>
                                  )}
                                  {driveConnected && out.status === "COMPLETED" && out.outputRef && (
                                    <button
                                      onClick={() => handleSyncToDrive(group, out.id)}
                                      disabled={syncingOutputs.has(out.id)}
                                      className="p-1 bg-zinc-800 hover:bg-zinc-700 text-[#fafafa] rounded transition-all flex items-center justify-center cursor-pointer disabled:opacity-50"
                                      title="Sync to Drive"
                                    >
                                      {syncingOutputs.has(out.id) ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      ) : (
                                        <FolderOpen className="w-3.5 h-3.5 text-rose-500" />
                                      )}
                                    </button>
                                  )}
                                  {out.status === "COMPLETED" && out.outputRef && (
                                    <a
                                      href={getServeUrl(out.outputRef)}
                                      download
                                      className="p-1 bg-[#E11D48] hover:bg-rose-700 text-white rounded transition-all flex items-center justify-center cursor-pointer"
                                      title="Download Video"
                                    >
                                      <Download className="w-3.5 h-3.5" />
                                    </a>
                                  )}
                                  <button
                                    onClick={() => handleDeleteOutput(out.id, out.status)}
                                    disabled={deletingOutputs.has(out.id)}
                                    className="p-1 bg-zinc-900/50 hover:bg-red-500/10 text-[#71717a] hover:text-red-500 border border-[#27272a] rounded transition-all flex items-center justify-center cursor-pointer disabled:opacity-50"
                                    title="Delete/Cancel Video"
                                  >
                                    {deletingOutputs.has(out.id) ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <Trash2 className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                </div>
                              </div>

                              {driveConnected && (() => {
                                const settingsObj: any = typeof group.settings === "string" 
                                  ? JSON.parse(group.settings) 
                                  : (group.settings || {});
                                const effectiveFolderId = out.driveFolderId || settingsObj.driveFolderId;
                                const effectiveFolderName = out.driveFolderId ? out.driveFolderName : settingsObj.driveFolderName;
                                const effectiveEmail = out.driveFolderId ? out.googleEmail : settingsObj.googleEmail;
                                return (
                                  <div className="mt-1 flex flex-col gap-1 border-t border-[#27272a]/40 pt-2 text-[10px] text-[#71717a]">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="truncate flex items-center gap-1.5 font-medium max-w-[70%]">
                                        <FolderOpen className="w-3.5 h-3.5 text-rose-500/80 flex-shrink-0" />
                                        {out.driveFolderId ? (
                                          <span className="truncate text-rose-400 font-semibold" title={`Override Folder: ${effectiveFolderName}`}>
                                            Override: {effectiveFolderName}
                                          </span>
                                        ) : settingsObj.driveFolderId ? (
                                          <span className="truncate text-rose-500/60 font-semibold" title={`Group Default: ${effectiveFolderName}`}>
                                            Default: {effectiveFolderName}
                                          </span>
                                        ) : (
                                          <span>No Folder Linked</span>
                                        )}
                                      </span>
                                      <button
                                        onClick={() => {
                                          const isLegacy = group.campaignId === "";
                                          setFolderPickerTarget({
                                            type: isLegacy ? "item" : "output",
                                            id: out.id
                                          });
                                          setFolderSearch("");
                                          setDriveFolders([]);
                                        }}
                                        className="px-2 py-0.5 bg-[#18181b] hover:bg-[#27272a] text-[#e4e4e7] hover:text-[#fafafa] rounded font-semibold transition-all border border-[#27272a]"
                                      >
                                        {out.driveFolderId ? "Change" : "Select Folder"}
                                      </button>
                                    </div>
                                    {effectiveFolderId && (
                                      <div className="text-[9px] text-[#a1a1aa] flex items-center gap-1.5 pl-5">
                                        <span className="w-1 h-1 rounded-full bg-rose-500"></span>
                                        <span>Account: {effectiveEmail || "Global / Shared"}</span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}

                              {out.errorMessage && (
                                <p className="text-[10px] text-red-500 bg-red-500/5 p-1.5 rounded break-words max-h-16 overflow-y-auto">
                                  {out.errorMessage}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Google Drive Folder Picker Modal */}
      {folderPickerTarget && (() => {
        const isBulk = folderPickerTarget.type === "group" || folderPickerTarget.type === "batch";
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={() => setFolderPickerTarget(null)}
          >
            <div
              className="bg-[#18181b] rounded-2xl border border-[#27272a] p-5 max-w-md w-full mx-4 shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <h3 className="text-[#fafafa] text-sm font-semibold flex items-center gap-2">
                    <FolderOpen className="w-4 h-4 text-[#E11D48]" /> 
                    {isBulk ? "Select Multiple Folders" : "Select Google Drive Folder"}
                    <span className="text-[#71717a] text-[10px] font-normal">
                      ({isBulk ? "group round-robin" : "per video variation"})
                    </span>
                  </h3>
                  {currentPickerEmail && (
                    <p className="text-[10px] text-[#a1a1aa] pl-6 font-medium">
                      Drive Account: <span className="text-[#E11D48]">{currentPickerEmail}</span>
                    </p>
                  )}
                </div>
                <button
                  onClick={() => setFolderPickerTarget(null)}
                  className="text-[#71717a] hover:text-[#fafafa] transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {isBulk && (
                <p className="text-[#71717a] text-[11px] leading-relaxed">
                  Select multiple folders below. Rendered videos will be distributed cyclically (round-robin) across your selections.
                </p>
              )}

              {/* Search Box */}
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Search folders..."
                  value={folderSearch}
                  onChange={(e) => setFolderSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && searchDriveFolders(folderSearch)}
                  className="flex-1 px-3 py-2 rounded-lg bg-[#09090b] border border-[#27272a] text-[#fafafa] text-sm focus:outline-none focus:border-[#E11D48]"
                />
                <button
                  onClick={() => searchDriveFolders(folderSearch)}
                  disabled={searchingFolders}
                  className="px-3 py-2 rounded-lg bg-[#E11D48]/10 text-[#E11D48] border border-[#E11D48]/20 text-xs font-semibold hover:bg-[#E11D48]/20 transition-all disabled:opacity-50 flex items-center justify-center"
                >
                  {searchingFolders ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Search className="w-4 h-4" />
                  )}
                </button>
              </div>

              {/* Selected folder chips */}
              {isBulk && selectedPickerFolders.length > 0 && (
                <div className="flex flex-wrap gap-1.5 p-2 bg-[#09090b] rounded-lg border border-[#27272a] max-h-24 overflow-y-auto">
                  {selectedPickerFolders.map((f, idx) => (
                    <span
                      key={f.id}
                      className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#E11D48]/10 text-[#E11D48] text-[10px] font-semibold border border-[#E11D48]/20"
                    >
                      <span className="opacity-50 font-mono">{idx + 1}.</span>
                      <span className="truncate max-w-[120px]">{f.name}</span>
                      <button
                        onClick={() => handleToggleFolder(f)}
                        className="text-[#E11D48]/60 hover:text-red-500 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Folder list */}
              <div className="max-h-56 overflow-y-auto space-y-1 custom-scrollbar pr-1">
                {driveFolders.length === 0 ? (
                  <p className="text-xs text-[#71717a] text-center py-6">
                    {searchingFolders ? "Searching..." : "Type in input and press search"}
                  </p>
                ) : (
                  driveFolders.map((folder) => {
                    const isSelected = selectedPickerFolders.some((f) => f.id === folder.id);
                    return (
                      <button
                        key={folder.id}
                        onClick={() => {
                          if (isBulk) {
                            handleToggleFolder(folder);
                          } else {
                            handleAssignFolder(folderPickerTarget.id, folder.id, folder.name);
                          }
                        }}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all border group ${
                          isSelected 
                            ? "bg-[#E11D48]/5 border-[#E11D48]/20" 
                            : "bg-transparent border-transparent hover:bg-[#27272a]"
                        }`}
                      >
                        {isBulk && (
                          <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-all ${
                            isSelected 
                              ? "bg-[#E11D48] border-[#E11D48]" 
                              : "border-[#27272a] group-hover:border-[#71717a]"
                          }`}>
                            {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
                          </div>
                        )}
                        <FolderOpen className={`w-4 h-4 flex-shrink-0 transition-colors ${
                          isSelected ? "text-[#E11D48]" : "text-rose-500/80 group-hover:text-rose-500"
                        }`} />
                        <span className={`text-sm truncate ${
                          isSelected ? "text-[#fafafa] font-semibold" : "text-[#e4e4e7] group-hover:text-[#fafafa]"
                        }`}>
                          {folder.name}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>

              {/* Action Button for bulk mode */}
              {isBulk && (
                <button
                  onClick={() => handleAssignFolder(folderPickerTarget.id)}
                  disabled={selectedPickerFolders.length === 0}
                  className="w-full py-2.5 rounded-xl bg-[#E11D48] hover:bg-rose-700 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-semibold transition-all shadow-lg flex items-center justify-center gap-1.5"
                >
                  <Check className="w-4 h-4" /> Distribute {selectedPickerFolders.length} Folder{selectedPickerFolders.length !== 1 ? "s" : ""} (Round-Robin)
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* Video Preview Modal */}
      {/* Save Template Modal */}
      {showTemplateSaveModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#09090b] border border-[#27272a] rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-[#27272a] pb-3">
              <h3 className="text-[#fafafa] text-base font-semibold">Save Style Preset</h3>
              <button
                type="button"
                onClick={() => setShowTemplateSaveModal(false)}
                className="text-[#71717a] hover:text-[#fafafa] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2">
              <label className="block text-[11px] uppercase font-bold text-[#a1a1aa]">Preset Name</label>
              <input
                type="text"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                placeholder="e.g. Red Lower Third Bold"
                className="w-full bg-[#18181b] border border-[#27272a] rounded-lg px-4 py-2.5 text-sm focus:outline-none text-[#fafafa]"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowTemplateSaveModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#18181b] text-[#fafafa] hover:bg-[#27272a] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveNewPreset}
                disabled={isSavingTemplate}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
              >
                {isSavingTemplate && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Save Preset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Warn In Use Modal */}
      {showWarnInUseDialog && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#09090b] border border-[#f59e0b]/30 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-[#f59e0b]/10 text-[#f59e0b] rounded-lg">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="space-y-1 flex-1">
                <h3 className="text-[#fafafa] text-base font-semibold">Active Template in Use</h3>
                <p className="text-xs text-[#71717a] leading-relaxed">
                  This style template is currently in use by one or more active render groups.
                  Updating it now will change the styling of future renders for those groups.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowWarnInUseDialog(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#18181b] text-[#fafafa] hover:bg-[#27272a] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUpdatePresetConfirm}
                disabled={isSavingTemplate}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#f59e0b] hover:bg-[#f59e0b]/90 disabled:opacity-50 transition-colors flex items-center gap-1.5"
              >
                {isSavingTemplate && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Update Preset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Smart Download Action Bar */}
      {selectedGroupIds.size > 0 && (() => {
        let total = 0;
        let renderReadyCount = 0;
        groups.forEach((g) => {
          if (selectedGroupIds.has(g.id)) {
            if (isGroupRenderReady(g)) renderReadyCount++;
            g.outputs.forEach((out) => {
              if (out.status === "COMPLETED") total++;
            });
          }
        });
        return (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-[#18181b]/95 border border-[#E11D48]/30 rounded-full px-6 py-3 shadow-2xl backdrop-blur-md flex items-center gap-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <span className="text-xs text-[#e4e4e7] font-semibold">
              {selectedGroupIds.size} group{selectedGroupIds.size > 1 ? "s" : ""} selected ({total} ready)
            </span>
            <div className="w-[1px] h-4 bg-[#27272a]"></div>
            <button
              onClick={handleBulkRenderSelected}
              disabled={bulkRendering || renderReadyCount === 0}
              title={renderReadyCount === 0 ? "Selected groups need at least 1 variation and 1 hook, and must not be queued already" : "Queue all selected render-ready groups for rendering"}
              className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-full flex items-center gap-1.5 transition-all shadow-md cursor-pointer"
            >
              {bulkRendering ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              Render selected ({renderReadyCount})
            </button>
            <button
              onClick={() => {
                if (total === 0) {
                  toast.error("No completed videos in the selected groups!");
                  return;
                }
                setShowSmartDownload(true);
              }}
              className="px-4 py-1.5 bg-[#E11D48] hover:bg-rose-700 text-white text-xs font-bold rounded-full flex items-center gap-1.5 transition-all shadow-md cursor-pointer"
            >
              <FolderOpen className="w-3.5 h-3.5" /> Smart Download
            </button>
            <button
              onClick={() => {
                if (total === 0) {
                  toast.error("No completed videos in the selected groups!");
                  return;
                }
                setSmartExportSearch("");
                setSearchedExportFolders([]);
                setSelectedExportFolders([]);
                setIncludeExportedSmartExport(false);
                setExportPreview(null);
                setExportDays(1);
                setExportRunError(null);
                setShowSmartExport(true);
              }}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-full flex items-center gap-1.5 transition-all shadow-md cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" /> Smart Export
            </button>
            <button
              onClick={handleClearSelectedOutputs}
              disabled={bulkDeleting}
              title="Delete only the rendered videos of the selected groups — the groups themselves stay in the builder"
              className="px-4 py-1.5 bg-[#27272a] hover:bg-[#3f3f46] disabled:opacity-40 disabled:cursor-not-allowed text-[#e4e4e7] text-xs font-bold rounded-full flex items-center gap-1.5 transition-all shadow-md cursor-pointer"
            >
              {bulkDeleting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              Clear outputs ({selectedGroupIds.size})
            </button>
            <button
              onClick={handleDeleteSelectedGroups}
              disabled={bulkDeleting}
              title="Permanently delete the selected groups including source videos, hooks and all rendered videos"
              className="px-4 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-full flex items-center gap-1.5 transition-all shadow-md cursor-pointer"
            >
              <Trash className="w-3.5 h-3.5" /> Delete groups ({selectedGroupIds.size})
            </button>
            <button
              onClick={() => setSelectedGroupIds(new Set())}
              className="text-[10px] text-[#71717a] hover:text-[#fafafa] transition-colors font-medium underline cursor-pointer"
            >
              Clear Selection
            </button>
          </div>
        );
      })()}

      {/* Smart Download Modal */}
      {showSmartDownload && (() => {
        let total = 0;
        let unexported = 0;
        groups.forEach((g) => {
          if (selectedGroupIds.has(g.id)) {
            g.outputs.forEach((out) => {
              if (out.status === "COMPLETED") {
                total++;
                if (!out.exportedAt) unexported++;
              }
            });
          }
        });
        const availableCount = includeExported ? total : unexported;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div
              className="bg-[#18181b] rounded-2xl border border-[#27272a] p-6 max-w-sm w-full mx-4 shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-[#fafafa] text-sm font-semibold flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-[#E11D48]" /> Smart Folderized Download
                </h3>
                <button
                  onClick={() => {
                    setShowSmartDownload(false);
                    setIncludeExported(false);
                  }}
                  className="text-[#71717a] hover:text-[#fafafa] transition-all cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-[#71717a] text-xs leading-relaxed">
                Randomly shuffles and distributes completed videos from the selected {selectedGroupIds.size} groups into account folders inside a single archive.
              </p>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-[#a1a1aa] font-semibold">Accounts (folders)</label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={smartAccounts}
                    onChange={(e) => setSmartAccounts(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-16 bg-[#09090b] border border-[#27272a] rounded-lg px-2 py-1.5 text-white text-xs text-center focus:outline-none focus:border-[#E11D48]"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-xs text-[#a1a1aa] font-semibold">Videos per account</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={smartVidsPerAccount}
                    onChange={(e) => setSmartVidsPerAccount(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-16 bg-[#09090b] border border-[#27272a] rounded-lg px-2 py-1.5 text-white text-xs text-center focus:outline-none focus:border-[#E11D48]"
                  />
                </div>
              </div>

              {/* Exported count / check guard */}
              {total - unexported > 0 && (
                <div className="bg-[#27272a]/20 border border-[#27272a] rounded-xl p-3 space-y-2">
                  <p className="text-[10px] text-[#a1a1aa] leading-normal">
                    <span className="font-bold text-[#fafafa]">{total - unexported}</span> of the {total} completed videos have already been exported.
                  </p>
                  <label className="flex items-center gap-2 text-[10px] text-[#e4e4e7] font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeExported}
                      onChange={(e) => setIncludeExported(e.target.checked)}
                      className="rounded border-[#27272a] bg-[#09090b] text-[#E11D48] focus:ring-[#E11D48]/30 w-3 h-3 cursor-pointer"
                    />
                    <span>Include previously exported videos</span>
                  </label>
                </div>
              )}

              <div className="bg-[#E11D48]/5 border border-[#E11D48]/10 rounded-lg px-3 py-2 text-[10px] text-rose-300">
                Total needed: <span className="font-bold text-white">{smartAccounts * smartVidsPerAccount}</span> • Available: <span className="font-bold text-white">{availableCount}</span> completed videos
              </div>

              <button
                onClick={handleSmartDownload}
                disabled={smartDownloading || (smartAccounts * smartVidsPerAccount > availableCount)}
                className="w-full py-2.5 rounded-xl bg-[#E11D48] hover:bg-rose-700 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-semibold transition-all shadow-lg flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {smartDownloading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {smartDownloadProgress || "Processing..."}
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Generate & Download Archive
                  </>
                )}
              </button>
            </div>
          </div>
        );
      })()}

      {/* Smart Export Modal */}
      {showSmartExport && (() => {
        let total = 0;
        let unexported = 0;
        groups.forEach((g) => {
          if (selectedGroupIds.has(g.id)) {
            g.outputs.forEach((out) => {
              if (out.status === "COMPLETED") {
                total++;
                if (out.exportStatus !== "exported" && !out.exportedAt) unexported++;
              }
            });
          }
        });
        const totalCompleted = includeExportedSmartExport ? total : unexported;

        const assignedCount = selectedExportFolders.reduce((sum, f) => sum + f.count, 0);
        const overAllocated = assignedCount > totalCompleted;
        const cannotExport = overAllocated || (exportPreview && exportPreview.unfulfillable.length > 0) || selectedExportFolders.length === 0;

        const sortedSelected = [...selectedExportFolders].sort((a, b) => naturalCompare(a.name || "", b.name || ""));
        const sortedResults = [...searchedExportFolders].sort((a, b) => naturalCompare(a.name || "", b.name || ""));

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm">
            <div
              className="bg-[#18181b] rounded-2xl border border-[#27272a] p-6 max-w-4xl w-full mx-4 shadow-2xl space-y-6 flex flex-col max-h-[90vh] overflow-hidden text-white"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-[#27272a] pb-4 flex-shrink-0">
                <h3 className="text-[#fafafa] text-base font-bold flex items-center gap-2">
                  <Upload className="w-5 h-5 text-blue-500" /> Smart Google Drive Export
                </h3>
                <button
                  onClick={() => {
                    setShowSmartExport(false);
                    setSelectedExportFolders([]);
                  }}
                  className="text-[#71717a] hover:text-[#fafafa] transition-all cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Scrollable Content Area */}
              <div className="flex-1 overflow-y-auto space-y-5 pr-1 custom-scrollbar text-xs">
                <p className="text-[#71717a] leading-relaxed">
                  Distribute and mix completed videos from the selected <span className="text-[#fafafa] font-bold">{selectedGroupIds.size} groups</span> directly into Google Drive folders. No two videos in the same folder will come from the same group to prevent duplication issues.
                </p>

                {/* Posting schedule: days multiplier */}
                <div className="bg-[#27272a]/20 border border-[#27272a] rounded-xl p-3.5 flex items-center justify-between">
                  <span className="text-[#a1a1aa] leading-normal">
                    Folder counts are set to <span className="font-bold text-[#fafafa]">default posts/day × days</span>.
                  </span>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[#e4e4e7] font-medium">Days</span>
                    <div className="flex items-center bg-[#09090b] border border-[#27272a] rounded-lg overflow-hidden">
                      <button
                        type="button"
                        onClick={() => handleExportDaysChange(exportDays - 1)}
                        disabled={exportDays <= 1}
                        className="p-1.5 hover:bg-[#27272a] text-[#a1a1aa] hover:text-white transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={90}
                        value={exportDays}
                        onChange={(e) => handleExportDaysChange(parseInt(e.target.value) || 1)}
                        className="w-12 bg-transparent text-center text-xs font-bold text-white font-mono focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleExportDaysChange(exportDays + 1)}
                        className="p-1.5 hover:bg-[#27272a] text-[#a1a1aa] hover:text-white transition-colors cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                {total - unexported > 0 && (
                  <div className="bg-[#27272a]/20 border border-[#27272a] rounded-xl p-3.5 flex items-center justify-between">
                    <span className="text-[#a1a1aa] leading-normal">
                      <span className="font-bold text-[#fafafa]">{total - unexported}</span> of the {total} completed videos are already exported.
                    </span>
                    <label className="flex items-center gap-2 text-[#e4e4e7] font-medium cursor-pointer flex-shrink-0">
                      <input
                        type="checkbox"
                        checked={includeExportedSmartExport}
                        onChange={(e) => {
                          setIncludeExportedSmartExport(e.target.checked);
                          setExportPreview(null);
                        }}
                        className="rounded border-[#27272a] bg-[#09090b] text-blue-600 focus:ring-blue-600/30 w-3.5 h-3.5 cursor-pointer"
                      />
                      <span>Include previously exported</span>
                    </label>
                  </div>
                )}

                {/* Selected accounts chips tray */}
                {sortedSelected.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-bold text-[#fafafa] uppercase tracking-wider text-[10px] text-[#71717a]">Selected Accounts Tray</h4>
                    <div className="flex flex-wrap gap-2 p-3 bg-[#09090b] border border-[#27272a] rounded-xl">
                      {sortedSelected.map((folder) => {
                        const colKey = folder.mappedAccount?.color || "zinc";
                        const baseColor = COLOR_MAP[colKey] || (colKey.startsWith("#") ? colKey : null) || COLOR_MAP.zinc;
                        return (
                          <div
                            key={folder.id}
                            className="flex items-center gap-1.5 px-2.5 py-1 bg-white/5 rounded-lg border border-white/10 text-white text-[11px] font-medium transition-all"
                            style={{ borderLeft: `3px solid ${baseColor}` }}
                          >
                            <span className="truncate max-w-[150px]">{folder.name}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedExportFolders((prev) => prev.filter((f) => f.id !== folder.id));
                              }}
                              className="text-[#71717a] hover:text-white transition-colors cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Two Column Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                  
                  {/* Left Column: Search & Results */}
                  <div className="space-y-3">
                    <h4 className="font-bold text-[#fafafa] uppercase tracking-wider text-[10px] text-[#71717a]">Search Drive Folders</h4>
                    
                    <div className="relative">
                      <Search className="absolute left-3 top-2.5 w-4 h-4 text-[#71717a]" />
                      <input
                        type="text"
                        placeholder="Type folder name to search..."
                        value={smartExportSearch}
                        onChange={(e) => handleSearchExportFolders(e.target.value)}
                        className="w-full bg-[#09090b] border border-[#27272a] rounded-xl pl-9 pr-4 py-2 text-white placeholder-[#71717a] text-xs focus:outline-none focus:border-blue-500"
                      />
                      {searchingExportFolders && (
                        <Loader2 className="absolute right-3 top-2.5 w-4 h-4 animate-spin text-blue-500" />
                      )}
                    </div>

                    {sortedResults.length > 0 && (
                      <div className="bg-[#09090b] border border-[#27272a] rounded-xl max-h-[300px] overflow-y-auto divide-y divide-[#27272a] pr-1 custom-scrollbar">
                        {sortedResults.map((folder) => {
                          const colKey = folder.mappedAccount?.color || "zinc";
                          const baseColor = COLOR_MAP[colKey] || (colKey.startsWith("#") ? colKey : null) || COLOR_MAP.zinc;
                          const isSelected = selectedExportFolders.some((f) => f.id === folder.id);

                          return (
                            <div
                              key={folder.id}
                              onClick={() => {
                                if (isSelected) {
                                  setSelectedExportFolders((prev) => prev.filter((f) => f.id !== folder.id));
                                } else {
                                  setSelectedExportFolders((prev) => [
                                    ...prev,
                                    {
                                      ...folder,
                                      count: Math.max(1, Math.min((folder.defaultPostCount ?? 1) * exportDays, selectedGroupIds.size)),
                                    },
                                  ]);
                                }
                              }}
                              className={`p-2.5 hover:bg-[#18181b] cursor-pointer flex justify-between items-center transition-colors ${
                                isSelected ? "bg-blue-500/5" : ""
                              }`}
                              style={{ borderLeft: `3px solid ${baseColor}` }}
                            >
                              <div className="flex items-center gap-2.5 truncate mr-3">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  readOnly
                                  className="rounded border-[#27272a] bg-[#09090b] text-blue-600 focus:ring-blue-600/30 w-3.5 h-3.5 cursor-pointer"
                                />
                                <div className="truncate">
                                  <p className="font-medium text-gray-200 truncate">{folder.name}</p>
                                  <div className="flex items-center gap-1.5 mt-0.5 truncate">
                                    <span
                                      className="w-2 h-2 rounded-full flex-shrink-0"
                                      style={{ backgroundColor: baseColor }}
                                    />
                                    <span className="text-[10px] text-[#71717a] font-medium flex-shrink-0">
                                      {colKey} · {folder.defaultPostCount ?? 1}/day
                                    </span>
                                    {folder.mappedAccount && (
                                      <span className="text-[10px] text-blue-400 font-medium truncate">
                                        · linked to @{folder.mappedAccount.tiktokUsername}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <Plus className={`w-4 h-4 text-[#71717a] hover:text-white flex-shrink-0 transition-transform ${isSelected ? "rotate-45 text-red-400 hover:text-red-300" : ""}`} />
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {smartExportSearch && !searchingExportFolders && sortedResults.length === 0 && (
                      <p className="text-[10px] text-[#71717a] italic">No folders found matching search query.</p>
                    )}
                  </div>

                  {/* Right Column: Counts, Mix Rules & Warnings */}
                  <div className="space-y-4">
                    <h4 className="font-bold text-[#fafafa] uppercase tracking-wider text-[10px] text-[#71717a]">Export Volumes Configuration</h4>
                    
                    {sortedSelected.length === 0 ? (
                      <div className="bg-[#09090b] border border-[#27272a] border-dashed rounded-xl p-8 text-center text-[#71717a]">
                        No folders selected yet. Search and select folders on the left.
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                        {sortedSelected.map((folder) => {
                          const colKey = folder.mappedAccount?.color || "zinc";
                          const baseColor = COLOR_MAP[colKey] || (colKey.startsWith("#") ? colKey : null) || COLOR_MAP.zinc;
                          
                          const origIndex = selectedExportFolders.findIndex((f) => f.id === folder.id);

                          return (
                            <div
                              key={folder.id}
                              className="flex items-center justify-between p-3 bg-blue-500/5 hover:bg-blue-500/10 border border-blue-500/20 rounded-xl transition-all"
                              style={{ borderLeft: `3px solid ${baseColor}` }}
                            >
                              <div className="truncate flex-1 mr-3">
                                <p className="font-semibold text-white truncate">{folder.name}</p>
                                {folder.mappedAccount && (
                                  <p className="text-[10px] text-blue-400 mt-0.5 font-medium">
                                    Maps to Account: @{folder.mappedAccount.tiktokUsername}
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-3 flex-shrink-0">
                                <div className="flex items-center bg-[#09090b] border border-[#27272a] rounded-lg overflow-hidden">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (origIndex !== -1) {
                                        setSelectedExportFolders((prev) => {
                                          const next = [...prev];
                                          next[origIndex] = { ...next[origIndex], count: Math.max(0, next[origIndex].count - 1) };
                                          return next;
                                        });
                                      }
                                    }}
                                    className="p-1.5 hover:bg-[#27272a] text-[#a1a1aa] hover:text-white transition-colors cursor-pointer"
                                  >
                                    <Minus className="w-3.5 h-3.5" />
                                  </button>
                                  <span className="w-8 text-center text-xs font-bold text-white font-mono">
                                    {folder.count}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (folder.count >= selectedGroupIds.size) {
                                        toast.error(`Per-folder count cannot exceed selected groups (${selectedGroupIds.size})!`);
                                        return;
                                      }
                                      if (origIndex !== -1) {
                                        setSelectedExportFolders((prev) => {
                                          const next = [...prev];
                                          next[origIndex] = { ...next[origIndex], count: next[origIndex].count + 1 };
                                          return next;
                                        });
                                      }
                                    }}
                                    className="p-1.5 hover:bg-[#27272a] text-[#a1a1aa] hover:text-white transition-colors cursor-pointer"
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedExportFolders((prev) => prev.filter((f) => f.id !== folder.id));
                                  }}
                                  className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg transition-colors cursor-pointer"
                                  title="Remove folder"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {exportPreview && exportPreview.unfulfillable.length > 0 && (
                      <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3.5 space-y-2 text-red-400">
                        <p className="font-bold text-[10px] uppercase tracking-wider flex items-center gap-1.5">
                          <AlertCircle className="w-4 h-4" /> Feasibility Warning: Unfulfillable Folders
                        </p>
                        <ul className="list-disc pl-4 space-y-1 text-[10px] leading-normal">
                          {exportPreview.unfulfillable.map((unf, idx) => (
                            <li key={idx}>
                              <span className="font-bold text-white">{unf.driveFolderName}</span>: {unf.reason}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                </div>
              </div>

              {/* Footer Summary & Action Buttons */}
              <div className="flex-shrink-0 border-t border-[#27272a] pt-4 space-y-4">
                <div className="flex justify-between items-center bg-[#09090b] border border-[#27272a] rounded-xl px-4 py-3 text-xs">
                  <div className="text-center flex-1">
                    <p className="text-[#71717a] text-[10px] uppercase font-bold">Total Available</p>
                    <p className="font-bold text-[#fafafa] text-sm mt-0.5">{totalCompleted}</p>
                  </div>
                  <div className="w-[1px] h-6 bg-[#27272a]"></div>
                  <div className="text-center flex-1">
                    <p className="text-[#71717a] text-[10px] uppercase font-bold">Assigned</p>
                    <p className="font-bold text-blue-400 text-sm mt-0.5">{assignedCount}</p>
                  </div>
                  <div className="w-[1px] h-6 bg-[#27272a]"></div>
                  <div className="text-center flex-1">
                    <p className="text-[#71717a] text-[10px] uppercase font-bold">Left to Assign</p>
                    <p className={`font-extrabold text-sm mt-0.5 ${overAllocated ? "text-red-500" : "text-green-400"}`}>
                      {overAllocated ? 0 : totalCompleted - assignedCount}
                    </p>
                  </div>
                </div>

                {overAllocated && (
                  <div className="text-center text-[10px] text-red-500 font-bold bg-red-500/10 py-1.5 rounded-lg border border-red-500/20">
                    ⚠️ Over-allocation warning: You have assigned more videos than available. Please reduce folder counts.
                  </div>
                )}

                {exportRunError && (
                  <div className="text-center text-[10px] text-red-500 font-bold bg-red-500/10 py-1.5 rounded-lg border border-red-500/20 flex items-center justify-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" /> {exportRunError}
                  </div>
                )}

                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => {
                      setShowSmartExport(false);
                      setSelectedExportFolders([]);
                    }}
                    className="px-4 py-2 bg-[#27272a] hover:bg-[#3f3f46] text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleStartSmartExport}
                    disabled={cannotExport || loadingPreview}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
                  >
                    {loadingPreview ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Validating...
                      </>
                    ) : (
                      <>
                        <Upload className="w-3.5 h-3.5" />
                        Queue Smart Export
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Smart Export Progress & Retry Modal */}
      {exportingJobId && exportJobDetails && (() => {
        const job = exportJobDetails;
        const totalAssigned = job.assignments?.length || 0;
        const done = job.assignments?.filter((a: any) => a.status === "done").length || 0;
        const failed = job.assignments?.filter((a: any) => a.status === "failed").length || 0;
        const pending = job.assignments?.filter((a: any) => a.status === "pending" || a.status === "uploading").length || 0;
        const percent = totalAssigned > 0 ? Math.round(((done + failed) / totalAssigned) * 100) : 0;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm">
            <div
              className="bg-[#18181b] rounded-2xl border border-[#27272a] p-6 max-w-xl w-full mx-4 shadow-2xl space-y-5 flex flex-col max-h-[85vh] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-[#27272a] pb-4 flex-shrink-0">
                <div>
                  <h3 className="text-[#fafafa] text-base font-bold flex items-center gap-2">
                    <Loader2 className={`w-5 h-5 text-blue-500 ${job.status === "uploading" ? "animate-spin" : ""}`} /> 
                    Smart Export Job Progress
                  </h3>
                  <p className="text-[10px] text-[#71717a] mt-0.5 font-mono">Job ID: {job.id}</p>
                </div>
                {(job.status === "done" || job.status === "failed") && (
                  <button
                    onClick={() => setExportingJobId(null)}
                    className="text-[#71717a] hover:text-[#fafafa] transition-all cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>

              <div className="space-y-2 flex-shrink-0">
                <div className="flex justify-between text-xs text-[#a1a1aa] font-semibold">
                  <span className="capitalize">Status: <span className={job.status === "done" ? "text-green-400 font-bold" : job.status === "failed" ? "text-red-400 font-bold" : "text-blue-400 font-bold"}>{job.status}</span></span>
                  <span>{percent}% ({done + failed}/{totalAssigned})</span>
                </div>
                <div className="w-full h-2 bg-[#09090b] rounded-full overflow-hidden border border-[#27272a]">
                  <div
                    className={`h-full transition-all duration-500 ${job.status === "failed" ? "bg-red-500" : "bg-blue-600"}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-[#71717a] font-medium pt-1">
                  <span>Queued/Uploading: <span className="text-blue-400 font-bold">{pending}</span></span>
                  <span>Uploaded: <span className="text-green-400 font-bold">{done}</span></span>
                  <span>Failed: <span className="text-red-400 font-bold">{failed}</span></span>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 custom-scrollbar">
                <h4 className="font-bold text-[#fafafa] uppercase tracking-wider text-[10px] text-[#71717a] sticky top-0 bg-[#18181b] py-1">Assignments List</h4>
                {job.assignments?.map((ass: any) => {
                  const hookText = ass.video?.hook?.text || "Unknown video";
                  const grpName = ass.video?.group?.name || "Unknown group";
                  return (
                    <div key={ass.id} className="p-3 bg-[#09090b] border border-[#27272a] rounded-xl flex items-center justify-between text-xs">
                      <div className="truncate flex-1 mr-3 space-y-1">
                        <p className="font-bold text-gray-200 truncate" title={hookText}>“{hookText}”</p>
                        <p className="text-[10px] text-[#71717a] truncate font-medium">
                          From: <span className="text-[#fafafa]">{grpName}</span> • Dest Folder: <span className="font-mono text-gray-300">{ass.driveFolderId.substring(0, 12)}...</span>
                        </p>
                        {ass.error && (
                          <p className="text-[10px] text-red-400 font-medium leading-normal bg-red-500/5 p-2 rounded-lg border border-red-500/10">
                            Error: {ass.error}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                          ass.status === "done"
                            ? "bg-green-500/10 text-green-400"
                            : ass.status === "failed"
                            ? "bg-red-500/10 text-red-500"
                            : ass.status === "uploading"
                            ? "bg-blue-500/10 text-blue-400 animate-pulse"
                            : "bg-gray-500/10 text-gray-400"
                        }`}>
                          {ass.status}
                        </span>

                        {ass.status === "failed" && (
                          <button
                            onClick={() => handleRetryAssignment(ass.id)}
                            className="px-2.5 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-[10px] font-bold rounded-lg border border-red-500/20 transition-all cursor-pointer"
                          >
                            Retry
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {(job.status === "done" || job.status === "failed") && (
                <div className="flex justify-end border-t border-[#27272a] pt-4 flex-shrink-0">
                  <button
                    onClick={() => setExportingJobId(null)}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
                  >
                    Close & Finish
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {previewVideoUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setPreviewVideoUrl(null)}
        >
          <div
            className="bg-[#18181b] rounded-2xl border border-[#27272a] p-5 max-w-sm w-full mx-4 shadow-2xl space-y-4 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[#fafafa] text-sm font-semibold flex items-center gap-2">
                <Play className="w-4 h-4 text-[#E11D48]" /> Video Preview
              </h3>
              <button
                onClick={() => setPreviewVideoUrl(null)}
                className="text-[#71717a] hover:text-[#fafafa] transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="aspect-[9/16] max-h-[60vh] mx-auto bg-black rounded-xl overflow-hidden border border-[#27272a] shadow-inner relative flex items-center justify-center">
              <video
                src={previewVideoUrl}
                controls
                autoPlay
                className="w-full h-full object-contain"
              />
            </div>
          </div>
        </div>
      )}

      {isEditingPrompt && selectedGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
          <div
            className="bg-[#18181b] border border-[#27272a] rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] flex flex-col justify-between shadow-2xl animate-in fade-in zoom-in duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <div className="flex justify-between items-center border-b border-[#27272a] pb-3 mb-4">
                <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-[#E11D48]" /> Edit AI Prompt Template
                </h3>
                <button
                  onClick={() => setIsEditingPrompt(false)}
                  className="text-[#71717a] hover:text-[#fafafa] transition-colors cursor-pointer"
                  type="button"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-xs text-[#71717a] mb-4 leading-relaxed">
                Customize the instruction context sent to Gemini to generate your video caption hooks. Keep the strict JSON format instruction at the end to ensure hooks parse correctly.
              </p>

              <textarea
                value={customPrompt}
                onChange={(e) => {
                  setCustomPrompt(e.target.value);
                  setHasManuallyEditedPrompt(true);
                }}
                className="w-full min-h-[300px] text-xs bg-[#09090b] border border-[#27272a] focus:border-[#E11D48] rounded-xl p-4 text-zinc-200 font-mono focus:outline-none custom-scrollbar leading-relaxed"
                placeholder="Prompt template details..."
              />
            </div>

            <div className="flex justify-between items-center border-t border-[#27272a] pt-4 mt-6">
              <button
                onClick={() => {
                  const campaign = campaigns.find((c) => c.id === selectedGroup.campaignId);
                  const campaignMarkdown = campaign
                    ? `# ${campaign.title}\n\n**Type:** ${campaign.type}\n**Description:** ${campaign.description}\n**Brief:** ${campaign.brief}\n**Info Context:**\n${campaign.infoContent || "None"}`
                    : "No campaign linked.";

                  let transcriptionText = "";
                  if (selectedGroup.transcript) {
                    try {
                      const wordList = JSON.parse(selectedGroup.transcript);
                      if (Array.isArray(wordList)) {
                        transcriptionText = wordList.map((w: any) => w.word || w.text || "").join(" ");
                      } else {
                        transcriptionText = String(selectedGroup.transcript);
                      }
                    } catch {
                      transcriptionText = selectedGroup.transcript;
                    }
                  }

                  const defaultPrompt = `Generate exactly ${aiHookCount} unique video captions or hook headlines summarizing this video transcript.

CAMPAIGN CONTEXT:
${campaignMarkdown}

VIDEO TRANSCRIPT:
"${transcriptionText}"

Format your response strictly as a JSON array of strings, like this:
["First hook headline", "Second hook headline", "Third hook headline"]
Do not add any other markdown wrapper like \`\`\`json or text blocks. Generate only the raw JSON array.`;

                  setCustomPrompt(defaultPrompt);
                  setHasManuallyEditedPrompt(false);
                  toast.success("Reset prompt to default");
                }}
                className="text-xs text-[#71717a] hover:text-[#fafafa] font-bold transition-colors cursor-pointer"
                type="button"
              >
                [Reset to Default]
              </button>

              <button
                onClick={() => {
                  setIsEditingPrompt(false);
                  toast.success("Prompt template saved");
                }}
                className="px-5 py-2 bg-[#E11D48] hover:bg-rose-700 text-white font-bold rounded-lg text-xs transition-colors shadow cursor-pointer font-semibold"
                type="button"
              >
                Save & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
