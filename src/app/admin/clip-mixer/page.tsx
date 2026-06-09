"use client";

import React, { useState, useEffect, useRef } from "react";
import { 
  Folder, Video, Plus, Trash2, Sliders, Music, Sparkles, Layers, Play, Pause, 
  RefreshCw, ChevronRight, Check, X, ShieldAlert, Film, HelpCircle, HardDrive, 
  Download, Volume2, VolumeX, Eye, AlertCircle, Loader2, Users, History
} from "lucide-react";
import { toast } from "sonner";

interface Section {
  id: string;
  name: string;
  color: string;
  totalGroups: number;
  totalAccounts: number;
}

interface ClipFolder {
  id: string;
  name: string;
  sectionId: string;
  clips: ClipVideo[];
  _count?: {
    clips: number;
  };
}

interface ClipVideo {
  id: string;
  folderId: string;
  videoUrl: string;
  duration: number;
  createdAt: string;
}

interface Track {
  id: string;
  title: string;
  artist: string;
  duration: number;
  fileUrl: string;
  isLyrical: boolean;
}

interface LyricalTemplate {
  id: string;
  templateName: string;
  fontFamily: string;
  fontSize: number;
  activeColor: string;
  muteAudio: boolean;
}

interface Account {
  id: string;
  tiktokUsername: string;
  tiktokDisplayName: string;
  tiktokAvatarUrl: string;
  group: {
    id: string;
    name: string;
    section: {
      id: string;
      name: string;
      color: string;
    };
  };
}

interface BatchItem {
  id: string;
  accountId: string;
  renderedVideoUrl: string | null;
  status: "PENDING" | "GENERATED" | "CONFIRMED" | "RENDERING" | "RENDERED" | "UPLOADED" | "FAILED";
  errorMessage: string | null;
  createdAt: string;
  account: {
    tiktokUsername: string;
    tiktokDisplayName: string;
    tiktokAvatarUrl: string;
  };
}

interface Batch {
  id: string;
  folderId: string;
  trackId: string;
  lyricalTemplateId: string;
  targetDuration: number;
  totalVideos: number;
  muteAudio: boolean;
  status: "DRAFT" | "QUOTES_GENERATING" | "QUOTES_REVIEW" | "RENDERING" | "COMPLETED" | "FAILED";
  createdAt: string;
  folder?: { name: string };
  track?: { title: string; artist: string };
  lyricalTemplate?: { templateName: string };
  items?: BatchItem[];
}

export default function ClipMixerPage() {
  const [sections, setSections] = useState<Section[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState<string>("");
  const [folders, setFolders] = useState<ClipFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");
  const [newFolderName, setNewFolderName] = useState<string>("");
  
  const [tracks, setTracks] = useState<Track[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string>("");
  const [templates, setTemplates] = useState<LyricalTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  
  const [targetDuration, setTargetDuration] = useState<number>(15);
  const [videosPerAccount, setVideosPerAccount] = useState<number>(3);
  const [muteAudio, setMuteAudio] = useState<boolean>(false);
  
  const [activeTab, setActiveTab] = useState<"folders" | "generator" | "batches">("folders");
  
  // Batches history & details
  const [batches, setBatches] = useState<Batch[]>([]);
  const [activeBatch, setActiveBatch] = useState<Batch | null>(null);
  
  // Upload UI state
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Video preview modal
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
  
  // Refresh toggles
  const [isLoadingSections, setIsLoadingSections] = useState(false);
  const [isLoadingFolders, setIsLoadingFolders] = useState(false);
  const [isLoadingTracks, setIsLoadingTracks] = useState(false);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [isLoadingBatches, setIsLoadingBatches] = useState(false);

  // Fetch sections
  const fetchSections = async () => {
    setIsLoadingSections(true);
    try {
      const res = await fetch("/api/managed/sections");
      if (!res.ok) throw new Error("Failed to fetch sections");
      const data = await res.ok ? await res.json() : [];
      setSections(data);
      if (data.length > 0 && !selectedSectionId) {
        setSelectedSectionId(data[0].id);
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to load sections");
    } finally {
      setIsLoadingSections(false);
    }
  };

  // Fetch folders for selected section
  const fetchFolders = async (sectionId: string) => {
    if (!sectionId) return;
    setIsLoadingFolders(true);
    try {
      const res = await fetch(`/api/managed/clip-mixer/folders?sectionId=${sectionId}`);
      if (!res.ok) throw new Error("Failed to fetch folders");
      const data = await res.json();
      setFolders(data);
      if (data.length > 0) {
        // preserve selection if still exists, otherwise select first
        if (!data.some((f: ClipFolder) => f.id === selectedFolderId)) {
          setSelectedFolderId(data[0].id);
        }
      } else {
        setSelectedFolderId("");
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to load folders");
    } finally {
      setIsLoadingFolders(false);
    }
  };

  // Fetch tracks
  const fetchTracks = async () => {
    setIsLoadingTracks(true);
    try {
      const res = await fetch("/api/managed/genres/tracks");
      if (!res.ok) throw new Error("Failed to fetch tracks");
      const data = await res.json();
      const lyricalTracks = data.filter((t: Track) => t.isLyrical);
      setTracks(lyricalTracks);
      if (lyricalTracks.length > 0 && !selectedTrackId) {
        setSelectedTrackId(lyricalTracks[0].id);
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to load tracks");
    } finally {
      setIsLoadingTracks(false);
    }
  };

  // Fetch templates for selected track
  const fetchTemplates = async (trackId: string) => {
    if (!trackId) {
      setTemplates([]);
      setSelectedTemplateId("");
      return;
    }
    try {
      const res = await fetch(`/api/managed/genres/tracks/lyrical?trackId=${trackId}`);
      if (!res.ok) throw new Error("Failed to fetch templates");
      const data = await res.json();
      setTemplates(data);
      if (data.length > 0) {
        setSelectedTemplateId(data[0].id);
        setMuteAudio(data[0].muteAudio || false);
      } else {
        setSelectedTemplateId("");
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to load styling templates");
    }
  };

  // Fetch active accounts
  const fetchAccounts = async () => {
    setIsLoadingAccounts(true);
    try {
      const res = await fetch("/api/managed/genres/accounts");
      if (!res.ok) throw new Error("Failed to fetch accounts");
      const data = await res.json();
      setAccounts(data);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load accounts");
    } finally {
      setIsLoadingAccounts(false);
    }
  };

  // Fetch batches history
  const fetchBatches = async () => {
    setIsLoadingBatches(true);
    try {
      const res = await fetch("/api/managed/clip-mixer/batches");
      if (!res.ok) throw new Error("Failed to fetch batches");
      const data = await res.json();
      setBatches(data);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load batches history");
    } finally {
      setIsLoadingBatches(false);
    }
  };

  // Poll active batch progress
  useEffect(() => {
    if (!activeBatch || activeBatch.status === "COMPLETED" || activeBatch.status === "FAILED") {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/managed/clip-mixer/batches?batchId=${activeBatch.id}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        setActiveBatch(data);
        
        // Update item in list too
        setBatches(prev => prev.map(b => b.id === data.id ? data : b));
        
        if (data.status === "COMPLETED" || data.status === "FAILED") {
          clearInterval(interval);
          toast.success(`Batch rendering finished with status: ${data.status}`);
        }
      } catch (err) {
        console.error("Polling progress failed", err);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [activeBatch]);

  // Initial load
  useEffect(() => {
    fetchSections();
    fetchTracks();
    fetchAccounts();
    fetchBatches();
  }, []);

  // Section dependency triggers
  useEffect(() => {
    if (selectedSectionId) {
      fetchFolders(selectedSectionId);
    }
  }, [selectedSectionId]);

  // Track dependency triggers
  useEffect(() => {
    if (selectedTrackId) {
      fetchTemplates(selectedTrackId);
    }
  }, [selectedTrackId]);

  // Template select trigger
  const handleTemplateSelect = (tplId: string) => {
    setSelectedTemplateId(tplId);
    const selectedTpl = templates.find(t => t.id === tplId);
    if (selectedTpl) {
      setMuteAudio(selectedTpl.muteAudio || false);
    }
  };

  // Folder creation
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim() || !selectedSectionId) return;

    try {
      const res = await fetch("/api/managed/clip-mixer/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CREATE_FOLDER",
          sectionId: selectedSectionId,
          name: newFolderName.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create folder");

      toast.success("Clip folder created!");
      setNewFolderName("");
      fetchFolders(selectedSectionId);
      setSelectedFolderId(data.id);
    } catch (err: any) {
      toast.error(err.message || "Failed to create folder");
    }
  };

  // Folder deletion
  const handleDeleteFolder = async (folderId: string) => {
    if (!confirm("Are you sure you want to delete this folder and all clips inside? This cannot be undone.")) return;

    try {
      const res = await fetch(`/api/managed/clip-mixer/folders?folderId=${folderId}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to delete folder");

      toast.success("Folder and clips deleted");
      fetchFolders(selectedSectionId);
    } catch (err: any) {
      toast.error(err.message || "Failed to delete folder");
    }
  };

  // Clip deletion
  const handleDeleteClip = async (clipId: string) => {
    if (!confirm("Delete this clip?")) return;

    try {
      const res = await fetch(`/api/managed/clip-mixer/folders?clipId=${clipId}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to delete clip");

      toast.success("Clip video deleted");
      fetchFolders(selectedSectionId);
    } catch (err: any) {
      toast.error(err.message || "Failed to delete clip");
    }
  };

  // Handle multi-clip uploads
  const handleUploadClips = async (files: FileList | null) => {
    if (!files || files.length === 0 || !selectedFolderId) return;

    setIsUploading(true);
    setUploadProgress(`Preparing ${files.length} file(s)...`);

    try {
      const formData = new FormData();
      formData.append("folderId", selectedFolderId);
      for (let i = 0; i < files.length; i++) {
        formData.append("clipFile", files[i]);
      }

      setUploadProgress("Uploading clips to server (FFprobe parsing duration)...");
      const res = await fetch("/api/managed/clip-mixer/folders", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to upload clips");

      toast.success(`Successfully uploaded ${files.length} clip(s)!`);
      fetchFolders(selectedSectionId);
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setIsUploading(false);
      setUploadProgress("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Batch deletion
  const handleDeleteBatch = async (batchId: string) => {
    if (!confirm("Delete this batch run and its rendered files?")) return;

    try {
      const res = await fetch(`/api/managed/clip-mixer/batches?batchId=${batchId}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to delete batch");

      toast.success("Batch run deleted");
      fetchBatches();
      if (activeBatch && activeBatch.id === batchId) {
        setActiveBatch(null);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to delete batch");
    }
  };

  // Trigger batch generation
  const handleGenerateBatch = async () => {
    if (!selectedFolderId) {
      toast.error("Please select a Clip Folder first");
      return;
    }
    if (!selectedTrackId || !selectedTemplateId) {
      toast.error("Please select a Lyrical Track and Captions Template");
      return;
    }
    if (selectedAccountIds.length === 0) {
      toast.error("Please select at least one TikTok account");
      return;
    }

    const currentFolder = folders.find(f => f.id === selectedFolderId);
    if (!currentFolder || !currentFolder.clips || currentFolder.clips.length === 0) {
      toast.error("Selected folder is empty. Please upload clips first!");
      return;
    }

    const promise = fetch("/api/managed/clip-mixer/batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folderId: selectedFolderId,
        trackId: selectedTrackId,
        lyricalTemplateId: selectedTemplateId,
        targetDuration,
        muteAudio,
        accountIds: selectedAccountIds,
        videosPerAccount,
      }),
    });

    toast.promise(promise, {
      loading: "Initializing batch composer queue...",
      success: async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to start composition");
        
        // Fetch active batch details and show panel
        const batchRes = await fetch(`/api/managed/clip-mixer/batches?batchId=${data.batchId}`);
        const batchData = await batchRes.json();
        setActiveBatch(batchData);
        setActiveTab("batches");
        fetchBatches();
        return "Clip Mixer batch rendering started!";
      },
      error: (err) => err.message || "Failed to start batch rendering",
    });
  };

  // Section accounts filter
  const sectionAccounts = accounts.filter(
    (acc) => acc.group.section.id === selectedSectionId
  );

  const toggleSelectAccount = (id: string) => {
    setSelectedAccountIds(prev => 
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    );
  };

  const handleSelectAllAccounts = () => {
    setSelectedAccountIds(sectionAccounts.map(a => a.id));
  };

  const handleDeselectAllAccounts = () => {
    setSelectedAccountIds([]);
  };

  const currentFolder = folders.find(f => f.id === selectedFolderId);

  return (
    <div className="space-y-8 text-gray-200 pb-16">
      
      {/* Header Panel */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-white/5 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-2xl bg-gradient-to-tr from-purple-500/10 to-pink-500/10 border border-purple-500/20 text-purple-400">
              <Film className="w-6 h-6" />
            </div>
            <h1 className="text-3xl font-black bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent tracking-tight">
              Smart Clip Mixer
            </h1>
          </div>
          <p className="text-gray-400 text-sm mt-1">
            Mash up short clips into unique vertical videos overlaid with synced lyrical captions.
          </p>
        </div>

        {/* Section Selector */}
        <div className="flex items-center gap-3 bg-[#0f0f18] p-2 rounded-2xl border border-white/5 shadow-inner">
          <span className="text-xs text-gray-500 font-bold uppercase tracking-wider pl-2">Account Section:</span>
          <select
            value={selectedSectionId}
            onChange={(e) => setSelectedSectionId(e.target.value)}
            className="bg-[#07070c] border border-white/5 rounded-xl px-4 py-2 text-white font-semibold text-sm focus:outline-none focus:border-purple-500 transition-all cursor-pointer"
          >
            {sections.map((sec) => (
              <option key={sec.id} value={sec.id}>
                {sec.name} ({sec.totalAccounts} accounts)
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabs Selector */}
      <div className="flex bg-[#0f0f18] p-1 rounded-2xl border border-white/5 shadow-inner self-start inline-flex">
        <button
          onClick={() => setActiveTab("folders")}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 ${
            activeTab === "folders" 
              ? "bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-purple-300 border border-purple-500/30 shadow-lg shadow-purple-500/5 backdrop-blur-md" 
              : "text-gray-400 hover:text-white"
          }`}
        >
          <Folder className="w-4 h-4" />
          Clip Library
        </button>
        <button
          onClick={() => setActiveTab("generator")}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 ${
            activeTab === "generator" 
              ? "bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-purple-300 border border-purple-500/30 shadow-lg shadow-purple-500/5 backdrop-blur-md" 
              : "text-gray-400 hover:text-white"
          }`}
        >
          <Sliders className="w-4 h-4" />
          Batch Generator
        </button>
        <button
          onClick={() => setActiveTab("batches")}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 ${
            activeTab === "batches" 
              ? "bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-purple-300 border border-purple-500/30 shadow-lg shadow-purple-500/5 backdrop-blur-md" 
              : "text-gray-400 hover:text-white"
          }`}
        >
          <Sparkles className="w-4 h-4" />
          Batch Progress {batches.some(b => b.status === "RENDERING") && (
            <span className="w-2.5 h-2.5 rounded-full bg-purple-500 animate-ping inline-block" />
          )}
        </button>
      </div>

      {/* TAB: CLIP LIBRARY */}
      {activeTab === "folders" && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          
          {/* Folders List Sidebar */}
          <div className="lg:col-span-1 space-y-6 bg-[#0c0c14] border border-white/5 rounded-3xl p-6 shadow-2xl relative overflow-hidden">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Folder className="w-4 h-4 text-purple-400" />
              Folders
            </h2>

            <form onSubmit={handleCreateFolder} className="space-y-3">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="New folder name..."
                className="w-full bg-[#0f0f18] border border-white/5 rounded-xl px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/35 transition-all text-sm"
              />
              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-xl text-sm transition-all shadow-md shadow-purple-600/10 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Create Folder
              </button>
            </form>

            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
              {isLoadingFolders ? (
                <div className="flex items-center justify-center py-8 text-gray-500 text-sm gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-purple-500" />
                  Loading...
                </div>
              ) : folders.length === 0 ? (
                <p className="text-sm text-gray-500 py-4 italic text-center">No folders in section</p>
              ) : (
                folders.map((folder) => (
                  <div
                    key={folder.id}
                    onClick={() => setSelectedFolderId(folder.id)}
                    className={`flex items-center justify-between p-3 rounded-xl cursor-pointer border transition-all text-sm ${
                      selectedFolderId === folder.id
                        ? "bg-purple-500/10 border-purple-500/30 text-purple-300"
                        : "bg-[#09090f] border-white/5 text-gray-400 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Folder className={`w-4 h-4 ${selectedFolderId === folder.id ? "text-purple-400" : "text-gray-600"}`} />
                      <span className="font-semibold truncate">{folder.name}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs bg-[#0f0f18] border border-white/5 text-gray-500 px-2 py-0.5 rounded-full font-bold">
                        {folder.clips?.length || 0}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteFolder(folder.id);
                        }}
                        className="text-gray-600 hover:text-red-400 transition-all p-1 hover:bg-white/5 rounded-lg"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Folder Details / Upload Section */}
          <div className="lg:col-span-3 space-y-6">
            {selectedFolderId ? (
              <div className="bg-[#0c0c14] border border-white/5 rounded-3xl p-6 shadow-2xl space-y-6">
                
                {/* Folder Header */}
                <div className="flex items-center justify-between border-b border-white/5 pb-4">
                  <div>
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                      <Folder className="w-5 h-5 text-purple-400" />
                      {currentFolder?.name}
                    </h2>
                    <p className="text-xs text-gray-400 mt-1">
                      Upload video clips here. Clips will be randomly sliced (3-5s) and concatenated.
                    </p>
                  </div>
                </div>

                {/* Upload Area */}
                <div 
                  onClick={() => !isUploading && fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer ${
                    isUploading 
                      ? "border-purple-500/35 bg-purple-500/5 cursor-not-allowed" 
                      : "border-white/5 bg-[#09090f] hover:border-purple-500/25 hover:bg-purple-500/5"
                  }`}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={(e) => handleUploadClips(e.target.files)}
                    multiple
                    accept="video/*"
                    className="hidden"
                    disabled={isUploading}
                  />
                  {isUploading ? (
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="w-10 h-10 text-purple-500 animate-spin" />
                      <p className="text-sm font-semibold text-purple-300">{uploadProgress}</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="mx-auto w-12 h-12 rounded-2xl bg-purple-500/10 flex items-center justify-center text-purple-400">
                        <Video className="w-6 h-6" />
                      </div>
                      <p className="text-sm font-semibold text-white">Click or drag video clips to upload</p>
                      <p className="text-xs text-gray-500">Supports MP4, MOV, WebM. Multi-file upload supported.</p>
                    </div>
                  )}
                </div>

                {/* Clips Grid */}
                <div>
                  <h3 className="text-sm font-bold text-white mb-4 uppercase tracking-wider text-gray-500">Uploaded Clips ({currentFolder?.clips?.length || 0})</h3>
                  {(!currentFolder?.clips || currentFolder.clips.length === 0) ? (
                    <div className="bg-[#09090f] border border-white/5 rounded-2xl p-12 text-center text-gray-500 text-sm italic">
                      No clips in this folder yet. Drag and drop videos above.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
                      {currentFolder.clips.map((clip) => (
                        <div key={clip.id} className="group bg-[#09090f] border border-white/5 rounded-2xl overflow-hidden relative shadow-inner">
                          <div className="aspect-[9/16] relative bg-black flex items-center justify-center">
                            <video
                              src={clip.videoUrl}
                              className="w-full h-full object-cover"
                              preload="metadata"
                            />
                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center gap-3">
                              <button
                                onClick={() => setPreviewVideoUrl(clip.videoUrl)}
                                className="w-10 h-10 rounded-full bg-white/10 text-white flex items-center justify-center border border-white/10 hover:bg-white/20 transition-all"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteClip(clip.id)}
                                className="w-10 h-10 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center border border-red-500/10 hover:bg-red-500/20 transition-all"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                            <span className="absolute bottom-2 left-2 text-[10px] bg-black/75 backdrop-blur-md px-2 py-0.5 rounded-full font-bold border border-white/10 text-amber-400">
                              {clip.duration.toFixed(1)}s
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>
            ) : (
              <div className="bg-[#0c0c14] border border-white/5 rounded-3xl p-16 text-center shadow-2xl">
                <Folder className="w-16 h-16 text-gray-700 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-white">No Folder Selected</h2>
                <p className="text-sm text-gray-500 mt-2 max-w-sm mx-auto">
                  Please select a clip folder from the sidebar or create a new one to start uploading video clips.
                </p>
              </div>
            )}
          </div>

        </div>
      )}

      {/* TAB: BATCH GENERATOR */}
      {activeTab === "generator" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Main Controls */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Folder & Audio Track Selection Card */}
            <div className="bg-[#0c0c14] border border-white/5 rounded-3xl p-6 shadow-2xl space-y-6">
              <h2 className="text-lg font-bold text-white flex items-center gap-2 border-b border-white/5 pb-3">
                <Sliders className="w-4 h-4 text-purple-400" />
                Step 1: Set Clip Folder & Audio Track
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Folders List */}
                <div className="space-y-2">
                  <label className="text-xs text-gray-400 font-bold uppercase tracking-wider">Source Clip Folder:</label>
                  <select
                    value={selectedFolderId}
                    onChange={(e) => setSelectedFolderId(e.target.value)}
                    className="w-full bg-[#0f0f18] border border-white/5 rounded-xl px-4 py-3 text-white font-semibold text-sm focus:outline-none focus:border-purple-500 transition-all cursor-pointer"
                  >
                    <option value="">-- Select Folder --</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} ({f.clips?.length || 0} clips uploaded)
                      </option>
                    ))}
                  </select>
                </div>

                {/* Track Selector */}
                <div className="space-y-2">
                  <label className="text-xs text-gray-400 font-bold uppercase tracking-wider">Audio Track (Whisper Synced):</label>
                  <select
                    value={selectedTrackId}
                    onChange={(e) => setSelectedTrackId(e.target.value)}
                    className="w-full bg-[#0f0f18] border border-white/5 rounded-xl px-4 py-3 text-white font-semibold text-sm focus:outline-none focus:border-purple-500 transition-all cursor-pointer"
                  >
                    <option value="">-- Select Track --</option>
                    {tracks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title} - {t.artist} ({t.duration.toFixed(0)}s)
                      </option>
                    ))}
                  </select>
                </div>

              </div>

              {/* Lyrical Presets Selector */}
              {selectedTrackId && (
                <div className="space-y-2 pt-2">
                  <label className="text-xs text-gray-400 font-bold uppercase tracking-wider">Lyrics Overlay Style Presets:</label>
                  {templates.length === 0 ? (
                    <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/25 text-amber-300 text-sm flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <span>No styling presets exist for this track. Please create a Lyrical template on the Bulk Genres page first!</span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {templates.map((tpl) => (
                        <div
                          key={tpl.id}
                          onClick={() => handleTemplateSelect(tpl.id)}
                          className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                            selectedTemplateId === tpl.id
                              ? "bg-purple-500/10 border-purple-500/40 text-purple-300 shadow-md"
                              : "bg-[#09090f] border-white/5 text-gray-400 hover:text-white hover:border-white/10"
                          }`}
                        >
                          <div>
                            <p className="font-bold text-sm">{tpl.templateName}</p>
                            <p className="text-[10px] text-gray-500 font-mono mt-0.5">{tpl.fontFamily} - {tpl.fontSize}px</p>
                          </div>
                          {selectedTemplateId === tpl.id && (
                            <div className="w-5 h-5 rounded-full bg-purple-500 text-white flex items-center justify-center flex-shrink-0">
                              <Check className="w-3 h-3" />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Video Specifications & Mixing Settings Card */}
            <div className="bg-[#0c0c14] border border-white/5 rounded-3xl p-6 shadow-2xl space-y-6">
              <h2 className="text-lg font-bold text-white flex items-center gap-2 border-b border-white/5 pb-3">
                <Sliders className="w-4 h-4 text-purple-400" />
                Step 2: Video Composition Details
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                
                {/* Duration Slider */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-gray-400 font-bold uppercase tracking-wider">Target Video Duration:</label>
                    <span className="text-sm font-bold text-amber-400">{targetDuration} seconds</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="60"
                    step="1"
                    value={targetDuration}
                    onChange={(e) => setTargetDuration(parseInt(e.target.value))}
                    className="w-full h-1.5 bg-[#0f0f18] border border-white/5 rounded-lg appearance-none cursor-pointer accent-purple-500"
                  />
                  <p className="text-[10px] text-gray-500 leading-normal">
                    Clips will merge randomly to match target duration. Random variance of up to ±2 seconds is applied to each output for TikTok uniqueness (e.g. {targetDuration - 2}-{targetDuration + 2}s).
                  </p>
                </div>

                {/* Videos count per account */}
                <div className="space-y-4">
                  <label className="text-xs text-gray-400 font-bold uppercase tracking-wider block">Videos Per Selected Account:</label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={videosPerAccount}
                    onChange={(e) => setVideosPerAccount(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full bg-[#0f0f18] border border-white/5 rounded-xl px-4 py-3 text-white font-semibold text-sm focus:outline-none focus:border-purple-500 transition-all"
                  />
                  <p className="text-[10px] text-gray-500">
                    Each account will receive a completely distinct, uniquely sliced randomized clip mashup.
                  </p>
                </div>

              </div>

              {/* Mute Audio Option */}
              <div className="p-4 rounded-2xl bg-[#09090f] border border-white/5 flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-xl border ${muteAudio ? "bg-red-500/10 border-red-500/20 text-red-400" : "bg-purple-500/10 border-purple-500/20 text-purple-400"}`}>
                    {muteAudio ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">Mute Background Music</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      Outputs a silent audio track. Use this to overlay the music directly on the TikTok publishing app.
                    </p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={muteAudio}
                    onChange={(e) => setMuteAudio(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-300 after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                </label>
              </div>

            </div>

          </div>

          {/* Accounts checklist & trigger */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-[#0c0c14] border border-white/5 rounded-3xl p-6 shadow-2xl flex flex-col h-full min-h-[450px]">
              
              <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-4">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Users className="w-4 h-4 text-purple-400" />
                  Accounts Checklist
                </h2>
                <div className="flex gap-2">
                  <button onClick={handleSelectAllAccounts} className="text-[10px] text-purple-400 font-bold hover:underline cursor-pointer">All</button>
                  <span className="text-[10px] text-gray-600">|</span>
                  <button onClick={handleDeselectAllAccounts} className="text-[10px] text-purple-400 font-bold hover:underline cursor-pointer">None</button>
                </div>
              </div>

              {/* Accounts list */}
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-[300px]">
                {sectionAccounts.length === 0 ? (
                  <p className="text-sm text-gray-500 italic text-center py-12">No accounts in selected section.</p>
                ) : (
                  sectionAccounts.map((acc) => {
                    const selected = selectedAccountIds.includes(acc.id);
                    return (
                      <div
                        key={acc.id}
                        onClick={() => toggleSelectAccount(acc.id)}
                        className={`flex items-center justify-between p-3 rounded-xl cursor-pointer border transition-all ${
                          selected 
                            ? "bg-purple-500/10 border-purple-500/30 text-purple-300 shadow-md" 
                            : "bg-[#09090f] border-white/5 text-gray-400 hover:text-white"
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <img
                            src={acc.tiktokAvatarUrl || "https://www.tiktok.com/favicon.ico"}
                            alt={acc.tiktokUsername}
                            className="w-6 h-6 rounded-full bg-gray-800 object-cover flex-shrink-0"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = "https://www.tiktok.com/favicon.ico";
                            }}
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate">@{acc.tiktokUsername}</p>
                            <p className="text-[10px] text-gray-500 truncate">{acc.tiktokDisplayName}</p>
                          </div>
                        </div>
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 border ${
                          selected ? "bg-purple-500 border-purple-400 text-white" : "border-white/10"
                        }`}>
                          {selected && <Check className="w-3 h-3" />}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-white/5 space-y-4">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Total videos:</span>
                  <span className="font-bold text-white">{selectedAccountIds.length * videosPerAccount}</span>
                </div>
                
                <button
                  onClick={handleGenerateBatch}
                  disabled={selectedAccountIds.length === 0 || !selectedFolderId || !selectedTrackId}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold py-3 px-6 rounded-xl text-sm transition-all shadow-lg shadow-purple-600/20 disabled:from-purple-900/50 disabled:to-pink-900/50 disabled:text-gray-500 disabled:shadow-none cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  Generate Video Mixes
                </button>
              </div>

            </div>
          </div>

        </div>
      )}

      {/* TAB: BATCH PROGRESS */}
      {activeTab === "batches" && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          
          {/* Batches History List */}
          <div className="lg:col-span-1 space-y-4 bg-[#0c0c14] border border-white/5 rounded-3xl p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 border-b border-white/5 pb-3">
              <History className="w-4 h-4 text-purple-400" />
              Mixer Batches
            </h2>

            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
              {isLoadingBatches ? (
                <div className="flex items-center justify-center py-8 text-gray-500 text-sm gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-purple-500" />
                  Loading...
                </div>
              ) : batches.length === 0 ? (
                <p className="text-sm text-gray-500 py-4 italic text-center">No batches run yet</p>
              ) : (
                batches.map((b) => (
                  <div
                    key={b.id}
                    onClick={() => setActiveBatch(b)}
                    className={`p-3.5 rounded-xl cursor-pointer border transition-all text-sm relative ${
                      activeBatch?.id === b.id
                        ? "bg-purple-500/10 border-purple-500/30 text-purple-300 shadow-md"
                        : "bg-[#09090f] border-white/5 text-gray-400 hover:text-white"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full font-mono ${
                        b.status === "COMPLETED" ? "bg-green-500/15 text-green-400 border border-green-500/20" :
                        b.status === "FAILED" ? "bg-red-500/15 text-red-400 border border-red-500/20" :
                        "bg-amber-500/15 text-amber-400 border border-amber-500/20 animate-pulse"
                      }`}>
                        {b.status}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteBatch(b.id);
                        }}
                        className="text-gray-500 hover:text-red-400 transition-all p-1 hover:bg-white/5 rounded-lg"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="space-y-1 font-semibold">
                      <div className="flex items-center gap-1 text-white truncate">
                        <Folder className="w-3.5 h-3.5 text-purple-500/70" />
                        <span className="truncate">{b.folder?.name || "Clips Folder"}</span>
                      </div>
                      <div className="flex items-center gap-1 text-[11px] text-gray-400 truncate font-normal">
                        <Music className="w-3 h-3 text-purple-500/50" />
                        <span className="truncate">{b.track?.title || "Lyrics Track"}</span>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between text-[10px] text-gray-500 font-mono">
                      <span>{new Date(b.createdAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}</span>
                      <span className="bg-white/5 px-2 py-0.5 rounded font-bold">{b.totalVideos} videos</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Active Batch Details View */}
          <div className="lg:col-span-3 space-y-6">
            {activeBatch ? (
              <div className="bg-[#0c0c14] border border-white/5 rounded-3xl p-6 shadow-2xl space-y-6">
                
                {/* Header info */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-4">
                  <div>
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                      Batch Queue Details
                      <span className="text-xs font-mono text-gray-500">ID: {activeBatch.id.substring(0, 8)}</span>
                    </h3>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-gray-400">
                      <span className="flex items-center gap-1"><Folder className="w-3.5 h-3.5" /> Folder: <strong className="text-white">{activeBatch.folder?.name}</strong></span>
                      <span className="flex items-center gap-1"><Music className="w-3.5 h-3.5" /> Track: <strong className="text-white">{activeBatch.track?.title}</strong></span>
                      <span className="flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> Layout: <strong className="text-white">{activeBatch.lyricalTemplate?.templateName}</strong></span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1.5">
                    <span className={`text-xs font-bold px-3 py-1 rounded-full font-mono border ${
                      activeBatch.status === "COMPLETED" ? "bg-green-500/15 text-green-400 border-green-500/20" :
                      activeBatch.status === "FAILED" ? "bg-red-500/15 text-red-400 border-red-500/20" :
                      "bg-amber-500/15 text-amber-400 border-amber-500/20"
                    }`}>
                      {activeBatch.status === "RENDERING" ? "RENDERING IN BACKGROUND" : activeBatch.status}
                    </span>
                    <span className="text-[10px] text-gray-500 font-mono">Created {new Date(activeBatch.createdAt).toLocaleString()}</span>
                  </div>
                </div>

                {/* Progress bar */}
                {(() => {
                  const items = activeBatch.items || [];
                  const total = items.length;
                  const completed = items.filter(i => i.status === "RENDERED" || i.status === "UPLOADED").length;
                  const failed = items.filter(i => i.status === "FAILED").length;
                  const percentage = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0;

                  return (
                    <div className="space-y-2 bg-[#09090f] border border-white/5 p-4 rounded-2xl">
                      <div className="flex justify-between text-xs font-bold font-mono">
                        <span className="text-gray-400">Render Progress: {percentage}%</span>
                        <span className="text-purple-400">{completed} / {total} Completed ({failed} failed)</span>
                      </div>
                      <div className="w-full bg-gray-800 h-2.5 rounded-full overflow-hidden flex">
                        <div className="bg-purple-500 h-full transition-all duration-500" style={{ width: `${total > 0 ? (completed / total) * 100 : 0}%` }} />
                        <div className="bg-red-500 h-full transition-all duration-500" style={{ width: `${total > 0 ? (failed / total) * 100 : 0}%` }} />
                      </div>
                    </div>
                  );
                })()}

                {/* Items List */}
                <div className="space-y-3">
                  <h4 className="text-sm font-bold text-white mb-2 uppercase tracking-wider text-gray-500">Items Queue</h4>
                  <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                    {(activeBatch.items || []).map((item) => (
                      <div key={item.id} className="p-3.5 rounded-xl bg-[#09090f] border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        
                        <div className="flex items-center gap-3">
                          <img
                            src={item.account?.tiktokAvatarUrl || "https://www.tiktok.com/favicon.ico"}
                            alt={item.account?.tiktokUsername}
                            className="w-8 h-8 rounded-full bg-gray-800 object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = "https://www.tiktok.com/favicon.ico";
                            }}
                          />
                          <div>
                            <p className="text-sm font-bold text-white">@{item.account?.tiktokUsername}</p>
                            <p className="text-[10px] text-gray-500">{item.account?.tiktokDisplayName}</p>
                          </div>
                        </div>

                        <div className="flex flex-col sm:items-end gap-1 font-mono">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border self-start sm:self-auto ${
                            item.status === "RENDERED" ? "bg-green-500/10 text-green-400 border-green-500/20" :
                            item.status === "FAILED" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                            item.status === "RENDERING" ? "bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse" :
                            "bg-gray-800 text-gray-400 border-transparent"
                          }`}>
                            {item.status}
                          </span>
                          {item.errorMessage && (
                            <p className="text-[10px] text-red-400 max-w-[280px] text-left sm:text-right mt-1 truncate" title={item.errorMessage}>
                              {item.errorMessage}
                            </p>
                          )}
                        </div>

                        {item.status === "RENDERED" && item.renderedVideoUrl && (
                          <div className="flex items-center gap-2 self-end sm:self-auto">
                            <button
                              onClick={() => setPreviewVideoUrl(item.renderedVideoUrl)}
                              className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-white font-bold py-1.5 px-3 rounded-lg text-xs transition-all border border-white/5 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              Watch
                            </button>
                            <a
                              href={item.renderedVideoUrl}
                              download={`render_${item.id}.mp4`}
                              className="flex items-center gap-1.5 bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 font-bold py-1.5 px-3 rounded-lg text-xs transition-all border border-purple-500/20 cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" />
                              Download
                            </a>
                          </div>
                        )}

                      </div>
                    ))}
                  </div>
                </div>

              </div>
            ) : (
              <div className="bg-[#0c0c14] border border-white/5 rounded-3xl p-16 text-center shadow-2xl">
                <Sparkles className="w-16 h-16 text-gray-700 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-white">No Batch Selected</h2>
                <p className="text-sm text-gray-500 mt-2 max-w-sm mx-auto">
                  Please select a Mixer Batch run from the sidebar timeline to check its sequential rendering progress and download output videos.
                </p>
              </div>
            )}
          </div>

        </div>
      )}

      {/* Video Preview Modal overlay */}
      {previewVideoUrl && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="relative w-full max-w-sm aspect-[9/16] bg-[#0c0c14] border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col">
            <button
              onClick={() => setPreviewVideoUrl(null)}
              className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center border border-white/10 hover:bg-black/80 transition-all cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex-1 bg-black">
              <video
                src={previewVideoUrl}
                className="w-full h-full object-contain"
                controls
                autoPlay
                loop
              />
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
