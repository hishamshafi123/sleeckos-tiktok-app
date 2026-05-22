"use client";

import { useState, useEffect, useRef } from "react";
import { 
  Sparkles, Music, Sliders, Play, Pause, Trash2, Plus, 
  Upload, Film, CheckCircle2, AlertCircle, RefreshCw, ChevronRight, Check, X
} from "lucide-react";
import { toast } from "sonner";

// Tabs Enum
type TabType = "tracks" | "accounts" | "batches";

interface Track {
  id: string;
  title: string;
  artist: string;
  fileUrl: string;
  duration: number;
  defaultStart: number;
  defaultDuration: number;
  createdAt: string;
}

interface BackgroundVideo {
  id: string;
  videoUrl: string;
  createdAt: string;
}

interface GenreConfig {
  id: string;
  themeText: string;
  fontFamily: string;
  fontSize: number;
  fontColor: string;
  textCase: string;
  boxColor: string;
  shadowColor: string;
  lineSpacing: number;
}

interface Account {
  id: string;
  tiktokUsername: string;
  tiktokDisplayName: string;
  tiktokAvatarUrl: string;
  driveFolderId: string | null;
  driveFolderName: string | null;
  group: { name: string } | null;
  genreConfigs: GenreConfig[];
  backgroundVideos: BackgroundVideo[];
}

interface Batch {
  id: string;
  genre: string;
  status: "DRAFT" | "QUOTES_GENERATING" | "QUOTES_REVIEW" | "RENDERING" | "COMPLETED" | "FAILED";
  totalPosts: number;
  postsPerAccount: number;
  audioReuseMax: number;
  videoLength: number;
  createdAt: string;
}

interface BatchItem {
  id: string;
  quoteText: string;
  quoteAuthor: string | null;
  status: "PENDING" | "GENERATED" | "CONFIRMED" | "RENDERING" | "RENDERED" | "UPLOADED" | "FAILED";
  errorMessage: string | null;
  backgroundVideoUrl: string;
  driveFileId: string | null;
  account: {
    tiktokUsername: string;
    tiktokAvatarUrl: string;
  };
  track: {
    title: string;
    artist: string;
  };
}

export default function GenresDashboard() {
  const [activeTab, setActiveTab] = useState<TabType>("accounts");

  // State pools
  const [tracks, setTracks] = useState<Track[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  
  // Loading states
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingBatches, setLoadingBatches] = useState(false);

  // Selected Account state
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const selectedAccount = accounts.find(a => a.id === selectedAccountId);

  // 1. Tracks Library State
  const [trackTitle, setTrackTitle] = useState("");
  const [trackArtist, setTrackArtist] = useState("");
  const [trackStart, setTrackStart] = useState("0");
  const [trackDuration, setTrackDuration] = useState("7");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [uploadingTrack, setUploadingTrack] = useState(false);
  
  // Audio Player State
  const [playingTrackId, setPlayingTrackId] = useState<string | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // 2. Account Settings Form State
  const [themeText, setThemeText] = useState("");
  const [fontFamily, setFontFamily] = useState("Outfit-Bold");
  const [fontSize, setFontSize] = useState(44);
  const [fontColor, setFontColor] = useState("#FFFFFF");
  const [textCase, setTextCase] = useState("UPPERCASE");
  const [boxColor, setBoxColor] = useState("black@0.4");
  const [shadowColor, setShadowColor] = useState("black@0.6");
  const [lineSpacing, setLineSpacing] = useState(10);
  const [uploadingBg, setUploadingBg] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  // 3. Batch Wizard State
  const [wizardStep, setWizardStep] = useState(1);
  const [batchPostsTotal, setBatchPostsTotal] = useState(10);
  const [postsPerAccount, setPostsPerAccount] = useState(2);
  const [videoLength, setVideoLength] = useState(7.0);
  const [selectedBatchAccountIds, setSelectedBatchAccountIds] = useState<string[]>([]);
  const [activeBatch, setActiveBatch] = useState<(Batch & { items?: BatchItem[] }) | null>(null);
  const [generatingQuotes, setGeneratingQuotes] = useState(false);
  
  // Batch review edits
  const [reviewItems, setReviewItems] = useState<BatchItem[]>([]);
  const [savingReview, setSavingReview] = useState(false);

  // Batch Audio Pool selection
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>([]);
  const [audioReuseMax, setAudioReuseMax] = useState(2);
  const [triggeringRender, setTriggeringRender] = useState(false);

  // Fetch initial data
  useEffect(() => {
    fetchTracks();
    fetchAccounts();
    fetchBatches();
  }, []);

  // Set default form values when account selection changes
  useEffect(() => {
    if (selectedAccount) {
      const config = selectedAccount.genreConfigs[0];
      setThemeText(config?.themeText || "");
      setFontFamily(config?.fontFamily || "Outfit-Bold");
      setFontSize(config?.fontSize || 44);
      setFontColor(config?.fontColor || "#FFFFFF");
      setTextCase(config?.textCase || "UPPERCASE");
      setBoxColor(config?.boxColor || "black@0.4");
      setShadowColor(config?.shadowColor || "black@0.6");
      setLineSpacing(config?.lineSpacing || 10);
    } else {
      setThemeText("");
    }
  }, [selectedAccountId, accounts]);

  // Audio Playback helper
  const togglePlayTrack = (track: Track) => {
    if (playingTrackId === track.id) {
      audioPlayerRef.current?.pause();
      setPlayingTrackId(null);
    } else {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.src = track.fileUrl;
        audioPlayerRef.current.currentTime = track.defaultStart;
        audioPlayerRef.current.play();
        setPlayingTrackId(track.id);
      }
    }
  };

  // Poll progress if a batch is currently rendering
  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    if (activeBatch && (activeBatch.status === "RENDERING" || activeBatch.status === "QUOTES_GENERATING")) {
      intervalId = setInterval(async () => {
        try {
          const res = await fetch(`/api/managed/genres/batches?batchId=${activeBatch.id}`);
          if (res.ok) {
            const data = await res.json();
            setActiveBatch(data);
            if (data.status === "COMPLETED" || data.status === "FAILED") {
              toast.success(`Batch rendering queue ended: ${data.status}`);
              fetchBatches();
            }
          }
        } catch (err) {
          console.error("Error polling batch:", err);
        }
      }, 2000);
    }
    return () => clearInterval(intervalId);
  }, [activeBatch]);

  // APIs calling helpers
  const fetchTracks = async () => {
    setLoadingTracks(true);
    try {
      const res = await fetch("/api/managed/genres/tracks");
      if (res.ok) setTracks(await res.json());
    } catch {
      toast.error("Failed to load music tracks");
    } finally {
      setLoadingTracks(false);
    }
  };

  const fetchAccounts = async () => {
    setLoadingAccounts(true);
    try {
      const res = await fetch("/api/managed/genres/accounts");
      if (res.ok) {
        const data = await res.json();
        setAccounts(data);
        if (data.length > 0 && !selectedAccountId) {
          setSelectedAccountId(data[0].id);
        }
      }
    } catch {
      toast.error("Failed to load accounts config");
    } finally {
      setLoadingAccounts(false);
    }
  };

  const fetchBatches = async () => {
    setLoadingBatches(true);
    try {
      const res = await fetch("/api/managed/genres/batches");
      if (res.ok) setBatches(await res.json());
    } catch {
      toast.error("Failed to load batch history");
    } finally {
      setLoadingBatches(false);
    }
  };

  // Tracks Actions
  const handleUploadTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!audioFile || !trackTitle || !trackArtist) {
      toast.error("Please fill in all track details and select a file");
      return;
    }

    setUploadingTrack(true);
    const data = new FormData();
    data.append("audioFile", audioFile);
    data.append("title", trackTitle);
    data.append("artist", trackArtist);
    data.append("defaultStart", trackStart);
    data.append("defaultDuration", trackDuration);

    // Read audio duration using browser capabilities
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const arrayBuffer = await audioFile.arrayBuffer();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      data.append("duration", audioBuffer.duration.toString());
    } catch (err) {
      console.warn("Failed to extract duration, letting fallback handle it", err);
    }

    try {
      const res = await fetch("/api/managed/genres/tracks", {
        method: "POST",
        body: data,
      });

      if (res.ok) {
        toast.success("Music track uploaded successfully");
        setTrackTitle("");
        setTrackArtist("");
        setTrackStart("0");
        setTrackDuration("7");
        setAudioFile(null);
        fetchTracks();
      } else {
        const errData = await res.json();
        toast.error(errData.error || "Upload failed");
      }
    } catch {
      toast.error("Network error during track upload");
    } finally {
      setUploadingTrack(false);
    }
  };

  const handleDeleteTrack = async (id: string) => {
    if (!confirm("Are you sure you want to delete this audio track?")) return;
    try {
      const res = await fetch(`/api/managed/genres/tracks?id=${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("Track deleted");
        fetchTracks();
      } else {
        toast.error("Failed to delete track");
      }
    } catch {
      toast.error("Network error deleting track");
    }
  };

  // Configurations Actions
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccountId) return;

    setSavingConfig(true);
    const data = new FormData();
    data.append("accountId", selectedAccountId);
    data.append("themeText", themeText);
    data.append("fontFamily", fontFamily);
    data.append("fontSize", fontSize.toString());
    data.append("fontColor", fontColor);
    data.append("textCase", textCase);
    data.append("boxColor", boxColor);
    data.append("shadowColor", shadowColor);
    data.append("lineSpacing", lineSpacing.toString());

    try {
      const res = await fetch("/api/managed/genres/accounts", {
        method: "POST",
        body: data,
      });
      if (res.ok) {
        toast.success("Aesthetic styling settings updated");
        fetchAccounts();
      } else {
        toast.error("Failed to save configuration settings");
      }
    } catch {
      toast.error("Network error saving configs");
    } finally {
      setSavingConfig(false);
    }
  };

  const handleUploadBg = async (file: File) => {
    if (!selectedAccountId) return;
    setUploadingBg(true);

    const data = new FormData();
    data.append("accountId", selectedAccountId);
    data.append("videoFile", file);

    try {
      const res = await fetch("/api/managed/genres/accounts", {
        method: "POST",
        body: data,
      });
      if (res.ok) {
        toast.success("Background video loop uploaded successfully");
        fetchAccounts();
      } else {
        toast.error("Failed to upload loop");
      }
    } catch {
      toast.error("Error uploading background");
    } finally {
      setUploadingBg(false);
    }
  };

  const handleDeleteBg = async (videoId: string) => {
    if (!confirm("Are you sure you want to delete this background loop?")) return;
    try {
      const res = await fetch(`/api/managed/genres/accounts?deleteVideoId=${videoId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("Background video removed");
        fetchAccounts();
      } else {
        toast.error("Failed to remove background");
      }
    } catch {
      toast.error("Error removing background");
    }
  };

  // Batch Compositing Actions
  const handleStartQuoteGeneration = async () => {
    if (selectedBatchAccountIds.length === 0) {
      toast.error("Please select at least one TikTok account for the batch");
      return;
    }

    setGeneratingQuotes(true);
    try {
      const res = await fetch("/api/managed/genres/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "GENERATE_QUOTES",
          accountIds: selectedBatchAccountIds,
          postsPerAccount,
          videoLength,
        }),
      });

      if (res.ok) {
        const batchData = await res.json();
        setActiveBatch(batchData);
        setReviewItems(batchData.items || []);
        setWizardStep(2);
        toast.success("Quotes bulk generated successfully via Gemini API");
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to generate quotes");
      }
    } catch {
      toast.error("Network error generating quotes");
    } finally {
      setGeneratingQuotes(false);
    }
  };

  const handleSaveReviewEdits = async () => {
    if (!activeBatch) return;
    setSavingReview(true);

    try {
      const res = await fetch("/api/managed/genres/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "UPDATE_QUOTES",
          batchId: activeBatch.id,
          items: reviewItems.map(item => ({
            id: item.id,
            quoteText: item.quoteText,
            quoteAuthor: item.quoteAuthor,
          })),
        }),
      });

      if (res.ok) {
        toast.success("Quote edits saved successfully");
        setWizardStep(3);
      } else {
        toast.error("Failed to save edits");
      }
    } catch {
      toast.error("Error saving edits");
    } finally {
      setSavingReview(false);
    }
  };

  const handleStartCompositionRendering = async () => {
    if (!activeBatch) return;
    if (selectedTrackIds.length === 0) {
      toast.error("Please select at least one track for the audio pool");
      return;
    }

    setTriggeringRender(true);
    try {
      const res = await fetch("/api/managed/genres/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "START_RENDERING",
          batchId: activeBatch.id,
          trackIds: selectedTrackIds,
          audioReuseMax,
        }),
      });

      if (res.ok) {
        toast.success("Rendering composition queue triggered successfully");
        setWizardStep(4);
        // Refresh active batch to watch progress
        const statusRes = await fetch(`/api/managed/genres/batches?batchId=${activeBatch.id}`);
        if (statusRes.ok) setActiveBatch(await statusRes.json());
      } else {
        toast.error("Failed to start composition");
      }
    } catch {
      toast.error("Error starting composition");
    } finally {
      setTriggeringRender(false);
    }
  };

  // Rendering statistics
  const getRenderStats = () => {
    if (!activeBatch?.items) return { total: 0, completed: 0, failed: 0, percent: 0 };
    const items = activeBatch.items;
    const total = items.length;
    const completed = items.filter(i => i.status === "UPLOADED").length;
    const failed = items.filter(i => i.status === "FAILED").length;
    const percent = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0;
    return { total, completed, failed, percent };
  };

  return (
    <div className="space-y-8 text-gray-200 pb-16">
      <audio ref={audioPlayerRef} className="hidden" onEnded={() => setPlayingTrackId(null)} />
      
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-white/5 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <Sparkles className="w-8 h-8 text-amber-500 animate-pulse" />
            <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-amber-400 via-amber-200 to-purple-400 bg-clip-text text-transparent">
              Genres: Bulk Quote Video Composer
            </h1>
          </div>
          <p className="text-gray-400 text-sm mt-1">
            Configure visual styling, music libraries, upload background loops, and bulk render quotes with AI.
          </p>
        </div>

        {/* Tab Selector */}
        <div className="flex bg-[#0f0f18] p-1 rounded-2xl border border-white/5 shadow-inner">
          <button
            onClick={() => setActiveTab("accounts")}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 ${
              activeTab === "accounts" 
                ? "bg-gradient-to-r from-amber-500/20 to-purple-500/20 text-amber-400 border border-amber-500/30 shadow-lg shadow-amber-500/5 backdrop-blur-md" 
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Sliders className="w-4 h-4" />
            Accounts Config
          </button>
          <button
            onClick={() => setActiveTab("tracks")}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 ${
              activeTab === "tracks" 
                ? "bg-gradient-to-r from-amber-500/20 to-purple-500/20 text-amber-400 border border-amber-500/30 shadow-lg shadow-amber-500/5 backdrop-blur-md" 
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Music className="w-4 h-4" />
            Tracks Library
          </button>
          <button
            onClick={() => setActiveTab("batches")}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 ${
              activeTab === "batches" 
                ? "bg-gradient-to-r from-amber-500/20 to-purple-500/20 text-amber-400 border border-amber-500/30 shadow-lg shadow-amber-500/5 backdrop-blur-md" 
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Sparkles className="w-4 h-4" />
            Composer Wizard
          </button>
        </div>
      </div>

      {/* ────────────────────────────────────────────────────────────────────────
          TAB: TRACKS LIBRARY
      ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === "tracks" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Uploader Form */}
          <div className="lg:col-span-1 bg-[#0d0d16] border border-white/5 p-6 rounded-3xl shadow-xl space-y-6">
            <h2 className="text-xl font-bold flex items-center gap-2 text-amber-300">
              <Plus className="w-5 h-5 text-amber-500" />
              Add Audio Track
            </h2>
            
            <form onSubmit={handleUploadTrack} className="space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-wider font-bold text-gray-400 mb-2">
                  Track Title
                </label>
                <input
                  type="text"
                  placeholder="e.g. Solitude"
                  value={trackTitle}
                  onChange={(e) => setTrackTitle(e.target.value)}
                  className="w-full bg-[#141423] border border-white/5 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30"
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider font-bold text-gray-400 mb-2">
                  Artist / Producer
                </label>
                <input
                  type="text"
                  placeholder="e.g. M83"
                  value={trackArtist}
                  onChange={(e) => setTrackArtist(e.target.value)}
                  className="w-full bg-[#141423] border border-white/5 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs uppercase tracking-wider font-bold text-gray-400 mb-2">
                    Start Trim (s)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={trackStart}
                    onChange={(e) => setTrackStart(e.target.value)}
                    className="w-full bg-[#141423] border border-white/5 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30"
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-wider font-bold text-gray-400 mb-2">
                    Duration (s)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={trackDuration}
                    onChange={(e) => setTrackDuration(e.target.value)}
                    className="w-full bg-[#141423] border border-white/5 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider font-bold text-gray-400 mb-2">
                  Audio MP3 File
                </label>
                <div className="relative border border-dashed border-white/10 hover:border-amber-500/30 rounded-2xl bg-[#141423] p-4 text-center cursor-pointer transition-all duration-300">
                  <input
                    type="file"
                    accept="audio/mp3, audio/mpeg"
                    onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div className="flex flex-col items-center space-y-2">
                    <Upload className="w-8 h-8 text-gray-500" />
                    <span className="text-sm font-semibold text-gray-400">
                      {audioFile ? audioFile.name : "Select MP3 Track"}
                    </span>
                    <span className="text-xs text-gray-600">Max size 20MB</span>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={uploadingTrack}
                className="w-full bg-gradient-to-r from-amber-500 to-purple-600 hover:from-amber-600 hover:to-purple-700 text-white font-bold py-3.5 px-6 rounded-2xl transition-all duration-300 flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploadingTrack ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    Uploading Audio...
                  </>
                ) : (
                  <>
                    <Upload className="w-5 h-5" />
                    Upload to Library
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Tracks List */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2 text-gray-300">
              <Music className="w-5 h-5 text-purple-400" />
              Library Music Tracks ({tracks.length})
            </h2>

            {loadingTracks ? (
              <div className="flex justify-center items-center py-24">
                <RefreshCw className="w-8 h-8 text-amber-500 animate-spin" />
              </div>
            ) : tracks.length === 0 ? (
              <div className="bg-[#0d0d16] border border-white/5 p-12 text-center rounded-3xl">
                <p className="text-gray-500 text-sm">No tracks uploaded in the library yet. Start by uploading one!</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {tracks.map((track) => (
                  <div 
                    key={track.id} 
                    className={`bg-[#0d0d16] border rounded-3xl p-5 flex flex-col justify-between space-y-4 transition-all duration-300 ${
                      playingTrackId === track.id ? "border-amber-500/40 shadow-lg shadow-amber-500/5 bg-[#141221]" : "border-white/5 hover:border-white/10"
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <h3 className="font-bold text-white text-base leading-tight">{track.title}</h3>
                        <p className="text-xs text-gray-400 font-medium">{track.artist}</p>
                      </div>
                      <button
                        onClick={() => handleDeleteTrack(track.id)}
                        className="text-gray-600 hover:text-red-400 p-2 hover:bg-red-400/10 rounded-xl transition-all duration-300"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="bg-[#141423] p-3 rounded-2xl flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => togglePlayTrack(track)}
                          className="bg-amber-500/15 hover:bg-amber-500 text-amber-400 hover:text-black p-3 rounded-xl transition-all duration-300"
                        >
                          {playingTrackId === track.id ? (
                            <Pause className="w-4 h-4 fill-current" />
                          ) : (
                            <Play className="w-4 h-4 fill-current" />
                          )}
                        </button>
                        <div className="text-xs space-y-0.5">
                          <p className="text-gray-400 font-semibold">Trim Config</p>
                          <p className="text-gray-500 font-medium">
                            Start: <span className="text-amber-400">{track.defaultStart}s</span> | Duration: <span className="text-purple-400">{track.defaultDuration}s</span>
                          </p>
                        </div>
                      </div>

                      <div className="text-right text-xs">
                        <p className="text-gray-500 font-medium">Total Length</p>
                        <p className="text-white font-bold">{track.duration.toFixed(1)}s</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────────
          TAB: ACCOUNTS CONFIGURATION
      ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === "accounts" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Accounts Grid Picker */}
          <div className="lg:col-span-1 space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2 text-gray-300">
              <Film className="w-5 h-5 text-purple-400" />
              TikTok Accounts
            </h2>

            {loadingAccounts ? (
              <div className="flex justify-center items-center py-24">
                <RefreshCw className="w-8 h-8 text-amber-500 animate-spin" />
              </div>
            ) : accounts.length === 0 ? (
              <div className="bg-[#0d0d16] border border-white/5 p-12 text-center rounded-3xl">
                <p className="text-gray-500 text-sm">No managed accounts linked. Link accounts under Manage accounts panel first.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {accounts.map((acc) => {
                  const hasConfig = acc.genreConfigs.length > 0;
                  const bgCount = acc.backgroundVideos.length;
                  const active = selectedAccountId === acc.id;

                  return (
                    <button
                      key={acc.id}
                      onClick={() => setSelectedAccountId(acc.id)}
                      className={`w-full text-left bg-[#0d0d16] border p-4 rounded-3xl transition-all duration-300 flex items-center justify-between gap-4 ${
                        active 
                          ? "border-amber-500/40 shadow-lg shadow-amber-500/5 bg-[#141221]" 
                          : "border-white/5 hover:border-white/10 hover:bg-white/[0.02]"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <img 
                          src={acc.tiktokAvatarUrl || "https://www.tiktok.com/favicon.ico"} 
                          alt={acc.tiktokUsername} 
                          className="w-11 h-11 rounded-full border border-white/10 bg-white/5 object-cover"
                        />
                        <div className="space-y-0.5">
                          <h3 className="font-bold text-white text-sm">@{acc.tiktokUsername}</h3>
                          <p className="text-xs text-gray-500 font-medium">
                            {acc.group?.name || "No Group"}
                          </p>
                        </div>
                      </div>

                      <div className="text-right space-y-1">
                        {hasConfig ? (
                          <span className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-green-500/10 text-green-400 border border-green-500/15 rounded-md">
                            Configured
                          </span>
                        ) : (
                          <span className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/15 rounded-md">
                            No Config
                          </span>
                        )}
                        <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">
                          {bgCount} backgrounds
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Selected Account Configurations & Backgrounds */}
          <div className="lg:col-span-2 space-y-8">
            {selectedAccount ? (
              <>
                {/* Visual Settings Form */}
                <div className="bg-[#0d0d16] border border-white/5 p-6 rounded-3xl shadow-xl space-y-6">
                  <div className="flex justify-between items-center border-b border-white/5 pb-4">
                    <div className="flex items-center gap-3">
                      <img 
                        src={selectedAccount.tiktokAvatarUrl} 
                        className="w-10 h-10 rounded-full object-cover border border-white/10"
                        alt=""
                      />
                      <div>
                        <h2 className="text-xl font-bold text-white">@{selectedAccount.tiktokUsername} Aesthetics</h2>
                        <p className="text-xs text-gray-400 font-medium">Style Configuration for the Quote Genre</p>
                      </div>
                    </div>
                  </div>

                  <form onSubmit={handleSaveConfig} className="space-y-6">
                    <div>
                      <label className="block text-xs uppercase tracking-wider font-bold text-gray-400 mb-2">
                        Account Theme / Topic Prompt (Gemini AI context)
                      </label>
                      <textarea
                        rows={3}
                        placeholder="e.g. Daily motivational quote, stoic wisdom for men, self discipline advice, ancient philosophy..."
                        value={themeText}
                        onChange={(e) => setThemeText(e.target.value)}
                        className="w-full bg-[#141423] border border-white/5 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30"
                      />
                      <p className="text-[11px] text-gray-500 mt-1.5 font-medium">
                        Used to bulk generate original, context-aligned quotes via Gemini API.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      
                      {/* Font Family */}
                      <div>
                        <label className="block text-xs uppercase tracking-wider font-bold text-gray-400 mb-2">
                          Font Family
                        </label>
                        <select
                          value={fontFamily}
                          onChange={(e) => setFontFamily(e.target.value)}
                          className="w-full bg-[#141423] border border-white/5 rounded-2xl px-4 py-3.5 text-sm text-white focus:outline-none focus:border-amber-500/50"
                        >
                          <option value="Outfit-Bold">Outfit Bold (Modern, Rounded)</option>
                          <option value="Inter-Bold">Inter Bold (Sleek, Clean Sans)</option>
                          <option value="PlayfairDisplay-Bold">Playfair Display Bold (Premium Serif)</option>
                          <option value="GreatVibes-Regular">Great Vibes (Elegant Script/Cursive)</option>
                        </select>
                      </div>

                      {/* Font Size */}
                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <label className="block text-xs uppercase tracking-wider font-bold text-gray-400">
                            Font Size (px)
                          </label>
                          <span className="text-xs font-extrabold text-amber-400">{fontSize}px</span>
                        </div>
                        <input
                          type="range"
                          min="24"
                          max="72"
                          value={fontSize}
                          onChange={(e) => setFontSize(parseInt(e.target.value))}
                          className="w-full h-1.5 bg-[#141423] rounded-lg appearance-none cursor-pointer accent-amber-500"
                        />
                      </div>

                      {/* Font Color Picker */}
                      <div>
                        <label className="block text-xs uppercase tracking-wider font-bold text-gray-400 mb-2">
                          Font Color (HEX or Quick Pick)
                        </label>
                        <div className="flex gap-2 mb-2">
                          <button
                            type="button"
                            onClick={() => setFontColor("#FFFFFF")}
                            className="w-6 h-6 rounded-full bg-white border border-white/10"
                            title="Pure White"
                          />
                          <button
                            type="button"
                            onClick={() => setFontColor("#FEF08A")}
                            className="w-6 h-6 rounded-full bg-yellow-200 border border-white/10"
                            title="Pale Yellow"
                          />
                          <button
                            type="button"
                            onClick={() => setFontColor("#FDE047")}
                            className="w-6 h-6 rounded-full bg-yellow-400 border border-white/10"
                            title="Vibrant Yellow"
                          />
                          <button
                            type="button"
                            onClick={() => setFontColor("#F5F5F7")}
                            className="w-6 h-6 rounded-full bg-[#f5f5f7] border border-white/10"
                            title="Cream Grey"
                          />
                        </div>
                        <input
                          type="text"
                          value={fontColor}
                          onChange={(e) => setFontColor(e.target.value)}
                          placeholder="#FFFFFF"
                          className="w-full bg-[#141423] border border-white/5 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-amber-500/50"
                        />
                      </div>

                      {/* Text Casing */}
                      <div>
                        <label className="block text-xs uppercase tracking-wider font-bold text-gray-400 mb-2">
                          Text Casing
                        </label>
                        <select
                          value={textCase}
                          onChange={(e) => setTextCase(e.target.value)}
                          className="w-full bg-[#141423] border border-white/5 rounded-2xl px-4 py-3.5 text-sm text-white focus:outline-none"
                        >
                          <option value="UPPERCASE">UPPERCASE</option>
                          <option value="Title Case">Title Case / Capitalize</option>
                          <option value="lowercase">lowercase</option>
                          <option value="None">As Written / None</option>
                        </select>
                      </div>

                      {/* Line Spacing */}
                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <label className="block text-xs uppercase tracking-wider font-bold text-gray-400">
                            Line Spacing (px)
                          </label>
                          <span className="text-xs font-extrabold text-purple-400">{lineSpacing}px</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="40"
                          value={lineSpacing}
                          onChange={(e) => setLineSpacing(parseInt(e.target.value))}
                          className="w-full h-1.5 bg-[#141423] rounded-lg appearance-none cursor-pointer accent-purple-500"
                        />
                      </div>

                      {/* Card Overlay Box Color */}
                      <div>
                        <label className="block text-xs uppercase tracking-wider font-bold text-gray-400 mb-2">
                          Text Background Card Opacity
                        </label>
                        <select
                          value={boxColor}
                          onChange={(e) => setBoxColor(e.target.value)}
                          className="w-full bg-[#141423] border border-white/5 rounded-2xl px-4 py-3.5 text-sm text-white focus:outline-none"
                        >
                          <option value="none">No Background Card / Clear</option>
                          <option value="black@0.2">Light Shadow Overlay (20%)</option>
                          <option value="black@0.4">Standard Overlay (40%)</option>
                          <option value="black@0.6">Deep Contrast Overlay (60%)</option>
                          <option value="black@0.8">Heavy Dark Card (80%)</option>
                        </select>
                      </div>

                      {/* Drop Shadow Color */}
                      <div>
                        <label className="block text-xs uppercase tracking-wider font-bold text-gray-400 mb-2">
                          Text Drop Shadow Opacity
                        </label>
                        <select
                          value={shadowColor}
                          onChange={(e) => setShadowColor(e.target.value)}
                          className="w-full bg-[#141423] border border-white/5 rounded-2xl px-4 py-3.5 text-sm text-white focus:outline-none"
                        >
                          <option value="none">No Drop Shadow</option>
                          <option value="black@0.4">Light Drop Shadow</option>
                          <option value="black@0.6">Standard Shadow</option>
                          <option value="black@0.8">Heavy Soft Glow Shadow</option>
                        </select>
                      </div>

                    </div>

                    <button
                      type="submit"
                      disabled={savingConfig}
                      className="bg-amber-500 hover:bg-amber-600 text-black font-extrabold px-6 py-3.5 rounded-2xl transition-all duration-300 shadow-lg disabled:opacity-50"
                    >
                      {savingConfig ? "Saving Config..." : "Save Aesthetics Settings"}
                    </button>
                  </form>
                </div>

                {/* Account Video Backgrounds */}
                <div className="bg-[#0d0d16] border border-white/5 p-6 rounded-3xl shadow-xl space-y-6">
                  <div>
                    <h3 className="text-lg font-bold text-white">Background Loop Gallery ({selectedAccount.backgroundVideos.length})</h3>
                    <p className="text-xs text-gray-400 mt-0.5">Upload vertical MP4 background loops for quote overlays</p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {/* Upload button card */}
                    <div className="relative border border-dashed border-white/10 hover:border-amber-500/30 bg-[#141423] aspect-[9/16] rounded-2xl flex flex-col items-center justify-center p-3 text-center cursor-pointer transition-all duration-300">
                      <input
                        type="file"
                        accept="video/mp4"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUploadBg(file);
                        }}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        disabled={uploadingBg}
                      />
                      {uploadingBg ? (
                        <>
                          <RefreshCw className="w-8 h-8 text-amber-500 animate-spin mb-2" />
                          <span className="text-xs text-gray-400 font-bold">Uploading MP4...</span>
                        </>
                      ) : (
                        <>
                          <Upload className="w-8 h-8 text-gray-500 mb-2" />
                          <span className="text-xs text-gray-400 font-bold">Upload Vertical MP4</span>
                          <span className="text-[10px] text-gray-600 mt-1">9:16 vertical crop</span>
                        </>
                      )}
                    </div>

                    {selectedAccount.backgroundVideos.map((bg) => (
                      <div key={bg.id} className="relative aspect-[9/16] rounded-2xl overflow-hidden border border-white/5 group bg-black">
                        <video
                          src={bg.videoUrl}
                          className="w-full h-full object-cover"
                          muted
                          loop
                          playsInline
                          onMouseOver={(e) => (e.target as HTMLVideoElement).play()}
                          onMouseOut={(e) => (e.target as HTMLVideoElement).pause()}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 flex flex-col justify-end p-3">
                          <button
                            onClick={() => handleDeleteBg(bg.id)}
                            className="bg-red-500/95 hover:bg-red-600 text-white p-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete
                          </button>
                        </div>
                        <div className="absolute top-2 left-2 bg-black/60 px-2 py-0.5 rounded text-[10px] font-medium text-gray-300">
                          Loop
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-[#0d0d16] border border-white/5 p-24 text-center rounded-3xl">
                <p className="text-gray-500">Please select an active TikTok account from the left panel.</p>
              </div>
            )}
          </div>

        </div>
      )}

      {/* ────────────────────────────────────────────────────────────────────────
          TAB: COMPOSER WIZARD
      ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === "batches" && (
        <div className="bg-[#0d0d16] border border-white/5 p-8 rounded-3xl shadow-xl space-y-8">
          
          {/* Steps Indicator */}
          <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-[#141423] p-4 rounded-3xl border border-white/5">
            <div className="flex items-center gap-2">
              <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
                wizardStep >= 1 ? "bg-amber-500 text-black shadow-lg shadow-amber-500/20" : "bg-gray-800 text-gray-500"
              }`}>1</span>
              <span className={`text-sm font-bold ${wizardStep >= 1 ? "text-white" : "text-gray-500"}`}>Quantities</span>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-600 hidden md:block" />
            
            <div className="flex items-center gap-2">
              <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
                wizardStep >= 2 ? "bg-amber-500 text-black shadow-lg shadow-amber-500/20" : "bg-gray-800 text-gray-500"
              }`}>2</span>
              <span className={`text-sm font-bold ${wizardStep >= 2 ? "text-white" : "text-gray-500"}`}>Quotes Review</span>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-600 hidden md:block" />

            <div className="flex items-center gap-2">
              <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
                wizardStep >= 3 ? "bg-amber-500 text-black shadow-lg shadow-amber-500/20" : "bg-gray-800 text-gray-500"
              }`}>3</span>
              <span className={`text-sm font-bold ${wizardStep >= 3 ? "text-white" : "text-gray-500"}`}>Audio Pool</span>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-600 hidden md:block" />

            <div className="flex items-center gap-2">
              <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
                wizardStep >= 4 ? "bg-amber-500 text-black shadow-lg shadow-amber-500/20" : "bg-gray-800 text-gray-500"
              }`}>4</span>
              <span className={`text-sm font-bold ${wizardStep >= 4 ? "text-white" : "text-gray-500"}`}>Composition Render</span>
            </div>
          </div>

          {/* ──────────────────────────────────────────────────
              STEP 1: BATCH QUANTITIES & ACCOUNTS SELECT
          ────────────────────────────────────────────────── */}
          {wizardStep === 1 && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block text-xs uppercase tracking-wider font-bold text-gray-400 mb-2">
                    Posts per TikTok Account
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={postsPerAccount}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 1;
                      setPostsPerAccount(val);
                      setBatchPostsTotal(selectedBatchAccountIds.length * val);
                    }}
                    className="w-full bg-[#141423] border border-white/5 rounded-2xl px-4 py-3.5 text-white font-bold"
                  />
                  <p className="text-[11px] text-gray-500 mt-1 font-semibold">e.g. 5 posts per account</p>
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wider font-bold text-gray-400 mb-2">
                    Video Target Length (seconds)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="5"
                    max="30"
                    value={videoLength}
                    onChange={(e) => setVideoLength(parseFloat(e.target.value) || 7.0)}
                    className="w-full bg-[#141423] border border-white/5 rounded-2xl px-4 py-3.5 text-white font-bold"
                  />
                  <p className="text-[11px] text-gray-500 mt-1 font-semibold">Standard loops are 7.0 seconds</p>
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wider font-bold text-gray-400 mb-2">
                    Total Posts Count
                  </label>
                  <div className="w-full bg-[#141423]/50 border border-white/5 rounded-2xl px-4 py-3.5 text-amber-400 font-black text-lg">
                    {selectedBatchAccountIds.length * postsPerAccount} videos
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1 font-semibold">Calculated dynamically across active accounts</p>
                </div>
              </div>

              {/* Accounts Selection */}
              <div className="space-y-4 pt-4 border-t border-white/5">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-bold text-white">Select Accounts to Composite ({selectedBatchAccountIds.length})</h3>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedBatchAccountIds.length === accounts.length) {
                        setSelectedBatchAccountIds([]);
                        setBatchPostsTotal(0);
                      } else {
                        const allIds = accounts.map(a => a.id);
                        setSelectedBatchAccountIds(allIds);
                        setBatchPostsTotal(allIds.length * postsPerAccount);
                      }
                    }}
                    className="text-xs text-amber-400 hover:text-amber-300 font-bold uppercase tracking-wider bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-xl transition-all"
                  >
                    {selectedBatchAccountIds.length === accounts.length ? "Deselect All" : "Select All"}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {accounts.map((acc) => {
                    const isSelected = selectedBatchAccountIds.includes(acc.id);
                    const isConfigured = acc.genreConfigs.length > 0;
                    const hasBgs = acc.backgroundVideos.length > 0;
                    const disabled = !isConfigured || !hasBgs || !acc.driveFolderId;

                    return (
                      <div
                        key={acc.id}
                        onClick={() => {
                          if (disabled) return;
                          if (isSelected) {
                            const updated = selectedBatchAccountIds.filter(id => id !== acc.id);
                            setSelectedBatchAccountIds(updated);
                            setBatchPostsTotal(updated.length * postsPerAccount);
                          } else {
                            const updated = [...selectedBatchAccountIds, acc.id];
                            setSelectedBatchAccountIds(updated);
                            setBatchPostsTotal(updated.length * postsPerAccount);
                          }
                        }}
                        className={`border p-4 rounded-3xl transition-all duration-300 flex items-center gap-3 cursor-pointer ${
                          disabled ? "opacity-35 cursor-not-allowed border-white/5 bg-[#0a0a0f]" :
                          isSelected ? "border-amber-500/50 bg-[#141221]" : "border-white/5 bg-[#0d0d16] hover:border-white/10"
                        }`}
                      >
                        <div className={`w-5 h-5 rounded-md border flex items-center justify-center ${
                          isSelected ? "bg-amber-500 border-amber-500 text-black" : "border-white/10 bg-black/40"
                        }`}>
                          {isSelected && <Check className="w-3.5 h-3.5 stroke-[4]" />}
                        </div>
                        <img src={acc.tiktokAvatarUrl} className="w-9 h-9 rounded-full object-cover" alt="" />
                        <div className="space-y-0.5">
                          <p className="text-sm font-bold text-white leading-tight">@{acc.tiktokUsername}</p>
                          {disabled ? (
                            <p className="text-[10px] text-red-400 font-semibold uppercase tracking-wider">
                              {!isConfigured ? "No theme config" : !hasBgs ? "No loops uploaded" : "No Drive folder"}
                            </p>
                          ) : (
                            <p className="text-[10px] text-gray-500 font-medium">{acc.group?.name}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Trigger */}
              <div className="pt-6 border-t border-white/5">
                <button
                  onClick={handleStartQuoteGeneration}
                  disabled={generatingQuotes || selectedBatchAccountIds.length === 0}
                  className="bg-amber-500 hover:bg-amber-600 text-black font-extrabold py-4 px-8 rounded-2xl shadow-lg transition-all duration-300 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-base"
                >
                  {generatingQuotes ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      Gemini Generating Quotes...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5" />
                      Generate Quotes via Gemini API
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ──────────────────────────────────────────────────
              STEP 2: QUOTES BULK REVIEW & EDIT CARD SCREEN
          ────────────────────────────────────────────────── */}
          {wizardStep === 2 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-bold text-white">Step 2: Review Bulk Generated Quotes</h3>
                <p className="text-xs text-gray-400 mt-0.5">Directly edit or fine-tune quotes before rendering them.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto pr-2">
                {reviewItems.map((item, idx) => (
                  <div key={item.id} className="bg-[#141423] border border-white/5 p-4 rounded-3xl space-y-3">
                    <div className="flex justify-between items-center border-b border-white/5 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest bg-amber-500/10 px-2 py-0.5 rounded">
                          Item #{idx + 1}
                        </span>
                        <span className="text-xs font-semibold text-gray-400">@{item.account.tiktokUsername}</span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider">Quote Text</label>
                      <textarea
                        value={item.quoteText}
                        rows={2}
                        onChange={(e) => {
                          const updated = [...reviewItems];
                          updated[idx].quoteText = e.target.value;
                          setReviewItems(updated);
                        }}
                        className="w-full bg-black/40 border border-white/5 rounded-2xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/30"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider">Author Name</label>
                      <input
                        type="text"
                        value={item.quoteAuthor || ""}
                        placeholder="Marcus Aurelius, Seneca, Unknown etc."
                        onChange={(e) => {
                          const updated = [...reviewItems];
                          updated[idx].quoteAuthor = e.target.value;
                          setReviewItems(updated);
                        }}
                        className="w-full bg-black/40 border border-white/5 rounded-2xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500/30"
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Triggers */}
              <div className="pt-6 border-t border-white/5 flex gap-4">
                <button
                  onClick={handleSaveReviewEdits}
                  disabled={savingReview}
                  className="bg-amber-500 hover:bg-amber-600 text-black font-extrabold py-3.5 px-6 rounded-2xl shadow-lg transition-all duration-300 disabled:opacity-50"
                >
                  {savingReview ? "Saving Changes..." : "Confirm & Proceed to Audio"}
                </button>
                <button
                  onClick={() => setWizardStep(1)}
                  className="bg-[#141423] hover:bg-[#1a1a2e] text-gray-400 hover:text-white font-bold py-3.5 px-6 rounded-2xl border border-white/5 transition-all"
                >
                  Back
                </button>
              </div>
            </div>
          )}

          {/* ──────────────────────────────────────────────────
              STEP 3: AUDIO POOL SELECTION
          ────────────────────────────────────────────────── */}
          {wizardStep === 3 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-bold text-white">Step 3: Select Audio Tracks Pool</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Select music tracks to dynamically allocate across batch videos using the round-robin solver.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-6 border-b border-white/5">
                {/* Reuse Slider */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-xs uppercase tracking-wider font-bold text-gray-400">
                      Maximum Audio Track Reuse
                    </label>
                    <span className="text-xs font-black text-amber-500 bg-amber-500/15 border border-amber-500/25 px-2 py-0.5 rounded-lg">
                      Max {audioReuseMax} times
                    </span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={audioReuseMax}
                    onChange={(e) => setAudioReuseMax(parseInt(e.target.value))}
                    className="w-full h-1.5 bg-[#141423] rounded-lg appearance-none cursor-pointer accent-amber-500"
                  />
                  <p className="text-[10px] text-gray-500 mt-1 font-semibold">
                    Guarantees variety by ensuring no account repeats the same song more than {audioReuseMax} times.
                  </p>
                </div>
              </div>

              {/* Tracks Checklist */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <h4 className="font-bold text-white text-base">Select Available Tracks ({selectedTrackIds.length})</h4>
                  <button
                    onClick={() => {
                      if (selectedTrackIds.length === tracks.length) {
                        setSelectedTrackIds([]);
                      } else {
                        setSelectedTrackIds(tracks.map(t => t.id));
                      }
                    }}
                    className="text-xs text-amber-400 hover:text-amber-300 font-bold uppercase tracking-wider"
                  >
                    {selectedTrackIds.length === tracks.length ? "Deselect All" : "Select All"}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {tracks.map((track) => {
                    const isSelected = selectedTrackIds.includes(track.id);
                    return (
                      <div
                        key={track.id}
                        onClick={() => {
                          if (isSelected) {
                            setSelectedTrackIds(selectedTrackIds.filter(id => id !== track.id));
                          } else {
                            setSelectedTrackIds([...selectedTrackIds, track.id]);
                          }
                        }}
                        className={`border p-4 rounded-3xl transition-all duration-300 flex items-center gap-3 cursor-pointer ${
                          isSelected ? "border-amber-500/50 bg-[#141221]" : "border-white/5 bg-[#0d0d16] hover:border-white/10"
                        }`}
                      >
                        <div className={`w-5 h-5 rounded-md border flex items-center justify-center ${
                          isSelected ? "bg-amber-500 border-amber-500 text-black" : "border-white/10 bg-black/40"
                        }`}>
                          {isSelected && <Check className="w-3.5 h-3.5 stroke-[4]" />}
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-sm font-bold text-white leading-tight">{track.title}</p>
                          <p className="text-[10px] text-gray-500 font-medium">{track.artist}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Triggers */}
              <div className="pt-6 border-t border-white/5 flex gap-4">
                <button
                  onClick={handleStartCompositionRendering}
                  disabled={triggeringRender || selectedTrackIds.length === 0}
                  className="bg-gradient-to-r from-amber-500 to-purple-600 hover:from-amber-600 hover:to-purple-700 text-white font-extrabold py-4 px-8 rounded-2xl shadow-lg transition-all duration-300 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {triggeringRender ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      Allocating & Queueing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5 text-amber-300" />
                      Compose & Upload to Google Drive
                    </>
                  )}
                </button>
                <button
                  onClick={() => setWizardStep(2)}
                  className="bg-[#141423] hover:bg-[#1a1a2e] text-gray-400 hover:text-white font-bold py-4 px-6 rounded-2xl border border-white/5 transition-all"
                >
                  Back
                </button>
              </div>
            </div>
          )}

          {/* ──────────────────────────────────────────────────
              STEP 4: QUEUED COMPOSITION RENDERING MONITOR
          ────────────────────────────────────────────────── */}
          {wizardStep === 4 && activeBatch && (
            <div className="space-y-8">
              {/* Progress Summary Card */}
              {(() => {
                const stats = getRenderStats();
                return (
                  <div className="bg-[#141423] border border-white/5 p-6 rounded-3xl space-y-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <h3 className="font-bold text-lg text-white">Batch Composition Rendering Progress</h3>
                        <p className="text-xs text-gray-400">Sequential rendering engine runs sequentially on server CPU</p>
                      </div>
                      <span className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider border shadow-md ${
                        activeBatch.status === "COMPLETED" ? "bg-green-500/10 text-green-400 border-green-500/20 shadow-green-500/5" :
                        activeBatch.status === "FAILED" ? "bg-red-500/10 text-red-400 border-red-500/20 shadow-red-500/5" :
                        "bg-amber-500/10 text-amber-400 border-amber-500/20 shadow-amber-500/5 animate-pulse"
                      }`}>
                        {activeBatch.status}
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs font-semibold text-gray-400">
                        <span>Progress: {stats.percent}% ({stats.completed + stats.failed} of {stats.total} clips)</span>
                        <span className="text-green-400 font-bold">{stats.completed} uploaded</span>
                      </div>
                      <div className="w-full bg-black/40 h-2.5 rounded-full overflow-hidden border border-white/5">
                        <div 
                          className="bg-gradient-to-r from-amber-500 to-purple-500 h-full rounded-full transition-all duration-500"
                          style={{ width: `${stats.percent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Batch items list */}
              <div className="space-y-3">
                <h4 className="font-bold text-white text-base">Compositing Video Clips Checklist</h4>
                <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-2">
                  {activeBatch.items?.map((item, idx) => (
                    <div 
                      key={item.id} 
                      className={`bg-[#0d0d16] border p-4 rounded-3xl flex flex-col sm:flex-row justify-between sm:items-center gap-4 transition-all duration-300 ${
                        item.status === "RENDERING" ? "border-amber-500/40 bg-[#141221] shadow-md shadow-amber-500/5" :
                        item.status === "UPLOADED" ? "border-green-500/20" :
                        item.status === "FAILED" ? "border-red-500/20 bg-[#1e0e13]" : "border-white/5 opacity-60"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-[#141423] border border-white/5 flex items-center justify-center font-bold text-xs text-amber-500">
                          #{idx + 1}
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-bold text-white">@{item.account.tiktokUsername}</p>
                          <p className="text-xs text-gray-400 max-w-lg italic font-medium leading-normal">
                            &ldquo;{item.quoteText}&rdquo;
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 self-end sm:self-center">
                        <div className="text-right text-xs">
                          <p className="text-gray-500 font-semibold">{item.track.title}</p>
                          <p className="text-[10px] text-gray-600 font-semibold uppercase tracking-wider">Audio clip</p>
                        </div>

                        {item.status === "RENDERING" && (
                          <span className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/15 rounded-xl text-xs font-bold animate-pulse">
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            Rendering...
                          </span>
                        )}

                        {item.status === "UPLOADED" && (
                          <span className="flex items-center gap-1 px-3 py-1 bg-green-500/10 text-green-400 border border-green-500/15 rounded-xl text-xs font-bold">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Google Drive Uploaded
                          </span>
                        )}

                        {item.status === "FAILED" && (
                          <span className="flex items-center gap-1 px-3 py-1 bg-red-500/10 text-red-400 border border-red-500/15 rounded-xl text-xs font-bold" title={item.errorMessage || "Unknown error"}>
                            <AlertCircle className="w-3.5 h-3.5" />
                            Failed
                          </span>
                        )}

                        {item.status === "PENDING" && (
                          <span className="flex items-center gap-1 px-3 py-1 bg-gray-800 text-gray-500 border border-white/5 rounded-xl text-xs font-bold">
                            Queued
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Close Button */}
              {activeBatch.status !== "RENDERING" && (
                <div className="pt-6 border-t border-white/5 flex gap-4">
                  <button
                    onClick={() => {
                      setWizardStep(1);
                      setActiveBatch(null);
                      fetchBatches();
                    }}
                    className="bg-[#141423] hover:bg-[#1a1a2e] text-gray-400 hover:text-white font-bold py-3.5 px-6 rounded-2xl border border-white/5 transition-all"
                  >
                    Finish and Back to Wizard
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ──────────────────────────────────────────────────
              BATCH HISTORY (Displayed underneath wizard steps)
          ────────────────────────────────────────────────── */}
          {wizardStep === 1 && (
            <div className="pt-8 border-t border-white/5 space-y-4">
              <h3 className="text-lg font-bold text-white">Compositing Batch History ({batches.length})</h3>
              
              {loadingBatches ? (
                <div className="flex justify-center py-8">
                  <RefreshCw className="w-6 h-6 text-amber-500 animate-spin" />
                </div>
              ) : batches.length === 0 ? (
                <p className="text-gray-500 text-sm">No historical compositing batches found.</p>
              ) : (
                <div className="space-y-3">
                  {batches.map((b) => (
                    <div 
                      key={b.id} 
                      className="bg-[#141423] border border-white/5 p-4 rounded-3xl flex justify-between items-center gap-4 transition-all duration-300 hover:border-white/10"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">Batch Composition</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider border ${
                            b.status === "COMPLETED" ? "bg-green-500/10 text-green-400 border-green-500/15" :
                            b.status === "FAILED" ? "bg-red-500/10 text-red-400 border-red-500/15" :
                            "bg-amber-500/10 text-amber-400 border-amber-500/15"
                          }`}>
                            {b.status}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-400 font-medium">
                          Created {new Date(b.createdAt).toLocaleString()} | {b.totalPosts} total videos ({b.postsPerAccount} per account)
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <button
                          onClick={async () => {
                            setLoadingBatches(true);
                            try {
                              const res = await fetch(`/api/managed/genres/batches?batchId=${b.id}`);
                              if (res.ok) {
                                const fullBatch = await res.json();
                                setActiveBatch(fullBatch);
                                setWizardStep(4);
                              }
                            } catch {
                              toast.error("Failed to load batch progress");
                            } finally {
                              setLoadingBatches(false);
                            }
                          }}
                          className="bg-amber-500/10 hover:bg-amber-500 text-amber-400 hover:text-black px-3.5 py-2 rounded-xl text-xs font-bold transition-all border border-amber-500/20 hover:border-amber-500"
                        >
                          View Progress
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      )}

    </div>
  );
}
