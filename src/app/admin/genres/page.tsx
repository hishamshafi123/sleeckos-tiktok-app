"use client";

import { useState, useEffect, useRef } from "react";
import { 
  Sparkles, Music, Sliders, Play, Pause, Trash2, Plus, 
  Upload, Film, CheckCircle2, AlertCircle, RefreshCw, ChevronRight, ChevronDown, Check, X, Lock, Tag, Folder, Eye, Filter
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
  genre: string | null;
  musician: string | null;
  campaignOn: boolean;
  campaignActiveAt: string | null;
  videosPosted?: number;
  totalViews?: number;
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
  account: {
    tiktokUsername: string;
    tiktokAvatarUrl: string;
  };
  track: {
    title: string;
    artist: string;
  };
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
  const [cancellingBatchId, setCancellingBatchId] = useState<string | null>(null);

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

  // Set default form values when account selection changes
  useEffect(() => {
    if (selectedAccount) {
      const config = selectedAccount.genreConfigs[0];
      setThemeText(config?.themeText || "");
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
    } else {
      setThemeText("");
      setCurveText(false);
      setCurvature(30);
      setBoxColor("none");
      setPositionY(50);
      setPreviewBgIndex(0);
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
    data.append("themeText", themeText);
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
                          </div>

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
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 font-extrabold text-xs tracking-wider uppercase transition-all shadow-md shadow-amber-500/5 cursor-default"
              >
                <Sparkles className="w-4 h-4" />
                Quotes Composer
              </button>

              {/* Lyrical Genre (Locked Placeholder) */}
              <div 
                className="relative group flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white/[0.02] border border-white/5 text-gray-500 font-bold text-xs tracking-wider uppercase select-none cursor-not-allowed transition-all hover:bg-white/[0.04]"
                title="Lyrical composer is locked"
              >
                <Lock className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />
                <span>Lyrical</span>
                {/* Custom premium glassmorphic tooltip */}
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block bg-[#0f0f18]/95 border border-white/10 px-3 py-1.5 rounded-xl shadow-xl backdrop-blur-md text-[10px] text-gray-300 font-bold uppercase tracking-wider text-center w-48 z-20 pointer-events-none">
                  Lyrical Composer <span className="text-purple-400">Coming Soon</span>
                </div>
              </div>

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
                                            disabled ? "opacity-35 cursor-not-allowed border-white/5 bg-[#0a0a0f]" :
                                            isSelected ? "border-amber-500/50 bg-[#141221]" : "border-white/5 bg-[#0d0d16] hover:border-white/10"
                                          }`}
                                        >
                                          <div className={`w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 ${
                                            isSelected ? "bg-amber-500 border-amber-500 text-black" : "border-white/10 bg-black/40"
                                          }`}>
                                            {isSelected && <Check className="w-3.5 h-3.5 stroke-[4]" />}
                                          </div>
                                          <img src={acc.tiktokAvatarUrl} className="w-9 h-9 rounded-full object-cover flex-shrink-0 bg-white/5" alt="" />
                                          <div className="space-y-0.5 overflow-hidden">
                                            <p className="text-xs font-bold text-white leading-tight truncate">@{acc.tiktokUsername}</p>
                                            {disabled ? (
                                              <p className="text-[8px] text-red-400 font-semibold uppercase tracking-wider truncate">
                                                {!isConfigured ? "No theme config" : !hasBgs ? "No loops uploaded" : "No Drive folder"}
                                              </p>
                                            ) : (
                                              <p className="text-[8px] text-gray-500 font-semibold uppercase tracking-wider">Configured</p>
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

              {/* Close or Cancel Button */}
              <div className="pt-6 border-t border-white/5 flex flex-wrap gap-4">
                {activeBatch.status !== "RENDERING" ? (
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
