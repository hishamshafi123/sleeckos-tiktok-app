"use client";

import { useState, useEffect, useRef } from "react";
import { 
  Sparkles, Music, Sliders, Play, Pause, Trash2, Plus, 
  Upload, Film, CheckCircle2, AlertCircle, RefreshCw, ChevronRight, ChevronDown, Check, X, Lock, Tag, Folder, Eye, Filter,
  Loader2, ExternalLink, Download
} from "lucide-react";
import { toast as originalToast } from "sonner";

// Robust HTTP + HTTPS compatible clipboard copy helper
const copyTextToClipboard = (text: string): boolean => {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    console.warn("navigator.clipboard failed, trying fallback:", err);
  }

  try {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand("copy");
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    console.error("Fallback copy failed:", err);
    return false;
  }
};

const toast = {
  ...originalToast,
  error: (message: any, options?: any) => {
    const errorMsg = typeof message === "string" 
      ? message 
      : message?.message 
        ? message.message 
        : JSON.stringify(message) || "An unexpected error occurred";
      
    console.error("[Toast Error]", errorMsg);
    
    return originalToast.error(errorMsg, {
      ...options,
      duration: 20000, // Extend to 20 seconds to give plenty of time
      action: {
        label: "Copy",
        onClick: () => {
          const success = copyTextToClipboard(errorMsg);
          if (success) {
            originalToast.success("Error copied to clipboard!");
          } else {
            originalToast.error("Failed to copy automatically. Please open browser console to copy.");
          }
        }
      }
    });
  }
};

// Inline Google Drive folder linker for the Bulk Genres page
const InlineFolderLinker = ({ accountId, onLinked }: { accountId: string; onLinked: () => void }) => {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLink = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!url.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/managed/accounts/${accountId}/link-drive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderUrl: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to link");
      toast.success("Folder linked successfully!");
      setUrl("");
      onLinked();
    } catch (err: any) {
      toast.error(err.message || "Failed to link");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex gap-1 mt-1.5" onClick={(e) => e.stopPropagation()}>
      <input
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Paste Drive folder link..."
        className="flex-1 bg-black/50 border border-white/10 rounded-lg px-2 py-1 text-[9px] text-white focus:outline-none focus:border-purple-500 placeholder-gray-700 transition-colors"
      />
      <button
        onClick={handleLink}
        disabled={loading || !url.trim()}
        className="bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-[9px] font-bold text-white px-2.5 py-1 rounded-lg transition-all flex items-center gap-1"
      >
        {loading ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : "Link"}
      </button>
    </div>
  );
};

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
  genre: string | null;
  musician: string | null;
  campaignOn: boolean;
  campaignActiveAt: string | null;
  videosPosted?: number;
  totalViews?: number;
  createdAt: string;
  isLyrical?: boolean;
  lyricalTranscription?: string | null;
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
  curveText: boolean;
  curvature: number;
  positionY: number;
}

interface Account {
  id: string;
  tiktokUsername: string;
  tiktokDisplayName: string;
  tiktokAvatarUrl: string;
  driveFolderId: string | null;
  driveFolderName: string | null;
  driveConnected?: boolean;
  googleOAuthConnected?: boolean;
  group: {
    id: string;
    name: string;
    slug: string;
    section: {
      id: string;
      name: string;
      slug: string;
      color: string;
    } | null;
  } | null;
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
  renderedVideoUrl?: string | null;
  account?: {
    tiktokUsername: string;
    tiktokAvatarUrl: string;
  } | null;
  track?: {
    title: string;
    artist: string;
  } | null;
}

// Helper to recursively group accounts by Niche (Section) -> Group -> Account
interface NicheGrouped {
  id: string;
  name: string;
  slug: string;
  color: string;
  groups: {
    id: string;
    name: string;
    slug: string;
    accounts: Account[];
  }[];
}

function getNicheGrouped(accountsList: Account[]): NicheGrouped[] {
  const nichesMap: Record<string, NicheGrouped> = {};
  const uncategorizedNiche: NicheGrouped = {
    id: "uncategorized",
    name: "Uncategorized Niches",
    slug: "uncategorized",
    color: "#9ca3af",
    groups: []
  };
  const uncategorizedGroup = {
    id: "uncategorized",
    name: "Uncategorized Groups",
    slug: "uncategorized",
    accounts: [] as Account[]
  };

  accountsList.forEach(acc => {
    const sec = acc.group?.section;
    const grp = acc.group;

    if (sec && grp) {
      if (!nichesMap[sec.id]) {
        nichesMap[sec.id] = {
          id: sec.id,
          name: sec.name,
          slug: sec.slug,
          color: sec.color || "#8b5cf6",
          groups: []
        };
      }
      let g = nichesMap[sec.id].groups.find(x => x.id === grp.id);
      if (!g) {
        g = {
          id: grp.id,
          name: grp.name,
          slug: grp.slug,
          accounts: []
        };
        nichesMap[sec.id].groups.push(g);
      }
      g.accounts.push(acc);
    } else if (grp) {
      let g = uncategorizedNiche.groups.find(x => x.id === grp.id);
      if (!g) {
        g = {
          id: grp.id,
          name: grp.name,
          slug: grp.slug,
          accounts: []
        };
        uncategorizedNiche.groups.push(g);
      }
      g.accounts.push(acc);
    } else {
      uncategorizedGroup.accounts.push(acc);
    }
  });

  const result = Object.values(nichesMap);
  if (uncategorizedNiche.groups.length > 0) {
    result.push(uncategorizedNiche);
  }
  if (uncategorizedGroup.accounts.length > 0) {
    if (uncategorizedNiche.groups.length === 0) {
      uncategorizedNiche.groups.push(uncategorizedGroup);
      result.push(uncategorizedNiche);
    } else {
      const existingUncat = result.find(r => r.id === "uncategorized");
      if (existingUncat) {
        existingUncat.groups.push(uncategorizedGroup);
      }
    }
  }
  return result;
}

export default function GenresDashboard() {
  const [activeTab, setActiveTab] = useState<TabType>("accounts");

  const resolveUrl = (url: string | null | undefined): string => {
    if (!url) return "";
    if (url.startsWith("/uploads/")) {
      return url.replace("/uploads/", "/api/uploads/");
    }
    return url;
  };

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
  const [trackGenre, setTrackGenre] = useState("");
  const [trackStart, setTrackStart] = useState("0");
  const [trackDuration, setTrackDuration] = useState("7");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [uploadingTrack, setUploadingTrack] = useState(false);
  
  // Tracks Library Filter states
  const [filterGenre, setFilterGenre] = useState("all");
  const [filterMusician, setFilterMusician] = useState("all");
  const [filterCampaign, setFilterCampaign] = useState("all"); // "all" | "active"
  const [searchTrackQuery, setSearchTrackQuery] = useState("");
  const [previewBgIndex, setPreviewBgIndex] = useState(0);
  
  // Audio Player State
  const [playingTrackId, setPlayingTrackId] = useState<string | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // 2. Account Settings Form State
  const [themeText, setThemeText] = useState("");
  const [themeEnabled, setThemeEnabled] = useState(true);
  const [fontFamily, setFontFamily] = useState("Outfit-Bold");
  const [fontSize, setFontSize] = useState(44);
  const [fontColor, setFontColor] = useState("#FFFFFF");
  const [textCase, setTextCase] = useState("UPPERCASE");
  const [boxColor, setBoxColor] = useState("none");
  const [shadowColor, setShadowColor] = useState("black@0.6");
  const [lineSpacing, setLineSpacing] = useState(10);
  const [curveText, setCurveText] = useState(false);
  const [curvature, setCurvature] = useState(30);
  const [positionY, setPositionY] = useState(50);
  const [uploadingBg, setUploadingBg] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [driveUrl, setDriveUrl] = useState("");
  const [linkingDrive, setLinkingDrive] = useState(false);
  const [foldersList, setFoldersList] = useState<{ id: string; name: string }[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [folderSearchQuery, setFolderSearchQuery] = useState("");

  const fetchFolders = async (accountId: string) => {
    setLoadingFolders(true);
    setFoldersList([]);
    setFolderSearchQuery("");
    try {
      const res = await fetch(`/api/managed/accounts/${accountId}/drive-folders`);
      if (res.ok) {
        const data = await res.json();
        setFoldersList(data.folders || []);
        if (data.folders && data.folders.length > 0) {
          setSelectedFolderId(data.folders[0].id);
        }
      }
    } catch (err) {
      console.warn("Failed to fetch folders list:", err);
    } finally {
      setLoadingFolders(false);
    }
  };

  const linkSelectedFolder = async (accountId: string) => {
    if (!selectedFolderId) return;
    setLinkingDrive(true);
    try {
      const folder = foldersList.find(f => f.id === selectedFolderId);
      const folderName = folder ? folder.name : "Drive Folder";

      const res = await fetch(`/api/managed/accounts/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driveFolderId: selectedFolderId,
          driveFolderName: folderName,
        }),
      });

      if (!res.ok) throw new Error("Failed to link folder");
      toast.success(`Linked folder: ${folderName}`);
      fetchAccounts();
    } catch (err: any) {
      toast.error(err.message || "Failed to link folder");
    } finally {
      setLinkingDrive(false);
    }
  };

  // Cascading Dropdown Selectors for Niche & Group under Accounts Config Tab
  const [selectedNicheFilter, setSelectedNicheFilter] = useState("all");
  const [selectedGroupFilter, setSelectedGroupFilter] = useState("all");

  // Cascading Dropdown Selectors for Niche & Group under Composer Wizard Tab
  const [wizardNicheFilter, setWizardNicheFilter] = useState("all");
  const [wizardGroupFilter, setWizardGroupFilter] = useState("all");

  // Sidebar and selections collapsible state
  const [expandedNiches, setExpandedNiches] = useState<Record<string, boolean>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  // Batch Wizard State
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
  const [quotesSource, setQuotesSource] = useState<"gemini" | "csv">("gemini");
  const [parsedCsvQuotes, setParsedCsvQuotes] = useState<{ text: string; author: string }[]>([]);
  const [cancellingBatchId, setCancellingBatchId] = useState<string | null>(null);
  const [retryingBatchId, setRetryingBatchId] = useState<string | null>(null);

  // Lyrical composition states
  const [wizardGenre, setWizardGenre] = useState<"quote" | "lyrical">("quote");
  const [setupLyricalTrackId, setSetupLyricalTrackId] = useState<string | null>(null);
  const [designatingLyrical, setDesignatingLyrical] = useState<Record<string, boolean>>({});
  const [lyricalTemplateName, setLyricalTemplateName] = useState("Vibrant Neon");
  const [lyricalFontFamily, setLyricalFontFamily] = useState("Montserrat-Black");
  const [lyricalFontSize, setLyricalFontSize] = useState(48);
  const [lyricalActiveColor, setLyricalActiveColor] = useState("multi");
  const [lyricalStrokeWidth, setLyricalStrokeWidth] = useState(5);
  const [lyricalStrokeColor, setLyricalStrokeColor] = useState("#000000");
  const [lyricalPositionY, setLyricalPositionY] = useState(0.75);
  const [preRenderingTemplate, setPreRenderingTemplate] = useState(false);
  const [lyricalTemplates, setLyricalTemplates] = useState<any[]>([]);
  const [loadingTemplatesTrackId, setLoadingTemplatesTrackId] = useState<string | null>(null);
  const [selectedLyricalTrackId, setSelectedLyricalTrackId] = useState<string>("");
  const [selectedLyricalTemplateId, setSelectedLyricalTemplateId] = useState<string>("");
  const [selectedPreviewTemplateId, setSelectedPreviewTemplateId] = useState<string | null>(null);
  const [lyricalPlaybackTime, setLyricalPlaybackTime] = useState<number>(0);
  const [setupLyricalBgVideoUrl, setSetupLyricalBgVideoUrl] = useState<string>("");
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const [setupLyricalColorFilter, setSetupLyricalColorFilter] = useState<string>("none");
  const [setupLyricalVignette, setSetupLyricalVignette] = useState<string>("none");
  const [setupLyricalParticleFx, setSetupLyricalParticleFx] = useState<string>("none");
  const [mixupVisuals, setMixupVisuals] = useState<boolean>(true);



  // Local video preview & manual upload states
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [uploadingItems, setUploadingItems] = useState<Record<string, boolean>>({});
  const [retryingItemIds, setRetryingItemIds] = useState<Record<string, boolean>>({});
  const [uploadingBatch, setUploadingBatch] = useState(false);

  // Download states (batchId -> DownloadState)
  interface DownloadState {
    progress: number;
    totalSize: string;
    loadedSize: string;
  }
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});

  // Derived autocomplete lists
  const uniqueMusiciansList = Array.from(new Set(tracks.map(t => t.musician || t.artist).filter(Boolean))) as string[];
  const uniqueGenresList = Array.from(new Set(tracks.map(t => t.genre).filter(Boolean))) as string[];

  // Fetch initial data & load google fonts for preview
  useEffect(() => {
    fetchTracks();
    fetchAccounts();
    fetchBatches();

    // Inject Google Fonts link for preview styling
    const id = "google-fonts-preview";
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Anton&family=Caveat:wght@700&family=Great+Vibes&family=Inter:wght@700&family=Lora:ital,wght@0,700;1,700&family=Montserrat:wght@700&family=Oswald:wght@700&family=Outfit:wght@700&family=Playfair+Display:ital,wght@0,700;1,700&display=swap";
      document.head.appendChild(link);
    }
  }, []);

  // Synchronize background preview video with audio playback
  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video) return;

    const isPlayingThis = playingTrackId === setupLyricalTrackId && setupLyricalTrackId !== null;
    if (isPlayingThis) {
      video.play().catch(err => console.warn("Video play failed:", err));
      
      const audioTime = lyricalPlaybackTime;
      const videoDuration = video.duration;
      if (videoDuration && isFinite(videoDuration) && videoDuration > 0) {
        const expectedVideoTime = audioTime % videoDuration;
        if (Math.abs(video.currentTime - expectedVideoTime) > 0.5) {
          video.currentTime = expectedVideoTime;
        }
      }
    } else {
      video.pause();
    }
  }, [playingTrackId, setupLyricalTrackId, lyricalPlaybackTime]);

  // Automatically select the first background video as the default lyrical preview background
  useEffect(() => {
    if (!setupLyricalBgVideoUrl && accounts.length > 0) {
      const firstBg = accounts.flatMap(a => a.backgroundVideos || [])[0];
      if (firstBg) {
        setSetupLyricalBgVideoUrl(firstBg.videoUrl);
      }
    }
  }, [accounts, setupLyricalBgVideoUrl]);

  // Set default form values when account selection changes
  useEffect(() => {
    if (selectedAccount) {
      const config = selectedAccount.genreConfigs[0];
      setThemeEnabled(config?.themeText !== "__DISABLED__");
      setThemeText(config?.themeText === "__DISABLED__" ? "" : config?.themeText || "");
      setFontFamily(config?.fontFamily || "Outfit-Bold");
      setFontSize(config?.fontSize || 44);
      setFontColor(config?.fontColor || "#FFFFFF");
      setTextCase(config?.textCase || "UPPERCASE");
      setBoxColor(config?.boxColor || "none");
      setShadowColor(config?.shadowColor || "black@0.6");
      setLineSpacing(config?.lineSpacing || 10);
      setCurveText(config?.curveText || false);
      setCurvature(config?.curvature !== undefined ? config.curvature : 30);
      setPositionY(config?.positionY ?? 50);
      setPreviewBgIndex(0);

      setSelectedFolderId("");
      setFoldersList([]);
      fetchFolders(selectedAccount.id);
    } else {
      setThemeText("");
      setThemeEnabled(true);
      setCurveText(false);
      setCurvature(30);
      setBoxColor("none");
      setPositionY(50);
      setPreviewBgIndex(0);
      setSelectedFolderId("");
      setFoldersList([]);
    }
  }, [selectedAccountId, accounts]);

  // Audio Playback helper
  const togglePlayTrack = (track: Track) => {
    if (playingTrackId === track.id) {
      audioPlayerRef.current?.pause();
      setPlayingTrackId(null);
    } else {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.src = resolveUrl(track.fileUrl);
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

  const fetchLyricalTemplates = async (trackId: string) => {
    setLoadingTemplatesTrackId(trackId);
    try {
      const res = await fetch(`/api/managed/genres/tracks/lyrical?trackId=${trackId}`);
      if (res.ok) {
        const data = await res.json();
        setLyricalTemplates(data);
        if (data.length > 0 && !selectedPreviewTemplateId) {
          setSelectedPreviewTemplateId(data[0].id);
        }
      }
    } catch {
      toast.error("Failed to load styling templates");
    } finally {
      setLoadingTemplatesTrackId(null);
    }
  };

  const handleDesignateLyrical = async (trackId: string) => {
    setDesignatingLyrical(prev => ({ ...prev, [trackId]: true }));
    toast.info("Starting Whisper audio alignment in the background... this may take up to 2-3 minutes.");
    try {
      const res = await fetch("/api/managed/genres/tracks/lyrical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId }),
      });
      if (res.ok) {
        toast.success("Successfully transcribed and aligned lyrical track!");
        fetchTracks();
      } else {
        const data = await res.json();
        toast.error(data.error || "Whisper alignment failed");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to designate lyrical track");
    } finally {
      setDesignatingLyrical(prev => ({ ...prev, [trackId]: false }));
    }
  };

  const handlePreRenderTemplate = async (trackId: string) => {
    setPreRenderingTemplate(true);
    toast.info("Generating caption PNG preview frame and pre-rendering MOV transparent overlay clip... this may take up to 1-2 minutes.");
    try {
      const res = await fetch("/api/managed/genres/tracks/lyrical", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackId,
          templateName: lyricalTemplateName,
          fontFamily: lyricalFontFamily,
          fontSize: lyricalFontSize,
          activeColor: lyricalActiveColor,
          strokeWidth: lyricalStrokeWidth,
          strokeColor: lyricalStrokeColor,
          positionY: lyricalPositionY,
        }),
      });
      if (res.ok) {
        toast.success(`Successfully rendered template '${lyricalTemplateName}'`);
        const data = await res.json();
        await fetchLyricalTemplates(trackId);
        setSelectedPreviewTemplateId(data.id);
      } else {
        const data = await res.json();
        toast.error(data.error || "Pre-rendering overlays failed");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to pre-render templates");
    } finally {
      setPreRenderingTemplate(false);
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
    data.append("genre", trackGenre);
    data.append("musician", trackArtist); // Consolidated: map Musician/Producer to both fields

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
        setTrackGenre("");
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

  const handleToggleCampaign = async (track: Track) => {
    try {
      const res = await fetch("/api/managed/genres/tracks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: track.id,
          campaignOn: !track.campaignOn,
        }),
      });
      if (res.ok) {
        toast.success(`Campaign turned ${!track.campaignOn ? "ON" : "OFF"} for "${track.title}"`);
        fetchTracks();
      } else {
        toast.error("Failed to toggle campaign");
      }
    } catch {
      toast.error("Error toggling campaign");
    }
  };

  // Configurations Actions
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccountId) return;

    setSavingConfig(true);
    const data = new FormData();
    data.append("accountId", selectedAccountId);
    data.append("themeText", themeEnabled ? themeText : "__DISABLED__");
    data.append("fontFamily", fontFamily);
    data.append("fontSize", fontSize.toString());
    data.append("fontColor", fontColor);
    data.append("textCase", textCase);
    data.append("boxColor", boxColor);
    data.append("shadowColor", shadowColor);
    data.append("lineSpacing", lineSpacing.toString());
    data.append("curveText", curveText.toString());
    data.append("curvature", curvature.toString());
    data.append("positionY", positionY.toString());

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

  const linkDrive = async (id: string) => {
    if (!driveUrl.trim()) return;
    setLinkingDrive(true);
    try {
      const res = await fetch(`/api/managed/accounts/${id}/link-drive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderUrl: driveUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Link failed");
      toast.success(`Linked: ${data.folderName}`);
      setDriveUrl("");
      fetchAccounts();
    } catch (err: any) {
      toast.error(err.message || "Failed to link folder");
    } finally {
      setLinkingDrive(false);
    }
  };

  const unlinkDrive = async (id: string, disconnectGoogle = false) => {
    const confirmMsg = disconnectGoogle
      ? "Disconnect Google Account? This will remove the connected Google Drive folder and log you out of Google on this server."
      : "Remove Google Drive folder link? (This keeps your Google Account connected so you can paste a new folder URL instantly)";

    if (!confirm(confirmMsg)) return;
    try {
      const url = `/api/managed/accounts/${id}/link-drive${disconnectGoogle ? "?disconnectGoogle=true" : ""}`;
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) throw new Error("Unlink failed");
      toast.success(disconnectGoogle ? "Google Account disconnected" : "Drive folder unlinked");
      fetchAccounts();
    } catch {
      toast.error(disconnectGoogle ? "Failed to disconnect account" : "Failed to unlink folder");
    }
  };

  // Visual CSS and Casing Helpers
  const getCssFontFamily = (font: string) => {
    switch (font) {
      case "Outfit-Bold": return "'Outfit', sans-serif";
      case "Inter-Bold": return "'Inter', sans-serif";
      case "PlayfairDisplay-Bold": return "'Playfair Display', serif";
      case "GreatVibes-Regular": return "'Great Vibes', cursive";
      case "Anton": return "'Anton', sans-serif";
      case "Caveat": return "'Caveat', cursive";
      case "Lora": return "'Lora', serif";
      case "Montserrat": return "'Montserrat', sans-serif";
      case "Oswald": return "'Oswald', sans-serif";
      default: return "'Outfit', sans-serif";
    }
  };

  const getCssRgba = (colorStr: string) => {
    if (!colorStr || colorStr === "none") return "transparent";
    const parts = colorStr.split("@");
    const color = parts[0];
    const opacity = parts[1] || "1";
    if (color === "black") {
      return `rgba(0, 0, 0, ${opacity})`;
    }
    if (color === "white") {
      return `rgba(255, 255, 255, ${opacity})`;
    }
    return `rgba(0, 0, 0, ${opacity})`;
  };

  const getCssTextShadow = (shadowStr: string) => {
    if (!shadowStr || shadowStr === "none") return "none";
    const parts = shadowStr.split("@");
    const opacity = parts[1] || "1";
    return `2px 2px 4px rgba(0, 0, 0, ${opacity})`;
  };

  const applyTextCase = (text: string, casing: string) => {
    if (!text) return "";
    switch (casing) {
      case "UPPERCASE": return text.toUpperCase();
      case "Title Case": 
        return text.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
      case "lowercase": return text.toLowerCase();
      default: return text;
    }
  };

  // Niche and Group collapsing helpers
  const toggleNicheCollapse = (nicheId: string) => {
    setExpandedNiches(prev => ({
      ...prev,
      [nicheId]: !prev[nicheId]
    }));
  };

  const toggleGroupCollapse = (groupId: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  };

  // Bulk selectors for wizard
  const toggleSelectNiche = (niche: NicheGrouped, select: boolean) => {
    const validAccs = niche.groups.flatMap(g => g.accounts).filter(acc => {
      const isConfigured = acc.genreConfigs.length > 0;
      const hasBgs = acc.backgroundVideos.length > 0;
      return isConfigured && hasBgs && acc.driveFolderId;
    });
    const validIds = validAccs.map(a => a.id);

    if (select) {
      const newSelections = Array.from(new Set([...selectedBatchAccountIds, ...validIds]));
      setSelectedBatchAccountIds(newSelections);
      setBatchPostsTotal(newSelections.length * postsPerAccount);
    } else {
      const newSelections = selectedBatchAccountIds.filter(id => !validIds.includes(id));
      setSelectedBatchAccountIds(newSelections);
      setBatchPostsTotal(newSelections.length * postsPerAccount);
    }
  };

  const toggleSelectGroup = (group: { id: string; name: string; slug: string; accounts: Account[] }, select: boolean) => {
    const validAccs = group.accounts.filter(acc => {
      const isConfigured = acc.genreConfigs.length > 0;
      const hasBgs = acc.backgroundVideos.length > 0;
      return isConfigured && hasBgs && acc.driveFolderId;
    });
    const validIds = validAccs.map(a => a.id);

    if (select) {
      const newSelections = Array.from(new Set([...selectedBatchAccountIds, ...validIds]));
      setSelectedBatchAccountIds(newSelections);
      setBatchPostsTotal(newSelections.length * postsPerAccount);
    } else {
      const newSelections = selectedBatchAccountIds.filter(id => !validIds.includes(id));
      setSelectedBatchAccountIds(newSelections);
      setBatchPostsTotal(newSelections.length * postsPerAccount);
    }
  };

  // CSV Parser & Upload Helpers for Bulk Quote Import
  const parseCSVText = (csvText: string): { text: string; author: string }[] => {
    const lines = csvText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) return [];

    const firstLine = lines[0].toLowerCase();
    const isHeader =
      firstLine === "hook" ||
      firstLine === "text" ||
      firstLine === "hooks" ||
      firstLine === "hook_text" ||
      firstLine === "hooktext" ||
      firstLine === "quote" ||
      firstLine === "quotes" ||
      firstLine === "quote_text" ||
      firstLine === "quotetext" ||
      firstLine === "caption" ||
      firstLine === "title" ||
      firstLine.includes("hook") ||
      firstLine.includes("text") ||
      firstLine.includes("quote");

    const dataLines = isHeader ? lines.slice(1) : lines;

    return dataLines
      .map((line) => {
        let text = "";
        let author = "";

        if (line.startsWith('"')) {
          const parts: string[] = [];
          let current = "";
          let inQuotes = false;
          for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
              if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
              } else {
                inQuotes = !inQuotes;
              }
            } else if (char === ',' && !inQuotes) {
              parts.push(current);
              current = "";
            } else {
              current += char;
            }
          }
          parts.push(current);

          text = parts[0]?.trim() || "";
          author = parts[1]?.trim() || "";
        } else {
          if (line.includes(",")) {
            const idx = line.indexOf(",");
            text = line.substring(0, idx).trim();
            author = line.substring(idx + 1).trim();
          } else {
            text = line;
          }
        }

        if (text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1);
        if (author.startsWith('"') && author.endsWith('"')) author = author.slice(1, -1);

        return { text: text.trim(), author: author.trim() };
      })
      .filter((q) => q.text.length > 0);
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    let combinedQuotes: { text: string; author: string }[] = [];
    let filesProcessed = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        const parsed = parseCSVText(text);
        combinedQuotes = [...combinedQuotes, ...parsed];
        
        filesProcessed++;
        if (filesProcessed === files.length) {
          setParsedCsvQuotes(combinedQuotes);
          toast.success(`Parsed ${combinedQuotes.length} quotes from ${files.length} CSV files!`);
        }
      };
      reader.readAsText(file);
    }
  };

  // Batch Compositing Actions
  const handleStartQuoteGeneration = async () => {
    if (selectedBatchAccountIds.length === 0) {
      toast.error("Please select at least one TikTok account for the batch");
      return;
    }

    if (quotesSource === "csv" && parsedCsvQuotes.length === 0) {
      toast.error("Please upload at least one CSV file with quotes");
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
          csvQuotes: quotesSource === "csv" ? parsedCsvQuotes : undefined,
        }),
      });

      if (res.ok) {
        const batchData = await res.json();
        setActiveBatch(batchData);
        setReviewItems(batchData.items || []);
        setWizardStep(2);
        toast.success(
          quotesSource === "csv"
            ? "CSV quotes imported and allocated successfully"
            : "Quotes bulk generated successfully via Gemini API"
        );
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

  const handleStartLyricalGeneration = async () => {
    if (selectedBatchAccountIds.length === 0) {
      toast.error("Please select at least one TikTok account");
      return;
    }
    if (!selectedLyricalTrackId || !selectedLyricalTemplateId) {
      toast.error("Please select a Lyrical Track and Styling Template");
      return;
    }

    setGeneratingQuotes(true);
    try {
      const res = await fetch("/api/managed/genres/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CREATE_LYRICAL_BATCH",
          accountIds: selectedBatchAccountIds,
          postsPerAccount: postsPerAccount,
          trackId: selectedLyricalTrackId,
          lyricalTemplateId: selectedLyricalTemplateId,
          mixupVisuals: mixupVisuals,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        toast.success("Lyrical bulk composition queued successfully!");
        
        // Fetch fresh batch info to show progress immediately
        const batchRes = await fetch(`/api/managed/genres/batches?batchId=${data.batchId}`);
        if (batchRes.ok) {
          setActiveBatch(await batchRes.json());
        }
        
        // Transition directly to Step 4 (Render progress list)
        setWizardStep(4);
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to create lyrical composition batch");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to start composition batch");
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

  const handleCancelBatch = async (batchId: string) => {
    if (!window.confirm("Are you sure you want to cancel this rendering batch? This will stop compiling remaining videos.")) {
      return;
    }
    setCancellingBatchId(batchId);
    try {
      const res = await fetch("/api/managed/genres/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CANCEL_BATCH",
          batchId,
        }),
      });

      if (res.ok) {
        toast.success("Batch cancelled successfully");
        fetchBatches();
        if (activeBatch?.id === batchId) {
          const statusRes = await fetch(`/api/managed/genres/batches?batchId=${batchId}`);
          if (statusRes.ok) setActiveBatch(await statusRes.json());
        }
      } else {
        const errData = await res.json();
        toast.error(errData.error || "Failed to cancel batch");
      }
    } catch {
      toast.error("Error cancelling batch");
    } finally {
      setCancellingBatchId(null);
    }
  };

  const handleRetryFailedRenders = async (batchId: string) => {
    setRetryingBatchId(batchId);
    try {
      const res = await fetch("/api/managed/genres/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "RETRY_FAILED",
          batchId,
        }),
      });

      if (res.ok) {
        toast.success("Retrying failed renders initiated!");
        fetchBatches();
        if (activeBatch?.id === batchId) {
          const statusRes = await fetch(`/api/managed/genres/batches?batchId=${batchId}`);
          if (statusRes.ok) setActiveBatch(await statusRes.json());
        }
      } else {
        const errData = await res.json();
        toast.error(errData.error || "Failed to retry failed renders");
      }
    } catch {
      toast.error("Error retrying failed renders");
    } finally {
      setRetryingBatchId(null);
    }
  };

  const handleRetrySingleItem = async (batchId: string, itemId: string) => {
    setRetryingItemIds(prev => ({ ...prev, [itemId]: true }));
    try {
      const res = await fetch("/api/managed/genres/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "RETRY_FAILED",
          batchId,
          itemId,
        }),
      });

      if (res.ok) {
        toast.success("Retrying video render initiated!");
        fetchBatches();
        if (activeBatch?.id === batchId) {
          const statusRes = await fetch(`/api/managed/genres/batches?batchId=${batchId}`);
          if (statusRes.ok) setActiveBatch(await statusRes.json());
        }
      } else {
        const errData = await res.json();
        toast.error(errData.error || "Failed to retry video render");
      }
    } catch {
      toast.error("Error retrying video render");
    } finally {
      setRetryingItemIds(prev => ({ ...prev, [itemId]: false }));
    }
  };

  const handleUploadToDrive = async (itemId: string) => {
    setUploadingItems(prev => ({ ...prev, [itemId]: true }));
    try {
      const res = await fetch("/api/managed/genres/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "UPLOAD_TO_DRIVE",
          itemId
        })
      });
      if (res.ok) {
        toast.success("Video uploaded to Google Drive successfully!");
        if (activeBatch) {
          const statusRes = await fetch(`/api/managed/genres/batches?batchId=${activeBatch.id}`);
          if (statusRes.ok) setActiveBatch(await statusRes.json());
        }
        fetchBatches();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to upload video to Google Drive");
      }
    } catch (err) {
      console.error(err);
      toast.error("An error occurred while uploading to Google Drive");
    } finally {
      setUploadingItems(prev => ({ ...prev, [itemId]: false }));
    }
  };

  const handleUploadAllToDrive = async (batchId: string) => {
    setUploadingBatch(true);
    try {
      const res = await fetch("/api/managed/genres/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "UPLOAD_TO_DRIVE",
          batchId
        })
      });
      if (res.ok) {
        toast.success("All rendered videos uploaded to Google Drive!");
        const statusRes = await fetch(`/api/managed/genres/batches?batchId=${batchId}`);
        if (statusRes.ok) setActiveBatch(await statusRes.json());
        fetchBatches();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to upload all videos to Google Drive");
      }
    } catch (err) {
      console.error(err);
      toast.error("An error occurred during bulk Google Drive upload");
    } finally {
      setUploadingBatch(false);
    }
  };

  const handleDownload = async (batchId: string) => {
    try {
      setDownloads((prev) => ({
        ...prev,
        [batchId]: { progress: 0, totalSize: "Preparing...", loadedSize: "0%" }
      }));

      const getErrorMessage = async (res: Response, fallback: string) => {
        try {
          const contentType = res.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const err = await res.json();
            return err.error || fallback;
          }
          return fallback;
        } catch {
          return fallback;
        }
      };

      let isPrepared = false;
      let statusData: any = null;

      // Poll the status every 2 seconds
      while (!isPrepared) {
        const res = await fetch(`/api/managed/genres/batches/download?batchId=${batchId}`);
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
        link.download = statusData.downloadUrl.split("/").pop() || `genre_batch_${batchId.substring(0, 8)}.tar.gz`;
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

  // Rendering statistics
  const getRenderStats = () => {
    if (!activeBatch?.items) return { total: 0, completed: 0, failed: 0, percent: 0 };
    const items = activeBatch.items;
    const total = items.length;
    const completed = items.filter(i => i.status === "RENDERED" || i.status === "UPLOADED").length;
    const failed = items.filter(i => i.status === "FAILED").length;
    const percent = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0;
    return { total, completed, failed, percent };
  };

  return (
    <div className="space-y-8 text-gray-200 pb-16">
      <style>{`
        @keyframes float-dust {
          0% { transform: translateY(0) scale(0.8); opacity: 0; }
          10% { opacity: 0.8; }
          90% { opacity: 0.8; }
          100% { transform: translateY(-160px) scale(1.1); opacity: 0; }
        }
        .animate-float-dust {
          animation: float-dust infinite linear;
        }
      `}</style>
      {/* Import premium styling fonts dynamically */}
      <link 
        href="https://fonts.googleapis.com/css2?family=Anton&family=Caveat:wght@700&family=Inter:wght@700;900&family=Montserrat:wght@900&family=Outfit:wght@800;900&display=swap" 
        rel="stylesheet" 
      />
      <audio 
        ref={audioPlayerRef} 
        className="hidden" 
        onEnded={() => setPlayingTrackId(null)} 
        onTimeUpdate={(e) => {
          setLyricalPlaybackTime(e.currentTarget.currentTime);
        }}
      />
      
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
                  Musician / Producer
                </label>
                <input
                  type="text"
                  placeholder="e.g. M83, Chopin, Hans Zimmer"
                  value={trackArtist}
                  onChange={(e) => setTrackArtist(e.target.value)}
                  list="musicians-datalist"
                  className="w-full bg-[#141423] border border-white/5 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30"
                  required
                />
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider font-bold text-gray-400 mb-2">
                  Genre / Mood
                </label>
                <input
                  type="text"
                  placeholder="e.g. Stoic, Sad, Piano, Lyrical"
                  value={trackGenre}
                  onChange={(e) => setTrackGenre(e.target.value)}
                  list="genres-datalist"
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

            {/* Search & Filter Controls */}
            {(() => {
              const uniqueGenres = Array.from(new Set(tracks.map(t => t.genre).filter(Boolean))) as string[];
              const uniqueMusicians = Array.from(new Set(tracks.map(t => t.musician || t.artist).filter(Boolean))) as string[];

              const filteredTracks = tracks.filter(t => {
                const matchesSearch = 
                  t.title.toLowerCase().includes(searchTrackQuery.toLowerCase()) ||
                  t.artist.toLowerCase().includes(searchTrackQuery.toLowerCase()) ||
                  (t.genre && t.genre.toLowerCase().includes(searchTrackQuery.toLowerCase())) ||
                  ((t.musician || t.artist).toLowerCase().includes(searchTrackQuery.toLowerCase()));
                  
                const matchesGenre = filterGenre === "all" || t.genre === filterGenre;
                const matchesMusician = filterMusician === "all" || (t.musician || t.artist) === filterMusician;
                const matchesCampaign = filterCampaign === "all" || (filterCampaign === "active" && t.campaignOn);
                
                return matchesSearch && matchesGenre && matchesMusician && matchesCampaign;
              });

              return (
                <div className="space-y-4">
                  <div className="bg-[#0d0d16] border border-white/5 p-4 rounded-3xl space-y-3 shadow-xl">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <div className="md:col-span-2 relative">
                        <input
                          type="text"
                          placeholder="Search title, artist, genre..."
                          value={searchTrackQuery}
                          onChange={(e) => setSearchTrackQuery(e.target.value)}
                          className="w-full bg-[#141423] border border-white/5 rounded-2xl pl-10 pr-4 py-2.5 text-xs text-white focus:outline-none focus:border-amber-500/30"
                        />
                        <Filter className="absolute left-3.5 top-3 w-3.5 h-3.5 text-gray-500" />
                      </div>
                      
                      <div>
                        <select
                          value={filterGenre}
                          onChange={(e) => setFilterGenre(e.target.value)}
                          className="w-full bg-[#141423] border border-white/5 rounded-2xl px-3 py-2.5 text-xs text-white focus:outline-none"
                        >
                          <option value="all">All Genres</option>
                          {uniqueGenres.map(g => (
                            <option key={g} value={g}>{g}</option>
                          ))}
                        </select>
                      </div>
                      
                      <div>
                        <select
                          value={filterMusician}
                          onChange={(e) => setFilterMusician(e.target.value)}
                          className="w-full bg-[#141423] border border-white/5 rounded-2xl px-3 py-2.5 text-xs text-white focus:outline-none"
                        >
                          <option value="all">All Musicians</option>
                          {uniqueMusicians.map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setFilterCampaign(filterCampaign === "all" ? "active" : "all")}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                            filterCampaign === "active"
                              ? "bg-green-500/10 text-green-400 border-green-500/20 shadow-lg shadow-green-500/5"
                              : "bg-[#141423] text-gray-400 border-white/5 hover:text-white"
                          }`}
                        >
                          <Tag className="w-3.5 h-3.5" />
                          Campaign Active Only
                        </button>
                        
                        {(searchTrackQuery || filterGenre !== "all" || filterMusician !== "all" || filterCampaign !== "all") && (
                          <button
                            type="button"
                            onClick={() => {
                              setSearchTrackQuery("");
                              setFilterGenre("all");
                              setFilterMusician("all");
                              setFilterCampaign("all");
                            }}
                            className="text-xs text-amber-400 hover:text-amber-300 font-bold px-2 py-1.5"
                          >
                            Reset Filters
                          </button>
                        )}
                      </div>

                      <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">
                        Showing {filteredTracks.length} of {tracks.length} tracks
                      </span>
                    </div>
                  </div>

                  {loadingTracks ? (
                    <div className="flex justify-center items-center py-24">
                      <RefreshCw className="w-8 h-8 text-amber-500 animate-spin" />
                    </div>
                  ) : filteredTracks.length === 0 ? (
                    <div className="bg-[#0d0d16] border border-white/5 p-12 text-center rounded-3xl">
                      <p className="text-gray-500 text-sm">No tracks matched your active filter settings.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {filteredTracks.map((track) => (
                        <div 
                          key={track.id} 
                          className={`bg-[#0d0d16] border rounded-3xl p-5 flex flex-col justify-between space-y-4 transition-all duration-300 ${
                            playingTrackId === track.id ? "border-amber-500/40 shadow-lg shadow-amber-500/5 bg-[#141221]" : "border-white/5 hover:border-white/10"
                          }`}
                        >
                          {/* Title block */}
                          <div className="flex justify-between items-start">
                            <div className="space-y-1 overflow-hidden">
                              <h3 className="font-bold text-white text-base leading-tight truncate">{track.title}</h3>
                              <p className="text-xs text-gray-400 font-medium truncate">{track.artist}</p>
                              
                              {/* Genre & Musician badges */}
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {track.genre && (
                                  <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 bg-purple-500/10 text-purple-400 border border-purple-500/15 rounded-md">
                                    {track.genre}
                                  </span>
                                )}
                                {track.musician && track.musician !== track.artist && (
                                  <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/15 rounded-md">
                                    {track.musician}
                                  </span>
                                )}
                              </div>
                            </div>
                            
                            <button
                              type="button"
                              onClick={() => handleDeleteTrack(track.id)}
                              className="text-gray-600 hover:text-red-400 p-2 hover:bg-red-400/10 rounded-xl transition-all duration-300"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>

                          {/* Trim Settings */}
                          <div className="bg-[#141423] p-3 rounded-2xl flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
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

                          {/* Campaign controls */}
                          <div className="border-t border-white/5 pt-3.5 space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <label className="relative inline-flex items-center cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={track.campaignOn}
                                    onChange={() => handleToggleCampaign(track)}
                                    className="sr-only peer"
                                  />
                                  <div className="w-9 h-5 bg-gray-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-300 after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500 peer-checked:after:bg-black peer-checked:after:border-black"></div>
                                </label>
                                <span className={`text-[10px] font-bold uppercase tracking-wider ${track.campaignOn ? "text-green-400" : "text-gray-500"}`}>
                                  Campaign On/Off
                                </span>
                              </div>
                              
                              {track.campaignOn && (
                                <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-green-400 bg-green-500/10 border border-green-500/15 px-2 py-0.5 rounded animate-pulse">
                                  Active
                                </span>
                              )}
                            </div>

                            {/* Dynamic views / posted analytics statistics */}
                            {track.campaignOn && (
                              <div className="grid grid-cols-2 gap-2 bg-black/40 p-2.5 rounded-2xl border border-white/5 shadow-inner">
                                <div className="text-center">
                                  <p className="text-[9px] text-gray-500 uppercase tracking-wider font-bold">Videos Posted</p>
                                  <p className="text-sm font-black text-amber-400 mt-0.5">{track.videosPosted || 0}</p>
                                </div>
                                <div className="text-center border-l border-white/5">
                                  <p className="text-[9px] text-gray-500 uppercase tracking-wider font-bold">Total Views</p>
                                  <p className="text-sm font-black text-purple-400 mt-0.5">{(track.totalViews || 0).toLocaleString()}</p>
                                </div>
                              </div>
                            )}

                            {/* Lyrical Configurator Action Button */}
                            <div className="border-t border-white/5 pt-3.5 flex flex-col gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  if (setupLyricalTrackId === track.id) {
                                    setSetupLyricalTrackId(null);
                                  } else {
                                    setSetupLyricalTrackId(track.id);
                                    if (track.isLyrical) {
                                      fetchLyricalTemplates(track.id);
                                    }
                                  }
                                }}
                                className={`w-full py-2.5 px-4 rounded-2xl text-xs font-bold transition-all duration-300 flex items-center justify-center gap-2 border ${
                                  track.isLyrical 
                                    ? "bg-purple-500/10 text-purple-300 border-purple-500/30 hover:bg-purple-500/25 shadow-lg shadow-purple-500/5" 
                                    : "bg-white/5 text-gray-400 border-white/5 hover:text-white hover:bg-white/10"
                                }`}
                              >
                                <Music className="w-3.5 h-3.5" />
                                {track.isLyrical ? "Lyrical Setup & Templates" : "Use for Lyrical Videos"}
                              </button>
                            </div>
                          </div>

                          {/* Lyrical Config Drawer Block */}
                          {setupLyricalTrackId === track.id && (
                            <div className="border-t border-white/5 pt-4 mt-2 px-5 pb-5 space-y-4 text-left bg-black/20 rounded-b-3xl">
                              <div className="flex justify-between items-center">
                                <h4 className="text-xs font-black uppercase tracking-widest text-purple-400 flex items-center gap-1.5">
                                  <Sparkles className="w-3.5 h-3.5" />
                                  Lyrical Video Setup
                                </h4>
                                <button 
                                  type="button" 
                                  onClick={() => setSetupLyricalTrackId(null)}
                                  className="text-gray-500 hover:text-gray-300 text-xs font-bold"
                                >
                                  Close
                                </button>
                              </div>

                              {!track.isLyrical ? (
                                <div className="bg-purple-950/20 border border-purple-500/20 rounded-2xl p-4 space-y-3">
                                  <p className="text-[11px] text-purple-300 leading-relaxed">
                                    This track needs to be transcribed and word-aligned by Whisper. This runs once and creates exact timing coordinates, allowing subsequent styling changes and overlay creations in under 2 seconds!
                                  </p>
                                  <button
                                    type="button"
                                    disabled={designatingLyrical[track.id]}
                                    onClick={() => handleDesignateLyrical(track.id)}
                                    className="w-full bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-white font-bold py-2 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
                                  >
                                    {designatingLyrical[track.id] ? (
                                      <>
                                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                        Whisper Aligning...
                                      </>
                                    ) : (
                                      <>
                                        <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                                        Designate & Align Now
                                      </>
                                    )}
                                  </button>
                                </div>
                              ) : (
                                <div className="space-y-4">
                                  {/* Styling form */}
                                  <div className="bg-[#141423] p-3 rounded-2xl border border-white/5 space-y-3">
                                    <div className="space-y-1">
                                      <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Preset Theme</label>
                                      <select
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          if (val === "neon-rainbow") {
                                            setLyricalTemplateName("Neon Rainbow");
                                            setLyricalFontFamily("Montserrat-Black");
                                            setLyricalFontSize(48);
                                            setLyricalActiveColor("multi");
                                            setLyricalStrokeWidth(5);
                                            setLyricalStrokeColor("#000000");
                                            setLyricalPositionY(0.75);
                                          } else if (val === "vibrant-yellow") {
                                            setLyricalTemplateName("Vibrant Yellow");
                                            setLyricalFontFamily("Anton");
                                            setLyricalFontSize(50);
                                            setLyricalActiveColor("#ffff00");
                                            setLyricalStrokeWidth(4);
                                            setLyricalStrokeColor("#000000");
                                            setLyricalPositionY(0.70);
                                          } else if (val === "electric-green") {
                                            setLyricalTemplateName("Electric Green");
                                            setLyricalFontFamily("Outfit-Bold");
                                            setLyricalFontSize(46);
                                            setLyricalActiveColor("#00ff00");
                                            setLyricalStrokeWidth(6);
                                            setLyricalStrokeColor("#111111");
                                            setLyricalPositionY(0.80);
                                          } else if (val === "hot-pink") {
                                            setLyricalTemplateName("Hot Pink");
                                            setLyricalFontFamily("Inter-Bold");
                                            setLyricalFontSize(48);
                                            setLyricalActiveColor("#ff007f");
                                            setLyricalStrokeWidth(5);
                                            setLyricalStrokeColor("#000000");
                                            setLyricalPositionY(0.75);
                                          }
                                        }}
                                        className="w-full bg-black/40 border border-white/5 rounded-xl px-2 py-1.5 text-xs text-gray-300 focus:outline-none"
                                      >
                                        <option value="custom">-- Choose Preset Styling --</option>
                                        <option value="neon-rainbow">Neon Rainbow (Active Multi-color)</option>
                                        <option value="vibrant-yellow">Vibrant Yellow (Anton Bold)</option>
                                        <option value="electric-green">Electric Green (Outfit Active)</option>
                                        <option value="hot-pink">Hot Pink (Vibrant Neon Pink)</option>
                                      </select>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2">
                                      <div className="space-y-1">
                                        <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Template Name</label>
                                        <input
                                          type="text"
                                          value={lyricalTemplateName}
                                          onChange={(e) => setLyricalTemplateName(e.target.value)}
                                          placeholder="e.g. My Style"
                                          className="w-full bg-black/40 border border-white/5 rounded-xl px-2 py-1.5 text-xs text-white focus:outline-none"
                                        />
                                      </div>
                                      <div className="space-y-1">
                                        <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Font Family</label>
                                        <select
                                          value={lyricalFontFamily}
                                          onChange={(e) => setLyricalFontFamily(e.target.value)}
                                          className="w-full bg-black/40 border border-white/5 rounded-xl px-2 py-1.5 text-xs text-gray-300 focus:outline-none"
                                        >
                                          <option value="Montserrat-Black">Montserrat Black</option>
                                          <option value="Outfit-Bold">Outfit Bold</option>
                                          <option value="Anton">Anton</option>
                                          <option value="Inter-Bold">Inter Bold</option>
                                          <option value="Caveat-Bold">Caveat Bold</option>
                                        </select>
                                      </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2">
                                      <div className="space-y-1">
                                        <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Font Size ({lyricalFontSize}px)</label>
                                        <input
                                          type="range"
                                          min="24"
                                          max="72"
                                          value={lyricalFontSize}
                                          onChange={(e) => setLyricalFontSize(parseInt(e.target.value))}
                                          className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                                        />
                                      </div>
                                      <div className="space-y-1">
                                        <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Stroke Width ({lyricalStrokeWidth}px)</label>
                                        <input
                                          type="range"
                                          min="0"
                                          max="12"
                                          value={lyricalStrokeWidth}
                                          onChange={(e) => setLyricalStrokeWidth(parseInt(e.target.value))}
                                          className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                                        />
                                      </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2">
                                      <div className="space-y-1">
                                        <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Active Neon Color</label>
                                        <select
                                          value={lyricalActiveColor}
                                          onChange={(e) => setLyricalActiveColor(e.target.value)}
                                          className="w-full bg-black/40 border border-white/5 rounded-xl px-2 py-1.5 text-xs text-gray-300 focus:outline-none"
                                        >
                                          <option value="multi">Neon Rainbow (Cycles Colors)</option>
                                          <option value="#ffff00">Neon Yellow</option>
                                          <option value="#00ff00">Neon Green</option>
                                          <option value="#00ffff">Neon Cyan</option>
                                          <option value="#ff007f">Neon Pink</option>
                                          <option value="#ff5500">Neon Orange</option>
                                        </select>
                                      </div>
                                      <div className="space-y-1">
                                        <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Position Y ({(lyricalPositionY * 100).toFixed(0)}%)</label>
                                        <input
                                          type="range"
                                          min="30"
                                          max="90"
                                          step="5"
                                          value={lyricalPositionY * 100}
                                          onChange={(e) => setLyricalPositionY(parseInt(e.target.value) / 100)}
                                          className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                                        />
                                      </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2">
                                      <div className="space-y-1">
                                        <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Stroke Outline Color</label>
                                        <select
                                          value={lyricalStrokeColor}
                                          onChange={(e) => setLyricalStrokeColor(e.target.value)}
                                          className="w-full bg-black/40 border border-white/5 rounded-xl px-2 py-1.5 text-xs text-gray-300 focus:outline-none"
                                        >
                                          <option value="#000000">Black (#000000)</option>
                                          <option value="#ffffff">White (#ffffff)</option>
                                          <option value="#1a1a1a">Charcoal (#1a1a1a)</option>
                                          <option value="#333333">Grey (#333333)</option>
                                          <option value="#4a0404">Dark Red (#4a0404)</option>
                                          <option value="#052e16">Dark Green (#052e16)</option>
                                        </select>
                                      </div>
                                      <div className="space-y-1">
                                        <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Preview BG Loop</label>
                                        {(() => {
                                          const uniqueBgs = Array.from(
                                            new Map(
                                              accounts.flatMap(a => a.backgroundVideos || []).map(v => [v.videoUrl, v])
                                            ).values()
                                          );
                                          return (
                                            <select
                                              value={setupLyricalBgVideoUrl}
                                              onChange={(e) => setSetupLyricalBgVideoUrl(e.target.value)}
                                              className="w-full bg-black/40 border border-white/5 rounded-xl px-2 py-1.5 text-xs text-gray-300 focus:outline-none"
                                            >
                                              <option value="">-- No Video (Gradient Only) --</option>
                                              {uniqueBgs.map((bg, idx) => (
                                                <option key={bg.id || idx} value={bg.videoUrl}>
                                                  Loop {idx + 1} ({bg.videoUrl.split("/").pop()})
                                                </option>
                                              ))}
                                            </select>
                                          );
                                        })()}
                                      </div>
                                    </div>

                                    <div className="grid grid-cols-3 gap-2">
                                      <div className="space-y-1">
                                        <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Color Filter</label>
                                        <select
                                          value={setupLyricalColorFilter}
                                          onChange={(e) => setSetupLyricalColorFilter(e.target.value)}
                                          className="w-full bg-black/40 border border-white/5 rounded-xl px-1.5 py-1.5 text-[10px] text-gray-300 focus:outline-none"
                                        >
                                          <option value="none">Normal (Clear)</option>
                                          <option value="cyberpunk">Cyberpunk (Neon)</option>
                                          <option value="cinema">Cinema (Warm)</option>
                                          <option value="vhs">VHS (Retro Grain)</option>
                                          <option value="monochrome">Moody Mono</option>
                                        </select>
                                      </div>
                                      <div className="space-y-1">
                                        <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Dark Vignette</label>
                                        <select
                                          value={setupLyricalVignette}
                                          onChange={(e) => setSetupLyricalVignette(e.target.value)}
                                          className="w-full bg-black/40 border border-white/5 rounded-xl px-1.5 py-1.5 text-[10px] text-gray-300 focus:outline-none"
                                        >
                                          <option value="none">None (Clear)</option>
                                          <option value="bottom_fade">Bottom Shadow</option>
                                          <option value="radial_vignette">Cinema Vignette</option>
                                        </select>
                                      </div>
                                      <div className="space-y-1">
                                        <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Particle FX</label>
                                        <select
                                          value={setupLyricalParticleFx}
                                          onChange={(e) => setSetupLyricalParticleFx(e.target.value)}
                                          className="w-full bg-black/40 border border-white/5 rounded-xl px-1.5 py-1.5 text-[10px] text-gray-300 focus:outline-none"
                                        >
                                          <option value="none">None</option>
                                          <option value="gold_dust.mp4">Gold Dust</option>
                                          <option value="bokeh.mp4">Golden Bokeh</option>
                                          <option value="fireflies.mp4">Fireflies</option>
                                          <option value="snow.mp4">Falling Snow</option>
                                        </select>
                                      </div>
                                    </div>

                                    <button
                                      type="button"
                                      disabled={preRenderingTemplate}
                                      onClick={() => handlePreRenderTemplate(track.id)}
                                      className="w-full bg-gradient-to-r from-amber-500 to-purple-600 hover:from-amber-600 hover:to-purple-700 text-white font-extrabold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
                                    >
                                      {preRenderingTemplate ? (
                                        <>
                                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                          Pre-rendering overlays...
                                        </>
                                      ) : (
                                        <>
                                          <Sparkles className="w-3.5 h-3.5" />
                                          Pre-render styling overlays
                                        </>
                                      )}
                                    </button>
                                  </div>

                                  {/* Live interactive player canvas */}
                                  {(() => {
                                    let wordsList: any[] = [];
                                    if (track.lyricalTranscription) {
                                      try {
                                        wordsList = JSON.parse(track.lyricalTranscription);
                                      } catch (e) {
                                        console.error("Failed to parse transcription:", e);
                                      }
                                    }

                                    // Group words into chunks client-side (max 3 words, gap 1.5s)
                                    const chunks = (() => {
                                      const res = [];
                                      let currentChunk = [];
                                      for (const w of wordsList) {
                                        if (currentChunk.length === 0) {
                                          currentChunk.push(w);
                                        } else {
                                          const gap = w.start - currentChunk[currentChunk.length - 1].end;
                                          if (currentChunk.length >= 3 || gap > 1.5) {
                                            res.push(currentChunk);
                                            currentChunk = [w];
                                          } else {
                                            currentChunk.push(w);
                                          }
                                        }
                                      }
                                      if (currentChunk.length > 0) {
                                        res.push(currentChunk);
                                      }
                                      return res;
                                    })();

                                    // Find which chunk is active at lyricalPlaybackTime
                                    const activeChunk = chunks.find(chunk => {
                                      if (chunk.length === 0) return false;
                                      const start = chunk[0].start;
                                      const end = chunk[chunk.length - 1].end;
                                      return lyricalPlaybackTime >= start && lyricalPlaybackTime <= end;
                                    });

                                    // Fallback if no exact active chunk is found: show chunk that is closest/before or first chunk
                                    const currentChunk = activeChunk || (() => {
                                      let last = null;
                                      for (const chunk of chunks) {
                                        if (chunk.length === 0) continue;
                                        if (lyricalPlaybackTime >= chunk[0].start) {
                                          last = chunk;
                                        }
                                      }
                                      return last;
                                    })() || chunks[0] || [
                                      { word: "Music", start: 0.0, end: 1.0 },
                                      { word: "Lyrical", start: 1.0, end: 2.0 },
                                      { word: "Preview", start: 2.0, end: 3.0 }
                                    ];

                                    // Map font-family string option to CSS family name
                                    const cssColorFilterStyle = (() => {
                                      if (setupLyricalColorFilter === "cyberpunk") {
                                        return "contrast(1.2) saturate(1.3) hue-rotate(320deg) brightness(0.95)";
                                      }
                                      if (setupLyricalColorFilter === "cinema") {
                                        return "sepia(0.2) contrast(1.1) saturate(1.2) brightness(0.95)";
                                      }
                                      if (setupLyricalColorFilter === "monochrome") {
                                        return "grayscale(1) contrast(1.3) brightness(0.9)";
                                      }
                                      if (setupLyricalColorFilter === "vhs") {
                                        return "contrast(1.1) saturate(0.85) sepia(0.1) brightness(0.95)";
                                      }
                                      return "none";
                                    })();

                                    const cssFontFamily = (() => {
                                      if (lyricalFontFamily === "Montserrat-Black") return "'Montserrat', sans-serif";
                                      if (lyricalFontFamily === "Outfit-Bold") return "'Outfit', sans-serif";
                                      if (lyricalFontFamily === "Anton") return "'Anton', sans-serif";
                                      if (lyricalFontFamily === "Inter-Bold") return "'Inter', sans-serif";
                                      if (lyricalFontFamily === "Caveat-Bold") return "'Caveat', cursive";
                                      return "'Montserrat', sans-serif";
                                    })();

                                    // Map active neon colors
                                    const hexList = ["#FFFF00", "#00FF00", "#00FFFF", "#FF00FF", "#FF5F00", "#FF007F"];
                                    const getWordColor = (w: any, idx: number, isActive: boolean) => {
                                      if (!isActive) return "#ffffff";
                                      if (lyricalActiveColor === "multi") {
                                        return hexList[idx % hexList.length];
                                      }
                                      return lyricalActiveColor;
                                    };

                                    const isPlayingThis = playingTrackId === track.id;
                                    const playPercent = isPlayingThis && track.duration > 0
                                      ? Math.min(100, Math.max(0, (lyricalPlaybackTime / track.duration) * 100))
                                      : 0;

                                    return (
                                      <div className="space-y-3 bg-[#0c0c14]/50 p-4 rounded-3xl border border-white/5 shadow-inner">
                                        <div className="flex justify-between items-center">
                                          <span className="text-[10px] uppercase tracking-wider font-extrabold text-gray-500">Live Typography & Audio Preview</span>
                                          <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded border ${isPlayingThis ? "bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse" : "bg-white/5 text-gray-500 border-white/5"}`}>
                                            {isPlayingThis ? "Playing Sound" : "Paused"}
                                          </span>
                                        </div>

                                        <div 
                                          onClick={() => togglePlayTrack(track)}
                                          className="relative aspect-[9/16] w-full max-w-[170px] mx-auto bg-[#07070d] border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col justify-between group cursor-pointer hover:border-purple-500/30 transition-all duration-300"
                                        >
                                          {/* Background video loop layer */}
                                          {setupLyricalBgVideoUrl ? (
                                            <>
                                              <video
                                                ref={previewVideoRef}
                                                src={resolveUrl(setupLyricalBgVideoUrl)}
                                                className="absolute inset-0 w-full h-full object-cover z-0"
                                                style={{ filter: cssColorFilterStyle }}
                                                muted
                                                loop
                                                playsInline
                                              />
                                              {/* Dark premium glassmorphic overlay over bright background videos */}
                                              <div className="absolute inset-0 bg-black/45 backdrop-blur-[0.5px] z-0 select-none" />
                                            </>
                                          ) : (
                                            <>
                                              {/* Sleek abstract glowing mesh layout background */}
                                              <div 
                                                className="absolute inset-0 bg-gradient-to-b from-[#120521] via-[#050616] to-[#04101e] opacity-90 select-none z-0" 
                                                style={{ filter: cssColorFilterStyle }}
                                              />
                                              <div className="absolute top-[20%] left-[20%] w-[100px] h-[100px] bg-purple-600/10 rounded-full blur-[40px] animate-pulse z-0" />
                                              <div className="absolute bottom-[20%] right-[20%] w-[100px] h-[100px] bg-indigo-500/10 rounded-full blur-[40px] animate-pulse z-0" />
                                            </>
                                          )}

                                          {/* Dynamic Vignette Shadow overlay layer */}
                                          {setupLyricalVignette === "bottom_fade" && (
                                            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent z-[1] pointer-events-none select-none" />
                                          )}
                                          {setupLyricalVignette === "radial_vignette" && (
                                            <div className="absolute inset-0 bg-[radial-gradient(circle,transparent_40%,rgba(0,0,0,0.65)_95%)] z-[1] pointer-events-none select-none" />
                                          )}

                                          {/* Animated Floating Particles Layer */}
                                          {setupLyricalParticleFx !== "none" && (
                                            <div className="absolute inset-0 z-[2] overflow-hidden pointer-events-none select-none">
                                              <div className="absolute w-1.5 h-1.5 bg-amber-400/50 rounded-full blur-[0.5px] top-[90%] left-[15%] animate-float-dust" style={{ animationDelay: "0s", animationDuration: "6s" }} />
                                              <div className="absolute w-2.5 h-2.5 bg-yellow-200/40 rounded-full blur-[1px] top-[80%] left-[45%] animate-float-dust" style={{ animationDelay: "1.5s", animationDuration: "5s" }} />
                                              <div className="absolute w-1.5 h-1.5 bg-white/60 rounded-full top-[95%] left-[75%] animate-float-dust" style={{ animationDelay: "3s", animationDuration: "7s" }} />
                                              <div className="absolute w-2 h-2 bg-amber-300/35 rounded-full blur-[1.5px] top-[75%] left-[60%] animate-float-dust" style={{ animationDelay: "0.5s", animationDuration: "8s" }} />
                                              <div className="absolute w-1.5 h-1.5 bg-yellow-100/50 rounded-full blur-[0.5px] top-[85%] left-[30%] animate-float-dust" style={{ animationDelay: "2.2s", animationDuration: "6.5s" }} />
                                            </div>
                                          )}

                                          {/* Simulated TikTok UI Overlays */}
                                          <div className="absolute right-2.5 bottom-12 flex flex-col items-center gap-3 z-10 text-white/40 pointer-events-none">
                                            <div className="flex flex-col items-center gap-0.5">
                                              <div className="w-5 h-5 rounded-full border border-white/20 bg-white/10 flex items-center justify-center text-[7px] font-bold">♫</div>
                                            </div>
                                            <div className="flex flex-col items-center gap-0.5">
                                              <span className="text-[10px]">❤️</span>
                                              <span className="text-[6px] font-bold">12.5K</span>
                                            </div>
                                            <div className="flex flex-col items-center gap-0.5">
                                              <span className="text-[10px]">💬</span>
                                              <span className="text-[6px] font-bold">342</span>
                                            </div>
                                          </div>

                                          <div className="absolute left-3 bottom-3 flex items-center gap-1.5 z-10 text-white/50 pointer-events-none">
                                            <div className="w-3.5 h-3.5 rounded-full bg-purple-500/30 border border-purple-500/40 flex items-center justify-center text-[6px] font-black uppercase text-purple-300 tracking-wider">L</div>
                                            <div className="text-[7px] leading-tight max-w-[100px] truncate font-semibold">
                                              <p className="text-white/80 font-bold">@sleeckos</p>
                                              <p className="text-[6px] text-white/40">Lyrical Video Composer...</p>
                                            </div>
                                          </div>

                                          {/* Center Play/Pause hover control */}
                                          <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-20">
                                            <div className="w-12 h-12 rounded-full bg-black/60 border border-white/10 flex items-center justify-center text-white shadow-xl shadow-black/50 backdrop-blur-sm">
                                              {isPlayingThis ? (
                                                <svg className="w-5 h-5 fill-current text-purple-400" viewBox="0 0 24 24">
                                                  <rect x="4" y="4" width="4" height="16" rx="1"></rect>
                                                  <rect x="16" y="4" width="4" height="16" rx="1"></rect>
                                                </svg>
                                              ) : (
                                                <svg className="w-5 h-5 fill-current text-amber-400 translate-x-0.5" viewBox="0 0 24 24">
                                                  <path d="M8 5v14l11-7z"></path>
                                                </svg>
                                              )}
                                            </div>
                                          </div>

                                          {/* Live Interactive Caption Block */}
                                          <div 
                                            className="absolute left-0 right-0 px-2.5 text-center transform -translate-y-1/2 transition-all duration-150 z-10 select-none pointer-events-none"
                                            style={{ 
                                              top: `${lyricalPositionY * 100}%`,
                                              fontFamily: cssFontFamily,
                                              fontSize: `${lyricalFontSize * 0.22}px`,
                                              lineHeight: 1.25
                                            }}
                                          >
                                            <div className="flex flex-wrap justify-center items-center gap-x-1 gap-y-0.5">
                                              {currentChunk.map((w: any, idx: number) => {
                                                const isActive = isPlayingThis 
                                                  ? (lyricalPlaybackTime >= w.start && lyricalPlaybackTime <= w.end)
                                                  : (idx === 0);
                                                
                                                const activeColor = getWordColor(w, idx, isActive);
                                                
                                                return (
                                                  <span
                                                    key={idx}
                                                    style={{
                                                      color: isActive ? activeColor : "#ffffff",
                                                      WebkitTextStroke: `${lyricalStrokeWidth * 0.22}px ${lyricalStrokeColor}`,
                                                      textShadow: isActive ? `0 0 8px ${activeColor}cc, 0 0 16px ${activeColor}80` : "none",
                                                      transform: isActive ? "scale(1.1)" : "scale(1.0)",
                                                      transition: "all 0.1s ease-out",
                                                      display: "inline-block"
                                                    }}
                                                    className={`${isActive ? "font-black tracking-tight" : "font-extrabold"}`}
                                                  >
                                                    {w.word}
                                                  </span>
                                                );
                                              })}
                                            </div>
                                          </div>

                                          {/* Progress timeline bar at the bottom */}
                                          <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10 z-20">
                                            <div 
                                              className="h-full bg-gradient-to-r from-amber-500 to-purple-600 transition-all duration-100 ease-linear"
                                              style={{ width: `${playPercent}%` }}
                                            />
                                          </div>
                                        </div>

                                        <div className="flex justify-between items-center text-[9px] text-gray-500 px-1 font-medium">
                                          <span>Playback: {lyricalPlaybackTime.toFixed(1)}s</span>
                                          <span>Total: {track.duration.toFixed(1)}s</span>
                                        </div>
                                      </div>
                                    );
                                  })()}

                                  {/* Pre-rendered templates grid and preview */}
                                  <div className="space-y-3">
                                    <h5 className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400">Available Templates & Captions Preview</h5>
                                    
                                    {loadingTemplatesTrackId === track.id ? (
                                      <div className="flex justify-center items-center py-6">
                                        <RefreshCw className="w-5 h-5 text-purple-500 animate-spin" />
                                      </div>
                                    ) : lyricalTemplates.length === 0 ? (
                                      <p className="text-[10px] text-gray-600 italic">No templates created for this track yet.</p>
                                    ) : (
                                      <div className="space-y-4">
                                        {/* Templates Select Grid */}
                                        <div className="grid grid-cols-2 gap-2 max-h-[160px] overflow-y-auto pr-1">
                                          {lyricalTemplates.map((tpl) => (
                                            <div 
                                              key={tpl.id}
                                              onClick={() => {
                                                setSelectedPreviewTemplateId(tpl.id);
                                                setLyricalTemplateName(tpl.templateName);
                                                setLyricalFontFamily(tpl.fontFamily);
                                                setLyricalFontSize(tpl.fontSize);
                                                setLyricalActiveColor(tpl.activeColor);
                                                setLyricalStrokeWidth(tpl.strokeWidth);
                                                setLyricalStrokeColor(tpl.strokeColor);
                                                setLyricalPositionY(tpl.positionY);
                                              }}
                                              className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                                                selectedPreviewTemplateId === tpl.id 
                                                  ? "bg-purple-500/15 border-purple-500/40 text-white shadow-lg shadow-purple-500/5" 
                                                  : "bg-black/30 border-white/5 text-gray-400 hover:border-white/10"
                                              }`}
                                            >
                                              <p className="text-[11px] font-bold text-white truncate">{tpl.templateName}</p>
                                              <p className="text-[9px] text-gray-500 truncate mt-0.5">{tpl.fontFamily} ({tpl.fontSize}px)</p>
                                            </div>
                                          ))}
                                        </div>

                                        {/* Premium Live Render Preview Box (9:16 aspect ratio representation) */}
                                        {(() => {
                                          const activeTpl = lyricalTemplates.find(t => t.id === selectedPreviewTemplateId);
                                          if (!activeTpl) return null;
                                          return (
                                            <div className="space-y-2 bg-[#0c0c14] p-3 rounded-2xl border border-white/5">
                                              <div className="flex justify-between items-center">
                                                <span className="text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Baked Typography Frame Preview</span>
                                                <span className="text-[9px] text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded uppercase font-bold">{activeTpl.templateName}</span>
                                              </div>
                                              
                                              <div className="relative aspect-[9/16] w-full max-w-[160px] mx-auto bg-black border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex items-center justify-center group">
                                                {/* Preview Image loaded dynamically from Backend */}
                                                <img 
                                                  src={resolveUrl(activeTpl.previewImageUrl)} 
                                                  className="w-full h-full object-cover select-none" 
                                                  alt="Lyrics typography render preview" 
                                                />
                                                {/* Glassmorphic border glow overlay */}
                                                <div className="absolute inset-0 border border-white/5 rounded-2xl pointer-events-none" />
                                              </div>
                                              <p className="text-[9px] text-center text-gray-500 mt-1">Pre-rendered static overlay frame saved on the server</p>
                                            </div>
                                          );
                                        })()}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
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
              <div className="space-y-4">
                {/* Modern cascading filter controls for Sidebar */}
                <div className="bg-[#0c0c14]/85 border border-white/5 p-4 rounded-3xl space-y-3.5 shadow-xl">
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider font-extrabold text-gray-500 mb-1.5">
                      Filter by Niche
                    </label>
                    <select
                      value={selectedNicheFilter}
                      onChange={(e) => {
                        setSelectedNicheFilter(e.target.value);
                        setSelectedGroupFilter("all");
                      }}
                      className="w-full bg-[#141423] border border-white/5 rounded-2xl px-4 py-2.5 text-xs font-bold text-gray-300 focus:outline-none focus:border-amber-500/30"
                    >
                      <option value="all">All Niches</option>
                      {(() => {
                        const sectionsMap = new Map();
                        accounts.forEach(a => {
                          const sec = a.group?.section;
                          if (sec) {
                            sectionsMap.set(sec.id, sec);
                          }
                        });
                        return Array.from(sectionsMap.values()).map(sec => (
                          <option key={sec.id} value={sec.id}>{sec.name}</option>
                        ));
                      })()}
                      <option value="uncategorized">Uncategorized Niches</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase tracking-wider font-extrabold text-gray-500 mb-1.5">
                      Filter by Group
                    </label>
                    <select
                      value={selectedGroupFilter}
                      onChange={(e) => setSelectedGroupFilter(e.target.value)}
                      className="w-full bg-[#141423] border border-white/5 rounded-2xl px-4 py-2.5 text-xs font-bold text-gray-300 focus:outline-none focus:border-amber-500/30"
                      disabled={selectedNicheFilter === "uncategorized"}
                    >
                      <option value="all">All Groups</option>
                      {(() => {
                        const groupsMap = new Map();
                        accounts.forEach(a => {
                          const grp = a.group;
                          const sec = grp?.section;
                          if (grp) {
                            if (selectedNicheFilter === "all" || (sec && sec.id === selectedNicheFilter)) {
                              groupsMap.set(grp.id, grp);
                            }
                          }
                        });
                        return Array.from(groupsMap.values()).map(grp => (
                          <option key={grp.id} value={grp.id}>{grp.name}</option>
                        ));
                      })()}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase tracking-wider font-extrabold text-gray-500 mb-1.5">
                      Account Fast-Select
                    </label>
                    <select
                      value={selectedAccountId || ""}
                      onChange={(e) => {
                        if (e.target.value) {
                          setSelectedAccountId(e.target.value);
                        } else {
                          setSelectedAccountId(null);
                        }
                      }}
                      className="w-full bg-[#141423] border border-white/5 rounded-2xl px-4 py-2.5 text-xs font-bold text-gray-300 focus:outline-none focus:border-amber-500/30"
                    >
                      <option value="">-- Choose Account --</option>
                      {(() => {
                        return accounts
                          .filter(a => {
                            const sec = a.group?.section;
                            const grp = a.group;
                            
                            if (selectedNicheFilter !== "all") {
                              if (selectedNicheFilter === "uncategorized") {
                                if (sec) return false;
                              } else {
                                if (!sec || sec.id !== selectedNicheFilter) return false;
                              }
                            }
                            
                            if (selectedGroupFilter !== "all") {
                              if (!grp || grp.id !== selectedGroupFilter) return false;
                            }
                            
                            return true;
                          })
                          .map(a => (
                            <option key={a.id} value={a.id}>@{a.tiktokUsername}</option>
                          ));
                      })()}
                    </select>
                  </div>
                </div>

                {/* Filtered Collapsible visual tree */}
                {(() => {
                  const filteredList = accounts.filter(a => {
                    const sec = a.group?.section;
                    const grp = a.group;
                    
                    if (selectedNicheFilter !== "all") {
                      if (selectedNicheFilter === "uncategorized") {
                        if (sec) return false;
                      } else {
                        if (!sec || sec.id !== selectedNicheFilter) return false;
                      }
                    }
                    
                    if (selectedGroupFilter !== "all") {
                      if (!grp || grp.id !== selectedGroupFilter) return false;
                    }
                    
                    return true;
                  });

                  if (filteredList.length === 0) {
                    return (
                      <div className="bg-[#0d0d16] border border-white/5 p-8 text-center rounded-3xl">
                        <p className="text-gray-500 text-xs font-semibold">No accounts match the selected filters.</p>
                      </div>
                    );
                  }

                  return getNicheGrouped(filteredList).map((niche) => {
                    const isNicheExpanded = expandedNiches[niche.id] !== false;
                    const nicheColor = niche.color || "#8b5cf6";
                    const nicheAccounts = niche.groups.flatMap(g => g.accounts);
                    const configuredCount = nicheAccounts.filter(a => a.genreConfigs.length > 0).length;

                    return (
                      <div key={niche.id} className="bg-[#0c0c14] border border-white/5 rounded-3xl overflow-hidden shadow-md">
                        <button
                          type="button"
                          onClick={() => toggleNicheCollapse(niche.id)}
                          style={{ borderLeftColor: nicheColor }}
                          className="w-full flex items-center justify-between p-4 bg-[#11111c] hover:bg-[#151528]/80 text-left transition-all duration-300 border-l-4"
                        >
                          <div className="flex items-center gap-2 overflow-hidden mr-2">
                            <Folder className="w-4 h-4 text-gray-400 flex-shrink-0" style={{ color: nicheColor }} />
                            <span className="font-extrabold text-white text-xs uppercase tracking-wider truncate">
                              {niche.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-[9px] font-bold text-gray-400 bg-white/5 border border-white/5 px-2 py-0.5 rounded-md">
                              {configuredCount}/{nicheAccounts.length} Configured
                            </span>
                            {isNicheExpanded ? (
                              <ChevronDown className="w-4 h-4 text-gray-500" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-gray-500" />
                            )}
                          </div>
                        </button>

                        {isNicheExpanded && (
                          <div className="p-3 space-y-3 bg-[#0d0d16]/30 border-t border-white/5">
                            {niche.groups.map((group) => {
                              const isGroupExpanded = expandedGroups[group.id] !== false;
                              const groupConfiguredCount = group.accounts.filter(a => a.genreConfigs.length > 0).length;

                              return (
                                <div key={group.id} className="space-y-2 border border-white/5 rounded-2xl bg-black/20 p-2.5">
                                  <button
                                    type="button"
                                    onClick={() => toggleGroupCollapse(group.id)}
                                    className="w-full flex items-center justify-between px-2.5 py-1 text-left transition-all hover:opacity-80"
                                  >
                                    <div className="flex items-center gap-2">
                                      <Tag className="w-3.5 h-3.5 text-gray-400" />
                                      <span className="font-bold text-gray-300 text-xs truncate">
                                        {group.name}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[8px] font-black uppercase text-gray-500">
                                        {groupConfiguredCount}/{group.accounts.length}
                                      </span>
                                      {isGroupExpanded ? (
                                        <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                                      ) : (
                                        <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
                                      )}
                                    </div>
                                  </button>

                                  {isGroupExpanded && (
                                    <div className="space-y-1.5 pl-2.5">
                                      {group.accounts.map((acc) => {
                                        const hasConfig = acc.genreConfigs.length > 0;
                                        const bgCount = acc.backgroundVideos.length;
                                        const active = selectedAccountId === acc.id;

                                        return (
                                          <button
                                            key={acc.id}
                                            type="button"
                                            onClick={() => setSelectedAccountId(acc.id)}
                                            className={`w-full text-left p-3 rounded-2xl transition-all duration-300 flex items-center justify-between gap-3 border ${
                                              active 
                                                ? "border-amber-500/40 shadow-lg shadow-amber-500/5 bg-[#141221]" 
                                                : "border-white/5 hover:border-white/10 hover:bg-white/[0.01] bg-[#0f0f18]/60"
                                            }`}
                                          >
                                            <div className="flex items-center gap-2.5 overflow-hidden">
                                              <img 
                                                src={acc.tiktokAvatarUrl || "https://www.tiktok.com/favicon.ico"} 
                                                alt={acc.tiktokUsername} 
                                                className="w-7 h-7 rounded-full border border-white/10 bg-white/5 object-cover flex-shrink-0"
                                              />
                                              <span className="font-bold text-white text-xs truncate">@{acc.tiktokUsername}</span>
                                            </div>

                                            <div className="text-right flex-shrink-0 flex items-center gap-1.5">
                                              {hasConfig ? (
                                                <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 bg-green-500/10 text-green-400 border border-green-500/15 rounded-md">
                                                  Configured
                                                </span>
                                              ) : (
                                                <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/15 rounded-md">
                                                  No Config
                                                </span>
                                              )}
                                              <span className="text-[8px] text-gray-500 font-semibold uppercase tracking-wider">
                                                {bgCount} bgs
                                              </span>
                                            </div>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </div>

          {/* Selected Account Configurations & Backgrounds */}
          <div className="lg:col-span-2">
            {selectedAccount ? (
              <div className="space-y-8">
                {/* 2-Column Styling grid: Controls on left, Live 9:16 Crop Mockup Preview on right */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  {/* Left Column: Visual Settings Form (span 7) */}
                  <div className="lg:col-span-7 bg-[#0d0d16] border border-white/5 p-6 rounded-3xl shadow-xl space-y-6">
                    <div className="flex justify-between items-center border-b border-white/5 pb-4">
                      <div className="flex items-center gap-3">
                        <img 
                          src={selectedAccount.tiktokAvatarUrl} 
                          className="w-10 h-10 rounded-full object-cover border border-white/10 bg-white/5"
                          alt=""
                        />
                        <div>
                          <h2 className="text-lg font-black text-white">@{selectedAccount.tiktokUsername} Aesthetics</h2>
                          <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Style Configuration for the Quote Genre</p>
                        </div>
                      </div>
                    </div>

                    <form onSubmit={handleSaveConfig} className="space-y-6">
                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <label className="block text-xs uppercase tracking-wider font-bold text-gray-400">
                            Account Theme / Topic Prompt (Gemini AI context)
                          </label>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Include Theme</span>
                            <input 
                              type="checkbox" 
                              checked={themeEnabled}
                              onChange={(e) => setThemeEnabled(e.target.checked)}
                              className="w-4 h-4 rounded border-white/10 text-amber-500 focus:ring-amber-500/30 bg-[#141423]"
                            />
                          </div>
                        </div>
                        {themeEnabled ? (
                          <>
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
                          </>
                        ) : (
                          <div className="bg-[#141423]/50 border border-dashed border-white/5 rounded-2xl px-4 py-3 text-xs text-gray-500 font-semibold uppercase tracking-wider flex items-center justify-center h-24">
                            Account Theme Disabled (Generic Prompt Fallback)
                          </div>
                        )}
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
                            <option value="Anton">Anton (Heavy, Impressive Impact)</option>
                            <option value="Caveat">Caveat (Bold Cursive Handwriting)</option>
                            <option value="Lora">Lora (Elegant Classic Serif)</option>
                            <option value="Montserrat">Montserrat (Geometric Premium Sans)</option>
                            <option value="Oswald">Oswald (Narrow Tall Gothic)</option>
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
                            min="12"
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
                          <div className="flex gap-2.5 mb-3">
                            {[
                              { hex: "#FFFFFF", name: "Pure White", bg: "bg-white" },
                              { hex: "#FEF08A", name: "Pale Yellow", bg: "bg-yellow-100" },
                              { hex: "#FDE047", name: "Vibrant Yellow", bg: "bg-yellow-400" },
                              { hex: "#F5F5F7", name: "Cream Grey", bg: "bg-[#f5f5f7]" },
                              { hex: "#F87171", name: "Soft Red", bg: "bg-red-400" },
                              { hex: "#6EE7B7", name: "Mint Green", bg: "bg-emerald-300" },
                              { hex: "#93C5FD", name: "Sky Blue", bg: "bg-blue-300" },
                              { hex: "#C084FC", name: "Lavender", bg: "bg-purple-400" }
                            ].map((preset) => {
                              const isActive = fontColor.toLowerCase() === preset.hex.toLowerCase();
                              return (
                                <button
                                  key={preset.hex}
                                  type="button"
                                  onClick={() => setFontColor(preset.hex)}
                                  className={`w-7 h-7 rounded-full border-2 transition-all duration-300 relative hover:scale-110 flex items-center justify-center ${
                                    isActive
                                      ? "border-amber-500 scale-110 shadow-lg shadow-amber-500/20 ring-1 ring-amber-500/30"
                                      : "border-white/10 hover:border-white/30"
                                  }`}
                                  title={preset.name}
                                >
                                  <span className={`w-full h-full rounded-full ${preset.bg}`} />
                                  {isActive && (
                                    <div className="absolute w-2 h-2 rounded-full bg-black flex items-center justify-center">
                                      <Check className="w-1.5 h-1.5 text-amber-500 stroke-[4]" />
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                          <div className="flex gap-3 items-center">
                            <div className="relative flex-1">
                              <input
                                type="text"
                                value={fontColor}
                                onChange={(e) => setFontColor(e.target.value)}
                                placeholder="#FFFFFF"
                                className="w-full bg-[#141423] border border-white/5 rounded-2xl pl-4 pr-10 py-3 text-sm font-bold text-white focus:outline-none focus:border-amber-500/50"
                              />
                              <div className="absolute right-3.5 top-3.5 w-4 h-4 rounded-full border border-white/10 shadow-sm transition-all duration-300" style={{ backgroundColor: fontColor.startsWith("#") ? fontColor : "#ffffff" }} />
                            </div>
                            <div className="relative w-12 h-11 rounded-2xl overflow-hidden border border-white/5 bg-[#141423] flex items-center justify-center hover:border-amber-500/40 transition-all duration-300">
                              <input
                                type="color"
                                value={fontColor.startsWith("#") && fontColor.length === 7 ? fontColor : "#FFFFFF"}
                                onChange={(e) => setFontColor(e.target.value)}
                                className="absolute inset-0 w-full h-full p-0 border-0 cursor-pointer bg-transparent opacity-0 z-10"
                              />
                              <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-red-500 via-green-500 to-blue-500 flex items-center justify-center animate-spin-slow">
                                <div className="w-4 h-4 rounded-full bg-[#141423]" />
                              </div>
                            </div>
                          </div>
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

                        {/* Text Vertical Positioning */}
                        <div>
                          <div className="flex justify-between items-center mb-2">
                            <label className="block text-xs uppercase tracking-wider font-bold text-gray-400">
                              Text Vertical Position (%)
                            </label>
                            <span className="text-xs font-extrabold text-amber-400">{positionY}%</span>
                          </div>
                          <input
                            type="range"
                            min="10"
                            max="90"
                            value={positionY}
                            onChange={(e) => setPositionY(parseInt(e.target.value))}
                            className="w-full h-1.5 bg-[#141423] rounded-lg appearance-none cursor-pointer accent-amber-500"
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

                      {/* Curve Text (Arc Along Path) */}
                      <div className="bg-[#141423]/60 p-4 border border-white/5 rounded-2xl space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <label className="block text-xs uppercase tracking-wider font-bold text-gray-300">
                              Curve Text (Arc Along Path)
                            </label>
                            <span className="text-[10px] text-gray-500 font-medium">Curve text characters along a dynamic SVG path</span>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={curveText}
                              onChange={() => setCurveText(!curveText)}
                              className="sr-only peer"
                            />
                            <div className="w-9 h-5 bg-gray-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-300 after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500 peer-checked:after:bg-black peer-checked:after:border-black"></div>
                          </label>
                        </div>

                        {curveText && (
                          <div className="pt-2 border-t border-white/5 transition-all duration-300">
                            <div className="flex justify-between items-center mb-2">
                              <label className="block text-[11px] uppercase tracking-wider font-bold text-gray-400">
                                Curvature Strength
                              </label>
                              <span className="text-xs font-extrabold text-amber-400">{curvature > 0 ? `+${curvature}` : curvature}</span>
                            </div>
                            <input
                              type="range"
                              min="-100"
                              max="100"
                              value={curvature}
                              onChange={(e) => setCurvature(parseInt(e.target.value))}
                              className="w-full h-1.5 bg-[#0d0d16] rounded-lg appearance-none cursor-pointer accent-amber-500"
                            />
                            <div className="flex justify-between text-[9px] text-gray-500 font-bold uppercase tracking-wider mt-1 px-1">
                              <span>Arch Down</span>
                              <span>Straight</span>
                              <span>Arch Up</span>
                            </div>
                          </div>
                        )}
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

                  {/* Right Column: High-Fidelity 9:16 Live Preview Panel (span 5) */}
                  <div className="lg:col-span-5 bg-[#0d0d16] border border-white/5 p-6 rounded-3xl shadow-xl flex flex-col justify-between space-y-6">
                    <div>
                      <h3 className="text-base font-bold text-white flex items-center gap-2">
                        <Eye className="w-4 h-4 text-amber-500" />
                        Live Aesthetics Preview
                      </h3>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mt-0.5">Real-time video layout overlay simulation</p>
                    </div>

                    {/* Standard 9:16 vertically cropped aspect box */}
                    <div className="relative aspect-[9/16] w-full max-w-[270px] mx-auto rounded-[2rem] overflow-hidden border border-white/10 shadow-2xl bg-black flex flex-col justify-between p-4">
                      {/* Background Loop Source */}
                      {selectedAccount.backgroundVideos.length > 0 ? (
                        <video
                          src={resolveUrl(selectedAccount.backgroundVideos[previewBgIndex]?.videoUrl)}
                          className="absolute inset-0 w-full h-full object-cover"
                          muted
                          loop
                          autoPlay
                          playsInline
                          preload="auto"
                          key={selectedAccount.backgroundVideos[previewBgIndex]?.id}
                          onLoadedData={(e) => {
                            const vid = e.target as HTMLVideoElement;
                            vid.play().catch(err => console.log("Autoplay preview video blocked:", err));
                          }}
                        />
                      ) : (
                        <div className="absolute inset-0 bg-gradient-to-br from-[#1b1a2e] to-[#0c0b14] flex flex-col items-center justify-center p-6 text-center">
                          <Film className="w-8 h-8 text-gray-600 mb-2" />
                          <p className="text-xs text-gray-400 font-bold">No Background Videos</p>
                          <p className="text-[10px] text-gray-600 mt-1.5">Upload loop MP4s below to unlock preview overlays.</p>
                        </div>
                      )}

                      {/* Dark Overlay Mockup Layer */}
                      <div className="absolute inset-0 bg-black/10 pointer-events-none" />

                      {/* Right side floating buttons mockup */}
                      <div className="absolute right-3.5 bottom-20 flex flex-col items-center gap-4 pointer-events-none opacity-85 z-10">
                        <div className="w-9 h-9 rounded-full border border-white/20 bg-black/40 backdrop-blur-md flex items-center justify-center">
                          <img src={selectedAccount.tiktokAvatarUrl || "https://www.tiktok.com/favicon.ico"} className="w-7 h-7 rounded-full object-cover" alt="" />
                        </div>
                        <div className="flex flex-col items-center">
                          <div className="w-8 h-8 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white">
                            <svg className="w-4 h-4 fill-white" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                          </div>
                          <span className="text-[8px] text-white font-extrabold mt-0.5">24.5K</span>
                        </div>
                        <div className="flex flex-col items-center">
                          <div className="w-8 h-8 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white">
                            <svg className="w-4 h-4 fill-white" viewBox="0 0 24 24"><path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18z"/></svg>
                          </div>
                          <span className="text-[8px] text-white font-extrabold mt-0.5">1,050</span>
                        </div>
                      </div>

                      {/* Bottom music disk spinner mockup */}
                      <div className="absolute right-3.5 bottom-6 pointer-events-none opacity-85 z-10">
                        <div className="w-8 h-8 rounded-full bg-black/60 border border-white/20 flex items-center justify-center animate-spin" style={{ animationDuration: "4s" }}>
                          <Music className="w-3.5 h-3.5 text-white" />
                        </div>
                      </div>

                      {/* Canvas Overlay text reacting live to inputs */}
                      {(() => {
                        const isClearBox = !boxColor || boxColor === "none";
                        const displayQuote = themeText ? applyTextCase(themeText, textCase) : applyTextCase("Be the change you wish to see in the world.", textCase);
                        return (
                          <div 
                            style={{
                              position: "absolute",
                              left: "0",
                              right: "0",
                              top: `${positionY}%`,
                              transform: "translateY(-50%)",
                              pointerEvents: "none",
                              zIndex: 10,
                              display: "flex",
                              justifyContent: "center",
                              padding: "0 16px",
                              transition: "top 0.2s ease",
                            }}
                          >
                            <div 
                              style={{
                                fontFamily: getCssFontFamily(fontFamily),
                                fontSize: `${Math.max(10, fontSize * 0.38)}px`,
                                color: fontColor,
                                textTransform: textCase === "UPPERCASE" ? "uppercase" : textCase === "lowercase" ? "lowercase" : "none",
                                backgroundColor: isClearBox ? "transparent" : getCssRgba(boxColor),
                                textShadow: getCssTextShadow(shadowColor),
                                lineHeight: `${(fontSize + lineSpacing) / fontSize}`,
                                borderRadius: isClearBox ? "0px" : (curveText ? "20px" : "0px"),
                                padding: isClearBox ? "0px" : (curveText ? "16px 20px" : "10px 14px"),
                                boxShadow: isClearBox ? "none" : undefined,
                                border: isClearBox ? "none" : "1px solid rgba(255, 255, 255, 0.05)",
                                transition: "all 0.2s ease",
                              }}
                              className={`text-center font-bold max-w-[95%] break-words pointer-events-auto ${isClearBox ? "" : "shadow-xl"}`}
                            >
                              {curveText ? (
                                <div className="flex flex-col items-center justify-center w-full">
                                  <svg viewBox="0 0 300 160" className="w-full overflow-visible">
                                    <path 
                                      id="previewCurvePath" 
                                      d={`M 20 110 Q 150 ${110 - curvature} 280 110`} 
                                      fill="none" 
                                      stroke="none"
                                    />
                                    <text 
                                      style={{
                                        fontFamily: getCssFontFamily(fontFamily),
                                        fontSize: `${Math.max(10, fontSize * 0.38)}px`,
                                        textShadow: getCssTextShadow(shadowColor),
                                        letterSpacing: "1px",
                                      }}
                                      fill={fontColor}
                                      className="font-bold"
                                    >
                                      <textPath 
                                        href="#previewCurvePath" 
                                        startOffset="50%" 
                                        textAnchor="middle"
                                      >
                                        {displayQuote}
                                      </textPath>
                                    </text>
                                  </svg>
                                  <div 
                                    style={{
                                      fontFamily: getCssFontFamily(fontFamily),
                                      color: fontColor,
                                      textShadow: getCssTextShadow(shadowColor),
                                      marginTop: "4px"
                                    }}
                                    className="text-[0.62em] opacity-80 font-medium text-center"
                                  >
                                    - Marcus Aurelius
                                  </div>
                                </div>
                              ) : (
                                <>
                                  "{displayQuote}"
                                  <div className="text-[0.62em] opacity-80 mt-1.5 font-medium">
                                    - Marcus Aurelius
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })()}

                      {/* TikTok bottom caption mockup details */}
                      <div className="mt-auto w-full z-10 p-2 bg-gradient-to-t from-black/80 to-transparent rounded-b-2xl pointer-events-none text-left">
                        <p className="text-[10px] font-black text-white">@{selectedAccount.tiktokUsername}</p>
                        <p className="text-[9px] text-gray-300 mt-0.5 line-clamp-2 leading-snug">Daily motivation niche context: {themeText || "Stoicism wisdom guides daily..."} #motivation #quotes</p>
                        <div className="flex items-center gap-1 mt-1.5 text-[9px] text-white font-medium">
                          <Music className="w-2.5 h-2.5 text-amber-500 animate-pulse" />
                          <span className="truncate">Original Sound - @{selectedAccount.tiktokUsername}</span>
                        </div>
                      </div>
                    </div>

                    {/* Pagination indicators to switch loops in real time */}
                    {selectedAccount.backgroundVideos.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[9px] text-center text-gray-500 font-extrabold uppercase tracking-wider">
                          Loop Selector: {previewBgIndex + 1} of {selectedAccount.backgroundVideos.length}
                        </p>
                        <div className="flex justify-center items-center gap-1.5">
                          {selectedAccount.backgroundVideos.map((_, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setPreviewBgIndex(idx)}
                              className={`w-2 h-2 rounded-full transition-all duration-300 ${
                                previewBgIndex === idx ? "bg-amber-500 w-4.5" : "bg-white/20 hover:bg-white/40"
                              }`}
                              title={`Preview Background #${idx + 1}`}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Google Drive Folder Configuration ── */}
                <div className="bg-[#0d0d16] border border-white/5 p-6 rounded-3xl shadow-xl space-y-5 text-left">
                  <div>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      <Folder className="w-5 h-5 text-blue-400" />
                      Google Drive Folder Configuration
                    </h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Select or paste the Google Drive folder where videos generated for this account will be automatically uploaded.
                    </p>
                  </div>

                  {selectedAccount.driveFolderId ? (
                    <div className="space-y-4">
                      {/* Active Folder Status */}
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-blue-500/10 border border-blue-500/20 rounded-2xl px-5 py-4">
                        <div className="overflow-hidden flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            {selectedAccount.googleOAuthConnected && (
                              <span className="flex items-center gap-1 bg-green-500/10 text-green-400 text-[10px] font-black uppercase px-2 py-0.5 rounded-full border border-green-500/20">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                                Google Account Connected
                              </span>
                            )}
                            <p className="text-sm text-blue-300 font-bold truncate">
                              {selectedAccount.googleOAuthConnected
                                ? `OAuth: ${selectedAccount.driveFolderName || "Sleeckos Videos"}`
                                : selectedAccount.driveFolderName || "Drive Folder"}
                            </p>
                          </div>
                          <p className="text-xs text-blue-400/60 font-mono mt-1 truncate">ID: {selectedAccount.driveFolderId}</p>
                        </div>
                        <div className="flex sm:flex-col items-end gap-2 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => unlinkDrive(selectedAccount.id, false)}
                            className="bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 text-xs font-bold px-3 py-2 rounded-xl transition-all"
                            title="Remove the folder link but keep Google OAuth logged in"
                          >
                            Unlink Folder
                          </button>
                          {selectedAccount.googleOAuthConnected && (
                            <button
                              type="button"
                              onClick={() => unlinkDrive(selectedAccount.id, true)}
                              className="text-red-400 hover:text-red-300 text-[10px] font-semibold transition-colors"
                              title="Disconnect and log out of Google completely"
                            >
                              Disconnect Google Account
                            </button>
                          )}
                        </div>
                      </div>

                      {foldersList.length > 0 ? (
                        <div className="space-y-2.5 pl-3.5 border-l-2 border-blue-500/20">
                          <div className="flex justify-between items-center">
                            <label className="block text-[10px] text-gray-500 font-extrabold uppercase tracking-wider">Select Folder Specifically</label>
                            <button
                              onClick={() => fetchFolders(selectedAccount.id)}
                              className="text-[9px] text-blue-400 hover:text-blue-300 transition-colors font-semibold"
                              type="button"
                            >
                              🔄 Refresh List
                            </button>
                          </div>
                          
                          {/* Search input filter */}
                          <input
                            type="text"
                            placeholder="🔍 Filter folders by name or ID..."
                            value={folderSearchQuery}
                            onChange={(e) => setFolderSearchQuery(e.target.value)}
                            className="w-full bg-[#141423] border border-white/5 rounded-2xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500 placeholder-gray-600 transition-colors"
                          />

                          <div className="flex gap-2">
                            <select
                              value={selectedFolderId}
                              onChange={(e) => setSelectedFolderId(e.target.value)}
                              className="flex-1 bg-[#141423] border border-white/5 rounded-2xl px-4 py-3 text-xs text-white focus:outline-none focus:border-blue-500 placeholder-gray-700 transition-colors"
                            >
                              <option value="" className="bg-[#11111c]">-- Choose Folder --</option>
                              {foldersList.filter(f => 
                                f.name.toLowerCase().includes(folderSearchQuery.toLowerCase()) || 
                                f.id.toLowerCase().includes(folderSearchQuery.toLowerCase())
                              ).map((f) => (
                                <option key={f.id} value={f.id} className="bg-[#11111c]">
                                  {f.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => linkSelectedFolder(selectedAccount.id)}
                              disabled={!selectedFolderId || linkingDrive}
                              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-xs font-bold text-white px-4 py-3 rounded-2xl transition-all flex items-center gap-1.5 flex-shrink-0"
                            >
                              {linkingDrive && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                              Select
                            </button>
                          </div>
                          
                          {foldersList.filter(f => 
                            f.name.toLowerCase().includes(folderSearchQuery.toLowerCase()) || 
                            f.id.toLowerCase().includes(folderSearchQuery.toLowerCase())
                          ).length === 0 && folderSearchQuery && (
                            <p className="text-[10px] text-amber-400/80 italic pl-1">No matching folders found.</p>
                          )}
                        </div>
                      ) : loadingFolders ? (
                        <div className="flex items-center gap-2 text-xs text-gray-400 pl-3.5">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                          Fetching folders list from Google...
                        </div>
                      ) : null}

                      {/* Inline Overwrite Link paste */}
                      <div className="space-y-2.5 pl-3.5 border-l-2 border-blue-500/20">
                        <label className="block text-[10px] text-gray-500 font-extrabold uppercase tracking-wider">Or Paste Folder Link</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={driveUrl}
                            onChange={(e) => setDriveUrl(e.target.value)}
                            placeholder="Paste new Google Drive folder URL or ID..."
                            className="flex-1 bg-[#141423] border border-white/5 rounded-2xl px-4 py-3 text-xs text-white focus:outline-none focus:border-blue-500 placeholder-gray-700 transition-colors"
                          />
                          <button
                            type="button"
                            onClick={() => linkDrive(selectedAccount.id)}
                            disabled={!driveUrl.trim() || linkingDrive}
                            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-xs font-bold text-white px-4 py-3 rounded-2xl transition-all flex items-center gap-1.5 flex-shrink-0"
                          >
                            {linkingDrive && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            Change
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Premium Connect Google Drive button */}
                      <div className="flex flex-col sm:flex-row gap-3">
                        <a
                          href={`/api/managed/accounts/${selectedAccount.id}/auth/google?section=${selectedAccount.group?.section?.slug || "uncategorized"}&group=${selectedAccount.group?.slug || "uncategorized"}`}
                          className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-black uppercase tracking-wider py-4 rounded-2xl transition-all shadow-lg hover:shadow-purple-500/25 hover:scale-[1.01]"
                        >
                          <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12.24 10.285V14.4h6.887c-.648 2.41-2.519 4.114-5.136 4.114-3.51 0-6.357-2.846-6.357-6.357s2.846-6.357 6.357-6.357c1.616 0 3.084.604 4.225 1.597L21.3 4.316C19.043 2.214 15.938 1 12.24 1c-6.076 0-11 4.924-11 11s4.924 11 11 11c6.34 0 10.55-4.46 10.55-10.74 0-.74-.08-1.285-.2-1.974h-10.35z"/>
                          </svg>
                          Connect Google Drive (OAuth)
                        </a>
                      </div>

                      {foldersList.length > 0 ? (
                        <div className="space-y-2.5">
                          <div className="flex justify-between items-center">
                            <label className="block text-[10px] text-gray-500 font-extrabold uppercase tracking-wider">Select Folder Specifically</label>
                            <button
                              onClick={() => fetchFolders(selectedAccount.id)}
                              className="text-[9px] text-blue-400 hover:text-blue-300 transition-colors font-semibold"
                              type="button"
                            >
                              🔄 Refresh List
                            </button>
                          </div>
                          
                          {/* Search input filter */}
                          <input
                            type="text"
                            placeholder="🔍 Filter folders by name or ID..."
                            value={folderSearchQuery}
                            onChange={(e) => setFolderSearchQuery(e.target.value)}
                            className="w-full bg-[#141423] border border-white/5 rounded-2xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500 placeholder-gray-600 transition-colors"
                          />

                          <div className="flex gap-2">
                            <select
                              value={selectedFolderId}
                              onChange={(e) => setSelectedFolderId(e.target.value)}
                              className="flex-1 bg-[#141423] border border-white/5 rounded-2xl px-4 py-3 text-xs text-white focus:outline-none focus:border-blue-500 placeholder-gray-700 transition-colors"
                            >
                              <option value="" className="bg-[#11111c]">-- Choose Folder --</option>
                              {foldersList.filter(f => 
                                f.name.toLowerCase().includes(folderSearchQuery.toLowerCase()) || 
                                f.id.toLowerCase().includes(folderSearchQuery.toLowerCase())
                              ).map((f) => (
                                <option key={f.id} value={f.id} className="bg-[#11111c]">
                                  {f.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => linkSelectedFolder(selectedAccount.id)}
                              disabled={!selectedFolderId || linkingDrive}
                              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-xs font-bold text-white px-4 py-3 rounded-2xl transition-all flex items-center gap-1.5 flex-shrink-0"
                            >
                              {linkingDrive && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                              Select
                            </button>
                          </div>

                          {foldersList.filter(f => 
                            f.name.toLowerCase().includes(folderSearchQuery.toLowerCase()) || 
                            f.id.toLowerCase().includes(folderSearchQuery.toLowerCase())
                          ).length === 0 && folderSearchQuery && (
                            <p className="text-[10px] text-amber-400/80 italic pl-1">No matching folders found.</p>
                          )}
                        </div>
                      ) : loadingFolders ? (
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                          Fetching folders list from Google...
                        </div>
                      ) : null}

                      {/* Divider */}
                      <div className="relative flex py-1 items-center">
                        <div className="flex-grow border-t border-white/5"></div>
                        <span className="flex-shrink mx-3 text-[10px] text-gray-600 font-extrabold uppercase tracking-wider">Or paste folder URL</span>
                        <div className="flex-grow border-t border-white/5"></div>
                      </div>

                      {/* Paste URL linking */}
                      <div className="space-y-2">
                        <p className="text-[10px] text-gray-500 leading-relaxed">
                          Or paste a Google Drive folder URL or ID. Uploads will automatically authorize using your Master/Global Google OAuth account quota.
                        </p>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={driveUrl}
                            onChange={(e) => setDriveUrl(e.target.value)}
                            placeholder="https://drive.google.com/drive/folders/..."
                            className="flex-1 bg-[#141423] border border-white/5 rounded-2xl px-4 py-3 text-xs text-white focus:outline-none focus:border-blue-500 placeholder-gray-700 transition-colors"
                          />
                          <button
                            type="button"
                            onClick={() => linkDrive(selectedAccount.id)}
                            disabled={!driveUrl.trim() || linkingDrive}
                            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-xs font-bold text-white px-4 py-3 rounded-2xl transition-all flex items-center gap-1.5 flex-shrink-0"
                          >
                            {linkingDrive && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            Link Folder
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
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
                          key={bg.id}
                          src={resolveUrl(bg.videoUrl)}
                          className="w-full h-full object-cover"
                          muted
                          loop
                          autoPlay
                          playsInline
                          preload="auto"
                          onLoadedData={(e) => {
                            const vid = e.target as HTMLVideoElement;
                            vid.play().catch(err => console.log("Autoplay gallery loop blocked:", err));
                          }}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 flex flex-col justify-end p-3 text-left">
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
              </div>
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
          
          {/* Multi-Genre Wizard Selection Bar */}
          <div className="border-b border-white/5 pb-6 text-left">
            <h2 className="text-xl font-bold text-white mb-4">Bulk Video Composer</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-[#11111c] p-2 rounded-2xl border border-white/5">
              {/* Quote Genre (Active) */}
              <button
                type="button"
                onClick={() => {
                  setWizardGenre("quote");
                  setWizardStep(1);
                }}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-extrabold text-xs tracking-wider uppercase transition-all shadow-md ${
                  wizardGenre === "quote"
                    ? "bg-amber-500/10 border border-amber-500/20 text-amber-400 shadow-amber-500/5 cursor-default"
                    : "bg-white/[0.02] border border-white/5 text-gray-400 hover:text-white"
                }`}
              >
                <Sparkles className="w-4 h-4" />
                Quotes Composer
              </button>

              {/* Lyrical Genre (Unlocked!) */}
              <button
                type="button"
                onClick={() => {
                  setWizardGenre("lyrical");
                  setWizardStep(1);
                  // Default to first lyrical track
                  const firstLyrical = tracks.find(t => t.isLyrical);
                  if (firstLyrical) {
                    setSelectedLyricalTrackId(firstLyrical.id);
                    fetchLyricalTemplates(firstLyrical.id);
                  }
                }}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-extrabold text-xs tracking-wider uppercase transition-all shadow-md ${
                  wizardGenre === "lyrical"
                    ? "bg-purple-500/10 border border-purple-500/20 text-purple-400 shadow-purple-500/5 cursor-default"
                    : "bg-white/[0.02] border border-white/5 text-gray-400 hover:text-white"
                }`}
              >
                <Music className="w-4 h-4" />
                Lyrical Composer
              </button>

              {/* K-Pop Genre (Locked Placeholder) */}
              <div 
                className="relative group flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white/[0.02] border border-white/5 text-gray-500 font-bold text-xs tracking-wider uppercase select-none cursor-not-allowed transition-all hover:bg-white/[0.04]"
                title="K-Pop composer is locked"
              >
                <Lock className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />
                <span>K-Pop</span>
                {/* Custom premium glassmorphic tooltip */}
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block bg-[#0f0f18]/95 border border-white/10 px-3 py-1.5 rounded-xl shadow-xl backdrop-blur-md text-[10px] text-gray-300 font-bold uppercase tracking-wider text-center w-48 z-20 pointer-events-none">
                  K-Pop Composer <span className="text-purple-400">Coming Soon</span>
                </div>
              </div>

              {/* Pop Genre (Locked Placeholder) */}
              <div 
                className="relative group flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white/[0.02] border border-white/5 text-gray-500 font-bold text-xs tracking-wider uppercase select-none cursor-not-allowed transition-all hover:bg-white/[0.04]"
                title="Pop composer is locked"
              >
                <Lock className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />
                <span>Pop Music</span>
                {/* Custom premium glassmorphic tooltip */}
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block bg-[#0f0f18]/95 border border-white/10 px-3 py-1.5 rounded-xl shadow-xl backdrop-blur-md text-[10px] text-gray-300 font-bold uppercase tracking-wider text-center w-48 z-20 pointer-events-none">
                  Pop Composer <span className="text-purple-400">Coming Soon</span>
                </div>
              </div>
            </div>
          </div>
          
          {/* Steps Indicator */}
          {wizardGenre === "lyrical" ? (
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-[#141423] p-4 rounded-3xl border border-white/5">
              <div className="flex items-center gap-2">
                <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
                  wizardStep === 1 ? "bg-purple-500 text-white shadow-lg shadow-purple-500/20" : "bg-gray-800 text-gray-500"
                }`}>1</span>
                <span className={`text-sm font-bold ${wizardStep === 1 ? "text-white" : "text-gray-500"}`}>Batch Settings</span>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-600 hidden md:block" />
              
              <div className="flex items-center gap-2">
                <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
                  wizardStep === 4 ? "bg-purple-500 text-white shadow-lg shadow-purple-500/20" : "bg-gray-800 text-gray-500"
                }`}>2</span>
                <span className={`text-sm font-bold ${wizardStep === 4 ? "text-white" : "text-gray-500"}`}>Composition Render</span>
              </div>
            </div>
          ) : (
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
          )}

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
                    {batchPostsTotal}
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1 font-semibold">
                    Automatically calculated count
                  </p>
                </div>
              </div>

              {/* Cascading Filter Controls for Step 1 Accounts Grid */}
              <div className="bg-[#0c0c14]/60 border border-white/5 p-4 rounded-3xl space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider font-extrabold text-gray-500 mb-1.5">
                      Filter by Niche
                    </label>
                    <select
                      value={wizardNicheFilter}
                      onChange={(e) => {
                        setWizardNicheFilter(e.target.value);
                        setWizardGroupFilter("all");
                      }}
                      className="w-full bg-[#141423] border border-white/5 rounded-2xl px-4 py-2.5 text-xs font-bold text-gray-300 focus:outline-none focus:border-amber-500/30"
                    >
                      <option value="all">All Niches</option>
                      {(() => {
                        const sectionsMap = new Map();
                        accounts.forEach(a => {
                          const sec = a.group?.section;
                          if (sec) {
                            sectionsMap.set(sec.id, sec);
                          }
                        });
                        return Array.from(sectionsMap.values()).map(sec => (
                          <option key={sec.id} value={sec.id}>{sec.name}</option>
                        ));
                      })()}
                      <option value="uncategorized">Uncategorized Niches</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase tracking-wider font-extrabold text-gray-500 mb-1.5">
                      Filter by Group
                    </label>
                    <select
                      value={wizardGroupFilter}
                      onChange={(e) => setWizardGroupFilter(e.target.value)}
                      className="w-full bg-[#141423] border border-white/5 rounded-2xl px-4 py-2.5 text-xs font-bold text-gray-300 focus:outline-none focus:border-amber-500/30"
                      disabled={wizardNicheFilter === "uncategorized"}
                    >
                      <option value="all">All Groups</option>
                      {(() => {
                        const groupsMap = new Map();
                        accounts.forEach(a => {
                          const grp = a.group;
                          const sec = grp?.section;
                          if (grp) {
                            if (wizardNicheFilter === "all" || (sec && sec.id === wizardNicheFilter)) {
                              groupsMap.set(grp.id, grp);
                            }
                          }
                        });
                        return Array.from(groupsMap.values()).map(grp => (
                          <option key={grp.id} value={grp.id}>{grp.name}</option>
                        ));
                      })()}
                    </select>
                  </div>
                </div>

                <div className="flex gap-2.5 pt-3 border-t border-white/5">
                  <button
                    type="button"
                    onClick={() => {
                      const visibleValid = accounts
                        .filter(acc => {
                          const sec = acc.group?.section;
                          const grp = acc.group;
                          
                          if (wizardNicheFilter !== "all") {
                            if (wizardNicheFilter === "uncategorized") {
                              if (sec) return false;
                            } else {
                              if (!sec || sec.id !== wizardNicheFilter) return false;
                            }
                          }
                          
                          if (wizardGroupFilter !== "all") {
                            if (!grp || grp.id !== wizardGroupFilter) return false;
                          }
                          
                          const isConfigured = acc.genreConfigs.length > 0;
                          const hasBgs = acc.backgroundVideos.length > 0;
                          return isConfigured && hasBgs && acc.driveFolderId;
                        })
                        .map(a => a.id);
                      
                      const otherSelected = selectedBatchAccountIds.filter(id => !accounts.some(a => {
                        if (a.id !== id) return false;
                        const sec = a.group?.section;
                        const grp = a.group;
                        if (wizardNicheFilter !== "all") {
                          if (wizardNicheFilter === "uncategorized") {
                            if (sec) return true;
                          } else {
                            if (!sec || sec.id !== wizardNicheFilter) return true;
                          }
                        }
                        if (wizardGroupFilter !== "all") {
                          if (!grp || grp.id !== wizardGroupFilter) return true;
                        }
                        return false;
                      }));

                      const updated = Array.from(new Set([...otherSelected, ...visibleValid]));
                      setSelectedBatchAccountIds(updated);
                      setBatchPostsTotal(updated.length * postsPerAccount);
                    }}
                    className="text-[10px] text-amber-400 hover:text-amber-300 font-extrabold uppercase tracking-widest bg-amber-500/10 border border-amber-500/20 px-3 py-2 rounded-xl transition-all"
                  >
                    Select All Configured
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const updated = selectedBatchAccountIds.filter(id => !accounts.some(a => {
                        if (a.id !== id) return false;
                        const sec = a.group?.section;
                        const grp = a.group;
                        if (wizardNicheFilter !== "all") {
                          if (wizardNicheFilter === "uncategorized") {
                            if (sec) return false;
                          } else {
                            if (!sec || sec.id !== wizardNicheFilter) return false;
                          }
                        }
                        if (wizardGroupFilter !== "all") {
                          if (!grp || grp.id !== wizardGroupFilter) return false;
                        }
                        return true;
                      }));
                      setSelectedBatchAccountIds(updated);
                      setBatchPostsTotal(updated.length * postsPerAccount);
                    }}
                    className="text-[10px] text-gray-400 hover:text-gray-300 font-extrabold uppercase tracking-widest bg-white/5 border border-white/5 px-3 py-2 rounded-xl transition-all"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                  {(() => {
                    const filteredWizard = accounts.filter(a => {
                      const sec = a.group?.section;
                      const grp = a.group;
                      
                      if (wizardNicheFilter !== "all") {
                        if (wizardNicheFilter === "uncategorized") {
                          if (sec) return false;
                        } else {
                          if (!sec || sec.id !== wizardNicheFilter) return false;
                        }
                      }
                      
                      if (wizardGroupFilter !== "all") {
                        if (!grp || grp.id !== wizardGroupFilter) return false;
                      }
                      
                      return true;
                    });

                    if (filteredWizard.length === 0) {
                      return (
                        <div className="bg-[#0d0d16] border border-white/5 p-12 text-center rounded-3xl">
                          <p className="text-gray-500 text-xs font-bold">No accounts match the active wizard filters.</p>
                        </div>
                      );
                    }

                    return getNicheGrouped(filteredWizard).map((niche) => {
                      const nicheColor = niche.color || "#8b5cf6";
                      const nicheAccounts = niche.groups.flatMap(g => g.accounts);
                      const configuredCount = nicheAccounts.filter(a => a.genreConfigs.length > 0).length;
                      
                      const allNicheIds = nicheAccounts.filter(acc => acc.genreConfigs.length > 0 && acc.backgroundVideos.length > 0 && acc.driveFolderId).map(a => a.id);
                      const isNicheFullySelected = allNicheIds.length > 0 && allNicheIds.every(id => selectedBatchAccountIds.includes(id));

                      return (
                        <div key={niche.id} className="border border-white/5 rounded-3xl overflow-hidden bg-black/10">
                          {/* Niche Header Bar */}
                          <div className="flex items-center justify-between p-4 bg-[#11111c]/60 border-b border-white/5">
                            <div className="flex items-center gap-2 overflow-hidden mr-2">
                              <span className="w-1.5 h-3.5 rounded-full flex-shrink-0" style={{ backgroundColor: nicheColor }} />
                              <span className="font-extrabold text-white text-xs uppercase tracking-wider truncate">
                                {niche.name} ({configuredCount}/{nicheAccounts.length} Configured)
                              </span>
                            </div>
                            <div>
                              <button
                                type="button"
                                onClick={() => toggleSelectNiche(niche, !isNicheFullySelected)}
                                className={`text-[9px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-lg border transition-all ${
                                  isNicheFullySelected 
                                    ? "bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-500/20" 
                                    : "bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border-amber-500/20"
                                }`}
                              >
                                {isNicheFullySelected ? "Deselect Niche" : "Select Niche"}
                              </button>
                            </div>
                          </div>

                          {/* Groups inside Niche */}
                          <div className="p-4 space-y-4">
                            {niche.groups.map((group) => {
                              const groupAccounts = group.accounts;
                              const allGroupIds = groupAccounts.filter(acc => acc.genreConfigs.length > 0 && acc.backgroundVideos.length > 0 && acc.driveFolderId).map(a => a.id);
                              const isGroupFullySelected = allGroupIds.length > 0 && allGroupIds.every(id => selectedBatchAccountIds.includes(id));

                              return (
                                <div key={group.id} className="space-y-3 bg-[#0d0d16]/30 border border-white/5 p-3 rounded-2xl">
                                  {/* Group Title Bar */}
                                  <div className="flex items-center justify-between border-b border-white/5 pb-2">
                                    <span className="font-bold text-gray-300 text-xs">
                                      {group.name} ({groupAccounts.length} Accounts)
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => toggleSelectGroup(group, !isGroupFullySelected)}
                                      className="text-[9px] font-black uppercase text-amber-500 bg-amber-500/5 hover:bg-amber-500/10 border border-amber-500/15 px-2 py-0.5 rounded"
                                    >
                                      {isGroupFullySelected ? "Deselect Group" : "Select Group"}
                                    </button>
                                  </div>

                                  {/* Accounts Cards inside Group */}
                                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                                    {group.accounts.map((acc) => {
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
                                            disabled && acc.driveFolderId ? "opacity-35 cursor-not-allowed border-white/5 bg-[#0a0a0f]" :
                                            disabled && !acc.driveFolderId ? "border-white/5 bg-[#0d0d16]/80 hover:border-white/10" :
                                            isSelected ? "border-amber-500/50 bg-[#141221]" : "border-white/5 bg-[#0d0d16] hover:border-white/10"
                                          }`}
                                        >
                                          <div className={`w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 ${
                                            isSelected ? "bg-amber-500 border-amber-500 text-black" : "border-white/10 bg-black/40"
                                          }`}>
                                            {isSelected && <Check className="w-3.5 h-3.5 stroke-[4]" />}
                                          </div>
                                          <img src={acc.tiktokAvatarUrl} className="w-9 h-9 rounded-full object-cover flex-shrink-0 bg-white/5" alt="" />
                                          <div className="space-y-0.5 overflow-hidden flex-1">
                                            <p className="text-xs font-bold text-white leading-tight truncate">@{acc.tiktokUsername}</p>
                                            {disabled ? (
                                              <div>
                                                <p className="text-[8px] text-red-400 font-semibold uppercase tracking-wider truncate mb-1">
                                                  {!isConfigured ? "No theme config" : !hasBgs ? "No loops uploaded" : "No Drive folder"}
                                                </p>
                                                {!acc.driveFolderId && (
                                                  <InlineFolderLinker accountId={acc.id} onLinked={fetchAccounts} />
                                                )}
                                              </div>
                                            ) : (
                                              <div className="flex items-center gap-2">
                                                <p className="text-[8px] text-gray-500 font-semibold uppercase tracking-wider">Configured</p>
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (confirm("Change Google Drive folder for this account?")) {
                                                      fetch(`/api/managed/accounts/${acc.id}/link-drive`, { method: "DELETE" }).then(() => {
                                                        toast.success("Folder unlinked");
                                                        fetchAccounts();
                                                      });
                                                    }
                                                  }}
                                                  className="text-[8px] text-red-400 hover:underline"
                                                >
                                                  (Change)
                                                </button>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>

              {/* Lyrical Track & Template or Quote Content Input Source Selection */}
              {wizardGenre === "lyrical" ? (
                <div className="bg-[#0c0c14]/40 border border-white/5 p-6 rounded-3xl space-y-6 text-left">
                  <div>
                    <h4 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                      <Music className="w-4 h-4 text-purple-400" />
                      Lyrical Track & Template Select
                    </h4>
                    <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider mt-0.5">Select a designated lyrical track and one of its pre-rendered overlays to overlay onto background loops</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Selectors Column */}
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="block text-xs uppercase tracking-wider font-bold text-gray-400">1. Select Aligned Lyrical Track</label>
                        <select
                          value={selectedLyricalTrackId}
                          onChange={(e) => {
                            const trackId = e.target.value;
                            setSelectedLyricalTrackId(trackId);
                            setSelectedLyricalTemplateId("");
                            if (trackId) {
                              fetchLyricalTemplates(trackId);
                            }
                          }}
                          className="w-full bg-[#141423] border border-white/5 rounded-2xl px-4 py-3.5 text-sm font-bold text-white focus:outline-none focus:border-purple-500/30"
                        >
                          <option value="">-- Choose Lyrical Music Track --</option>
                          {tracks.filter(t => t.isLyrical).map(t => (
                            <option key={t.id} value={t.id}>{t.title} — {t.artist}</option>
                          ))}
                        </select>
                        {tracks.filter(t => t.isLyrical).length === 0 && (
                          <p className="text-[10px] text-red-400 font-semibold uppercase tracking-wider mt-1">No lyrical tracks available. Designate one in the Tracks Library tab first.</p>
                        )}
                      </div>

                      {selectedLyricalTrackId && (
                        <div className="space-y-2">
                          <label className="block text-xs uppercase tracking-wider font-bold text-gray-400">2. Select Caption Styling Template</label>
                          {loadingTemplatesTrackId === selectedLyricalTrackId ? (
                            <div className="flex items-center gap-2 text-xs text-purple-400 py-2">
                              <RefreshCw className="w-4 h-4 animate-spin" />
                              Loading pre-rendered styling templates...
                            </div>
                          ) : lyricalTemplates.length === 0 ? (
                            <p className="text-[10px] text-amber-400 font-semibold uppercase tracking-wider bg-amber-500/5 border border-amber-500/10 p-3 rounded-2xl">
                              No styling templates pre-rendered for this track. Please go to Tracks Library, open this track, customize a style and click "Pre-render styling overlays" first!
                            </p>
                          ) : (
                            <div className="grid grid-cols-1 gap-2.5 max-h-[220px] overflow-y-auto pr-1">
                              {lyricalTemplates.map((tpl) => (
                                <div
                                  key={tpl.id}
                                  onClick={() => setSelectedLyricalTemplateId(tpl.id)}
                                  className={`p-3.5 rounded-2xl border text-left cursor-pointer transition-all flex items-center justify-between ${
                                    selectedLyricalTemplateId === tpl.id
                                      ? "bg-purple-500/15 border-purple-500/40 text-white shadow-lg shadow-purple-500/5"
                                      : "bg-[#141423]/40 border-white/5 text-gray-400 hover:border-white/10"
                                  }`}
                                >
                                  <div>
                                    <p className="text-xs font-bold text-white leading-tight">{tpl.templateName}</p>
                                    <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider mt-1">Font: {tpl.fontFamily} | Size: {tpl.fontSize}px</p>
                                  </div>
                                  <div className={`w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 ${
                                    selectedLyricalTemplateId === tpl.id ? "bg-purple-500 border-purple-500 text-white" : "border-white/10"
                                  }`}>
                                    {selectedLyricalTemplateId === tpl.id && <Check className="w-2.5 h-2.5 stroke-[4]" />}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Preview Image Column */}
                    <div>
                      {(() => {
                        const activeTpl = lyricalTemplates.find(t => t.id === selectedLyricalTemplateId);
                        if (!activeTpl) {
                          return (
                            <div className="aspect-[9/16] w-full max-w-[150px] mx-auto bg-black/40 border border-dashed border-white/10 rounded-3xl flex flex-col items-center justify-center text-center p-4">
                              <Eye className="w-8 h-8 text-gray-600 mb-2" />
                              <span className="text-xs text-gray-500 font-bold uppercase tracking-wider">No Template Selected</span>
                              <span className="text-[9px] text-gray-600 uppercase tracking-widest mt-1">Select a template to preview typography styling</span>
                            </div>
                          );
                        }

                        return (
                          <div className="space-y-2 text-center bg-[#0c0c14] p-3 rounded-2xl border border-white/5">
                            <span className="text-[10px] uppercase tracking-wider font-extrabold text-gray-500 block">Typography Preview: {activeTpl.templateName}</span>
                            <div className="relative aspect-[9/16] w-full max-w-[150px] mx-auto bg-black border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex items-center justify-center group">
                              <img
                                src={resolveUrl(activeTpl.previewImageUrl)}
                                className="w-full h-full object-cover select-none"
                                alt="Subtitles layout preview"
                              />
                              <div className="absolute inset-0 border border-white/5 rounded-3xl pointer-events-none" />
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                                          {/* Cinematic Visual Mutations Options */}
                                          <div className="bg-[#141423]/50 p-4.5 rounded-2xl border border-white/5 space-y-3 mt-4">
                                            <div className="flex items-center justify-between">
                                              <div className="flex items-center gap-2">
                                                <input
                                                  type="checkbox"
                                                  id="mixupVisualsToggle"
                                                  checked={mixupVisuals}
                                                  onChange={(e) => setMixupVisuals(e.target.checked)}
                                                  className="w-4 h-4 rounded border-white/10 text-purple-600 focus:ring-purple-500/30 bg-[#141423]"
                                                />
                                                <label htmlFor="mixupVisualsToggle" className="text-xs uppercase tracking-wider font-extrabold text-white cursor-pointer select-none">
                                                  Enable Cinematic Visuals Mutation Mix-Up
                                                </label>
                                              </div>
                                              <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/20 text-purple-400">
                                                {mixupVisuals ? "Mutator Active" : "Text-Only Overlay"}
                                              </span>
                                            </div>
                                            <p className="text-[10px] text-gray-500 leading-normal font-medium">
                                              If active, the composition engine will dynamically mutate and distribute **Color Filters** (Cyberpunk, Cinema Gold, Monochrome), **Vignettes** (Bottom Legibility Fade), and **Particle Loop Overlays** (Floating Dust, Golden Bokeh, fireflies) across the {selectedBatchAccountIds.length * postsPerAccount} generated videos. Each output becomes completely unique!
                                            </p>
                                          </div>

                  {/* Trigger Lyrical Composition Button */}
                  <div className="pt-6 border-t border-white/5">
                    <button
                      onClick={handleStartLyricalGeneration}
                      disabled={generatingQuotes || selectedBatchAccountIds.length === 0 || !selectedLyricalTrackId || !selectedLyricalTemplateId}
                      className="bg-purple-500 hover:bg-purple-600 text-white font-extrabold py-4 px-8 rounded-2xl shadow-lg transition-all duration-300 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-base"
                    >
                      {generatingQuotes ? (
                        <>
                          <RefreshCw className="w-5 h-5 animate-spin" />
                          Processing Lyrical Batch...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-5 h-5" />
                          Generate Lyrical Videos
                        </>
                      )}
                    </button>
                    {selectedBatchAccountIds.length > 0 && selectedLyricalTrackId && selectedLyricalTemplateId && (
                      <p className="text-[10px] text-purple-400 font-semibold uppercase tracking-wider mt-2.5">
                        Will generate {selectedBatchAccountIds.length * postsPerAccount} lyrical videos at ultra-fast 1-second overlay merge per video!
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                /* Quotes Input Source Selection */
                <div className="bg-[#0c0c14]/40 border border-white/5 p-6 rounded-3xl space-y-4">
                  <div>
                    <h4 className="text-sm font-black text-white uppercase tracking-wider">Quote Content Input Source</h4>
                    <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider mt-0.5">Choose how you want to supply the quote texts for this batch</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Option 1: Gemini */}
                    <button
                      type="button"
                      onClick={() => setQuotesSource("gemini")}
                      className={`flex items-start gap-4 p-4 rounded-2xl border text-left transition-all ${
                        quotesSource === "gemini"
                          ? "bg-amber-500/10 border-amber-500/30 text-white"
                          : "bg-[#141423]/40 border-white/5 text-gray-400 hover:border-white/10"
                      }`}
                    >
                      <div className={`p-2 rounded-xl ${quotesSource === "gemini" ? "bg-amber-500 text-black animate-pulse" : "bg-[#141423] text-gray-400"}`}>
                        <Sparkles className="w-5 h-5" />
                      </div>
                      <div>
                        <h5 className="text-sm font-bold text-white">Generate with Gemini AI</h5>
                        <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                          Gemini will dynamically bulk generate highly original quotes matching each account's theme or topic prompt.
                        </p>
                      </div>
                    </button>

                    {/* Option 2: CSV Import */}
                    <button
                      type="button"
                      onClick={() => setQuotesSource("csv")}
                      className={`flex items-start gap-4 p-4 rounded-2xl border text-left transition-all ${
                        quotesSource === "csv"
                          ? "bg-amber-500/10 border-amber-500/30 text-white"
                          : "bg-[#141423]/40 border-white/5 text-gray-400 hover:border-white/10"
                      }`}
                    >
                      <div className={`p-2 rounded-xl ${quotesSource === "csv" ? "bg-amber-500 text-black" : "bg-[#141423] text-gray-400"}`}>
                        <Upload className="w-5 h-5" />
                      </div>
                      <div>
                        <h5 className="text-sm font-bold text-white">Upload Quote CSV(s)</h5>
                        <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                          Import one or multiple CSV files containing your own custom quotes. Quotes will be distributed sequentially across video accounts.
                        </p>
                      </div>
                    </button>
                  </div>

                  {/* CSV File Upload Drop Zone */}
                  {quotesSource === "csv" && (
                    <div className="bg-[#141423]/30 border border-white/5 p-4 rounded-2xl space-y-4">
                      <div className="flex flex-col items-center justify-center border-2 border-dashed border-white/10 hover:border-amber-500/30 rounded-2xl p-6 transition-all text-center relative">
                        <input
                          type="file"
                          accept=".csv"
                          multiple
                          onChange={handleCsvUpload}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                        />
                        <Upload className="w-8 h-8 text-gray-400 mb-2" />
                        <p className="text-xs text-gray-300 font-bold">Select or drag one or multiple CSV files</p>
                        <p className="text-[10px] text-gray-500 mt-1 uppercase font-semibold">Only .csv files containing quote lists</p>
                      </div>

                      {parsedCsvQuotes.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Loaded CSV Quotes ({parsedCsvQuotes.length})</span>
                            <button
                              type="button"
                              onClick={() => setParsedCsvQuotes([])}
                              className="text-xs text-red-400 hover:underline font-bold uppercase tracking-wider"
                            >
                              Clear All
                            </button>
                          </div>
                          <div className="max-h-[150px] overflow-y-auto border border-white/5 rounded-2xl p-3 bg-black/40 space-y-2 text-left">
                            {parsedCsvQuotes.map((q, idx) => (
                              <div key={idx} className="text-xs text-gray-300 leading-snug border-b border-white/5 pb-1 last:border-b-0 last:pb-0">
                                <span className="text-amber-500 font-bold mr-1">#{idx + 1}</span>
                                "{q.text}" {q.author && <span className="text-gray-500">— {q.author}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

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
                          Processing Quotes...
                        </>
                      ) : quotesSource === "csv" ? (
                        <>
                          <Check className="w-5 h-5" />
                          Proceed with CSV Quotes
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
                        <span className="text-xs font-semibold text-gray-400">@{item.account?.tiktokUsername || "Account"}</span>
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
                    <div className="flex items-center gap-2">
                      <label className="block text-xs uppercase tracking-wider font-bold text-gray-400">
                        Maximum Audio Track Reuse
                      </label>
                      <button
                        type="button"
                        onClick={() => setAudioReuseMax(audioReuseMax === 0 ? 2 : 0)}
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all border ${
                          audioReuseMax !== 0
                            ? "bg-green-500/10 text-green-400 border-green-500/20 shadow-lg shadow-green-500/5 hover:bg-green-500/20"
                            : "bg-red-500/10 text-red-400 border-red-500/20 shadow-lg shadow-red-500/5 hover:bg-red-500/20"
                        }`}
                      >
                        {audioReuseMax !== 0 ? "Limit: ON" : "Limit: OFF"}
                      </button>
                    </div>
                    <span className={`text-xs font-black px-2 py-0.5 rounded-lg border ${
                      audioReuseMax !== 0
                        ? "text-amber-500 bg-amber-500/15 border-amber-500/25"
                        : "text-purple-400 bg-purple-500/15 border-purple-500/25"
                    }`}>
                      {audioReuseMax !== 0 ? `Max ${audioReuseMax} times` : "Unlimited"}
                    </span>
                  </div>
                  {audioReuseMax !== 0 ? (
                    <>
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
                    </>
                  ) : (
                    <div className="py-2.5 px-3 bg-purple-500/5 border border-purple-500/10 rounded-xl">
                      <p className="text-[10px] text-purple-400/80 font-medium leading-relaxed">
                        No maximum reuse limit active. Music tracks will be distributed purely in round-robin sequence without any constraints.
                      </p>
                    </div>
                  )}
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
                        item.status === "RENDERED" ? "border-purple-500/30 bg-[#121021] shadow-md shadow-purple-500/5" :
                        item.status === "UPLOADED" ? "border-green-500/20" :
                        item.status === "FAILED" ? "border-red-500/20 bg-[#1e0e13]" : "border-white/5 opacity-60"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-[#141423] border border-white/5 flex items-center justify-center font-bold text-xs text-amber-500">
                          #{idx + 1}
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-bold text-white">@{item.account?.tiktokUsername || "Account"}</p>
                          <p className="text-xs text-gray-400 max-w-lg italic font-medium leading-normal">
                            &ldquo;{item.quoteText}&rdquo;
                          </p>
                          {item.status === "FAILED" && item.errorMessage && (
                            <p className="text-[11px] text-red-400 font-semibold bg-red-500/10 px-2.5 py-1.5 rounded-xl border border-red-500/15 max-w-lg mt-1.5 flex items-start gap-1">
                              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                              <span>Error: {item.errorMessage}</span>
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 self-end sm:self-center">
                        <div className="text-right text-xs mr-2">
                          <p className="text-gray-500 font-semibold">{item.track?.title || "No track"}</p>
                          <p className="text-[10px] text-gray-600 font-semibold uppercase tracking-wider">Audio clip</p>
                        </div>

                        {item.status === "RENDERING" && (
                          <span className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/15 rounded-xl text-xs font-bold animate-pulse">
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            Rendering...
                          </span>
                        )}

                        {item.status === "RENDERED" && (
                          <div className="flex items-center gap-2">
                            <span className="flex items-center gap-1 px-3 py-1 bg-[#1d1b38] text-amber-400 border border-amber-500/20 rounded-xl text-xs font-bold shadow-md shadow-amber-500/5 mr-1">
                              <Sparkles className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                              Rendered (Ready)
                            </span>
                            
                            <button
                              onClick={() => {
                                setPreviewVideoUrl(item.renderedVideoUrl || null);
                                setIsPreviewModalOpen(true);
                              }}
                              className="flex items-center gap-1 px-3 py-1.5 bg-purple-500/15 hover:bg-purple-500 text-purple-400 hover:text-black border border-purple-500/20 hover:border-purple-500 rounded-xl text-xs font-extrabold transition-all duration-300"
                              title="Preview video render"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              Preview
                            </button>

                            <a
                              href={`/api${item.renderedVideoUrl}`}
                              download={`video_${item.id.substring(0, 8)}.mp4`}
                              className="flex items-center gap-1 px-3 py-1.5 bg-blue-500/15 hover:bg-blue-500 text-blue-400 hover:text-black border border-blue-500/20 hover:border-blue-500 rounded-xl text-xs font-extrabold transition-all duration-300 flex items-center justify-center"
                              title="Download video clip"
                            >
                              <Download className="w-3.5 h-3.5" />
                              Download
                            </a>

                            <button
                              onClick={() => handleUploadToDrive(item.id)}
                              disabled={!!uploadingItems[item.id] || uploadingBatch}
                              className="flex items-center gap-1 px-3 py-1.5 bg-green-500/15 hover:bg-green-500 text-green-400 hover:text-black border border-green-500/20 hover:border-green-500 rounded-xl text-xs font-extrabold transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Upload to Google Drive"
                            >
                              {uploadingItems[item.id] ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Upload className="w-3.5 h-3.5" />
                              )}
                              Upload
                            </button>
                          </div>
                        )}

                        {item.status === "UPLOADED" && (
                          <div className="flex items-center gap-2">
                            <span className="flex items-center gap-1 px-3 py-1 bg-green-500/10 text-green-400 border border-green-500/15 rounded-xl text-xs font-bold">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Google Drive Uploaded
                            </span>
                            {item.driveFileId && (
                              <a
                                href={`https://drive.google.com/file/d/${item.driveFileId}/view`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 px-3 py-1.5 bg-purple-500/15 hover:bg-purple-500 text-purple-400 hover:text-black border border-purple-500/20 hover:border-purple-500 rounded-xl text-xs font-extrabold transition-all duration-300"
                                title="Open in Google Drive"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                                View File
                              </a>
                            )}
                          </div>
                        )}

                        {item.status === "FAILED" && (
                          <div className="flex items-center gap-2">
                            <span className="flex items-center gap-1 px-3 py-1 bg-red-500/10 text-red-400 border border-red-500/15 rounded-xl text-xs font-bold" title={item.errorMessage || "Unknown error"}>
                              <AlertCircle className="w-3.5 h-3.5" />
                              Failed
                            </span>
                            <button
                              onClick={() => handleRetrySingleItem(activeBatch.id, item.id)}
                              disabled={!!retryingItemIds[item.id] || retryingBatchId === activeBatch.id}
                              className="flex items-center gap-1 px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500 text-amber-400 hover:text-black border border-amber-500/20 hover:border-amber-500 rounded-xl text-xs font-extrabold transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Retry rendering this clip"
                            >
                              {retryingItemIds[item.id] ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <RefreshCw className="w-3.5 h-3.5" />
                              )}
                              Retry
                            </button>
                          </div>
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

              {/* Close or Cancel Button */}
              <div className="pt-6 border-t border-white/5 flex flex-wrap gap-4">
                {activeBatch.items?.some(i => i.status === "RENDERED" || i.status === "UPLOADED") && (
                  <button
                    onClick={() => handleDownload(activeBatch.id)}
                    disabled={activeBatch.id in downloads}
                    className="bg-[#1d1b38] hover:bg-[#25224e] text-amber-400 hover:text-amber-300 font-extrabold py-3.5 px-6 rounded-2xl border border-amber-500/20 hover:border-amber-500/50 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-amber-500/5"
                  >
                    {activeBatch.id in downloads ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Downloading...
                      </>
                    ) : (
                      <>
                        <Download className="w-5 h-5" />
                        Download All Rendered ({activeBatch.items?.filter(i => i.status === "RENDERED" || i.status === "UPLOADED").length})
                      </>
                    )}
                  </button>
                )}

                {activeBatch.items?.some(i => i.status === "RENDERED") && (
                  <button
                    onClick={() => handleUploadAllToDrive(activeBatch.id)}
                    disabled={uploadingBatch}
                    className="bg-gradient-to-r from-green-500/20 to-emerald-500/20 hover:from-green-500 hover:to-emerald-500 text-green-400 hover:text-black font-extrabold py-3.5 px-6 rounded-2xl border border-green-500/30 hover:border-green-500 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-green-500/5 animate-pulse"
                  >
                    {uploadingBatch ? (
                      <>
                        <RefreshCw className="w-5 h-5 animate-spin" />
                        Uploading All...
                      </>
                    ) : (
                      <>
                        <Upload className="w-5 h-5" />
                        Upload All to Google Drive ({activeBatch.items?.filter(i => i.status === "RENDERED").length})
                      </>
                    )}
                  </button>
                )}

                {activeBatch.status !== "RENDERING" ? (
                  <div className="flex gap-3">
                    {activeBatch.items?.some(i => i.status === "FAILED") && (
                      <button
                        onClick={() => handleRetryFailedRenders(activeBatch.id)}
                        disabled={retryingBatchId === activeBatch.id}
                        className="bg-amber-500/10 hover:bg-amber-500 text-amber-400 hover:text-black font-extrabold py-3.5 px-6 rounded-2xl border border-amber-500/20 hover:border-amber-500 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-amber-500/5 transition-all duration-300"
                      >
                        {retryingBatchId === activeBatch.id ? (
                          <>
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            Retrying Failed...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="w-4 h-4" />
                            Retry Failed Renders ({activeBatch.items?.filter(i => i.status === "FAILED").length})
                          </>
                        )}
                      </button>
                    )}
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
                ) : (
                  <>
                    <button
                      onClick={() => {
                        setWizardStep(1);
                        setActiveBatch(null);
                        fetchBatches();
                      }}
                      className="bg-[#141423] hover:bg-[#1a1a2e] text-gray-400 hover:text-white font-bold py-3.5 px-6 rounded-2xl border border-white/5 transition-all"
                    >
                      Hide & Keep Running in Background
                    </button>
                    <button
                      onClick={() => handleCancelBatch(activeBatch.id)}
                      disabled={cancellingBatchId === activeBatch.id}
                      className="bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-black font-bold py-3.5 px-6 rounded-2xl border border-red-500/20 hover:border-red-500 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {cancellingBatchId === activeBatch.id ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Cancelling...
                        </>
                      ) : (
                        "Cancel Active Rendering"
                      )}
                    </button>
                  </>
                )}
              </div>

              {/* Bulk Download Progress Bar */}
              {activeBatch.id in downloads && (
                <div className="mt-4 px-6 py-4 bg-amber-500/5 border border-amber-500/10 rounded-2xl space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-[10px] font-black text-amber-400 uppercase tracking-wider flex items-center gap-1.5 animate-pulse">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Streaming Archive Chunks...
                    </span>
                    <span className="text-[10px] text-gray-500 font-semibold uppercase">
                      {downloads[activeBatch.id].loadedSize} / {downloads[activeBatch.id].totalSize}
                    </span>
                  </div>
                  <div className="w-full bg-black/40 h-1.5 rounded-full overflow-hidden border border-white/5">
                    <div 
                      className="h-full rounded-full bg-gradient-to-r from-amber-500 to-yellow-500 transition-all duration-300" 
                      style={{ width: `${downloads[activeBatch.id].progress || 5}%` }} 
                    />
                  </div>
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="text-gray-600 font-semibold uppercase">Do not close this tab</span>
                    <span className="text-amber-400 font-bold">{downloads[activeBatch.id].progress}% Complete</span>
                  </div>
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
                        {(b.status === "RENDERING" || b.status === "QUOTES_GENERATING") && (
                          <button
                            onClick={() => handleCancelBatch(b.id)}
                            disabled={cancellingBatchId === b.id}
                            className="bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-black px-3.5 py-2 rounded-xl text-xs font-bold transition-all border border-red-500/20 hover:border-red-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                          >
                            {cancellingBatchId === b.id && <RefreshCw className="w-3 h-3 animate-spin" />}
                            Cancel
                          </button>
                        )}
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

      {/* Video Preview Modal */}
      {isPreviewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md transition-all duration-300">
          <div className="relative w-full max-w-sm bg-[#0e0e16] border border-white/10 rounded-3xl overflow-hidden shadow-2xl shadow-purple-500/10">
            {/* Modal Header */}
            <div className="flex justify-between items-center px-6 py-4 border-b border-white/5 bg-black/20">
              <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500 animate-pulse" />
                Video Composition Preview
              </h3>
              <button
                onClick={() => {
                  setIsPreviewModalOpen(false);
                  setPreviewVideoUrl(null);
                }}
                className="p-1.5 rounded-full bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Video Player Area */}
            <div className="p-4 bg-black/40 flex justify-center items-center">
              {previewVideoUrl ? (
                <div className="w-full aspect-[9/16] max-h-[60vh] rounded-2xl overflow-hidden bg-black border border-white/5 relative shadow-inner">
                  <video 
                    src={resolveUrl(previewVideoUrl)} 
                    controls 
                    autoPlay 
                    className="w-full h-full object-contain"
                  />
                </div>
              ) : (
                <div className="py-20 text-gray-500 text-sm">No video file available for preview.</div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex justify-end px-6 py-3 border-t border-white/5 bg-black/20">
              <button
                onClick={() => {
                  setIsPreviewModalOpen(false);
                  setPreviewVideoUrl(null);
                }}
                className="px-5 py-2 bg-gradient-to-r from-amber-500 to-purple-500 hover:from-amber-600 hover:to-purple-600 text-black font-extrabold rounded-xl text-xs transition-all shadow-lg shadow-purple-500/10 active:scale-95"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      <datalist id="musicians-datalist">
        {uniqueMusiciansList.map((musician) => (
          <option key={musician} value={musician} />
        ))}
      </datalist>
      <datalist id="genres-datalist">
        {uniqueGenresList.map((genre) => (
          <option key={genre} value={genre} />
        ))}
      </datalist>
    </div>
  );
}
