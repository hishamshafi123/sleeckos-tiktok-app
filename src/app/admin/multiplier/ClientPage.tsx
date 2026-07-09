"use client";

import React, { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
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
  Download
} from "lucide-react";

interface Campaign {
  id: string;
  title: string;
  type: string;
  description: string;
  brief: string;
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
  errorMessage: string | null;
  variation: { videoRef: string };
  hook: { text: string };
}

interface MultiplierGroup {
  id: string;
  name: string;
  campaignId: string;
  campaign: { id: string; title: string };
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

export default function ClientPage() {
  const [activeTab, setActiveTab] = useState<"builder" | "queue">("builder");
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

  // Rendering Settings
  const [hookDuration, setHookDuration] = useState(5);
  const [animationType, setAnimationType] = useState<"NONE" | "FADE_IN" | "SLIDE_UP">("NONE");
  const [animationDuration, setAnimationDuration] = useState(0.5);

  // Variations & manual hooks inputs
  const [filesToUpload, setFilesToUpload] = useState<File[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [newHookText, setNewHookText] = useState("");
  const [aiHookCount, setAiHookCount] = useState(5);
  const [generatingAiHooks, setGeneratingAiHooks] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

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
  const [syncingOutputs, setSyncingOutputs] = useState<Set<string>>(new Set());
  const [selectedPickerFolders, setSelectedPickerFolders] = useState<{ id: string; name: string }[]>([]);
  const [downloads, setDownloads] = useState<Record<string, { progress: number; message: string }>>({});

  // Fetch initial data
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
      const groupRes = await fetch("/api/managed/multiplier");
      if (groupRes.ok) {
        const data = await groupRes.json();
        setGroups(data);
      }
    } catch (err) {
      console.error("Error loading groups:", err);
    } finally {
      setLoadingGroups(false);
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
  };

  const searchDriveFolders = async (query: string) => {
    setSearchingFolders(true);
    try {
      const res = await fetch(`/api/managed/multiplier/google/folders?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        setDriveFolders(data.folders || []);
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
            });
          });
        } else {
          groupObj.outputs.forEach((item, idx) => {
            const folder = selectedPickerFolders[idx % selectedPickerFolders.length];
            assignments.push({
              outputId: item.id,
              driveFolderId: folder.id,
              driveFolderName: folder.name,
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

  useEffect(() => {
    fetchData();
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  // Poll active rendering groups
  useEffect(() => {
    const activeGroups = groups.filter(
      (g) => g.status === "QUEUED" || g.status === "RENDERING" || g.transcriptStatus === "TRANSCRIBING"
    );

    if (activeGroups.length > 0) {
      if (!pollTimerRef.current) {
        pollTimerRef.current = setInterval(async () => {
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
    } else {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }
  }, [groups, selectedGroup]);

  // Load selected group details into form
  const handleSelectGroup = (group: MultiplierGroup) => {
    setSelectedGroup(group);
    setGroupName(group.name);
    setSelectedCampaignId(group.campaignId);
    setStyleId(group.styleId as any);
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
    setHookDuration(s.hookDuration ?? 5);
    setAnimationType(s.animationType ?? "NONE");
    setAnimationDuration(s.animationDuration ?? 0.5);

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
          styleId,
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
          styleId,
          settings: settingsObj,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save settings");
      }

      toast.success("Group configuration updated.");
      await fetchData();
      // Reload updated info
      const updated = groups.find((g) => g.id === selectedGroup.id);
      if (updated) setSelectedGroup(updated);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // Upload video variations
  const handleUploadVariations = async () => {
    if (!selectedGroup || filesToUpload.length === 0) return;

    setUploadingFiles(true);
    const formData = new FormData();
    filesToUpload.forEach((f) => {
      formData.append("file", f);
    });

    try {
      const res = await fetch(`/api/managed/multiplier/groups/${selectedGroup.id}/variations`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to upload variations");
      }

      toast.success("Video variations uploaded successfully.");
      setFilesToUpload([]);
      await fetchData();
      const updated = groups.find((g) => g.id === selectedGroup.id);
      if (updated) setSelectedGroup(updated);
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
      const res = await fetch(`/api/managed/multiplier/groups/${selectedGroup.id}/hooks/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          count: aiHookCount,
          useCampaignContext: true,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Gemini hook generator failed");
      }

      toast.success(`Successfully generated ${aiHookCount} AI captions.`);
      await fetchData();
      const updated = groups.find((g) => g.id === selectedGroup.id);
      if (updated) setSelectedGroup(updated);
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
      await fetchData();
      const updated = groups.find((g) => g.id === selectedGroup.id);
      if (updated) setSelectedGroup(updated);
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
      await fetchData();
      const updated = groups.find((g) => g.id === selectedGroup.id);
      if (updated) setSelectedGroup(updated);
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
      await fetchData();
      const updated = groups.find((g) => g.id === selectedGroup.id);
      if (updated) setSelectedGroup(updated);
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

  // Delete entire Group
  const handleDeleteGroup = async (groupId: string) => {
    if (!confirm("Are you sure you want to delete this Multiplier Group and all associated files?")) return;

    try {
      const res = await fetch(`/api/managed/multiplier?groupId=${groupId}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Deletion failed");

      toast.success("Group deleted.");
      setSelectedGroup(null);
      await fetchData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDeleteAllGroups = async () => {
    if (!confirm("Are you sure you want to delete ALL multiplier groups/batches and all associated video files? This action is permanent and cannot be undone.")) return;

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
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                {groups.map((group) => {
                  const isSel = selectedGroup?.id === group.id;
                  return (
                    <div
                      key={group.id}
                      onClick={() => handleSelectGroup(group)}
                      className={`p-3 rounded-lg border cursor-pointer transition-all flex justify-between items-center ${
                        isSel
                          ? "bg-[#27272a] border-[#E11D48]"
                          : "bg-[#09090b] border-[#27272a] hover:bg-[#18181b]"
                      }`}
                    >
                      <div className="truncate flex-1">
                        <p className="font-semibold text-sm truncate">{group.name}</p>
                        <p className="text-xs text-[#71717a] truncate mt-0.5">
                          {group.campaign?.title || "No Campaign"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            group.status === "COMPLETED"
                              ? "bg-green-500"
                              : group.status === "FAILED"
                              ? "bg-red-500"
                              : group.status === "RENDERING" || group.status === "QUEUED"
                              ? "bg-amber-500 animate-pulse"
                              : "bg-gray-500"
                          }`}
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteGroup(group.id);
                          }}
                          className="text-[#71717a] hover:text-red-500 transition-colors p-1"
                        >
                          <Trash className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-[#27272a] hover:border-[#E11D48] rounded-xl p-8 text-center cursor-pointer transition-all bg-[#09090b] flex flex-col items-center justify-center"
                  >
                    <Upload className="w-8 h-8 text-[#71717a] mb-2" />
                    <p className="text-sm font-semibold">Click to browse or drop video files</p>
                    <p className="text-xs text-[#71717a] mt-1">Accepts multiple .mp4 variations</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="video/mp4"
                      onChange={(e) => {
                        if (e.target.files) {
                          setFilesToUpload(Array.from(e.target.files));
                        }
                      }}
                      className="hidden"
                    />
                  </div>

                  {filesToUpload.length > 0 && (
                    <div className="mt-4 p-4 bg-[#09090b] rounded-lg border border-[#27272a] flex flex-col gap-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-[#a1a1aa] font-semibold">
                          Selected {filesToUpload.length} files:
                        </span>
                        <button
                          onClick={() => setFilesToUpload([])}
                          className="text-xs font-semibold text-[#E11D48] hover:underline"
                        >
                          Clear
                        </button>
                      </div>
                      <div className="text-xs text-[#71717a] max-h-24 overflow-y-auto space-y-1">
                        {filesToUpload.map((f, i) => (
                          <div key={i} className="truncate">
                            - {f.name} ({(f.size / (1024 * 1024)).toFixed(1)} MB)
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={handleUploadVariations}
                        disabled={uploadingFiles}
                        className="mt-2 w-full py-2 bg-[#E11D48] hover:bg-rose-700 text-white font-semibold rounded-lg text-xs transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                      >
                        {uploadingFiles ? (
                          <>
                            <Loader2 className="w-4.5 h-4.5 animate-spin" /> Uploading...
                          </>
                        ) : (
                          <>
                            <Upload className="w-3.5 h-3.5" /> Confirm Upload Variations
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {selectedGroup.variations.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-semibold text-[#a1a1aa] mb-2">Uploaded Variations ({selectedGroup.variations.length}):</p>
                      <div className="flex flex-wrap gap-3">
                        {selectedGroup.variations.map((v, i) => (
                          <div key={v.id} className="relative bg-[#09090b] px-3 py-2 rounded-lg border border-[#27272a] flex items-center gap-2">
                            <Video className="w-4 h-4 text-[#71717a]" />
                            <span className="text-xs font-semibold text-[#fafafa]">Variation #{i + 1}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Step 3: Transcription */}
                <div className="border-t border-[#27272a] pt-6">
                  <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <span className="bg-[#E11D48] text-white text-xs w-5 h-5 flex items-center justify-center rounded-full font-bold">3</span>
                    Speech Transcription (Stable-ts / Whisper)
                  </h2>
                  <div className="bg-[#09090b] border border-[#27272a] rounded-xl p-6 flex items-start gap-4 justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold">Runs transcription alignment once for the entire Group</p>
                      <p className="text-xs text-[#71717a]">
                        We transcribe only the first variation, saving execution costs. All hooks use this exact transcript alignment.
                      </p>
                      {selectedGroup.transcriptStatus === "TRANSCRIBED" && (
                        <div className="mt-2 inline-flex items-center gap-1 text-xs text-green-500 bg-green-500/10 px-2.5 py-1 rounded-full font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Alignment completed successfully
                        </div>
                      )}
                      {selectedGroup.transcriptStatus === "TRANSCRIBING" && (
                        <div className="mt-2 inline-flex items-center gap-1 text-xs text-amber-500 bg-amber-500/10 px-2.5 py-1 rounded-full font-semibold animate-pulse">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Transcribing source...
                        </div>
                      )}
                      {selectedGroup.transcriptStatus === "FAILED" && (
                        <div className="mt-2 inline-flex items-center gap-1 text-xs text-red-500 bg-red-500/10 px-2.5 py-1 rounded-full font-semibold">
                          <AlertCircle className="w-3.5 h-3.5" /> Transcription failed
                        </div>
                      )}
                    </div>

                    <button
                      onClick={handleTranscribeGroup}
                      disabled={transcribing || selectedGroup.variations.length === 0 || selectedGroup.transcriptStatus === "TRANSCRIBING"}
                      className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white font-semibold rounded-lg text-sm transition-all disabled:opacity-50 flex items-center gap-2"
                    >
                      {transcribing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin text-[#E11D48]" /> Processing...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-4 h-4" /> Run Alignment
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
                        <p className="text-sm font-semibold flex items-center gap-1.5">
                          <Sparkles className="w-4.5 h-4.5 text-[#E11D48]" /> Gemini AI Hook Generator
                        </p>
                        <p className="text-xs text-[#71717a] mt-1 mb-4">
                          Synthesizes the transcript text with the campaign brief messaging context to draft premium news-style hooks.
                        </p>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="w-24">
                          <label className="block text-[10px] text-[#71717a] uppercase font-bold mb-1">Hooks Count</label>
                          <input
                            type="number"
                            min={1}
                            max={20}
                            value={aiHookCount}
                            onChange={(e) => setAiHookCount(parseInt(e.target.value) || 5)}
                            className="w-full bg-[#18181b] border border-[#27272a] rounded px-3 py-1.5 text-xs text-center focus:outline-none"
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
                        <div className="absolute inset-0 bg-neutral-900/10 flex items-center justify-center text-[10px] text-[#27272a] pointer-events-none">
                          Background Video Frame
                        </div>
                        {/* Live CSS approximate preview */}
                        <div
                          style={{
                            position: "absolute",
                            top: `${positionYPercent}%`,
                            left: "10px",
                            right: "10px",
                            transform: "translateY(-50%)",
                            backgroundColor: bgStripColor,
                            opacity: bgStripOpacity,
                            borderLeft: styleId === "news-lower-third" || styleId === "breaking-headline" ? `3px solid ${accentColor}` : "none",
                            borderRadius: styleId === "subtitle-box" ? "4px" : styleId === "quote-card" ? "6px" : "0",
                            padding: "6px",
                            boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
                          }}
                        >
                          <p
                            style={{
                              color: fontColor,
                              fontSize: "8px",
                              lineHeight: "1.2",
                              fontWeight: "bold",
                              textAlign: styleId === "subtitle-box" ? "center" : "left",
                              fontFamily: styleId === "quote-card" ? "Georgia, serif" : "sans-serif",
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {getStylePreviewSnippet()}
                          </p>
                        </div>
                      </div>
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
      ) : (
        /* Queue Dashboard Tab */
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Layers className="text-[#E11D48] w-5 h-5" /> Rendering Batches Progress Board
            </h2>
            <div className="flex items-center gap-2">
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
            <div className="space-y-6">
              {groups.map((group) => {
                const pendingOutputs = group.outputs.filter((o) => o.status === "PENDING" || o.status === "RENDERING");
                const completedOutputs = group.outputs.filter((o) => o.status === "COMPLETED");
                const failedOutputs = group.outputs.filter((o) => o.status === "FAILED");
                const totalOutputs = group.outputs.length;

                const percent = totalOutputs > 0 ? Math.round((completedOutputs.length / totalOutputs) * 100) : 0;

                // Hide completely raw draft groups without outputs from queue dashboard unless they are transcribing
                if (totalOutputs === 0 && group.status !== "RENDERING" && group.transcriptStatus !== "TRANSCRIBING") return null;

                return (
                  <div key={group.id} className="bg-[#18181b] rounded-xl border border-[#27272a] p-6 space-y-4">
                    {/* Header */}
                    <div className="flex justify-between items-start gap-4">
                      <div>
                        <h3 className="font-extrabold text-lg flex items-center gap-2">
                          {group.name}
                          <span className="text-xs text-[#a1a1aa] font-medium bg-[#27272a] px-2.5 py-0.5 rounded-full border border-[#27272a]">
                            Campaign: {group.campaign?.title || "None"}
                          </span>
                        </h3>
                        <p className="text-xs text-[#71717a] mt-1">
                          Mode: {group.mappingMode === "each" ? "Multiply" : "Distribute"} | Preset: {group.styleId}
                        </p>
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
                          title="Delete Batch"
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

                                <div className="flex gap-2">
                                  {out.status === "FAILED" && (
                                    <button
                                      onClick={() => handleRetryOutput(group, out.id)}
                                      className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-[#fafafa] font-semibold rounded text-[10px] transition-all"
                                    >
                                      Retry
                                    </button>
                                  )}
                                  {driveConnected && out.status === "COMPLETED" && out.outputRef && (
                                    <button
                                      onClick={() => handleSyncToDrive(group, out.id)}
                                      disabled={syncingOutputs.has(out.id)}
                                      className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-[#fafafa] font-semibold rounded text-[10px] transition-all flex items-center gap-1 disabled:opacity-50"
                                    >
                                      {syncingOutputs.has(out.id) ? (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                      ) : (
                                        <FolderOpen className="w-3 h-3 text-rose-500" />
                                      )}
                                      {syncingOutputs.has(out.id) ? "Syncing..." : "Sync Drive"}
                                    </button>
                                  )}
                                  {out.status === "COMPLETED" && out.outputRef && (
                                    <a
                                      href={out.outputRef}
                                      download
                                      className="px-2.5 py-1 bg-[#E11D48] hover:bg-rose-700 text-white font-semibold rounded text-[10px] transition-all flex items-center gap-1"
                                    >
                                      Download <ExternalLink className="w-3 h-3" />
                                    </a>
                                  )}
                                </div>
                              </div>

                              {driveConnected && (
                                  <div className="mt-1 flex items-center justify-between gap-2 border-t border-[#27272a]/40 pt-2 text-[10px] text-[#71717a]">
                                    <span className="truncate flex items-center gap-1">
                                      <FolderOpen className="w-3.5 h-3.5 text-rose-500/80" />
                                      {out.driveFolderId ? "Synced Override" : "No Folder Override"}
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
                              )}

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
                <h3 className="text-[#fafafa] text-sm font-semibold flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-[#E11D48]" /> 
                  {isBulk ? "Select Multiple Folders" : "Select Google Drive Folder"}
                  <span className="text-[#71717a] text-[10px] font-normal">
                    ({isBulk ? "group round-robin" : "per video variation"})
                  </span>
                </h3>
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
    </div>
  );
}
