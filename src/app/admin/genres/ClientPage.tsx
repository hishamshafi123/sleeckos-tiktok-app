"use client";

import { useState, useEffect, useRef } from "react";
import { 
  Sparkles, Music, Sliders, Play, Pause, Trash2, Plus, 
  Upload, Film, CheckCircle2, AlertCircle, RefreshCw, ChevronRight, ChevronDown, Check, X, Lock, Tag, Folder, FolderOpen, Eye, Filter,
  Loader2, ExternalLink, Download, Edit3, Search, FileText, Clock, Mic
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

function computeBratLayout(
  words: { word: string; start: number; end: number }[],
  fontFamily: string,
  baseFontSize: number,
  canvasWidth: number,
  canvasHeight: number,
  margin: number
) {
  if (typeof window === "undefined") return [];
  let canvas = (window as any).__previewLayoutCanvas;
  if (!canvas) {
    canvas = document.createElement("canvas");
    (window as any).__previewLayoutCanvas = canvas;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  const fontMap: Record<string, string> = {
    "Montserrat-Black": "Montserrat",
    "Outfit-Bold": "Outfit",
    "Anton": "Anton",
    "Inter-Bold": "Inter",
    "Inter-Light": "Inter",
    "Inter-Regular": "Inter",
    "Caveat-Bold": "Caveat",
    "Oswald-Bold": "Oswald",
    "PlayfairDisplay-Bold": "Playfair Display",
    "GreatVibes-Regular": "Great Vibes",
    "Lora-Bold": "Lora",
  };
  const fontName = fontMap[fontFamily] || "Montserrat";

  function measureText(text: string, size: number): number {
    ctx.font = `800 ${size}px ${fontName}, sans-serif`;
    return ctx.measureText(text).width;
  }

  const targetWidth = canvasWidth - 2 * margin;
  const targetHeight = canvasHeight * 0.6;

  function getWrappedLines(wordTexts: string[], size: number): string[][] {
    const lines: string[][] = [];
    let currentLine: string[] = [];
    const spaceWidth = measureText(" ", size);
    let currentWidth = 0;

    for (const w of wordTexts) {
      const wordWidth = measureText(w, size);
      if (currentLine.length === 0) {
        currentLine.push(w);
        currentWidth = wordWidth;
      } else {
        const newWidth = currentWidth + spaceWidth + wordWidth;
        if (newWidth <= targetWidth) {
          currentLine.push(w);
          currentWidth = newWidth;
        } else {
          lines.push(currentLine);
          currentLine = [w];
          currentWidth = wordWidth;
        }
      }
    }
    if (currentLine.length > 0) {
      lines.push(currentLine);
    }
    return lines;
  }

  function getOptimalFontSize(wordTexts: string[]): number {
    let low = 20;
    let high = baseFontSize;
    let bestSize = 20;

    function checkFit(size: number): boolean {
      const lines = getWrappedLines(wordTexts, size);
      const lineHeight = size * 1.15;
      const totalHeight = lineHeight * lines.length + 10 * (lines.length - 1);

      for (const w of wordTexts) {
        if (measureText(w, size) > targetWidth) return false;
      }
      return totalHeight <= targetHeight;
    }

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (checkFit(mid)) {
        bestSize = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return bestSize;
  }

  const wordTexts = words.map(w => w.word);
  const bestFontSize = getOptimalFontSize(wordTexts);
  const lines = getWrappedLines(wordTexts, bestFontSize);

  const startX = margin;
  const startY = Math.round(canvasHeight * 0.2);
  const spaceWidth = measureText(" ", bestFontSize);
  const lineHeight = bestFontSize * 1.15;
  const lineSpacing = 10;

  let currentY = startY;
  const wordPositions: { word: string; x: number; y: number; fontSize: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineWords = lines[i];
    if (lineWords.length === 0) continue;

    const isLastLine = (i === lines.length - 1);
    let sumWordW = 0;
    const wordWidths = lineWords.map(w => {
      const w_w = measureText(w, bestFontSize);
      sumWordW += w_w;
      return w_w;
    });

    const normalGapW = (lineWords.length - 1) * spaceWidth;
    const naturalWidth = sumWordW + normalGapW;

    const isFullEnough = (naturalWidth / targetWidth) > 0.85;
    const shouldLeftAlign = (isLastLine && !isFullEnough) || lineWords.length === 1;

    if (shouldLeftAlign) {
      let currX = startX;
      for (let j = 0; j < lineWords.length; j++) {
        wordPositions.push({
          word: lineWords[j],
          x: Math.round(currX),
          y: Math.round(currentY),
          fontSize: bestFontSize
        });
        currX += wordWidths[j] + spaceWidth;
      }
    } else {
      const availableSpace = targetWidth - sumWordW;
      const gap = lineWords.length > 1 ? (availableSpace / (lineWords.length - 1)) : 0;
      let currX = startX;

      for (let j = 0; j < lineWords.length; j++) {
        wordPositions.push({
          word: lineWords[j],
          x: Math.round(currX),
          y: Math.round(currentY),
          fontSize: bestFontSize
        });
        currX += wordWidths[j] + gap;
      }
    }

    currentY += lineHeight + lineSpacing;
  }

  return wordPositions;
}

// Tabs Enum
type TabType = "tracks" | "accounts" | "batches" | "lyric-gen";

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
  savedStyleId?: string | null;
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
  trackStart?: number;
  trackEnd?: number | null;
  account?: {
    tiktokUsername: string;
    tiktokAvatarUrl: string;
  } | null;
  track?: {
    title: string;
    artist: string;
  } | null;
  lyricalTemplate?: {
    templateName: string;
    aspectRatio: string;
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

  // ── Lyric Generator Wizard State ──────────────────────────────────────────
  const [lgStep, setLgStep] = useState<1 | 2 | 3 | 4>(1);
  // Step 1: Audio upload
  const [lgAudioFile, setLgAudioFile] = useState<File | null>(null);
  const [lgUploading, setLgUploading] = useState(false);
  const [lgAudioUrl, setLgAudioUrl] = useState<string>("");
  const [lgAudioDuration, setLgAudioDuration] = useState(0);
  const [lgTrackId, setLgTrackId] = useState<string>("");
  const [lgTitle, setLgTitle] = useState("");
  const [lgArtist, setLgArtist] = useState("");
  // Step 2: Transcription
  const [lgTranscribing, setLgTranscribing] = useState(false);
  const [lgTranscriptionWords, setLgTranscriptionWords] = useState<any[]>([]);
  const [lgParsedLines, setLgParsedLines] = useState<any[]>([]);
  const [lgLyricsMode, setLgLyricsMode] = useState<"whisper" | "lrclib" | "manual">("whisper");
  const [lgLrclibQuery, setLgLrclibQuery] = useState("");
  const [lgLrclibSearching, setLgLrclibSearching] = useState(false);
  const [lgLrclibResults, setLgLrclibResults] = useState<any[]>([]);
  const [lgSelectedLrc, setLgSelectedLrc] = useState<any>(null);
  const [lgManualLrc, setLgManualLrc] = useState("");
  // Step 3: Line range
  const [lgStartLine, setLgStartLine] = useState<number | null>(null);
  const [lgEndLine, setLgEndLine] = useState<number | null>(null);
  // Step 4: Generate
  const [lgGenerating, setLgGenerating] = useState(false);

  const lgResetWizard = () => {
    setLgStep(1);
    setLgAudioFile(null);
    setLgUploading(false);
    setLgAudioUrl("");
    setLgAudioDuration(0);
    setLgTrackId("");
    setLgTitle("");
    setLgArtist("");
    setLgTranscribing(false);
    setLgTranscriptionWords([]);
    setLgParsedLines([]);
    setLgLyricsMode("whisper");
    setLgLrclibQuery("");
    setLgLrclibSearching(false);
    setLgLrclibResults([]);
    setLgSelectedLrc(null);
    setLgManualLrc("");
    setLgStartLine(null);
    setLgEndLine(null);
    setLgGenerating(false);
  };

  // Step 1: Upload audio file → creates a Track, then moves to step 2
  const lgHandleUpload = async () => {
    if (!lgAudioFile) return;
    if (!lgTitle.trim()) { toast.error("Please enter a title"); return; }
    setLgUploading(true);
    try {
      const formData = new FormData();
      formData.append("audioFile", lgAudioFile);
      formData.append("title", lgTitle.trim());
      formData.append("artist", lgArtist.trim() || "Unknown");
      formData.append("defaultStart", "0");
      formData.append("defaultDuration", "7");

      const res = await fetch("/api/managed/genres/tracks", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      setLgTrackId(data.id);
      setLgAudioUrl(data.fileUrl);
      setLgAudioDuration(data.duration || 0);
      toast.success("Audio uploaded successfully");
      setLgStep(2);
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setLgUploading(false);
    }
  };

  // Step 2a: Run Whisper transcription via existing lyrical API
  const lgRunWhisper = async () => {
    if (!lgTrackId) return;
    setLgTranscribing(true);
    try {
      const res = await fetch("/api/managed/genres/tracks/lyrical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId: lgTrackId, model: "base", device: "cpu" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Transcription failed");

      // data is the updated Track with lyricalTranscription
      const words: { word: string; start: number; end: number }[] = JSON.parse(data.lyricalTranscription || "[]");
      setLgTranscriptionWords(words);

      // Group words into lines (sentences) by silence gaps
      const lines = wordsToLines(words);
      setLgParsedLines(lines);

      toast.success(`Whisper transcription complete: ${words.length} words, ${lines.length} lines`);
      setLgStep(3);
    } catch (err: any) {
      toast.error(err.message || "Whisper transcription failed");
    } finally {
      setLgTranscribing(false);
    }
  };

  // Convert word-level timestamps to line-level (group by silence gaps)
  const wordsToLines = (words: { word: string; start: number; end: number }[]) => {
    if (words.length === 0) return [];
    const GAP_THRESHOLD = 1.2; // seconds of silence to start a new line
    const MAX_WORDS_PER_LINE = 10;
    const lines: { text: string; start: number; end: number; words: any[] }[] = [];
    let currentWords: typeof words = [];

    for (const w of words) {
      if (currentWords.length === 0) {
        currentWords.push(w);
      } else {
        const gap = w.start - currentWords[currentWords.length - 1].end;
        if (gap > GAP_THRESHOLD || currentWords.length >= MAX_WORDS_PER_LINE) {
          lines.push({
            text: currentWords.map(cw => cw.word).join(" "),
            start: currentWords[0].start,
            end: currentWords[currentWords.length - 1].end,
            words: currentWords,
          });
          currentWords = [w];
        } else {
          currentWords.push(w);
        }
      }
    }
    if (currentWords.length > 0) {
      lines.push({
        text: currentWords.map(cw => cw.word).join(" "),
        start: currentWords[0].start,
        end: currentWords[currentWords.length - 1].end,
        words: currentWords,
      });
    }
    return lines;
  };

  // Step 2b: Search LRCLIB for synced lyrics (alternative to Whisper)
  const lgSearchLrclib = async () => {
    if (!lgLrclibQuery.trim()) return;
    setLgLrclibSearching(true);
    try {
      const res = await fetch(`/api/managed/genres/tracks/lyrics?q=${encodeURIComponent(lgLrclibQuery.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "LRCLIB search failed");
      setLgLrclibResults(Array.isArray(data) ? data : []);
      if (data.length === 0) toast.error("No synced lyrics found for this query");
    } catch (err: any) {
      toast.error(err.message || "Search failed");
    } finally {
      setLgLrclibSearching(false);
    }
  };

  const lgHandleSelectLrc = (lrc: any) => {
    setLgSelectedLrc(lrc);
    setLgParsedLines(lrc.parsedLines || []);
    setLgStartLine(null);
    setLgEndLine(null);
  };

  // Parse manual .lrc paste
  const lgParseManualLrc = () => {
    if (!lgManualLrc.trim()) return;
    const timeRegex = /\[(\d+):(\d+(?:\.\d+)?)]/;
    const lines: any[] = [];
    let idx = 0;
    for (const line of lgManualLrc.split("\n")) {
      const match = timeRegex.exec(line);
      if (match) {
        const mins = parseInt(match[1], 10);
        const secs = parseFloat(match[2]);
        const text = line.replace(timeRegex, "").trim();
        lines.push({ text, start: mins * 60 + secs, end: 0, index: idx++ });
      }
    }
    lines.sort((a: any, b: any) => a.start - b.start);
    lines.forEach((l: any, i: number) => { l.index = i; });
    for (let i = 0; i < lines.length; i++) {
      lines[i].end = i < lines.length - 1 ? lines[i + 1].start : lines[i].start + 4;
    }
    setLgParsedLines(lines);
    setLgSelectedLrc({ syncedLyrics: lgManualLrc, trackName: lgTitle || "Manual", artistName: lgArtist });
    setLgStartLine(null);
    setLgEndLine(null);
    toast.success(`Parsed ${lines.length} lyric lines`);
  };

  const lgHandleLineClick = (lineIdx: number) => {
    if (lgStartLine === null) {
      setLgStartLine(lineIdx);
      setLgEndLine(null);
    } else if (lgEndLine === null) {
      if (lineIdx >= lgStartLine) {
        setLgEndLine(lineIdx);
      } else {
        setLgStartLine(lineIdx);
        setLgEndLine(null);
      }
    } else {
      setLgStartLine(lineIdx);
      setLgEndLine(null);
    }
  };

  const lgGetClipInfo = () => {
    if (lgStartLine === null || lgEndLine === null || lgParsedLines.length === 0) return null;
    const startTime = lgParsedLines[lgStartLine]?.start || 0;
    const endTime = lgParsedLines[lgEndLine]?.end || 0;
    const duration = endTime - startTime;
    return { startTime, endTime, duration, lineCount: lgEndLine - lgStartLine + 1 };
  };

  const lgFormatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const ms = Math.round((secs % 1) * 100);
    return `${m}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
  };

  // Step 4: Generate — trim audio to selected lines, update Track with word-level timing
  const lgHandleGenerate = async () => {
    if (lgStartLine === null || lgEndLine === null || !lgAudioUrl || !lgTrackId) {
      toast.error("Please complete all steps before generating");
      return;
    }
    setLgGenerating(true);
    try {
      const clipInfo = lgGetClipInfo();
      if (!clipInfo) throw new Error("Invalid clip info");

      // Get the words within the selected line range
      const selectedLines = lgParsedLines.slice(lgStartLine, lgEndLine + 1);
      let selectedWords: any[] = [];

      if (lgLyricsMode === "whisper" && selectedLines[0]?.words) {
        // Whisper mode: lines have embedded word arrays
        for (const line of selectedLines) {
          selectedWords.push(...(line.words || []));
        }
      } else {
        // LRC mode: generate word-level timing proportionally from line-level
        for (const line of selectedLines) {
          const words = (line.text || "").split(/\s+/).filter(Boolean);
          if (words.length === 0) continue;
          const lineDuration = (line.end || line.start + 2) - line.start;
          const wordDuration = lineDuration / words.length;
          words.forEach((w: string, i: number) => {
            selectedWords.push({
              word: w,
              start: Math.round((line.start + i * wordDuration) * 1000) / 1000,
              end: Math.round((line.start + (i + 1) * wordDuration) * 1000) / 1000,
            });
          });
        }
      }

      // Offset word times so the clip starts at 0
      const offset = clipInfo.startTime;
      const adjustedWords = selectedWords.map(w => ({
        word: w.word,
        start: Math.round((w.start - offset) * 1000) / 1000,
        end: Math.round((w.end - offset) * 1000) / 1000,
      }));

      // Trim audio via the trim endpoint
      const trimRes = await fetch("/api/managed/genres/lyric-generator/trim-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioFileUrl: lgAudioUrl,
          startTime: clipInfo.startTime,
          endTime: clipInfo.endTime,
        }),
      });
      const trimData = await trimRes.json();
      if (!trimRes.ok) throw new Error(trimData.error || "Audio trim failed");

      // Update the Track with the trimmed audio + word-level transcription
      const updateRes = await fetch(`/api/managed/genres/tracks`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: lgTrackId,
          fileUrl: trimData.filePath,
          duration: trimData.duration,
          defaultStart: 0,
          defaultDuration: trimData.duration,
          isLyrical: true,
          lyricalTranscription: JSON.stringify(adjustedWords),
          title: lgTitle.trim() || undefined,
          artist: lgArtist.trim() || undefined,
        }),
      });
      const updateData = await updateRes.json();
      if (!updateRes.ok) throw new Error(updateData.error || "Track update failed");

      toast.success(`Track updated: "${lgTitle}" — ${adjustedWords.length} words, ${Math.round(clipInfo.duration)}s clip`);
      fetchTracks();
      lgResetWizard();
      setActiveTab("tracks");
    } catch (err: any) {
      toast.error(err.message || "Generation failed");
    } finally {
      setLgGenerating(false);
    }
  };


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
  const [selectedLyricalTrackIds, setSelectedLyricalTrackIds] = useState<string[]>([]);
  const [lyricalTrackStart, setLyricalTrackStart] = useState<number>(0);
  const [lyricalTrackEnd, setLyricalTrackEnd] = useState<number>(0);
  const [selectedLyricalTemplateId, setSelectedLyricalTemplateId] = useState<string>("");
  const [selectedLyricalTemplateIds, setSelectedLyricalTemplateIds] = useState<string[]>([]);
  const [selectedPreviewTemplateId, setSelectedPreviewTemplateId] = useState<string | null>(null);
  const [lyricalPlaybackTime, setLyricalPlaybackTime] = useState<number>(0);
  const [setupLyricalBgVideoUrl, setSetupLyricalBgVideoUrl] = useState<string>("");
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const [setupLyricalColorFilter, setSetupLyricalColorFilter] = useState<string>("none");
  const [setupLyricalVignette, setSetupLyricalVignette] = useState<string>("none");
  const [setupLyricalParticleFx, setSetupLyricalParticleFx] = useState<string>("none");
  const [setupLyricalMirrorBg, setSetupLyricalMirrorBg] = useState<boolean>(false);
  const [setupLyricalBgSpeed, setSetupLyricalBgSpeed] = useState<number>(1.0);
  const [lyricalAnimationMode, setLyricalAnimationMode] = useState<string>("highlight");
  const [lyricalBgColor, setLyricalBgColor] = useState<string | null>(null);
  const [lyricalTextColor, setLyricalTextColor] = useState<string | null>(null);
  const [lyricalTextAlign, setLyricalTextAlign] = useState<string>("center");
  const [lyricalWordSpacing, setLyricalWordSpacing] = useState<string>("normal");
  const [lyricalLetterSpacing, setLyricalLetterSpacing] = useState<number>(0);
  const [lyricalMuteAudio, setLyricalMuteAudio] = useState<boolean>(false);
  const [lyricalAspectRatio, setLyricalAspectRatio] = useState<"9:16" | "1:1">("9:16");
  const [lyricalBgOpacity, setLyricalBgOpacity] = useState<number>(1.0);
  const [lyricalLofiFactor, setLyricalLofiFactor] = useState<number>(1);
  const [lyricalTextMargin, setLyricalTextMargin] = useState<number>(50);
  const [mixupVisuals, setMixupVisuals] = useState<boolean>(true);

  // Lyrical transcription editor states
  const [isLyricsEditorOpen, setIsLyricsEditorOpen] = useState(false);
  const [lyricsEditingTrack, setLyricsEditingTrack] = useState<any | null>(null);
  const [editingWords, setEditingWords] = useState<any[]>([]);
  const [savingLyrics, setSavingLyrics] = useState(false);

  // Style Studio presets & overrides states
  const [savedStyles, setSavedStyles] = useState<any[]>([]);
  const [loadingSavedStyles, setLoadingSavedStyles] = useState(false);
  const [accountSavedStyleId, setAccountSavedStyleId] = useState<string>("");
  const [lyricalSavedStyleId, setLyricalSavedStyleId] = useState<string>("");

  // LRCLIB Synced Lyrics states
  const [lyricsSearchQuery, setLyricsSearchQuery] = useState("");
  const [lyricsSearchResults, setLyricsSearchResults] = useState<any[]>([]);
  const [searchingLyrics, setSearchingLyrics] = useState(false);
  const [selectedLrcSong, setSelectedLrcSong] = useState<any | null>(null);
  const [lrcStartLine, setLrcStartLine] = useState<number>(0);
  const [lrcEndLine, setLrcEndLine] = useState<number>(0);
  const [isLrcSearchModalOpen, setIsLrcSearchModalOpen] = useState(false);



  // Local video preview & manual upload states
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
  const [previewAspectRatio, setPreviewAspectRatio] = useState<string>("9:16");
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [uploadingItems, setUploadingItems] = useState<Record<string, boolean>>({});
  const [retryingItemIds, setRetryingItemIds] = useState<Record<string, boolean>>({});
  const [deletingItemIds, setDeletingItemIds] = useState<Record<string, boolean>>({});
  const [uploadingBatch, setUploadingBatch] = useState(false);

  // Download states (batchId -> DownloadState)
  interface DownloadState {
    progress: number;
    totalSize: string;
    loadedSize: string;
  }
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});

  // Smart download (folderized) state
  const [showSmartDownload, setShowSmartDownload] = useState(false);
  const [smartAccounts, setSmartAccounts] = useState(5);
  const [smartVidsPerAccount, setSmartVidsPerAccount] = useState(3);
  const [smartDownloading, setSmartDownloading] = useState(false);
  const [smartDownloadProgress, setSmartDownloadProgress] = useState("");

  // Derived autocomplete lists
  const uniqueMusiciansList = Array.from(new Set(tracks.map(t => t.musician || t.artist).filter(Boolean))) as string[];
  const uniqueGenresList = Array.from(new Set(tracks.map(t => t.genre).filter(Boolean))) as string[];

  // Fetch initial data & load google fonts for preview
  useEffect(() => {
    fetchTracks();
    fetchAccounts();
    fetchBatches();
    fetchSavedStyles();

    // Inject Google Fonts link for preview styling
    const id = "google-fonts-preview";
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Anton&family=Caveat:wght@700&family=Great+Vibes&family=Inter:wght@700&family=Lora:ital,wght@0,700;1,700&family=Montserrat:wght@700&family=Oswald:wght@700&family=Outfit:wght@700&family=Playfair+Display:ital,wght@0,700;1,700&display=swap";
      document.head.appendChild(link);
    }

    // Restore wizardStep and activeBatchId on mount from localStorage
    if (typeof window !== "undefined") {
      const persistedStep = localStorage.getItem("lyrical_wizardStep");
      if (persistedStep) {
        setWizardStep(parseInt(persistedStep, 10));
      }
      const persistedBatchId = localStorage.getItem("lyrical_activeBatchId");
      if (persistedBatchId) {
        (async () => {
          try {
            const res = await fetch(`/api/managed/genres/batches?batchId=${persistedBatchId}`);
            if (res.ok) {
              const fullBatch = await res.json();
              setActiveBatch(fullBatch);
            }
          } catch (err) {
            console.error("Failed to load active batch from localStorage:", err);
          }
        })();
      }
    }
  }, []);

  // Save wizardStep to localStorage when it changes
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("lyrical_wizardStep", wizardStep.toString());
    }
  }, [wizardStep]);

  // Save activeBatchId to localStorage when it changes
  useEffect(() => {
    if (typeof window !== "undefined") {
      if (activeBatch) {
        localStorage.setItem("lyrical_activeBatchId", activeBatch.id);
      } else {
        localStorage.removeItem("lyrical_activeBatchId");
      }
    }
  }, [activeBatch]);

  // Auto-clamp lyricalTrackStart and lyricalTrackEnd when selectedLyricalTrackId changes
  useEffect(() => {
    if (selectedLyricalTrackId) {
      const track = tracks.find(t => t.id === selectedLyricalTrackId);
      if (track) {
        setLyricalTrackStart(prev => {
          const maxOffset = Math.max(0, track.duration - 5);
          return Math.min(prev, maxOffset);
        });
        setLyricalTrackEnd(prev => {
          if (prev <= 0 || prev > track.duration) {
            return track.duration;
          }
          return Math.max(5, Math.min(prev, track.duration));
        });
        return;
      }
    }
    setLyricalTrackStart(0);
    setLyricalTrackEnd(0);
  }, [selectedLyricalTrackId, tracks]);

  // Synchronize background preview video with audio playback
  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video) return;

    // Apply custom speed to video preview
    video.playbackRate = setupLyricalBgSpeed;

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
  }, [playingTrackId, setupLyricalTrackId, lyricalPlaybackTime, setupLyricalBgSpeed]);

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
      setAccountSavedStyleId(config?.savedStyleId || "");
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
      setAccountSavedStyleId("");
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

  const fetchSavedStyles = async () => {
    setLoadingSavedStyles(true);
    try {
      const res = await fetch("/api/managed/style-studio/saved-styles");
      if (res.ok) {
        setSavedStyles(await res.json());
      }
    } catch (err) {
      console.warn("Failed to load saved styles:", err);
    } finally {
      setLoadingSavedStyles(false);
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

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const ms = Math.round((secs % 1) * 100);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
  };

  const handleSearchLyrics = async () => {
    if (!lyricsSearchQuery.trim()) return;
    setSearchingLyrics(true);
    setLyricsSearchResults([]);
    setSelectedLrcSong(null);
    try {
      const res = await fetch(`/api/managed/genres/tracks/lyrics?q=${encodeURIComponent(lyricsSearchQuery.trim())}`);
      if (res.ok) {
        const data = await res.json();
        setLyricsSearchResults(data);
        if (data.length === 0) {
          toast.info("No matching synced lyrics found on LRCLIB.");
        }
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to search lyrics");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to search synced lyrics");
    } finally {
      setSearchingLyrics(false);
    }
  };

  const handleApplyLrcLyrics = async (trackId: string) => {
    if (!selectedLrcSong) return;
    const startLine = selectedLrcSong.parsedLines[lrcStartLine];
    const endLine = selectedLrcSong.parsedLines[lrcEndLine];
    if (!startLine || !endLine) return;

    const startTimestamp = startLine.start;
    const endTimestamp = endLine.end;

    // Filter and slice the words matching the selected line range
    const filteredWords = selectedLrcSong.words.filter(
      (w: any) => w.start >= startTimestamp && w.end <= endTimestamp
    );

    // Shift all words start/end timestamps so that startTimestamp becomes 0.0
    const shiftedWords = filteredWords.map((w: any) => ({
      word: w.word,
      start: Number((w.start - startTimestamp).toFixed(3)),
      end: Number((w.end - startTimestamp).toFixed(3)),
    }));

    setSavingLyrics(true);
    try {
      const res = await fetch("/api/managed/genres/tracks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: trackId,
          isLyrical: true,
          lyricalTranscription: JSON.stringify(shiftedWords),
        }),
      });

      if (res.ok) {
        toast.success("Lyrics applied and synced successfully!");
        
        // Update trim timestamps
        setLyricalTrackStart(startTimestamp);
        setLyricalTrackEnd(endTimestamp);

        // Update the tracks list to sync the updated transcription in UI
        fetchTracks();
        
        // Refresh templates list (so we can start styling!)
        await fetchLyricalTemplates(trackId);
        
        // Close modal if open
        setIsLrcSearchModalOpen(false);
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to update track synced lyrics");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to save track synced lyrics");
    } finally {
      setSavingLyrics(false);
    }
  };

  const handleOpenLyricsEditor = (track: any) => {
    setLyricsEditingTrack(track);
    let words = [];
    if (track.lyricalTranscription) {
      try {
        words = JSON.parse(track.lyricalTranscription);
      } catch (e) {
        console.error("Failed to parse lyrics:", e);
      }
    }
    setEditingWords(words);
    setIsLyricsEditorOpen(true);
  };

  const handleSaveLyrics = async () => {
    if (!lyricsEditingTrack) return;
    setSavingLyrics(true);
    try {
      const res = await fetch("/api/managed/genres/tracks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: lyricsEditingTrack.id,
          lyricalTranscription: JSON.stringify(editingWords)
        }),
      });
      if (res.ok) {
        toast.success("Lyrics transcription updated successfully!");
        setIsLyricsEditorOpen(false);
        setLyricsEditingTrack(null);
        fetchTracks(); // refresh tracks list to update in-memory state
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to save lyrics");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to update lyrics");
    } finally {
      setSavingLyrics(false);
    }
  };

  const handlePreRenderTemplate = async (trackId: string) => {
    setPreRenderingTemplate(true);
    toast.info("Saving caption styling template...");
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
          colorFilter: setupLyricalColorFilter,
          vignette: setupLyricalVignette,
          particleFx: setupLyricalParticleFx,
          mirrorBg: setupLyricalMirrorBg,
          bgSpeed: setupLyricalBgSpeed,
          animationMode: lyricalAnimationMode,
          bgColor: lyricalBgColor,
          textColor: lyricalTextColor,
          textAlign: lyricalTextAlign,
          wordSpacing: lyricalWordSpacing,
          letterSpacing: lyricalLetterSpacing,
          muteAudio: lyricalMuteAudio,
          aspectRatio: lyricalAspectRatio,
          bgOpacity: lyricalBgOpacity,
          lofiFactor: lyricalLofiFactor,
          textMargin: lyricalTextMargin,
          savedStyleId: lyricalSavedStyleId ? lyricalSavedStyleId : null,
        }),
      });
      if (res.ok) {
        toast.success(`Template '${lyricalTemplateName}' saved! Captions will be rendered via FFmpeg at batch time.`);
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

  const handleDeleteLyricalTemplate = async (templateId: string, trackId: string) => {
    if (!confirm("Are you sure you want to delete this styling template and all its pre-rendered assets? This cannot be undone.")) {
      return;
    }
    toast.info("Deleting styling template assets...");
    try {
      const res = await fetch(`/api/managed/genres/tracks/lyrical?templateId=${templateId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("Template deleted successfully!");
        if (selectedPreviewTemplateId === templateId) {
          setSelectedPreviewTemplateId(null);
        }
        await fetchLyricalTemplates(trackId);
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to delete template");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to delete template");
    }
  };

  const [reRenderingTemplateId, setReRenderingTemplateId] = useState<string | null>(null);
  const [renderProgress, setRenderProgress] = useState<{ percent: number; status: string }>({ percent: 0, status: "idle" });

  const handleReRenderOverlay = async (templateId: string, templateName: string) => {
    setReRenderingTemplateId(templateId);
    setRenderProgress({ percent: 0, status: "starting" });
    try {
      const res = await fetch("/api/managed/genres/tracks/lyrical", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId }),
      });

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        if (!res.ok) {
          toast.error(`Server error (${res.status}). Check Docker logs.`);
          setReRenderingTemplateId(null);
          setRenderProgress({ percent: 0, status: "idle" });
          return;
        }
      }

      // Start polling progress
      const pollInterval = setInterval(async () => {
        try {
          const pollRes = await fetch(`/api/managed/genres/tracks/lyrical?progressTemplateId=${templateId}`);
          if (pollRes.ok) {
            const progress = await pollRes.json();
            setRenderProgress({ percent: progress.percent || 0, status: progress.status || "rendering" });
            
            if (progress.status === "done") {
              clearInterval(pollInterval);
              toast.success(`Overlay for "${templateName}" rendered successfully! ✅`);
              setReRenderingTemplateId(null);
              setRenderProgress({ percent: 100, status: "done" });
            } else if (progress.status === "failed") {
              clearInterval(pollInterval);
              toast.error(`Overlay render failed for "${templateName}". Check Docker logs.`);
              setReRenderingTemplateId(null);
              setRenderProgress({ percent: 0, status: "idle" });
            }
          }
        } catch {}
      }, 2000);

      // Safety: stop polling after 5 minutes no matter what
      setTimeout(() => {
        clearInterval(pollInterval);
        if (reRenderingTemplateId === templateId) {
          setReRenderingTemplateId(null);
          setRenderProgress({ percent: 0, status: "idle" });
        }
      }, 300000);

    } catch (err: any) {
      toast.error(err.message || "Failed to re-render overlay");
      setReRenderingTemplateId(null);
      setRenderProgress({ percent: 0, status: "idle" });
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
    data.append("savedStyleId", accountSavedStyleId);

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

  const handleToggleTrack = (trackId: string) => {
    let nextIds: string[] = [];
    if (selectedLyricalTrackIds.includes(trackId)) {
      nextIds = selectedLyricalTrackIds.filter(id => id !== trackId);
    } else {
      nextIds = [...selectedLyricalTrackIds, trackId];
    }
    setSelectedLyricalTrackIds(nextIds);

    if (nextIds.length > 0) {
      const firstId = nextIds[0];
      setSelectedLyricalTrackId(firstId);
      fetchLyricalTemplates(firstId);
    } else {
      setSelectedLyricalTrackId("");
      setSelectedLyricalTemplateId("");
      setSelectedLyricalTemplateIds([]);
      setLyricalTemplates([]);
    }
  };

  const handleToggleLyricalTemplate = (templateId: string) => {
    // If mix_all is active, clear it and start multi-select
    const wasMixAll = selectedLyricalTemplateId === "mix_all";
    let nextIds: string[] = [];
    
    if (wasMixAll) {
      nextIds = [templateId];
      setSelectedLyricalTemplateId(templateId);
    } else {
      if (selectedLyricalTemplateIds.includes(templateId)) {
        nextIds = selectedLyricalTemplateIds.filter(id => id !== templateId);
      } else {
        nextIds = [...selectedLyricalTemplateIds, templateId];
      }
      
      if (nextIds.length > 0) {
        setSelectedLyricalTemplateId(nextIds[0]); // preview the first selected template
      } else {
        setSelectedLyricalTemplateId("");
      }
    }
    setSelectedLyricalTemplateIds(nextIds);
  };

  const handleStartLyricalGeneration = async () => {
    if (selectedBatchAccountIds.length === 0) {
      toast.error("Please select at least one TikTok account");
      return;
    }
    if (selectedLyricalTrackIds.length === 0 || (selectedLyricalTemplateId !== "mix_all" && selectedLyricalTemplateIds.length === 0)) {
      toast.error("Please select at least one Lyrical Track and a Styling Template");
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
          trackIds: selectedLyricalTrackIds,
          trackStart: lyricalTrackStart,
          trackEnd: lyricalTrackEnd,
          lyricalTemplateId: selectedLyricalTemplateId,
          lyricalTemplateIds: selectedLyricalTemplateIds,
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

  const handleDeleteBatchItem = async (batchId: string, itemId: string) => {
    if (!confirm("Delete this render permanently? This cannot be undone.")) return;
    setDeletingItemIds(prev => ({ ...prev, [itemId]: true }));
    try {
      const res = await fetch(`/api/managed/genres/batches?batchId=${batchId}&itemId=${itemId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("Render deleted successfully");
        // Refresh batch details
        if (activeBatch?.id === batchId) {
          const statusRes = await fetch(`/api/managed/genres/batches?batchId=${batchId}`);
          if (statusRes.ok) setActiveBatch(await statusRes.json());
        }
        fetchBatches();
      } else {
        const errData = await res.json();
        toast.error(errData.error || "Failed to delete render");
      }
    } catch {
      toast.error("Error deleting render");
    } finally {
      setDeletingItemIds(prev => ({ ...prev, [itemId]: false }));
    }
  };

  const handleDeleteBatch = async (batchId: string) => {
    if (!confirm("Delete this entire batch and all its rendered videos permanently?")) return;
    setDeletingItemIds(prev => ({ ...prev, [batchId]: true }));
    try {
      const res = await fetch(`/api/managed/genres/batches?batchId=${batchId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("Batch deleted successfully");
        fetchBatches();
        if (activeBatch?.id === batchId) {
          setActiveBatch(null);
          setWizardStep(1);
        }
      } else {
        const errData = await res.json();
        toast.error(errData.error || "Failed to delete batch");
      }
    } catch {
      toast.error("Error deleting batch");
    } finally {
      setDeletingItemIds(prev => ({ ...prev, [batchId]: false }));
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

  const handleReRenderItems = async (batchId: string, itemIds: string[]) => {
    // Set retrying state for all requested items
    setRetryingItemIds(prev => {
      const next = { ...prev };
      for (const id of itemIds) next[id] = true;
      return next;
    });

    try {
      const res = await fetch("/api/managed/genres/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "RE_RENDER_ITEMS",
          batchId,
          itemIds,
        }),
      });

      if (res.ok) {
        toast.success(itemIds.length === 1 ? "Re-rendering video initiated!" : "Re-rendering selected videos initiated!");
        fetchBatches();
        if (activeBatch?.id === batchId) {
          const statusRes = await fetch(`/api/managed/genres/batches?batchId=${batchId}`);
          if (statusRes.ok) setActiveBatch(await statusRes.json());
        }
      } else {
        const errData = await res.json();
        toast.error(errData.error || "Failed to re-render videos");
      }
    } catch {
      toast.error("Error initiating re-render");
    } finally {
      setRetryingItemIds(prev => {
        const next = { ...prev };
        for (const id of itemIds) next[id] = false;
        return next;
      });
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

  // ── Smart Download (Folderized) ────────────────────────────────────────────
  const handleSmartDownload = async (batchId: string) => {
    const totalNeeded = smartAccounts * smartVidsPerAccount;
    const renderedCount = activeBatch?.items?.filter(i => i.status === "RENDERED" || i.status === "UPLOADED").length || 0;
    if (totalNeeded > renderedCount) {
      toast.error(`Not enough videos! Need ${totalNeeded} but only ${renderedCount} rendered.`);
      return;
    }

    setSmartDownloading(true);
    setSmartDownloadProgress("Building archive...");

    try {
      const res = await fetch("/api/managed/genres/batches/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId,
          accountCount: smartAccounts,
          videosPerAccount: smartVidsPerAccount,
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
        link.download = data.downloadUrl.split("/").pop() || "smart_download.tar";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toast.success(`Download started in browser! (${smartAccounts} folders × ${smartVidsPerAccount} videos)`);
        // Let user see 100% complete state for 3s
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
        const res = await fetch(`/api/managed/genres/batches/download?batchId=${batchId}`);
        const text = await res.text();

        if (!res.ok) {
          let errMsg = "Failed to prepare download";
          try {
            const err = JSON.parse(text);
            errMsg = err.error || errMsg;
          } catch {
            if (text.trim().startsWith("<")) {
              const titleMatch = text.match(/<title>(.*?)<\/title>/i);
              errMsg = `Server error (${res.status}): ${titleMatch ? titleMatch[1] : "HTML Error"}`;
            }
          }
          throw new Error(errMsg);
        }

        try {
          statusData = JSON.parse(text);
        } catch {
          throw new Error("Invalid server status response");
        }

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
            totalSize: "Redirecting...",
            loadedSize: "Starting browser download",
          }
        }));

        const fileUrl = `/api${statusData.downloadUrl}`;
        const link = document.createElement("a");
        link.href = fileUrl;
        link.download = statusData.downloadUrl.split("/").pop() || `genre_batch_${batchId.substring(0, 8)}.tar`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toast.success("Download started in browser!");
        // Let user see 100% complete state for 3s
        await new Promise((resolve) => setTimeout(resolve, 3000));
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
        /* 1. Golden Dust (Upwards across full container) */
        @keyframes float-dust {
          0% { transform: translateY(0) scale(0.8); opacity: 0; }
          10% { opacity: 0.8; }
          90% { opacity: 0.8; }
          100% { transform: translateY(-330px) scale(1.1); opacity: 0; }
        }
        .animate-float-dust {
          animation: float-dust infinite linear;
        }

        /* 2. Golden Bokeh (Drifting slow across full container) */
        @keyframes float-bokeh {
          0% { transform: translateY(0) scale(0.8); opacity: 0; }
          20% { opacity: 0.35; }
          80% { opacity: 0.35; }
          100% { transform: translateY(-330px) scale(1.4); opacity: 0; }
        }
        .animate-float-bokeh {
          animation: float-bokeh infinite ease-in-out;
        }

        /* 3. Glowing Fireflies (Wandering rise across full container) */
        @keyframes float-fireflies {
          0% { transform: translateY(0) translateX(0); opacity: 0; }
          20% { opacity: 1; transform: translateY(-60px) translateX(12px); }
          45% { transform: translateY(-130px) translateX(-12px); }
          65% { transform: translateY(-200px) translateX(8px); }
          85% { opacity: 1; transform: translateY(-270px) translateX(-6px); }
          100% { transform: translateY(-330px) translateX(0); opacity: 0; }
        }
        .animate-float-fireflies {
          animation: float-fireflies infinite ease-in-out;
        }

        /* 4. Falling Snow (Downwards + Sway across full container) */
        @keyframes fall-snow {
          0% { transform: translateY(-20px) translateX(0) rotate(0deg); opacity: 0; }
          10% { opacity: 0.9; }
          90% { opacity: 0.9; }
          100% { transform: translateY(340px) translateX(16px) rotate(360deg); opacity: 0; }
        }
        .animate-fall-snow {
          animation: fall-snow infinite linear;
        }

        /* 5a. Rising Hearts */
        @keyframes float-hearts {
          0% { transform: translateY(0) scale(0.6) rotate(-15deg); opacity: 0; }
          15% { opacity: 0.9; transform: translateY(-40px) scale(0.9) rotate(5deg); }
          50% { transform: translateY(-160px) scale(1) rotate(-8deg); }
          85% { opacity: 0.8; transform: translateY(-280px) scale(0.85) rotate(10deg); }
          100% { transform: translateY(-340px) scale(0.5) rotate(-5deg); opacity: 0; }
        }
        .animate-float-hearts {
          animation: float-hearts infinite ease-in-out;
        }

        /* 5b. Sparkle Twinkle */
        @keyframes twinkle-sparkle {
          0%, 100% { opacity: 0; transform: scale(0.5) rotate(0deg); }
          25% { opacity: 1; transform: scale(1.2) rotate(90deg); }
          50% { opacity: 0.3; transform: scale(0.7) rotate(180deg); }
          75% { opacity: 1; transform: scale(1.1) rotate(270deg); }
        }
        .animate-twinkle-sparkle {
          animation: twinkle-sparkle infinite ease-in-out;
        }

        /* 5c. Confetti */
        @keyframes fall-confetti {
          0% { transform: translateY(-20px) translateX(0) rotate(0deg); opacity: 0; }
          10% { opacity: 1; }
          50% { transform: translateY(160px) translateX(25px) rotate(200deg); }
          100% { transform: translateY(340px) translateX(-10px) rotate(400deg); opacity: 0; }
        }
        .animate-fall-confetti {
          animation: fall-confetti infinite linear;
        }

        /* 5d. Neon Rain */
        @keyframes neon-rain {
          0% { transform: translateY(-10px) scaleY(0.5); opacity: 0; }
          10% { opacity: 0.8; transform: scaleY(1); }
          90% { opacity: 0.6; }
          100% { transform: translateY(340px) scaleY(1); opacity: 0; }
        }
        .animate-neon-rain {
          animation: neon-rain infinite linear;
        }

        /* 5e. Floating Bubbles */
        @keyframes float-bubbles {
          0% { transform: translateY(0) scale(0.5); opacity: 0; }
          15% { opacity: 0.6; transform: scale(0.8); }
          50% { transform: translateY(-150px) translateX(15px) scale(1); }
          85% { opacity: 0.5; }
          100% { transform: translateY(-330px) translateX(-10px) scale(1.2); opacity: 0; }
        }
        .animate-float-bubbles {
          animation: float-bubbles infinite ease-in-out;
        }

        /* 5. Golden Wave Bounce (Equal heights and delays) */
        @keyframes wave-bounce-1 {
          0%, 100% { height: 4px; }
          50% { height: 16px; }
        }
        @keyframes wave-bounce-2 {
          0%, 100% { height: 6px; }
          50% { height: 12px; }
        }
        @keyframes wave-bounce-3 {
          0%, 100% { height: 3px; }
          50% { height: 14px; }
        }
        .animate-wave-1 {
          animation: wave-bounce-1 0.8s infinite ease-in-out;
        }
        .animate-wave-2 {
          animation: wave-bounce-2 0.5s infinite ease-in-out;
        }
        .animate-wave-3 {
          animation: wave-bounce-3 0.7s infinite ease-in-out;
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
          <button
            onClick={() => setActiveTab("lyric-gen")}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 ${
              activeTab === "lyric-gen" 
                ? "bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 text-emerald-400 border border-emerald-500/30 shadow-lg shadow-emerald-500/5 backdrop-blur-md" 
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Mic className="w-4 h-4" />
            Lyric Generator
          </button>
        </div>
      </div>

      {/* ────────────────────────────────────────────────────────────────────────
          TAB: TRACKS LIBRARY
      ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === "tracks" && (
        setupLyricalTrackId !== null ? (() => {
          const selectedTrack = tracks.find(t => t.id === setupLyricalTrackId);
          if (!selectedTrack) {
            return (
              <div className="bg-[#0d0d16]/80 backdrop-blur-md border border-white/10 p-8 rounded-3xl text-center space-y-4">
                <p className="text-gray-400">Track not found.</p>
                <button
                  type="button"
                  onClick={() => setSetupLyricalTrackId(null)}
                  className="bg-white/5 border border-white/10 px-4 py-2 rounded-xl text-xs text-white hover:bg-white/10"
                >
                  Go Back
                </button>
              </div>
            );
          }
          
          const isPlayingThis = playingTrackId === selectedTrack.id;
          const playPercent = isPlayingThis && selectedTrack.duration > 0
            ? Math.min(100, Math.max(0, (lyricalPlaybackTime / selectedTrack.duration) * 100))
            : 0;

          // Parse transcription client-side
          let wordsList: any[] = [];
          if (selectedTrack.lyricalTranscription) {
            try {
              wordsList = JSON.parse(selectedTrack.lyricalTranscription);
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

          // Fallback if no active chunk is found
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

          // ── Word Builder: group into larger phrases (up to 12 words, split on gaps >1.5s)
          const phrases = (() => {
            if (lyricalAnimationMode !== "word_builder") return [];
            const res: any[][] = [];
            let current: any[] = [];
            let lastEnd = 0;
            for (const w of wordsList) {
              if (current.length > 0 && (w.start - lastEnd > 1.5 || current.length >= 12)) {
                res.push(current);
                current = [];
              }
              current.push(w);
              lastEnd = w.end;
            }
            if (current.length > 0) res.push(current);
            return res;
          })();

          // Find current phrase for word_builder mode
          const currentPhrase = phrases.find(phrase => {
            if (phrase.length === 0) return false;
            return lyricalPlaybackTime >= phrase[0].start - 0.05 && lyricalPlaybackTime <= phrase[phrase.length - 1].end + 0.3;
          }) || null;

          // Words to show in word_builder mode (all words whose start <= current time)
          const wordBuilderVisibleWords = currentPhrase
            ? currentPhrase.filter((w: any) => lyricalPlaybackTime >= w.start - 0.05)
            : [];

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
            if (setupLyricalColorFilter === "emerald") {
              return "contrast(1.15) saturate(0.7) sepia(0.1) hue-rotate(80deg) brightness(0.9)";
            }
            if (setupLyricalColorFilter === "polaroid") {
              return "contrast(0.95) saturate(1.1) sepia(0.15) brightness(1.02)";
            }
            if (setupLyricalColorFilter === "midnight") {
              return "contrast(1.1) saturate(1.15) hue-rotate(190deg) brightness(0.85)";
            }
            if (setupLyricalColorFilter === "golden_hour") {
              return "contrast(1.05) saturate(1.3) sepia(0.25) brightness(1.05) hue-rotate(-10deg)";
            }
            if (setupLyricalColorFilter === "arctic") {
              return "contrast(1.1) saturate(0.6) hue-rotate(180deg) brightness(1.05)";
            }
            if (setupLyricalColorFilter === "neon_noir") {
              return "contrast(1.4) saturate(1.5) brightness(0.75) hue-rotate(280deg)";
            }
            if (setupLyricalColorFilter === "rose_tint") {
              return "contrast(1.05) saturate(1.2) sepia(0.15) hue-rotate(330deg) brightness(1.0)";
            }
            if (setupLyricalColorFilter === "vintage_film") {
              return "contrast(0.9) saturate(0.8) sepia(0.3) brightness(0.95)";
            }
            if (setupLyricalColorFilter === "tropical") {
              return "contrast(1.1) saturate(1.5) hue-rotate(60deg) brightness(1.05)";
            }
            return "none";
          })();

          const cssFontFamily = (() => {
            if (lyricalFontFamily.startsWith("Montserrat")) return "'Montserrat', sans-serif";
            if (lyricalFontFamily.startsWith("Outfit")) return "'Outfit', sans-serif";
            if (lyricalFontFamily.startsWith("Anton")) return "'Anton', sans-serif";
            if (lyricalFontFamily.startsWith("Inter")) return "'Inter', sans-serif";
            if (lyricalFontFamily.startsWith("Caveat")) return "'Caveat', cursive";
            if (lyricalFontFamily.startsWith("Oswald")) return "'Oswald', sans-serif";
            if (lyricalFontFamily.startsWith("PlayfairDisplay")) return "'Playfair Display', serif";
            if (lyricalFontFamily.startsWith("GreatVibes")) return "'Great Vibes', cursive";
            if (lyricalFontFamily.startsWith("Lora")) return "'Lora', serif";
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

          return (
            <div className="space-y-6 animate-fadeIn text-left">
              {/* Studio Workspace Header Bar */}
              <div className="bg-[#0d0d16]/80 backdrop-blur-md border border-white/10 p-5 rounded-3xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-xl">
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => {
                      setSetupLyricalTrackId(null);
                      if (playingTrackId === selectedTrack.id) {
                        togglePlayTrack(selectedTrack);
                      }
                    }}
                    className="p-3 rounded-2xl bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-all duration-300 flex items-center justify-center gap-2 group cursor-pointer"
                  >
                    <X className="w-4 h-4 group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-black uppercase tracking-wider font-extrabold">Close Studio</span>
                  </button>
                  
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-purple-500 shadow-[0_0_12px_rgba(168,85,247,0.9)] animate-pulse" />
                      <h2 className="text-lg font-black text-white leading-none tracking-tight uppercase">Lyrical Video Setup Studio</h2>
                    </div>
                    <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">
                      Styling Track: <span className="text-amber-400 font-bold">{selectedTrack.title}</span> — {selectedTrack.artist} <span className="text-gray-600">|</span> Length: {selectedTrack.duration.toFixed(1)}s
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full border ${
                    selectedTrack.isLyrical 
                      ? "bg-green-500/10 text-green-400 border-green-500/20" 
                      : "bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse"
                  }`}>
                    {selectedTrack.isLyrical ? "Whisper Aligned" : "Alignment Needed"}
                  </span>

                  {selectedTrack.isLyrical && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleOpenLyricsEditor(selectedTrack)}
                        className="text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full border bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 hover:text-purple-300 border-purple-500/20 hover:border-purple-500/40 transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        <Edit3 className="w-3 h-3" />
                        Edit Lyrics
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedLrcSong(null);
                          setLyricsSearchQuery(selectedTrack.artist ? `${selectedTrack.artist} ${selectedTrack.title}` : selectedTrack.title);
                          setLyricsSearchResults([]);
                          setIsLrcSearchModalOpen(true);
                        }}
                        className="text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full border bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 hover:text-amber-300 border-amber-500/20 hover:border-amber-500/40 transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        <Music className="w-3 h-3" />
                        Import Synced LRC
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {!selectedTrack.isLyrical ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto items-stretch">
                  {/* Option 1: Whisper local auto-alignment */}
                  <div className="bg-[#0d0d16]/80 backdrop-blur-md border border-purple-500/20 rounded-3xl p-8 text-center flex flex-col justify-between space-y-6 shadow-2xl shadow-purple-950/10">
                    <div className="space-y-6">
                      <div className="w-16 h-16 rounded-3xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center mx-auto shadow-lg shadow-purple-500/5">
                        <Sparkles className="w-8 h-8 text-purple-400 animate-pulse" />
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-lg font-black text-white tracking-tight uppercase">Option A: Whisper Auto-Alignment</h3>
                        <p className="text-sm text-gray-400 leading-relaxed max-w-sm mx-auto">
                          This audio track will be fully transcribed and word-aligned automatically using our local Whisper model. This runs in the background and takes ~2 minutes.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={designatingLyrical[selectedTrack.id]}
                      onClick={() => handleDesignateLyrical(selectedTrack.id)}
                      className="w-full max-w-xs mx-auto bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-white font-extrabold py-3 px-6 rounded-2xl text-xs flex items-center justify-center gap-2 shadow-lg hover:shadow-purple-500/10 transition-all duration-300 disabled:opacity-50 cursor-pointer"
                    >
                      {designatingLyrical[selectedTrack.id] ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Whisper Aligning...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          Run Auto-Align
                        </>
                      )}
                    </button>
                  </div>

                  {/* Option 2: LRCLIB Synced Lyrics Fetcher */}
                  <div className="bg-[#0d0d16]/80 backdrop-blur-md border border-amber-500/20 rounded-3xl p-8 text-center flex flex-col justify-between space-y-6 shadow-2xl shadow-amber-950/10">
                    <div className="space-y-6">
                      <div className="w-16 h-16 rounded-3xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto shadow-lg shadow-amber-500/5">
                        <Music className="w-8 h-8 text-amber-400" />
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-lg font-black text-white tracking-tight uppercase">Option B: Synced Lyrics (LRCLIB)</h3>
                        <p className="text-sm text-gray-400 leading-relaxed max-w-sm mx-auto">
                          Search the public LRCLIB synced lyrics database to instantly fetch precise word timings, then choose a customized line range (start/end lines) for trimming.
                        </p>
                      </div>

                      {/* LRCLIB Search Area */}
                      <div className="space-y-3 text-left">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Artist / Song Title..."
                            value={lyricsSearchQuery}
                            onChange={(e) => setLyricsSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSearchLyrics()}
                            className="flex-1 bg-black/45 border border-white/10 focus:border-amber-500/50 rounded-xl px-3 py-2 text-xs text-white focus:outline-none transition-all"
                          />
                          <button
                            type="button"
                            onClick={handleSearchLyrics}
                            disabled={searchingLyrics || !lyricsSearchQuery.trim()}
                            className="bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-black font-extrabold px-3 py-2 rounded-xl text-xs transition-all flex items-center gap-1 cursor-pointer"
                          >
                            {searchingLyrics ? <Loader2 className="w-3 h-3 animate-spin" /> : "Search"}
                          </button>
                        </div>

                        {/* Search Results */}
                        {lyricsSearchResults.length > 0 && !selectedLrcSong && (
                          <div className="max-h-[150px] overflow-y-auto border border-white/5 rounded-xl bg-black/35 divide-y divide-white/5 pr-1">
                            {lyricsSearchResults.map((song) => (
                              <div
                                key={song.id}
                                onClick={() => {
                                  setSelectedLrcSong(song);
                                  setLrcStartLine(0);
                                  setLrcEndLine(Math.min(4, song.parsedLines.length - 1));
                                }}
                                className="p-2 hover:bg-white/5 cursor-pointer flex justify-between items-center text-[11px]"
                              >
                                <div className="truncate pr-2">
                                  <p className="font-bold text-white truncate">{song.trackName}</p>
                                  <p className="text-gray-500 truncate">{song.artistName} {song.albumName ? `(${song.albumName})` : ""}</p>
                                </div>
                                <span className="text-amber-400 font-extrabold text-[10px] uppercase flex-shrink-0">
                                  {song.syncedLyrics ? "Synced ✅" : "Unsynced"}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Selected Song Preview and Range Picker */}
                        {selectedLrcSong && (
                          <div className="space-y-4 bg-black/40 p-4 border border-white/5 rounded-2xl">
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] uppercase tracking-wider font-extrabold text-amber-400 truncate">
                                Selected: {selectedLrcSong.trackName}
                              </span>
                              <button
                                type="button"
                                onClick={() => setSelectedLrcSong(null)}
                                className="text-[9px] uppercase tracking-wider font-black text-gray-500 hover:text-white"
                              >
                                Change
                              </button>
                            </div>

                            {selectedLrcSong.parsedLines && selectedLrcSong.parsedLines.length > 0 ? (
                              <>
                                <div className="grid grid-cols-1 gap-2.5">
                                  <div className="space-y-1">
                                    <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Start Line</label>
                                    <select
                                      value={lrcStartLine}
                                      onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        setLrcStartLine(val);
                                        if (val > lrcEndLine) setLrcEndLine(val);
                                      }}
                                      className="w-full bg-black/60 border border-white/10 hover:border-white/20 rounded-xl px-2 py-1.5 text-xs text-white focus:outline-none"
                                    >
                                      {selectedLrcSong.parsedLines.map((line: any, idx: number) => (
                                        <option key={idx} value={idx}>
                                          [{formatTime(line.start)}] {line.text || "(instrumental)"}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="space-y-1">
                                    <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">End Line</label>
                                    <select
                                      value={lrcEndLine}
                                      onChange={(e) => setLrcEndLine(parseInt(e.target.value))}
                                      className="w-full bg-black/60 border border-white/10 hover:border-white/20 rounded-xl px-2 py-1.5 text-xs text-white focus:outline-none"
                                    >
                                      {selectedLrcSong.parsedLines.map((line: any, idx: number) => (
                                        <option key={idx} value={idx} disabled={idx < lrcStartLine}>
                                          [{formatTime(line.end)}] {line.text || "(instrumental)"}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </div>

                                <div className="text-[10px] text-gray-500 mt-2 bg-black/20 p-2 rounded-lg border border-white/5">
                                  <span className="font-bold text-gray-400">Preview details:</span> Duration:{" "}
                                  <span className="text-white font-extrabold">
                                    {(selectedLrcSong.parsedLines[lrcEndLine].end - selectedLrcSong.parsedLines[lrcStartLine].start).toFixed(1)}s
                                  </span>{" "}
                                  | Range:{" "}
                                  <span className="text-white font-extrabold">
                                    {selectedLrcSong.parsedLines[lrcStartLine].start.toFixed(1)}s - {selectedLrcSong.parsedLines[lrcEndLine].end.toFixed(1)}s
                                  </span>
                                </div>

                                <button
                                  type="button"
                                  disabled={savingLyrics}
                                  onClick={() => handleApplyLrcLyrics(selectedTrack.id)}
                                  className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-black font-extrabold py-2.5 rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer mt-1"
                                >
                                  {savingLyrics ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Apply Synced Lyrics & Crop"}
                                </button>
                              </>
                            ) : (
                              <p className="text-[10px] text-red-400 font-semibold uppercase tracking-wider">No synchronized lyrics available for this match.</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                // 3-Column Styling Studio Layout!
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                  
                  {/* Column 1: Configurator Deck */}
                  <div className="lg:col-span-4 bg-[#0d0d16]/70 backdrop-blur-xl border border-white/10 p-5 rounded-3xl shadow-2xl space-y-5">
                    <div className="flex items-center gap-2 pb-2 border-b border-white/5">
                      <Sliders className="w-4 h-4 text-purple-400" />
                      <h3 className="text-xs font-black uppercase tracking-widest text-purple-300">Styling Configurator</h3>
                    </div>

                    <div className="space-y-4">
                      {/* Style Studio Preset Selection */}
                      <div className="space-y-1">
                        <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">
                          Style Studio Preset (Remotion Pre-Render)
                        </label>
                        <select
                          value={lyricalSavedStyleId}
                          onChange={(e) => {
                            const val = e.target.value;
                            setLyricalSavedStyleId(val);
                            if (val) {
                              const style = savedStyles.find(s => s.id === val);
                              if (style) {
                                try {
                                  const params = JSON.parse(style.params || "{}");
                                  if (params.fontFamily) setLyricalFontFamily(params.fontFamily);
                                  if (params.fontSize) setLyricalFontSize(params.fontSize);
                                  if (params.textColor) setLyricalTextColor(params.textColor);
                                  if (params.activeColor) setLyricalActiveColor(params.activeColor);
                                } catch (e) {
                                  console.error("Failed to parse Style Studio preset params:", e);
                                }
                              }
                            }
                          }}
                          className="w-full bg-black/45 border border-white/10 hover:border-white/20 rounded-2xl px-3 py-2.5 text-xs text-gray-300 focus:outline-none transition-all duration-300 cursor-pointer"
                        >
                          <option value="">-- Use Classic FFmpeg Render (No Preset) --</option>
                          {savedStyles.map((style) => (
                            <option key={style.id} value={style.id}>
                              {style.name} ({style.templateKey})
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Preset Theme */}
                      <div className="space-y-1">
                        <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Preset Theme</label>
                        <select
                          onChange={(e) => {
                            const val = e.target.value;
                            setLyricalMuteAudio(false);
                            if (val === "neon-rainbow") {
                              setLyricalTemplateName("Neon Rainbow");
                              setLyricalFontFamily("Montserrat-Black");
                              setLyricalFontSize(48);
                              setLyricalActiveColor("multi");
                              setLyricalStrokeWidth(5);
                              setLyricalStrokeColor("#000000");
                              setLyricalPositionY(0.75);
                              setLyricalAnimationMode("highlight");
                              setLyricalBgColor(null);
                              setLyricalTextColor(null);
                              setLyricalTextAlign("center");
                              setLyricalWordSpacing("normal");
                              setLyricalLetterSpacing(0);
                            } else if (val === "vibrant-yellow") {
                              setLyricalTemplateName("Vibrant Yellow");
                              setLyricalFontFamily("Anton");
                              setLyricalFontSize(50);
                              setLyricalActiveColor("#ffff00");
                              setLyricalStrokeWidth(4);
                              setLyricalStrokeColor("#000000");
                              setLyricalPositionY(0.70);
                              setLyricalAnimationMode("highlight");
                              setLyricalBgColor(null);
                              setLyricalTextColor(null);
                              setLyricalTextAlign("center");
                              setLyricalWordSpacing("normal");
                              setLyricalLetterSpacing(0);
                            } else if (val === "electric-green") {
                              setLyricalTemplateName("Electric Green");
                              setLyricalFontFamily("Outfit-Bold");
                              setLyricalFontSize(46);
                              setLyricalActiveColor("#00ff00");
                              setLyricalStrokeWidth(6);
                              setLyricalStrokeColor("#111111");
                              setLyricalPositionY(0.80);
                              setLyricalAnimationMode("highlight");
                              setLyricalBgColor(null);
                              setLyricalTextColor(null);
                              setLyricalTextAlign("center");
                              setLyricalWordSpacing("normal");
                              setLyricalLetterSpacing(0);
                            } else if (val === "hot-pink") {
                              setLyricalTemplateName("Hot Pink");
                              setLyricalFontFamily("Inter-Bold");
                              setLyricalFontSize(48);
                              setLyricalActiveColor("#ff007f");
                              setLyricalStrokeWidth(5);
                              setLyricalStrokeColor("#000000");
                              setLyricalPositionY(0.75);
                              setLyricalAnimationMode("highlight");
                              setLyricalBgColor(null);
                              setLyricalTextColor(null);
                              setLyricalTextAlign("center");
                              setLyricalWordSpacing("normal");
                              setLyricalLetterSpacing(0);
                            } else if (val === "word-builder-yellow") {
                              setLyricalTemplateName("Minimalist Word Builder");
                              setLyricalFontFamily("Inter-Light");
                              setLyricalFontSize(56);
                              setLyricalActiveColor("#000000");
                              setLyricalStrokeWidth(0);
                              setLyricalStrokeColor("#000000");
                              setLyricalPositionY(0.40);
                              setLyricalAnimationMode("word_builder");
                              setLyricalBgColor("#F5A623");
                              setLyricalBgOpacity(1.0);
                              setLyricalLofiFactor(1);
                              setLyricalTextColor("#000000");
                              setSetupLyricalColorFilter("none");
                              setSetupLyricalVignette("none");
                              setSetupLyricalParticleFx("none");
                              setSetupLyricalBgVideoUrl("");
                              setLyricalTextAlign("left");
                              setLyricalWordSpacing("extra_wide");
                              setLyricalLetterSpacing(0);
                            } else if (val === "brat-style") {
                              setLyricalTemplateName("Brat Style");
                              setLyricalFontFamily("Montserrat-Black");
                              setLyricalFontSize(76);
                              setLyricalActiveColor("#000000");
                              setLyricalStrokeWidth(0);
                              setLyricalStrokeColor("#000000");
                              setLyricalPositionY(0.40);
                              setLyricalAnimationMode("brat");
                              setLyricalBgColor("#8ace00");
                              setLyricalBgOpacity(1.0);
                              setLyricalLofiFactor(8);
                              setLyricalTextMargin(50);
                              setLyricalTextColor("#000000");
                              setSetupLyricalColorFilter("none");
                              setSetupLyricalVignette("none");
                              setSetupLyricalParticleFx("none");
                              setSetupLyricalBgVideoUrl("");
                              setLyricalTextAlign("left");
                              setLyricalWordSpacing("wide");
                              setLyricalLetterSpacing(-2);
                            }
                          }}
                          className="w-full bg-black/45 border border-white/10 hover:border-white/20 rounded-2xl px-3 py-2.5 text-xs text-gray-300 focus:outline-none transition-all duration-300 cursor-pointer"
                        >
                          <option value="custom">-- Choose Preset Styling --</option>
                          <option value="neon-rainbow">Neon Rainbow (Active Multi-color)</option>
                          <option value="vibrant-yellow">Vibrant Yellow (Anton Bold)</option>
                          <option value="electric-green">Electric Green (Outfit Active)</option>
                          <option value="hot-pink">Hot Pink (Vibrant Neon Pink)</option>
                          <option value="word-builder-yellow">⚡ Minimalist Word Builder (Yellow & Black)</option>
                          <option value="brat-style">💚 Brat Style (Charli XCX - Pixelated Slime Green)</option>
                        </select>
                      </div>

                      {/* Name / Font / Aspect Ratio */}
                      <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Template Name</label>
                          <input
                            type="text"
                            value={lyricalTemplateName}
                            onChange={(e) => setLyricalTemplateName(e.target.value)}
                            placeholder="e.g. My Style"
                            className="w-full bg-black/45 border border-white/10 hover:border-white/20 focus:border-purple-500/50 rounded-2xl px-3 py-2 text-xs text-white focus:outline-none transition-all duration-300"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Font Family</label>
                          <select
                            value={lyricalFontFamily}
                            onChange={(e) => setLyricalFontFamily(e.target.value)}
                            className="w-full bg-black/45 border border-white/10 hover:border-white/20 rounded-2xl px-3 py-2 text-xs text-gray-300 focus:outline-none transition-all duration-300 cursor-pointer"
                          >
                            <option value="Montserrat-Black">Montserrat Black</option>
                            <option value="Outfit-Bold">Outfit Bold</option>
                            <option value="Anton">Anton</option>
                            <option value="Inter-Bold">Inter Bold</option>
                            <option value="Inter-Regular">Inter Regular</option>
                            <option value="Inter-Light">Inter Light</option>
                            <option value="Caveat-Bold">Caveat Bold</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Aspect Ratio</label>
                          <select
                            value={lyricalAspectRatio}
                            onChange={(e) => setLyricalAspectRatio(e.target.value as "9:16" | "1:1")}
                            className="w-full bg-black/45 border border-white/10 hover:border-white/20 rounded-2xl px-3 py-2 text-xs text-gray-300 focus:outline-none transition-all duration-300 cursor-pointer"
                          >
                            <option value="9:16">Vertical (9:16)</option>
                            <option value="1:1">Square (1:1)</option>
                          </select>
                        </div>
                      </div>

                      {/* Sliders Block */}
                      <div className="space-y-3 bg-black/30 p-3 rounded-2xl border border-white/5 shadow-inner">
                        {/* Font Size */}
                        <div className="space-y-1">
                          <div className="flex justify-between items-center text-[9px] uppercase tracking-wider font-extrabold text-gray-500">
                            <span>Font Size</span>
                            <span className="text-purple-400 font-black">{lyricalFontSize}px</span>
                          </div>
                          <input
                            type="range"
                            min="24"
                            max="72"
                            value={lyricalFontSize}
                            onChange={(e) => setLyricalFontSize(parseInt(e.target.value))}
                            className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                          />
                        </div>

                        {/* Stroke Width */}
                        <div className="space-y-1">
                          <div className="flex justify-between items-center text-[9px] uppercase tracking-wider font-extrabold text-gray-500">
                            <span>Stroke Width</span>
                            <span className="text-purple-400 font-black">{lyricalStrokeWidth}px</span>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="12"
                            value={lyricalStrokeWidth}
                            onChange={(e) => setLyricalStrokeWidth(parseInt(e.target.value))}
                            className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                          />
                        </div>

                        {/* Position Y */}
                        <div className="space-y-1">
                          <div className="flex justify-between items-center text-[9px] uppercase tracking-wider font-extrabold text-gray-500">
                            <span>Position Y</span>
                            <span className="text-purple-400 font-black">{Math.round(lyricalPositionY * 100)}%</span>
                          </div>
                          <input
                            type="range"
                            min="30"
                            max="90"
                            value={lyricalPositionY * 100}
                            onChange={(e) => setLyricalPositionY(parseInt(e.target.value) / 100)}
                            className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                          />
                        </div>
                      </div>

                      {/* Alignment & Spacing Block */}
                      <div className="space-y-3 bg-black/30 p-3 rounded-2xl border border-white/5 shadow-inner">
                        {/* Text Alignment */}
                        <div className="space-y-1">
                          <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Text Alignment</label>
                          <select
                            value={lyricalTextAlign}
                            onChange={(e) => setLyricalTextAlign(e.target.value)}
                            className="w-full bg-black/45 border border-white/10 hover:border-white/20 rounded-2xl px-3 py-2 text-xs text-gray-300 focus:outline-none transition-all duration-300 cursor-pointer"
                          >
                            <option value="center">Center</option>
                            <option value="left">Left</option>
                            <option value="right">Right</option>
                          </select>
                        </div>

                        {/* Word Spacing */}
                        <div className="space-y-1">
                          <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Word Spacing</label>
                          <select
                            value={lyricalWordSpacing}
                            onChange={(e) => setLyricalWordSpacing(e.target.value)}
                            className="w-full bg-black/45 border border-white/10 hover:border-white/20 rounded-2xl px-3 py-2 text-xs text-gray-300 focus:outline-none transition-all duration-300 cursor-pointer"
                          >
                            <option value="normal">Normal</option>
                            <option value="wide">Wide</option>
                            <option value="extra_wide">Extra Wide</option>
                          </select>
                        </div>

                        {/* Letter Spacing */}
                        <div className="space-y-1">
                          <div className="flex justify-between items-center text-[9px] uppercase tracking-wider font-extrabold text-gray-500">
                            <span>Letter Spacing</span>
                            <span className="text-purple-400 font-black">{lyricalLetterSpacing}px</span>
                          </div>
                          <input
                            type="range"
                            min="-5"
                            max="15"
                            value={lyricalLetterSpacing}
                            onChange={(e) => setLyricalLetterSpacing(parseInt(e.target.value))}
                            className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                          />
                        </div>
                      </div>

                      {/* Colors Block */}
                      <div className="space-y-3 bg-black/20 p-3 rounded-2xl border border-white/5 shadow-inner">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Active Neon Color</label>
                            <select
                              value={
                                ["multi", "#ffff00", "#00ff00", "#00ffff", "#ff007f", "#ff5500", "#bf00ff", "#ff0040", "#00ff88", "#ff69b4", "#7b68ee", "#ffffff"].includes(lyricalActiveColor)
                                  ? lyricalActiveColor
                                  : "custom"
                              }
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === "custom") {
                                  setLyricalActiveColor("#ffffff");
                                } else {
                                  setLyricalActiveColor(val);
                                }
                              }}
                              className="w-full bg-black/45 border border-white/10 hover:border-white/20 rounded-2xl px-3 py-2 text-xs text-gray-300 focus:outline-none transition-all duration-300 cursor-pointer"
                            >
                              <option value="multi">Neon Rainbow (Cycles)</option>
                              <option value="#ffff00">Neon Yellow</option>
                              <option value="#00ff00">Neon Green</option>
                              <option value="#00ffff">Neon Cyan</option>
                              <option value="#ff007f">Neon Pink</option>
                              <option value="#ff5500">Neon Orange</option>
                              <option value="#bf00ff">Neon Purple</option>
                              <option value="#ff0040">Neon Red</option>
                              <option value="#00ff88">Neon Mint</option>
                              <option value="#ff69b4">Hot Pink</option>
                              <option value="#7b68ee">Medium Slate</option>
                              <option value="#ffffff">Pure White</option>
                              <option value="custom">Custom Color...</option>
                            </select>
                            {lyricalActiveColor !== "multi" && (
                              <div className="flex items-center gap-2 mt-1.5">
                                <input
                                  type="color"
                                  value={lyricalActiveColor.startsWith("#") ? lyricalActiveColor : "#ffffff"}
                                  onChange={(e) => setLyricalActiveColor(e.target.value)}
                                  className="w-7 h-7 rounded-lg border border-white/10 cursor-pointer bg-transparent"
                                />
                                <input
                                  type="text"
                                  value={lyricalActiveColor}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    if (/^#[0-9a-fA-F]{0,6}$/.test(val)) setLyricalActiveColor(val);
                                  }}
                                  className="flex-1 bg-black/45 border border-white/10 hover:border-white/20 rounded-xl px-2 py-1 text-[10px] text-gray-300 font-mono focus:outline-none"
                                  placeholder="#FFFFFF"
                                />
                              </div>
                            )}
                          </div>
                          <div className="space-y-1">
                            <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Stroke Outline Color</label>
                            <select
                              value={lyricalStrokeColor}
                              onChange={(e) => setLyricalStrokeColor(e.target.value)}
                              className="w-full bg-black/45 border border-white/10 hover:border-white/20 rounded-2xl px-3 py-2 text-xs text-gray-300 focus:outline-none transition-all duration-300 cursor-pointer"
                            >
                              <option value="#000000">Black (#000000)</option>
                              <option value="#ffffff">White (#ffffff)</option>
                              <option value="#1a1a1a">Charcoal (#1a1a1a)</option>
                              <option value="#333333">Grey (#333333)</option>
                            </select>
                          </div>
                        </div>

                        {/* Inactive / Base Text Color */}
                        <div className="space-y-1 pt-1.5 border-t border-white/5">
                          <div className="flex justify-between items-center">
                            <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Base/Inactive Text Color</label>
                            {lyricalTextColor && (
                              <button
                                type="button"
                                onClick={() => setLyricalTextColor(null)}
                                className="text-[8px] text-red-400 hover:underline cursor-pointer"
                              >
                                Reset to Default
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <input
                              type="color"
                              value={lyricalTextColor || "#ffffff"}
                              onChange={(e) => setLyricalTextColor(e.target.value)}
                              className="w-7 h-7 rounded-lg border border-white/10 cursor-pointer bg-transparent"
                            />
                            <input
                              type="text"
                              value={lyricalTextColor || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === "") {
                                  setLyricalTextColor(null);
                                } else if (/^#[0-9a-fA-F]{0,6}$/.test(val)) {
                                  setLyricalTextColor(val);
                                }
                              }}
                              className="flex-1 bg-black/45 border border-white/10 hover:border-white/20 rounded-xl px-2 py-1 text-[10px] text-gray-300 font-mono focus:outline-none"
                              placeholder="Default (#ffffff)"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Mute Background Music Toggle */}
                      <div className="space-y-2 bg-black/20 p-3 rounded-2xl border border-white/5 shadow-inner">
                        <div className="flex items-center justify-between">
                          <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Mute Background Music</label>
                          <button
                            type="button"
                            onClick={() => setLyricalMuteAudio(!lyricalMuteAudio)}
                            className={`relative w-9 h-5 rounded-full transition-all duration-300 ${lyricalMuteAudio ? "bg-amber-500" : "bg-gray-700"}`}
                          >
                            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-md transition-all duration-300 ${lyricalMuteAudio ? "left-[18px]" : "left-0.5"}`} />
                          </button>
                        </div>
                      </div>

                      {/* Background Color & Opacity Card */}
                      <div className="space-y-3 bg-black/20 p-3 rounded-2xl border border-white/5 shadow-inner">
                        <div className="flex items-center justify-between">
                          <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Background Color</label>
                          <button
                            type="button"
                            onClick={() => {
                              if (lyricalBgColor) {
                                setLyricalBgColor(null);
                              } else {
                                setLyricalBgColor("#8ace00"); // default to Brat green!
                              }
                            }}
                            className={`relative w-9 h-5 rounded-full transition-all duration-300 ${lyricalBgColor ? "bg-amber-500" : "bg-gray-700"}`}
                          >
                            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-md transition-all duration-300 ${lyricalBgColor ? "left-[18px]" : "left-0.5"}`} />
                          </button>
                        </div>
                        {lyricalBgColor && (
                          <>
                            <div className="flex items-center gap-2 mt-1">
                              <input
                                type="color"
                                value={lyricalBgColor}
                                onChange={(e) => setLyricalBgColor(e.target.value)}
                                className="w-8 h-8 rounded-xl border border-white/10 cursor-pointer bg-transparent"
                              />
                              <input
                                type="text"
                                value={lyricalBgColor}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (/^#[0-9a-fA-F]{0,6}$/.test(val)) setLyricalBgColor(val);
                                }}
                                className="flex-1 bg-black/45 border border-white/10 hover:border-white/20 rounded-xl px-3 py-1.5 text-xs text-gray-300 font-mono focus:outline-none transition-all duration-300"
                                placeholder="#8ace00"
                              />
                            </div>
                            <div className="space-y-1 mt-2">
                              <div className="flex justify-between text-[9px] text-gray-500 uppercase font-extrabold">
                                <span>Opacity</span>
                                <span>{Math.round(lyricalBgOpacity * 100)}%</span>
                              </div>
                              <input
                                type="range"
                                min="0.0"
                                max="1.0"
                                step="0.05"
                                value={lyricalBgOpacity}
                                onChange={(e) => setLyricalBgOpacity(parseFloat(e.target.value))}
                                className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                              />
                            </div>
                          </>
                        )}
                        <p className="text-[8px] text-gray-600 mt-1">
                          {lyricalBgColor 
                            ? `Color overlay applied with ${Math.round(lyricalBgOpacity * 100)}% opacity`
                            : "Transparent background (using background video loops/clips)"
                          }
                        </p>
                      </div>

                      {/* Lo-Fi Pixelation Factor */}
                      <div className="space-y-2 bg-black/20 p-3 rounded-2xl border border-white/5 shadow-inner">
                        <div className="flex justify-between items-center">
                          <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Lo-Fi Pixelation</label>
                          <span className="text-xs text-amber-400 font-extrabold font-mono">{lyricalLofiFactor}x</span>
                        </div>
                        <input
                          type="range"
                          min="1"
                          max="20"
                          step="1"
                          value={lyricalLofiFactor}
                          onChange={(e) => setLyricalLofiFactor(parseInt(e.target.value, 10))}
                          className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                        />
                        <p className="text-[8px] text-gray-600">
                          {lyricalLofiFactor > 1 
                            ? `Scale down by ${lyricalLofiFactor}x and upscale with nearest-neighbor (pixelated look)`
                            : "No pixelation (sharp high-res text)"
                          }
                        </p>
                      </div>

                      {/* Text Frame Margin */}
                      <div className="space-y-2 bg-black/20 p-3 rounded-2xl border border-white/5 shadow-inner">
                        <div className="flex justify-between items-center">
                          <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Text Frame Margin</label>
                          <span className="text-xs text-amber-400 font-extrabold font-mono">{lyricalTextMargin}px</span>
                        </div>
                        <input
                          type="range"
                          min="10"
                          max="200"
                          step="5"
                          value={lyricalTextMargin}
                          onChange={(e) => setLyricalTextMargin(parseInt(e.target.value, 10))}
                          className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                        />
                        <p className="text-[8px] text-gray-600">
                          Configure text horizontal padding/margins from frame edges.
                        </p>
                      </div>

                      {/* Mirror, Speed, BG Video — hidden when solid bg is active */}
                      {(!lyricalBgColor || lyricalBgOpacity < 1.0) && (
                      <div className="space-y-3 bg-black/20 p-3 rounded-2xl border border-white/5 shadow-inner">
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
                                className="w-full bg-black/45 border border-white/10 hover:border-white/20 rounded-2xl px-3 py-2 text-xs text-gray-300 focus:outline-none transition-all duration-300 cursor-pointer"
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

                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Background Mirror</label>
                            <select
                              value={setupLyricalMirrorBg ? "true" : "false"}
                              onChange={(e) => setSetupLyricalMirrorBg(e.target.value === "true")}
                              className="w-full bg-black/45 border border-white/10 hover:border-white/20 rounded-2xl px-3 py-2 text-xs text-gray-300 focus:outline-none transition-all duration-300 cursor-pointer"
                            >
                              <option value="false">Normal (Standard)</option>
                              <option value="true">Mirrored (Horiz. Flip)</option>
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Background Speed</label>
                            <select
                              value={setupLyricalBgSpeed.toString()}
                              onChange={(e) => setSetupLyricalBgSpeed(parseFloat(e.target.value))}
                              className="w-full bg-black/45 border border-white/10 hover:border-white/20 rounded-2xl px-3 py-2 text-xs text-gray-300 focus:outline-none transition-all duration-300 cursor-pointer"
                            >
                              <option value="0.95">0.95x (Slow)</option>
                              <option value="1.0">1.00x (Normal)</option>
                              <option value="1.05">1.05x (Fast)</option>
                            </select>
                          </div>
                        </div>
                      </div>
                      )}

                      {/* Vignette, Filters, Particles */}
                      <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <label className="block text-[8px] uppercase tracking-wider font-extrabold text-gray-500">Color Filter</label>
                          <select
                            value={setupLyricalColorFilter}
                            onChange={(e) => setSetupLyricalColorFilter(e.target.value)}
                            className="w-full bg-black/45 border border-white/10 hover:border-white/20 rounded-xl px-1.5 py-2 text-[9px] text-gray-300 focus:outline-none transition-all duration-300 cursor-pointer"
                          >
                            <option value="none">Normal (Clear)</option>
                            <option value="cyberpunk">Cyberpunk</option>
                            <option value="cinema">Cinema (Warm)</option>
                            <option value="vhs">VHS (Retro)</option>
                            <option value="monochrome">Moody Mono</option>
                            <option value="emerald">Emerald</option>
                            <option value="polaroid">Polaroid</option>
                            <option value="midnight">Midnight</option>
                            <option value="golden_hour">Golden Hour</option>
                            <option value="arctic">Arctic Blue</option>
                            <option value="neon_noir">Neon Noir</option>
                            <option value="rose_tint">Rosé Tint</option>
                            <option value="vintage_film">Vintage Film</option>
                            <option value="tropical">Tropical</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[8px] uppercase tracking-wider font-extrabold text-gray-500">Dark Vignette</label>
                          <select
                            value={setupLyricalVignette}
                            onChange={(e) => setSetupLyricalVignette(e.target.value)}
                            className="w-full bg-black/45 border border-white/10 hover:border-white/20 rounded-xl px-1.5 py-2 text-[9px] text-gray-300 focus:outline-none transition-all duration-300 cursor-pointer"
                          >
                            <option value="none">None (Clear)</option>
                            <option value="bottom_fade">Bottom Shadow</option>
                            <option value="radial_vignette">Cinematic Vig.</option>
                            <option value="sunset_glow">Sunset Glow</option>
                            <option value="emerald_fade">Emerald Vig.</option>
                            <option value="top_fade">Top Shadow</option>
                            <option value="dual_fade">Dual Edge Fade</option>
                            <option value="purple_haze">Purple Haze</option>
                            <option value="blue_hour">Blue Hour</option>
                            <option value="fire_edge">Fire Edge</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[8px] uppercase tracking-wider font-extrabold text-gray-500">Particle FX</label>
                          <select
                            value={setupLyricalParticleFx}
                            onChange={(e) => setSetupLyricalParticleFx(e.target.value)}
                            className="w-full bg-black/45 border border-white/10 hover:border-white/20 rounded-xl px-1.5 py-2 text-[9px] text-gray-300 focus:outline-none transition-all duration-300 cursor-pointer"
                          >
                            <option value="none">None</option>
                            <option value="gold_dust.mp4">Gold Dust</option>
                            <option value="bokeh.mp4">Golden Bokeh</option>
                            <option value="fireflies.mp4">Fireflies</option>
                            <option value="snow.mp4">Falling Snow</option>
                            <option value="hearts.mp4">Rising Hearts</option>
                            <option value="sparkles.mp4">Sparkle Twinkle</option>
                            <option value="confetti.mp4">Confetti</option>
                            <option value="neon_rain.mp4">Neon Rain</option>
                            <option value="bubbles.mp4">Floating Bubbles</option>
                          </select>
                        </div>
                      </div>

                      {/* Save Template Button */}
                      <button
                        type="button"
                        disabled={preRenderingTemplate}
                        onClick={() => handlePreRenderTemplate(selectedTrack.id)}
                        className="w-full bg-gradient-to-r from-amber-500 via-purple-500 to-indigo-600 hover:from-amber-600 hover:to-indigo-700 text-white font-extrabold py-3 px-4 rounded-2xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-purple-500/5 hover:shadow-purple-500/10 hover:scale-[1.01] transition-all duration-300 disabled:opacity-50 cursor-pointer"
                      >
                        {preRenderingTemplate ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Saving template...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5" />
                            Save styling template
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Column 2: Live Video & Audio Preview Simulator */}
                  <div className="lg:col-span-4 bg-[#0d0d16]/70 backdrop-blur-xl border border-white/10 p-5 rounded-3xl shadow-2xl space-y-4 flex flex-col items-center">
                    <div className="w-full flex justify-between items-center pb-2 border-b border-white/5">
                      <div className="flex items-center gap-2">
                        <Play className="w-4 h-4 text-amber-400" />
                        <h3 className="text-xs font-black uppercase tracking-widest text-amber-300">Live Studio Preview</h3>
                      </div>
                      <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${isPlayingThis ? "bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse" : "bg-white/5 text-gray-500 border-white/5"}`}>
                        {isPlayingThis ? "Playing Sound" : "Paused"}
                      </span>
                    </div>

                    {/* Interactive Phone mockup */}
                    <div 
                      onClick={() => togglePlayTrack(selectedTrack)}
                      className={`relative ${lyricalAspectRatio === "1:1" ? "aspect-square" : "aspect-[9/16]"} w-full max-w-[200px] bg-[#07070d] border border-white/15 ${lyricalAspectRatio === "1:1" ? "rounded-[24px]" : "rounded-[36px]"} overflow-hidden shadow-2xl flex flex-col justify-between group cursor-pointer hover:border-purple-500/30 transition-all duration-300`}
                    >
                      {/* Background layer */}
                      {setupLyricalBgVideoUrl ? (
                        <>
                          <video
                            ref={previewVideoRef}
                            src={resolveUrl(setupLyricalBgVideoUrl)}
                            className="absolute inset-0 w-full h-full object-cover z-0"
                            style={{ 
                              filter: cssColorFilterStyle,
                              transform: setupLyricalMirrorBg ? "scaleX(-1)" : "none"
                            }}
                            muted
                            loop
                            playsInline
                          />
                          <div className="absolute inset-0 bg-black/45 backdrop-blur-[0.5px] z-0 select-none" />
                        </>
                      ) : (
                        <>
                          <div 
                            className="absolute inset-0 bg-gradient-to-b from-[#120521] via-[#050616] to-[#04101e] opacity-90 select-none z-0" 
                            style={{ filter: cssColorFilterStyle }}
                          />
                          <div className="absolute top-[20%] left-[20%] w-[100px] h-[100px] bg-purple-600/10 rounded-full blur-[40px] animate-pulse z-0" />
                          <div className="absolute bottom-[20%] right-[20%] w-[100px] h-[100px] bg-indigo-500/10 rounded-full blur-[40px] animate-pulse z-0" />
                        </>
                      )}

                      {/* Custom Background Color & Opacity Overlay */}
                      {lyricalBgColor && (
                        <div 
                          className="absolute inset-0 z-0 select-none" 
                          style={{ 
                            backgroundColor: lyricalBgColor,
                            opacity: lyricalBgOpacity 
                          }}
                        />
                      )}

                      {/* Vignette Overlay */}
                      {setupLyricalVignette === "bottom_fade" && (
                        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent z-[1] pointer-events-none select-none" />
                      )}
                      {setupLyricalVignette === "radial_vignette" && (
                        <div className="absolute inset-0 bg-[radial-gradient(circle,transparent_40%,rgba(0,0,0,0.65)_95%)] z-[1] pointer-events-none select-none" />
                      )}
                      {setupLyricalVignette === "sunset_glow" && (
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,140,0,0.65)_0%,rgba(255,69,0,0)_60%)] z-[1] pointer-events-none select-none" />
                      )}
                      {setupLyricalVignette === "emerald_fade" && (
                        <div className="absolute inset-0 bg-[radial-gradient(circle,transparent_40%,rgba(5,28,15,0.65)_95%)] z-[1] pointer-events-none select-none" />
                      )}
                      {setupLyricalVignette === "top_fade" && (
                        <div className="absolute inset-0 bg-gradient-to-b from-black/85 via-black/20 to-transparent z-[1] pointer-events-none select-none" />
                      )}
                      {setupLyricalVignette === "dual_fade" && (
                        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-transparent to-black/70 z-[1] pointer-events-none select-none" />
                      )}
                      {setupLyricalVignette === "purple_haze" && (
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom,rgba(147,51,234,0.45)_0%,transparent_70%)] z-[1] pointer-events-none select-none" />
                      )}
                      {setupLyricalVignette === "blue_hour" && (
                        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,rgba(30,58,138,0.55)_0%,transparent_65%)] z-[1] pointer-events-none select-none" />
                      )}
                      {setupLyricalVignette === "fire_edge" && (
                        <div className="absolute inset-0 bg-[radial-gradient(circle,transparent_35%,rgba(180,40,0,0.50)_90%)] z-[1] pointer-events-none select-none" />
                      )}

                      {/* Watermark badge overlay */}
                      <div className="absolute right-3 bottom-[75px] z-[5] pointer-events-none select-none scale-75 origin-bottom-right">
                        <div className="bg-[#0f0f0f]/65 border border-white/15 px-3 py-1.5 rounded-full backdrop-blur-md flex items-center gap-1.5 shadow-lg shadow-black/45">
                          <div className="flex items-center">
                            <div className="w-1.5 h-1.5 bg-purple-500 rounded-full shadow-[0_0_8px_rgba(168,85,247,0.8)]" />
                            <div className="w-[1.5px] h-3 bg-pink-500 rounded-t -mt-2 -ml-0.5" />
                            <div className="w-1.5 h-[1.5px] bg-pink-500 rounded-r -mt-2 -ml-0.5" />
                          </div>
                          <span className="text-[8px] font-extrabold tracking-wide text-white/95 uppercase">@sleeckos</span>
                        </div>
                      </div>

                      {/* Live Particles Overlays */}
                      {setupLyricalParticleFx !== "none" && (
                        <div className="absolute inset-0 z-[2] overflow-hidden pointer-events-none select-none">
                          {setupLyricalParticleFx === "gold_dust.mp4" && (
                            <>
                              <div className="absolute w-1 h-1 bg-amber-400/50 rounded-full blur-[0.3px] top-[95%] left-[10%] animate-float-dust" style={{ animationDelay: "0s", animationDuration: "5.5s" }} />
                              <div className="absolute w-2 h-2 bg-yellow-200/40 rounded-full blur-[0.8px] top-[90%] left-[45%] animate-float-dust" style={{ animationDelay: "1.2s", animationDuration: "4.8s" }} />
                              <div className="absolute w-1 h-1 bg-white/60 rounded-full top-[98%] left-[75%] animate-float-dust" style={{ animationDelay: "2.5s", animationDuration: "6.5s" }} />
                              <div className="absolute w-1.5 h-1.5 bg-amber-300/35 rounded-full blur-[1.2px] top-[92%] left-[60%] animate-float-dust" style={{ animationDelay: "0.5s", animationDuration: "7.2s" }} />
                              <div className="absolute w-1.5 h-1.5 bg-yellow-100/50 rounded-full blur-[0.3px] top-[94%] left-[30%] animate-float-dust" style={{ animationDelay: "1.8s", animationDuration: "5.8s" }} />
                              <div className="absolute w-2 h-2 bg-amber-400/30 rounded-full blur-[0.5px] top-[96%] left-[85%] animate-float-dust" style={{ animationDelay: "3.2s", animationDuration: "6s" }} />
                              <div className="absolute w-1.5 h-1.5 bg-yellow-300/40 rounded-full top-[91%] left-[20%] animate-float-dust" style={{ animationDelay: "4.1s", animationDuration: "5.2s" }} />
                              <div className="absolute w-1 h-1 bg-white/50 rounded-full blur-[0.4px] top-[97%] left-[55%] animate-float-dust" style={{ animationDelay: "0.8s", animationDuration: "7s" }} />
                              <div className="absolute w-2.5 h-2.5 bg-amber-200/25 rounded-full blur-[1.5px] top-[93%] left-[70%] animate-float-dust" style={{ animationDelay: "2.9s", animationDuration: "8s" }} />
                              <div className="absolute w-1 h-1 bg-yellow-400/60 rounded-full top-[95%] left-[40%] animate-float-dust" style={{ animationDelay: "5s", animationDuration: "6.2s" }} />
                            </>
                          )}
                          {setupLyricalParticleFx === "bokeh.mp4" && (
                            <>
                              <div className="absolute w-7 h-7 bg-yellow-300/10 rounded-full blur-[3px] top-[95%] left-[15%] animate-float-bokeh" style={{ animationDelay: "0s", animationDuration: "9s" }} />
                              <div className="absolute w-11 h-11 bg-amber-200/8 rounded-full blur-[4.5px] top-[98%] left-[50%] animate-float-bokeh" style={{ animationDelay: "2s", animationDuration: "12s" }} />
                              <div className="absolute w-6 h-6 bg-yellow-100/12 rounded-full blur-[2px] top-[92%] left-[78%] animate-float-bokeh" style={{ animationDelay: "4.5s", animationDuration: "8s" }} />
                              <div className="absolute w-8 h-8 bg-amber-400/8 rounded-full blur-[3.5px] top-[96%] left-[35%] animate-float-bokeh" style={{ animationDelay: "1.2s", animationDuration: "10.5s" }} />
                              <div className="absolute w-10 h-10 bg-yellow-400/8 rounded-full blur-[4px] top-[94%] left-[65%] animate-float-bokeh" style={{ animationDelay: "3.5s", animationDuration: "11s" }} />
                              <div className="absolute w-5 h-5 bg-amber-200/15 rounded-full blur-[1.8px] top-[97%] left-[10%] animate-float-bokeh" style={{ animationDelay: "5.8s", animationDuration: "8.5s" }} />
                              <div className="absolute w-7 h-7 bg-white/10 rounded-full blur-[2.5px] top-[91%] left-[88%] animate-float-bokeh" style={{ animationDelay: "2.8s", animationDuration: "9.5s" }} />
                            </>
                          )}
                          {setupLyricalParticleFx === "fireflies.mp4" && (
                            <>
                              <div className="absolute w-2 h-2 bg-lime-400 rounded-full shadow-[0_0_8px_#84cc16] top-[95%] left-[20%] animate-float-fireflies" style={{ animationDelay: "0s", animationDuration: "6.8s" }} />
                              <div className="absolute w-1.5 h-1.5 bg-yellow-300 rounded-full shadow-[0_0_6px_#fde047] top-[92%] left-[65%] animate-float-fireflies" style={{ animationDelay: "1.5s", animationDuration: "5.8s" }} />
                              <div className="absolute w-2 h-2 bg-lime-300 rounded-full shadow-[0_0_8px_#bef264] top-[96%] left-[45%] animate-float-fireflies" style={{ animationDelay: "3s", animationDuration: "7.5s" }} />
                              <div className="absolute w-1 h-1 bg-yellow-200 rounded-full shadow-[0_0_4px_#fef08a] top-[90%] left-[80%] animate-float-fireflies" style={{ animationDelay: "0.8s", animationDuration: "8.5s" }} />
                              <div className="absolute w-2.5 h-2.5 bg-lime-400 rounded-full shadow-[0_0_9px_#84cc16] top-[94%] left-[10%] animate-float-fireflies" style={{ animationDelay: "2.2s", animationDuration: "7.2s" }} />
                              <div className="absolute w-1.5 h-1.5 bg-lime-300 rounded-full shadow-[0_0_6px_#bef264] top-[97%] left-[30%] animate-float-fireflies" style={{ animationDelay: "4.1s", animationDuration: "6.2s" }} />
                              <div className="absolute w-2 h-2 bg-yellow-300 rounded-full shadow-[0_0_8px_#fde047] top-[93%] left-[55%] animate-float-fireflies" style={{ animationDelay: "5.3s", animationDuration: "8s" }} />
                              <div className="absolute w-1.5 h-1.5 bg-lime-400 rounded-full shadow-[0_0_6px_#84cc16] top-[98%] left-[72%] animate-float-fireflies" style={{ animationDelay: "1.9s", animationDuration: "6.5s" }} />
                            </>
                          )}
                          {setupLyricalParticleFx === "snow.mp4" && (
                            <>
                              <div className="absolute w-2 h-2 bg-white rounded-full top-[-10px] left-[15%] animate-fall-snow" style={{ animationDelay: "0s", animationDuration: "4.8s" }} />
                              <div className="absolute w-1.5 h-1.5 bg-slate-100/80 rounded-full top-[-10px] left-[45%] animate-fall-snow" style={{ animationDelay: "1.2s", animationDuration: "4.2s" }} />
                              <div className="absolute w-2.5 h-2.5 bg-white/90 rounded-full blur-[0.5px] top-[-10px] left-[70%] animate-fall-snow" style={{ animationDelay: "2.5s", animationDuration: "5.8s" }} />
                              <div className="absolute w-1.5 h-1.5 bg-white/70 rounded-full top-[-10px] left-[30%] animate-fall-snow" style={{ animationDelay: "0.5s", animationDuration: "5.2s" }} />
                              <div className="absolute w-2.5 h-2.5 bg-slate-200/90 rounded-full top-[-10px] left-[85%] animate-fall-snow" style={{ animationDelay: "3.2s", animationDuration: "4.5s" }} />
                              <div className="absolute w-1.5 h-1.5 bg-white/80 rounded-full top-[-10px] left-[5%] animate-fall-snow" style={{ animationDelay: "1.8s", animationDuration: "5s" }} />
                              <div className="absolute w-2.5 h-2.5 bg-white rounded-full top-[-10px] left-[60%] animate-fall-snow" style={{ animationDelay: "0.9s", animationDuration: "4.6s" }} />
                              <div className="absolute w-1 h-1 bg-slate-100 rounded-full top-[-10px] left-[38%] animate-fall-snow" style={{ animationDelay: "2.9s", animationDuration: "3.8s" }} />
                              <div className="absolute w-2.5 h-2.5 bg-white/95 rounded-full top-[-10px] left-[80%] animate-fall-snow" style={{ animationDelay: "4.1s", animationDuration: "5.5s" }} />
                              <div className="absolute w-1.5 h-1.5 bg-white/75 rounded-full top-[-10px] left-[52%] animate-fall-snow" style={{ animationDelay: "1.5s", animationDuration: "4.9s" }} />
                              <div className="absolute w-2 h-2 bg-slate-100 rounded-full top-[-10px] left-[22%] animate-fall-snow" style={{ animationDelay: "3.6s", animationDuration: "5.1s" }} />
                              <div className="absolute w-1.5 h-1.5 bg-white rounded-full top-[-10px] left-[95%] animate-fall-snow" style={{ animationDelay: "0.3s", animationDuration: "4.3s" }} />
                            </>
                          )}
                          {setupLyricalParticleFx === "hearts.mp4" && (
                            <>
                              <div className="absolute text-[10px] top-[95%] left-[15%] animate-float-hearts" style={{ animationDelay: "0s", animationDuration: "5.5s" }}>❤️</div>
                              <div className="absolute text-[8px] top-[92%] left-[45%] animate-float-hearts" style={{ animationDelay: "1.3s", animationDuration: "6.2s" }}>💕</div>
                              <div className="absolute text-[12px] top-[98%] left-[70%] animate-float-hearts" style={{ animationDelay: "2.8s", animationDuration: "5s" }}>💗</div>
                              <div className="absolute text-[9px] top-[93%] left-[30%] animate-float-hearts" style={{ animationDelay: "0.7s", animationDuration: "6.8s" }}>❤️</div>
                              <div className="absolute text-[11px] top-[96%] left-[85%] animate-float-hearts" style={{ animationDelay: "3.5s", animationDuration: "5.8s" }}>💖</div>
                              <div className="absolute text-[8px] top-[90%] left-[55%] animate-float-hearts" style={{ animationDelay: "4.2s", animationDuration: "7s" }}>💗</div>
                            </>
                          )}
                          {setupLyricalParticleFx === "sparkles.mp4" && (
                            <>
                              <div className="absolute w-1.5 h-1.5 bg-white rounded-sm rotate-45 top-[20%] left-[15%] animate-twinkle-sparkle" style={{ animationDelay: "0s", animationDuration: "2.5s" }} />
                              <div className="absolute w-2 h-2 bg-yellow-200/90 rounded-sm rotate-45 top-[40%] left-[75%] animate-twinkle-sparkle" style={{ animationDelay: "0.8s", animationDuration: "3.2s" }} />
                              <div className="absolute w-1 h-1 bg-white/80 rounded-sm rotate-45 top-[65%] left-[30%] animate-twinkle-sparkle" style={{ animationDelay: "1.5s", animationDuration: "2.8s" }} />
                              <div className="absolute w-2 h-2 bg-cyan-200/70 rounded-sm rotate-45 top-[80%] left-[60%] animate-twinkle-sparkle" style={{ animationDelay: "2.2s", animationDuration: "3.5s" }} />
                              <div className="absolute w-1.5 h-1.5 bg-white rounded-sm rotate-45 top-[30%] left-[50%] animate-twinkle-sparkle" style={{ animationDelay: "0.4s", animationDuration: "2.2s" }} />
                              <div className="absolute w-1 h-1 bg-pink-200/80 rounded-sm rotate-45 top-[55%] left-[88%] animate-twinkle-sparkle" style={{ animationDelay: "3s", animationDuration: "3s" }} />
                              <div className="absolute w-2 h-2 bg-white/90 rounded-sm rotate-45 top-[15%] left-[42%] animate-twinkle-sparkle" style={{ animationDelay: "1.8s", animationDuration: "2.6s" }} />
                              <div className="absolute w-1.5 h-1.5 bg-amber-200/80 rounded-sm rotate-45 top-[75%] left-[10%] animate-twinkle-sparkle" style={{ animationDelay: "2.8s", animationDuration: "3.8s" }} />
                            </>
                          )}
                          {setupLyricalParticleFx === "confetti.mp4" && (
                            <>
                              <div className="absolute w-2 h-3 bg-red-400/80 rounded-sm top-[-10px] left-[10%] animate-fall-confetti" style={{ animationDelay: "0s", animationDuration: "4s" }} />
                              <div className="absolute w-1.5 h-2.5 bg-yellow-400/80 rounded-sm top-[-10px] left-[30%] animate-fall-confetti" style={{ animationDelay: "0.8s", animationDuration: "4.5s" }} />
                              <div className="absolute w-2 h-2 bg-blue-400/80 rounded-sm top-[-10px] left-[55%] animate-fall-confetti" style={{ animationDelay: "1.5s", animationDuration: "3.8s" }} />
                              <div className="absolute w-1.5 h-3 bg-green-400/80 rounded-sm top-[-10px] left-[75%] animate-fall-confetti" style={{ animationDelay: "2.2s", animationDuration: "5s" }} />
                              <div className="absolute w-2 h-2.5 bg-pink-400/80 rounded-sm top-[-10px] left-[45%] animate-fall-confetti" style={{ animationDelay: "0.5s", animationDuration: "4.2s" }} />
                              <div className="absolute w-1.5 h-2 bg-purple-400/80 rounded-sm top-[-10px] left-[88%] animate-fall-confetti" style={{ animationDelay: "3s", animationDuration: "3.5s" }} />
                              <div className="absolute w-2 h-3 bg-orange-400/80 rounded-sm top-[-10px] left-[20%] animate-fall-confetti" style={{ animationDelay: "1.8s", animationDuration: "4.8s" }} />
                              <div className="absolute w-1.5 h-2.5 bg-cyan-400/80 rounded-sm top-[-10px] left-[65%] animate-fall-confetti" style={{ animationDelay: "2.8s", animationDuration: "4.3s" }} />
                            </>
                          )}
                          {setupLyricalParticleFx === "neon_rain.mp4" && (
                            <>
                              <div className="absolute w-[1px] h-4 bg-cyan-400/60 top-[-10px] left-[12%] animate-neon-rain shadow-[0_0_4px_#22d3ee]" style={{ animationDelay: "0s", animationDuration: "1.8s" }} />
                              <div className="absolute w-[1px] h-5 bg-purple-400/60 top-[-10px] left-[28%] animate-neon-rain shadow-[0_0_4px_#a855f7]" style={{ animationDelay: "0.3s", animationDuration: "2.1s" }} />
                              <div className="absolute w-[1px] h-3.5 bg-pink-400/60 top-[-10px] left-[45%] animate-neon-rain shadow-[0_0_4px_#f472b6]" style={{ animationDelay: "0.7s", animationDuration: "1.6s" }} />
                              <div className="absolute w-[1px] h-4.5 bg-cyan-300/60 top-[-10px] left-[62%] animate-neon-rain shadow-[0_0_4px_#67e8f9]" style={{ animationDelay: "1.1s", animationDuration: "2.3s" }} />
                              <div className="absolute w-[1px] h-3 bg-blue-400/60 top-[-10px] left-[78%] animate-neon-rain shadow-[0_0_4px_#60a5fa]" style={{ animationDelay: "0.5s", animationDuration: "1.9s" }} />
                              <div className="absolute w-[1px] h-5 bg-violet-400/60 top-[-10px] left-[92%] animate-neon-rain shadow-[0_0_4px_#a78bfa]" style={{ animationDelay: "1.4s", animationDuration: "2s" }} />
                              <div className="absolute w-[1px] h-4 bg-fuchsia-400/60 top-[-10px] left-[38%] animate-neon-rain shadow-[0_0_4px_#e879f9]" style={{ animationDelay: "0.9s", animationDuration: "1.7s" }} />
                              <div className="absolute w-[1px] h-3.5 bg-cyan-400/60 top-[-10px] left-[55%] animate-neon-rain shadow-[0_0_4px_#22d3ee]" style={{ animationDelay: "1.6s", animationDuration: "2.2s" }} />
                            </>
                          )}
                          {setupLyricalParticleFx === "bubbles.mp4" && (
                            <>
                              <div className="absolute w-4 h-4 border border-white/20 bg-white/5 rounded-full top-[95%] left-[15%] animate-float-bubbles" style={{ animationDelay: "0s", animationDuration: "6s" }} />
                              <div className="absolute w-6 h-6 border border-white/15 bg-white/3 rounded-full top-[92%] left-[45%] animate-float-bubbles" style={{ animationDelay: "1.5s", animationDuration: "7.5s" }} />
                              <div className="absolute w-3 h-3 border border-white/25 bg-white/5 rounded-full top-[98%] left-[70%] animate-float-bubbles" style={{ animationDelay: "3s", animationDuration: "5.5s" }} />
                              <div className="absolute w-5 h-5 border border-white/15 bg-white/3 rounded-full top-[90%] left-[30%] animate-float-bubbles" style={{ animationDelay: "0.8s", animationDuration: "8s" }} />
                              <div className="absolute w-3 h-3 border border-white/20 bg-white/5 rounded-full top-[96%] left-[85%] animate-float-bubbles" style={{ animationDelay: "2.2s", animationDuration: "6.5s" }} />
                              <div className="absolute w-7 h-7 border border-white/10 bg-white/3 rounded-full top-[93%] left-[58%] animate-float-bubbles" style={{ animationDelay: "4s", animationDuration: "9s" }} />
                            </>
                          )}
                        </div>
                      )}

                      {/* TikTok UI Elements simulation overlay */}
                      <div className="absolute right-3.5 bottom-12 flex flex-col items-center gap-3.5 z-10 text-white/50 pointer-events-none">
                        <div className="flex flex-col items-center gap-0.5">
                          <div className="w-5 h-5 rounded-full border border-white/20 bg-white/10 flex items-center justify-center text-[7px] font-bold text-white">♫</div>
                        </div>
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-[10px]">❤️</span>
                          <span className="text-[6px] font-black text-white/90">12.5K</span>
                        </div>
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-[10px]">💬</span>
                          <span className="text-[6px] font-black text-white/90">342</span>
                        </div>
                      </div>

                      <div className="absolute left-3 bottom-3 flex items-center gap-1.5 z-10 text-white/60 pointer-events-none">
                        <div className="w-3.5 h-3.5 rounded-full bg-purple-500/25 border border-purple-500/40 flex items-center justify-center text-[6px] font-black uppercase text-purple-300 tracking-wider shadow-md">L</div>
                        <div className="text-[7px] leading-tight max-w-[110px] truncate font-semibold">
                          <p className="text-white/90 font-bold leading-none">@sleeckos</p>
                          <p className="text-[6px] text-white/45 mt-0.5 leading-none">Lyrical Video Composer...</p>
                        </div>
                      </div>

                      {/* Play/Pause Hover block */}
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-20">
                        <div className="w-11 h-11 rounded-full bg-black/70 border border-white/15 flex items-center justify-center text-white shadow-2xl backdrop-blur-sm scale-90 group-hover:scale-100 transition-all duration-300">
                          {isPlayingThis ? (
                            <Pause className="w-4 h-4 text-purple-400 fill-current" />
                          ) : (
                            <Play className="w-4 h-4 text-amber-400 fill-current translate-x-0.5" />
                          )}
                        </div>
                      </div>

                      {/* Live Captions Typography Layer */}
                      {(() => {
                        const justify = lyricalTextAlign === "left" ? "flex-start" : lyricalTextAlign === "right" ? "flex-end" : "center";
                        const textAlignClass = lyricalTextAlign === "left" ? "text-left" : lyricalTextAlign === "right" ? "text-right" : "text-center";
                        const gapX = (() => {
                          if (lyricalWordSpacing === "wide") return lyricalAnimationMode === "word_builder" ? "14px" : "10px";
                          if (lyricalWordSpacing === "extra_wide") return lyricalAnimationMode === "word_builder" ? "20px" : "16px";
                          if (lyricalWordSpacing === "normal") return lyricalAnimationMode === "word_builder" ? "6px" : "4px";
                          return lyricalAnimationMode === "word_builder" ? "20px" : "4px";
                        })();
                        const gapY = lyricalAnimationMode === "word_builder" ? "8px" : "2px";
                        
                        return lyricalAnimationMode === "brat" ? (
                          /* ── BRAT STYLE MODE: Dynamic Font Sizing & Position ── */
                          <div className="absolute inset-0 z-10 select-none pointer-events-none">
                            {(() => {
                              const layoutWords = computeBratLayout(
                                wordBuilderVisibleWords,
                                lyricalFontFamily,
                                lyricalFontSize,
                                720,
                                1280,
                                lyricalTextMargin
                              );
                              return layoutWords.map((w: any, idx: number) => (
                                <span
                                  key={idx}
                                  className="absolute uppercase"
                                  style={{
                                    left: `${w.x * 0.23}px`,
                                    top: `${w.y * 0.23}px`,
                                    fontSize: `${w.fontSize * 0.23}px`,
                                    fontFamily: cssFontFamily,
                                    color: lyricalTextColor || "#000000",
                                    letterSpacing: `${lyricalLetterSpacing * 0.23}px`,
                                    textTransform: "lowercase" as const,
                                    lineHeight: 1.0,
                                    fontWeight: 900
                                  }}
                                >
                                  {w.word.toLowerCase()}
                                </span>
                              ));
                            })()}
                          </div>
                        ) : lyricalAnimationMode === "word_builder" ? (
                          /* ── WORD BUILDER MODE: Progressive word append ── */
                          <div 
                            className={`absolute left-0 right-0 px-4 transform -translate-y-1/2 transition-all duration-150 z-10 select-none pointer-events-none ${textAlignClass}`}
                            style={{ 
                              top: `${lyricalPositionY * 100}%`,
                              fontFamily: cssFontFamily,
                              fontSize: `${lyricalFontSize * 0.23}px`,
                              lineHeight: 1.6
                            }}
                          >
                            <div 
                              className="flex flex-wrap items-center"
                              style={{ 
                                justifyContent: justify,
                                gap: `${gapY} ${gapX}`,
                                maxHeight: `${Math.round(lyricalFontSize * 0.23 * 1.6 * 3 + 12)}px`, 
                                overflow: "hidden" 
                              }}
                            >
                              {wordBuilderVisibleWords.map((w: any, idx: number) => (
                                <span
                                  key={idx}
                                  style={{
                                    color: lyricalTextColor || "#000000",
                                    fontWeight: 300,
                                    textTransform: "lowercase" as const,
                                    letterSpacing: `${lyricalLetterSpacing * 0.23}px`,
                                    display: "inline-block",
                                  }}
                                >
                                  {w.word.toLowerCase()}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : (
                          /* ── HIGHLIGHT MODE: Existing chunk-based rendering ── */
                          <div 
                            className={`absolute left-0 right-0 px-3 transform -translate-y-1/2 transition-all duration-150 z-10 select-none pointer-events-none ${textAlignClass}`}
                            style={{ 
                              top: `${lyricalPositionY * 100}%`,
                              fontFamily: cssFontFamily,
                              fontSize: `${lyricalFontSize * 0.23}px`,
                              lineHeight: 1.25
                            }}
                          >
                            <div 
                              className="flex flex-wrap items-center"
                              style={{ 
                                justifyContent: justify,
                                gap: `${gapY} ${gapX}`
                              }}
                            >
                              {currentChunk.map((w: any, idx: number) => {
                                const isActive = isPlayingThis 
                                  ? (lyricalPlaybackTime >= w.start && lyricalPlaybackTime <= w.end)
                                  : (idx === 0);
                                
                                const activeColor = getWordColor(w, idx, isActive);
                                
                                return (
                                  <span
                                    key={idx}
                                    style={{
                                      color: isActive ? activeColor : (lyricalTextColor || "#ffffff"),
                                      WebkitTextStroke: `${lyricalStrokeWidth * 0.23}px ${lyricalStrokeColor}`,
                                      textShadow: isActive ? `0 0 8px ${activeColor}cc, 0 0 16px ${activeColor}50` : "none",
                                      transform: isActive ? "scale(1.12)" : "scale(1.0)",
                                      letterSpacing: `${lyricalLetterSpacing * 0.23}px`,
                                      transition: "all 0.08s ease-out",
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
                        );
                      })()}

                      {/* Progress bar */}
                      <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10 z-20">
                        <div 
                          className="h-full bg-gradient-to-r from-amber-400 to-purple-500 transition-all duration-100 ease-linear"
                          style={{ width: `${playPercent}%` }}
                        />
                      </div>
                    </div>

                    {/* Timeline slider seek bar below video mockup! */}
                    <div className="w-full space-y-2 mt-2 px-1 text-center bg-black/20 p-3 rounded-2xl border border-white/5 shadow-inner">
                      <div className="flex justify-between items-center text-[10px] text-gray-500 font-semibold uppercase tracking-wider leading-none">
                        <span>Playback Timeline</span>
                        <span className="text-white font-bold leading-none">{lyricalPlaybackTime.toFixed(1)}s / {selectedTrack.duration.toFixed(1)}s</span>
                      </div>
                      
                      <input 
                        type="range"
                        min="0"
                        max={selectedTrack.duration}
                        step="0.05"
                        value={lyricalPlaybackTime}
                        onChange={(e) => {
                          const targetTime = parseFloat(e.target.value);
                          setLyricalPlaybackTime(targetTime);
                          if (audioPlayerRef.current) {
                            audioPlayerRef.current.currentTime = targetTime;
                          }
                          if (previewVideoRef.current) {
                            previewVideoRef.current.currentTime = targetTime % (previewVideoRef.current.duration || 5.0);
                          }
                        }}
                        className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                      />
                    </div>
                  </div>

                  {/* Column 3: Templates Manager & Baked Renders Deck */}
                  <div className="lg:col-span-4 bg-[#0d0d16]/70 backdrop-blur-xl border border-white/10 p-5 rounded-3xl shadow-2xl space-y-5 flex flex-col justify-between self-stretch">
                    <div className="space-y-4">
                      <div className="flex justify-between items-center pb-2 border-b border-white/5">
                        <div className="flex items-center gap-2">
                          <Tag className="w-4 h-4 text-purple-400" />
                          <h3 className="text-xs font-black uppercase tracking-widest text-purple-300">Templates Manager</h3>
                        </div>
                        <span className="text-[9px] font-black text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-full">{lyricalTemplates.length} Custom Profiles</span>
                      </div>

                      {loadingTemplatesTrackId === selectedTrack.id ? (
                        <div className="flex justify-center items-center py-12">
                          <Loader2 className="w-6 h-6 text-purple-500 animate-spin" />
                        </div>
                      ) : lyricalTemplates.length === 0 ? (
                        <p className="text-xs text-gray-500 italic py-6 bg-black/20 rounded-2xl px-4 border border-white/5 text-center">No styling templates created yet.</p>
                      ) : (
                        <div className="grid grid-cols-1 gap-2.5 max-h-[220px] overflow-y-auto pr-1">
                          {lyricalTemplates.map((tpl) => {
                            const isActive = selectedPreviewTemplateId === tpl.id;
                            const displayFont = tpl.fontFamily.replace("-Black", "").replace("-Bold", "").replace("Montserrat", "Mont");
                            const monogramBg = tpl.activeColor === "multi"
                              ? "bg-gradient-to-tr from-yellow-400 via-green-400 to-pink-500 shadow-md text-black"
                              : "border border-white/10 shadow-lg text-black";
                            
                            return (
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
                                  setSetupLyricalColorFilter(tpl.colorFilter || "none");
                                  setSetupLyricalVignette(tpl.vignette || "none");
                                  setSetupLyricalParticleFx(tpl.particleFx || "none");
                                  setSetupLyricalMirrorBg(tpl.mirrorBg || false);
                                  setSetupLyricalBgSpeed(tpl.bgSpeed || 1.0);
                                  setLyricalAnimationMode(tpl.animationMode || "highlight");
                                  setLyricalBgColor(tpl.bgColor || null);
                                  setLyricalBgOpacity(tpl.bgOpacity ?? 1.0);
                                  setLyricalLofiFactor(tpl.lofiFactor ?? 1);
                                  setLyricalTextMargin(tpl.textMargin ?? 50);
                                  setLyricalTextColor(tpl.textColor || null);
                                  setLyricalTextAlign(tpl.textAlign || "center");
                                  setLyricalWordSpacing(tpl.wordSpacing || "normal");
                                  setLyricalLetterSpacing(tpl.letterSpacing || 0);
                                  setLyricalMuteAudio(tpl.muteAudio || false);
                                  setLyricalAspectRatio(tpl.aspectRatio || "9:16");
                                  setLyricalSavedStyleId(tpl.savedStyleId || "");
                                  if (tpl.bgColor && (tpl.bgOpacity ?? 1.0) >= 0.99) {
                                    setSetupLyricalBgVideoUrl("");
                                  }
                                }}
                                className={`p-3 rounded-2xl border text-left cursor-pointer transition-all duration-300 flex items-center justify-between gap-3 group/card relative overflow-hidden ${
                                  isActive 
                                    ? "bg-purple-500/10 border-purple-500/40 text-white shadow-lg" 
                                    : "bg-black/35 border-white/5 text-gray-400 hover:border-white/15 hover:bg-black/50"
                                }`}
                              >
                                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                  <div 
                                    className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] font-black uppercase ${monogramBg}`}
                                    style={tpl.activeColor !== "multi" ? {
                                      backgroundColor: tpl.activeColor || "#ffffff",
                                      boxShadow: `0 0 8px ${(tpl.activeColor || "#ffffff")}40`
                                    } : {}}
                                  >
                                    {tpl.templateName.substring(0, 2)}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-[11px] font-black text-white truncate leading-none mb-1">{tpl.templateName}</p>
                                    <div className="flex flex-wrap items-center gap-1">
                                      <span className="text-[7px] font-extrabold uppercase tracking-wider bg-white/5 border border-white/5 px-1 py-0.5 rounded text-gray-400">{displayFont}</span>
                                      <span className="text-[7px] font-extrabold uppercase tracking-wider bg-white/5 border border-white/5 px-1 py-0.5 rounded text-gray-400">{tpl.fontSize}px</span>
                                      <span className="text-[7px] font-extrabold uppercase tracking-wider bg-white/5 border border-white/5 px-1 py-0.5 rounded text-gray-400">Y: {Math.round(tpl.positionY * 100)}%</span>
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center gap-1 flex-shrink-0">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleReRenderOverlay(tpl.id, tpl.templateName);
                                    }}
                                    disabled={reRenderingTemplateId !== null}
                                    className="p-1.5 rounded-xl text-gray-500 hover:text-amber-400 hover:bg-amber-500/10 transition-all duration-300 opacity-40 group-hover/card:opacity-100 cursor-pointer flex items-center justify-center border border-transparent hover:border-amber-500/10 flex-shrink-0 disabled:opacity-100"
                                    title="Re-render Overlay (Pre-bake WebM)"
                                  >
                                    <RefreshCw className={`w-3.5 h-3.5 ${reRenderingTemplateId === tpl.id ? "animate-spin text-amber-400" : ""}`} />
                                  </button>

                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteLyricalTemplate(tpl.id, selectedTrack.id);
                                    }}
                                    className="p-1.5 rounded-xl text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-all duration-300 opacity-40 group-hover/card:opacity-100 cursor-pointer flex items-center justify-center border border-transparent hover:border-red-500/10 flex-shrink-0"
                                    title="Delete Styling Template"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>

                                {/* Progress bar for overlay rendering */}
                                {reRenderingTemplateId === tpl.id && (
                                  <div className="absolute bottom-0 left-0 right-0 px-3 pb-2">
                                    <div className="flex items-center gap-2">
                                      <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                                        <div 
                                          className="h-full bg-gradient-to-r from-amber-500 to-purple-500 rounded-full transition-all duration-500 ease-out"
                                          style={{ width: `${Math.max(renderProgress.percent, 2)}%` }}
                                        />
                                      </div>
                                      <span className="text-[8px] font-black text-amber-400 tabular-nums min-w-[28px] text-right">
                                        {renderProgress.percent}%
                                      </span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Premium Live Render Preview Box */}
                    {(() => {
                      const activeTpl = lyricalTemplates.find(t => t.id === selectedPreviewTemplateId);
                      if (!activeTpl) return null;
                      return (
                        <div className="space-y-2 bg-[#0c0c14] p-3 rounded-2xl border border-white/5">
                          <div className="flex justify-between items-center">
                            <span className="text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Baked Typography Frame Preview</span>
                            <span className="text-[9px] text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded uppercase font-bold">{activeTpl.templateName}</span>
                          </div>
                          
                          <div className={`relative ${activeTpl.aspectRatio === "1:1" ? "aspect-square" : "aspect-[9/16]"} w-full max-w-[140px] mx-auto bg-black border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex items-center justify-center group`}>
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

                </div>
              )}
            </div>
          );
        })() : (
          // ────────────────────────────────────────────────────────────────────────
          // MUSIC LIBRARY VIEW (WHEN setupLyricalTrackId IS NULL)
          // ────────────────────────────────────────────────────────────────────────
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-fadeIn text-left">
            
            {/* Column 1: Editorial Music Uploader Card */}
            <div className="lg:col-span-1 bg-[#0d0d16]/75 backdrop-blur-xl border border-white/10 p-6 rounded-3xl shadow-2xl space-y-6">
              <div className="flex items-center gap-2 pb-3 border-b border-white/5">
                <Music className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-black uppercase tracking-wider text-white">Audio MP3 Uploader</h3>
              </div>

              <form onSubmit={handleUploadTrack} className="space-y-4">
                {/* Title */}
                <div className="space-y-1">
                  <label className="block text-[10px] uppercase tracking-wider font-extrabold text-gray-500">Track Title</label>
                  <input
                    type="text"
                    required
                    value={trackTitle}
                    onChange={(e) => setTrackTitle(e.target.value)}
                    placeholder="e.g. Moonlight Sonata"
                    className="w-full bg-[#141423]/60 border border-white/5 hover:border-white/10 focus:border-amber-500/50 rounded-2xl px-4 py-3 text-xs text-white focus:outline-none transition-all duration-300"
                  />
                </div>

                {/* Artist */}
                <div className="space-y-1">
                  <label className="block text-[10px] uppercase tracking-wider font-extrabold text-gray-500">Artist / Musician</label>
                  <input
                    type="text"
                    required
                    value={trackArtist}
                    onChange={(e) => setTrackArtist(e.target.value)}
                    placeholder="e.g. Beethoven"
                    className="w-full bg-[#141423]/60 border border-white/5 hover:border-white/10 focus:border-amber-500/50 rounded-2xl px-4 py-3 text-xs text-white focus:outline-none transition-all duration-300"
                  />
                </div>

                {/* Genre */}
                <div className="space-y-1">
                  <label className="block text-[10px] uppercase tracking-wider font-extrabold text-gray-500">Genre Tag (Optional)</label>
                  <input
                    type="text"
                    value={trackGenre}
                    onChange={(e) => setTrackGenre(e.target.value)}
                    placeholder="e.g. Classical, Lo-Fi, Cinematic"
                    className="w-full bg-[#141423]/60 border border-white/5 hover:border-white/10 focus:border-amber-500/50 rounded-2xl px-4 py-3 text-xs text-white focus:outline-none transition-all duration-300"
                  />
                </div>

                {/* Trim Settings */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Default Start (s)</label>
                    <input
                      type="number"
                      step="0.1"
                      required
                      value={trackStart}
                      onChange={(e) => setTrackStart(e.target.value)}
                      placeholder="0.0"
                      className="w-full bg-[#141423]/60 border border-white/5 hover:border-white/10 focus:border-amber-500/50 rounded-2xl px-4 py-3 text-xs text-white focus:outline-none transition-all duration-300"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[9px] uppercase tracking-wider font-extrabold text-gray-500">Duration (s)</label>
                    <input
                      type="number"
                      step="0.1"
                      required
                      value={trackDuration}
                      onChange={(e) => setTrackDuration(e.target.value)}
                      placeholder="7.0"
                      className="w-full bg-[#141423]/60 border border-white/5 hover:border-white/10 focus:border-amber-500/50 rounded-2xl px-4 py-3 text-xs text-white focus:outline-none transition-all duration-300"
                    />
                  </div>
                </div>

                {/* File Drop Drag Area */}
                <div className="space-y-1 pt-1">
                  <label className="block text-[10px] uppercase tracking-wider font-extrabold text-gray-500">Select MP3 Audio File</label>
                  <div className="relative border border-dashed border-white/10 hover:border-amber-500/30 rounded-2xl p-6 text-center cursor-pointer transition-all duration-300 bg-black/20 hover:bg-black/35 group flex flex-col items-center justify-center">
                    <input
                      type="file"
                      required
                      accept="audio/mp3,audio/mpeg"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) setAudioFile(file);
                      }}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    <Upload className="w-8 h-8 text-gray-500 group-hover:text-amber-400 group-hover:scale-110 transition-all duration-300 mb-2" />
                    <span className="text-[11px] font-black text-gray-300 uppercase tracking-wide truncate max-w-full">
                      {audioFile ? audioFile.name : "Select MP3 Track"}
                    </span>
                    <span className="text-[9px] text-gray-600 font-bold uppercase tracking-wider mt-1">Max size 20MB</span>
                  </div>
                </div>

                {/* Upload Button */}
                <button
                  type="submit"
                  disabled={uploadingTrack || !audioFile}
                  className="w-full bg-gradient-to-r from-amber-500 to-purple-600 hover:from-amber-600 hover:to-purple-700 disabled:opacity-50 text-white font-extrabold py-3.5 px-6 rounded-2xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-amber-500/5 hover:scale-[1.01] transition-all duration-300 cursor-pointer"
                >
                  {uploadingTrack ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Uploading & Analyzing...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      Upload to Library
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* Columns 2-3: Search filters & Interactive grid library list */}
            <div className="lg:col-span-2 space-y-5">
              {/* Premium Search and Filter deck */}
              <div className="bg-[#0c0c14]/85 border border-white/10 p-5 rounded-3xl shadow-xl flex flex-col md:flex-row gap-4 justify-between items-center">
                
                <div className="relative w-full md:w-72">
                  <input
                    type="text"
                    value={searchTrackQuery}
                    onChange={(e) => setSearchTrackQuery(e.target.value)}
                    placeholder="Search tracks or artists..."
                    className="w-full bg-[#141423] border border-white/5 hover:border-white/10 focus:border-amber-500/50 rounded-2xl pl-10 pr-4 py-2.5 text-xs text-white focus:outline-none transition-all duration-300"
                  />
                  <Filter className="absolute left-3.5 top-3.5 w-3.5 h-3.5 text-gray-500" />
                </div>

                <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto justify-end">
                  {/* Genre Filter */}
                  <select
                    value={filterGenre}
                    onChange={(e) => setFilterGenre(e.target.value)}
                    className="bg-[#141423] border border-white/5 rounded-2xl px-3.5 py-2.5 text-xs font-bold text-gray-300 focus:outline-none hover:border-white/10 cursor-pointer"
                  >
                    <option value="all">All Genres</option>
                    {(() => {
                      const uniqueGenres = Array.from(new Set(tracks.map(t => t.genre).filter(Boolean))) as string[];
                      return uniqueGenres.map((g) => (
                        <option key={g} value={g}>{g}</option>
                      ));
                    })()}
                  </select>

                  {/* Campaign Status Filter */}
                  <select
                    value={filterCampaign}
                    onChange={(e) => setFilterCampaign(e.target.value)}
                    className="bg-[#141423] border border-white/5 rounded-2xl px-3.5 py-2.5 text-xs font-bold text-gray-300 focus:outline-none hover:border-white/10 cursor-pointer"
                  >
                    <option value="all">All Statuses</option>
                    <option value="active">Active Campaigns</option>
                    <option value="inactive">Inactive</option>
                  </select>

                  <button
                    onClick={() => {
                      setSearchTrackQuery("");
                      setFilterGenre("all");
                      setFilterMusician("all");
                      setFilterCampaign("all");
                    }}
                    className="p-2.5 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-all duration-300 flex items-center justify-center cursor-pointer"
                    title="Reset Filters"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Tracks Grid Loop */}
              {(() => {
                const filtered = tracks.filter((t) => {
                  const query = searchTrackQuery.toLowerCase().trim();
                  const matchesSearch = !query || 
                    t.title.toLowerCase().includes(query) || 
                    t.artist.toLowerCase().includes(query) ||
                    (t.genre && t.genre.toLowerCase().includes(query));
                  
                  const matchesGenre = filterGenre === "all" || t.genre === filterGenre;
                  const matchesCampaign = filterCampaign === "all" || 
                    (filterCampaign === "active" ? t.campaignOn : !t.campaignOn);
                  
                  return matchesSearch && matchesGenre && matchesCampaign;
                });

                if (loadingTracks) {
                  return (
                    <div className="flex justify-center items-center py-32 bg-[#0d0d16]/30 border border-white/5 rounded-3xl">
                      <RefreshCw className="w-8 h-8 text-amber-500 animate-spin" />
                    </div>
                  );
                }

                if (filtered.length === 0) {
                  return (
                    <div className="bg-[#0d0d16]/30 border border-white/5 p-20 text-center rounded-3xl">
                      <p className="text-gray-500 text-sm font-semibold uppercase tracking-wider">No music tracks found in your library.</p>
                      <p className="text-[10px] text-gray-600 uppercase tracking-widest mt-1">Upload your first MP3 above to begin</p>
                    </div>
                  );
                }

                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filtered.map((track) => {
                      const isPlaying = playingTrackId === track.id;
                      
                      return (
                        <div 
                          key={track.id}
                          className={`p-5 rounded-3xl border transition-all duration-300 text-left bg-[#0d0d16]/65 backdrop-blur-md relative overflow-hidden flex flex-col justify-between h-48 group ${
                            isPlaying 
                              ? "border-amber-500/40 shadow-lg shadow-amber-500/5 ring-1 ring-amber-500/10" 
                              : "border-white/5 hover:border-white/10 hover:bg-[#0d0d16]/80"
                          }`}
                        >
                          {/* Top row: Info & Visualizer */}
                          <div className="flex justify-between items-start gap-4">
                            <div className="min-w-0">
                              <h4 className="text-base font-black text-white leading-tight truncate">{track.title}</h4>
                              <p className="text-[11px] text-gray-400 font-extrabold uppercase tracking-wider mt-1 truncate">{track.artist}</p>
                              {track.genre && (
                                <span className="inline-block text-[8px] font-black uppercase tracking-widest px-2 py-0.5 bg-purple-500/10 text-purple-400 border border-purple-500/15 rounded-md mt-2">
                                  {track.genre}
                                </span>
                              )}
                            </div>

                            {/* Playing Gold Waveform Visualizer */}
                            {isPlaying ? (
                              <div className="flex items-end gap-0.5 h-4 bg-amber-500/5 border border-amber-500/10 px-2 py-1 rounded-lg">
                                <span className="w-0.5 bg-amber-400 rounded animate-wave-1" />
                                <span className="w-0.5 bg-amber-400 rounded animate-wave-2" />
                                <span className="w-0.5 bg-amber-400 rounded animate-wave-3" />
                              </div>
                            ) : (
                              <div className="flex flex-col items-end gap-1 flex-shrink-0 text-right">
                                <span className="text-[8px] font-extrabold uppercase tracking-widest text-gray-500 leading-none">
                                  Duration
                                </span>
                                <span className="text-xs font-black text-gray-400 leading-none mt-0.5">
                                  {track.duration.toFixed(1)}s
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Middle row: Stats if present */}
                          <div className="flex items-center gap-4 py-2 border-t border-b border-white/5 my-2">
                            <div className="flex-1 flex justify-around">
                              <div className="text-center">
                                <p className="text-[8px] uppercase tracking-widest font-extrabold text-gray-600 leading-none">Videos Posted</p>
                                <p className="text-xs font-black text-amber-500 leading-none mt-1">{track.videosPosted || 0}</p>
                              </div>
                              <div className="w-[1px] h-6 bg-white/5" />
                              <div className="text-center">
                                <p className="text-[8px] uppercase tracking-widest font-extrabold text-gray-600 leading-none">Total Views</p>
                                <p className="text-xs font-black text-purple-400 leading-none mt-1">
                                  {(track.totalViews || 0).toLocaleString()}
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Bottom Row: Actions */}
                          <div className="flex items-center justify-between gap-3 pt-1">
                            <div className="flex items-center gap-2">
                              {/* Play Pause Button */}
                              <button
                                onClick={() => togglePlayTrack(track)}
                                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 border cursor-pointer ${
                                  isPlaying 
                                    ? "bg-amber-500/10 border-amber-500/40 text-amber-400" 
                                    : "bg-white/5 border-white/5 text-white hover:bg-white/10 hover:border-white/10"
                                }`}
                              >
                                {isPlaying ? (
                                  <Pause className="w-3.5 h-3.5 fill-current" />
                                ) : (
                                  <Play className="w-3.5 h-3.5 fill-current translate-x-0.5" />
                                )}
                              </button>

                              {/* Lyrical Setup Studio Button */}
                              <button
                                onClick={async () => {
                                  setSetupLyricalTrackId(track.id);
                                  await fetchLyricalTemplates(track.id);
                                }}
                                className="bg-gradient-to-r from-amber-500 to-purple-600 hover:from-amber-600 hover:to-purple-700 text-white font-black text-[9px] uppercase tracking-widest px-3 py-2 rounded-2xl flex items-center gap-1.5 shadow-md shadow-amber-500/5 hover:scale-[1.02] transition-all duration-300 cursor-pointer"
                              >
                                <Sliders className="w-3.5 h-3.5" />
                                Lyrical Setup & Templates
                              </button>
                            </div>

                            <div className="flex items-center gap-3">
                              {/* Campaign On/Off Switch */}
                              <div className="flex items-center gap-1.5">
                                <span className={`text-[8px] font-black uppercase tracking-wider ${track.campaignOn ? "text-green-400" : "text-gray-500"}`}>
                                  {track.campaignOn ? "On" : "Off"}
                                </span>
                                <button
                                  onClick={async () => {
                                    try {
                                      const res = await fetch(`/api/managed/genres/tracks?trackId=${track.id}`, {
                                        method: "PATCH",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ campaignOn: !track.campaignOn })
                                      });
                                      if (res.ok) {
                                        toast.success("Campaign updated successfully");
                                        fetchTracks();
                                      } else {
                                        toast.error("Failed to update campaign toggle");
                                      }
                                    } catch {
                                      toast.error("Network error updating campaign");
                                    }
                                  }}
                                  className={`w-7 h-4 rounded-full p-0.5 transition-all duration-300 cursor-pointer relative flex items-center ${
                                    track.campaignOn ? "bg-green-500" : "bg-gray-800"
                                  }`}
                                >
                                  <div className={`w-3 h-3 rounded-full bg-white shadow-md transform transition-transform duration-300 ${
                                    track.campaignOn ? "translate-x-3" : "translate-x-0"
                                  }`} />
                                </button>
                              </div>

                              {/* Delete button */}
                              <button
                                onClick={async () => {
                                  if (confirm("Are you sure you want to delete this audio track and all its associated templates? This cannot be undone.")) {
                                    await handleDeleteTrack(track.id);
                                  }
                                }}
                                className="p-1.5 rounded-xl text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-all duration-300 opacity-40 hover:opacity-100 cursor-pointer flex items-center justify-center border border-transparent hover:border-red-500/10 flex-shrink-0"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        )
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
                        
                        {/* Style Studio Preset Selection */}
                        <div className="md:col-span-2 bg-[#1b1b2f]/50 border border-white/5 p-4 rounded-2xl">
                          <label className="block text-xs uppercase tracking-wider font-bold text-gray-400 mb-2">
                            Style Studio Preset (Remotion Pre-Render Flow)
                          </label>
                          <select
                            value={accountSavedStyleId}
                            onChange={(e) => setAccountSavedStyleId(e.target.value)}
                            className="w-full bg-[#141423] border border-white/5 rounded-2xl px-4 py-3.5 text-sm text-white focus:outline-none focus:border-amber-500/50"
                          >
                            <option value="">-- Use Classic FFmpeg Render (No Preset) --</option>
                            {savedStyles.map((style) => (
                              <option key={style.id} value={style.id}>
                                {style.name} ({style.templateKey})
                              </option>
                            ))}
                          </select>
                          <p className="text-[11px] text-gray-500 mt-1.5 font-medium">
                            If selected, this account will use the pre-rendered transparent overlay pipeline. The settings below (like Font Size and Font Color) will serve as overrides for the preset's defaults.
                          </p>
                        </div>

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
                        <label className="block text-xs uppercase tracking-wider font-bold text-gray-400">1. Select Aligned Lyrical Tracks</label>
                        <div className="grid grid-cols-1 gap-2 max-h-[200px] overflow-y-auto pr-1">
                          {tracks.filter(t => t.isLyrical).map((t) => {
                            const isSelected = selectedLyricalTrackIds.includes(t.id);
                            return (
                              <div
                                key={t.id}
                                onClick={() => handleToggleTrack(t.id)}
                                className={`p-3 rounded-2xl border text-left cursor-pointer transition-all flex items-center justify-between gap-3 ${
                                  isSelected
                                    ? "bg-purple-500/10 border-purple-500/40 text-white shadow-lg shadow-purple-500/5"
                                    : "bg-[#141423]/40 border-white/5 text-gray-400 hover:border-white/10"
                                }`}
                              >
                                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                  <div className={`w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0 ${
                                    isSelected ? "bg-purple-500 border-purple-500 text-white" : "border-white/10 bg-black/40"
                                  }`}>
                                    {isSelected && <Check className="w-2.5 h-2.5 stroke-[4]" />}
                                  </div>
                                  <div className="truncate">
                                    <p className="text-xs font-bold text-white leading-tight truncate">{t.title}</p>
                                    <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider mt-0.5 truncate">{t.artist} — {Math.round(t.duration)}s</p>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {tracks.filter(t => t.isLyrical).length === 0 && (
                          <p className="text-[10px] text-red-400 font-semibold uppercase tracking-wider mt-1">No lyrical tracks available. Designate one in the Tracks Library tab first.</p>
                        )}
                      </div>

                      {/* Music Trim Sliders */}
                      {selectedLyricalTrackId && (
                        <div className="space-y-4 bg-[#141423]/30 p-4 rounded-2xl border border-white/5">
                          {/* Start Trim Slider */}
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <label className="text-xs text-gray-400 font-bold uppercase tracking-wider">Music Start Trim:</label>
                              <span className="text-sm font-bold text-purple-400">{lyricalTrackStart.toFixed(1)}s</span>
                            </div>
                            <input
                              type="range"
                              min="0"
                              max={(() => {
                                const track = tracks.find(t => t.id === selectedLyricalTrackId);
                                return Math.max(0, lyricalTrackEnd - 5);
                              })()}
                              step="0.5"
                              value={lyricalTrackStart}
                              onChange={(e) => setLyricalTrackStart(parseFloat(e.target.value))}
                              className="w-full h-1.5 bg-[#0f0f18] border border-white/5 rounded-lg appearance-none cursor-pointer accent-purple-500"
                            />
                          </div>

                          {/* End Trim Slider */}
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <label className="text-xs text-gray-400 font-bold uppercase tracking-wider">Music End Trim:</label>
                              <span className="text-sm font-bold text-pink-400">{lyricalTrackEnd.toFixed(1)}s</span>
                            </div>
                            <input
                              type="range"
                              min={Math.min(lyricalTrackStart + 5, lyricalTrackEnd)}
                              max={(() => {
                                const track = tracks.find(t => t.id === selectedLyricalTrackId);
                                return track ? track.duration : 30;
                              })()}
                              step="0.5"
                              value={lyricalTrackEnd}
                              onChange={(e) => setLyricalTrackEnd(parseFloat(e.target.value))}
                              className="w-full h-1.5 bg-[#0f0f18] border border-white/5 rounded-lg appearance-none cursor-pointer accent-pink-500"
                            />
                          </div>

                          <p className="text-[10px] text-gray-500 leading-normal">
                            Select start and end trim offsets. The output video and lyrical overlays will play between {lyricalTrackStart.toFixed(1)}s and {lyricalTrackEnd.toFixed(1)}s (Duration: {(lyricalTrackEnd - lyricalTrackStart).toFixed(1)}s).
                          </p>
                        </div>
                      )}

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
                              No styling templates saved for this track. Please go to Tracks Library, open this track, customize a style and click "Save styling template" first!
                            </p>
                          ) : (
                                        <div className="grid grid-cols-1 gap-2.5 max-h-[220px] overflow-y-auto pr-1">
                              {/* Special card for mixing all templates */}
                              <div
                                onClick={() => {
                                  setSelectedLyricalTemplateId("mix_all");
                                  setSelectedLyricalTemplateIds([]);
                                }}
                                className={`p-3.5 rounded-2xl border text-left cursor-pointer transition-all flex items-center justify-between gap-2 ${
                                  selectedLyricalTemplateId === "mix_all"
                                    ? "bg-purple-500/10 border-purple-500/40 text-white shadow-lg shadow-purple-500/5"
                                    : "bg-[#141423]/40 border-white/5 text-gray-400 hover:border-white/10"
                                }`}
                              >
                                <div>
                                  <p className="text-xs font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-purple-400 leading-tight">🌀 MIX ALL PRE-RENDERED TEMPLATES</p>
                                  <p className="text-[10px] text-amber-500 font-bold uppercase tracking-wider mt-1">Cycles through all {lyricalTemplates.length} templates dynamically for each post!</p>
                                </div>
                                <div className={`w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 ${
                                  selectedLyricalTemplateId === "mix_all" ? "bg-purple-500 border-purple-500 text-white" : "border-white/10"
                                }`}>
                                  {selectedLyricalTemplateId === "mix_all" && <Check className="w-2.5 h-2.5 stroke-[4]" />}
                                </div>
                              </div>

                              {lyricalTemplates.map((tpl) => {
                                const isSelected = selectedLyricalTemplateIds.includes(tpl.id);
                                return (
                                  <div
                                    key={tpl.id}
                                    onClick={() => handleToggleLyricalTemplate(tpl.id)}
                                    className={`p-3.5 rounded-2xl border text-left cursor-pointer transition-all flex items-center justify-between ${
                                      isSelected
                                        ? "bg-purple-500/15 border-purple-500/40 text-white shadow-lg shadow-purple-500/5"
                                        : "bg-[#141423]/40 border-white/5 text-gray-400 hover:border-white/10"
                                    }`}
                                  >
                                    <div>
                                      <p className="text-xs font-bold text-white leading-tight">{tpl.templateName}</p>
                                      <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider mt-1">Font: {tpl.fontFamily} | Size: {tpl.fontSize}px</p>
                                    </div>
                                    <div className={`w-4 h-4 rounded-md border flex items-center justify-center flex-shrink-0 ${
                                      isSelected ? "bg-purple-500 border-purple-500 text-white" : "border-white/10"
                                    }`}>
                                      {isSelected && <Check className="w-2.5 h-2.5 stroke-[4]" />}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
 
                    {/* Preview Image Column */}
                    <div>
                      {(() => {
                        if (selectedLyricalTemplateId === "mix_all") {
                          return (
                            <div className="space-y-2 text-center bg-[#0c0c14] p-3 rounded-2xl border border-white/5">
                              <span className="text-[10px] uppercase tracking-wider font-extrabold text-amber-400 block animate-pulse">Dynamic Multi-Template Mix-up</span>
                              <div className="relative aspect-[9/16] w-full max-w-[150px] mx-auto bg-gradient-to-b from-[#180f33] via-[#050616] to-[#04101e] border border-amber-500/30 rounded-3xl overflow-hidden shadow-2xl flex flex-col items-center justify-center p-4 text-center">
                                <div className="absolute top-[20%] left-[20%] w-[80px] h-[80px] bg-purple-600/15 rounded-full blur-[30px] animate-pulse z-0" />
                                <div className="absolute bottom-[20%] right-[20%] w-[80px] h-[80px] bg-amber-500/15 rounded-full blur-[30px] animate-pulse z-0" />
                                <Sparkles className="w-8 h-8 text-amber-400 animate-spin z-10" style={{ animationDuration: "12s" }} />
                                <span className="text-[10px] text-white font-extrabold uppercase tracking-wider mt-3 z-10 font-bold leading-tight">Dynamic overlay cycling</span>
                                <span className="text-[8px] text-gray-400 uppercase tracking-widest mt-2 z-10 leading-normal font-semibold">Randomized & Distributed sequentially across 100% of posts</span>
                              </div>
                            </div>
                          );
                        }

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
                            <div className={`relative ${activeTpl.aspectRatio === "1:1" ? "aspect-square" : "aspect-[9/16]"} w-full max-w-[150px] mx-auto bg-black border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex items-center justify-center group`}>
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
                      disabled={generatingQuotes || selectedBatchAccountIds.length === 0 || selectedLyricalTrackIds.length === 0 || (selectedLyricalTemplateId !== "mix_all" && selectedLyricalTemplateIds.length === 0)}
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
                    {selectedBatchAccountIds.length > 0 && selectedLyricalTrackIds.length > 0 && (selectedLyricalTemplateId === "mix_all" || selectedLyricalTemplateIds.length > 0) && (
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
                        {/* Delete button (always visible) */}
                        <button
                          onClick={() => handleDeleteBatchItem(activeBatch.id, item.id)}
                          disabled={!!deletingItemIds[item.id]}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-black border border-red-500/15 hover:border-red-500 rounded-xl text-xs font-bold transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Delete this render"
                        >
                          {deletingItemIds[item.id] ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <div className="text-right text-xs mr-2">
                          <p className="text-gray-500 font-semibold text-white">
                            {item.track?.title || "No track"}
                            {item.trackStart !== undefined && (item.trackStart > 0 || (item.trackEnd !== undefined && item.trackEnd !== null)) && (
                              ` (${item.trackStart.toFixed(1)}s - ${item.trackEnd ? item.trackEnd.toFixed(1) + "s" : "end"} trim)`
                            )}
                          </p>
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
                                setPreviewAspectRatio(item.lyricalTemplate?.aspectRatio || "9:16");
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

                            <button
                              onClick={() => {
                                if (confirm("Are you sure you want to re-render this video? This will delete the existing file and generate it again.")) {
                                  handleReRenderItems(activeBatch.id, [item.id]);
                                }
                              }}
                              disabled={!!retryingItemIds[item.id] || activeBatch.status === "RENDERING"}
                              className="flex items-center gap-1 px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500 text-amber-400 hover:text-black border border-amber-500/20 hover:border-amber-500 rounded-xl text-xs font-extrabold transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Re-render this video"
                            >
                              {retryingItemIds[item.id] ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <RefreshCw className="w-3.5 h-3.5" />
                              )}
                              Re-render
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
                            <button
                              onClick={() => {
                                if (confirm("Are you sure you want to re-render this video? This will delete the existing file and generate it again.")) {
                                  handleReRenderItems(activeBatch.id, [item.id]);
                                }
                              }}
                              disabled={!!retryingItemIds[item.id] || activeBatch.status === "RENDERING"}
                              className="flex items-center gap-1 px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500 text-amber-400 hover:text-black border border-amber-500/20 hover:border-amber-500 rounded-xl text-xs font-extrabold transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Re-render this video"
                            >
                              {retryingItemIds[item.id] ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <RefreshCw className="w-3.5 h-3.5" />
                              )}
                              Re-render
                            </button>
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
                            <button
                              onClick={() => {
                                if (confirm("Are you sure you want to re-render this video? This will delete any partial render and generate it again.")) {
                                  handleReRenderItems(activeBatch.id, [item.id]);
                                }
                              }}
                              disabled={!!retryingItemIds[item.id] || activeBatch.status === "RENDERING"}
                              className="flex items-center gap-1 px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500 text-amber-400 hover:text-black border border-amber-500/20 hover:border-amber-500 rounded-xl text-xs font-extrabold transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Re-render this video"
                            >
                              {retryingItemIds[item.id] ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <RefreshCw className="w-3.5 h-3.5" />
                              )}
                              Re-render
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

                {/* Smart Download Button */}
                {activeBatch.items?.some(i => i.status === "RENDERED" || i.status === "UPLOADED") && (
                  <div className="relative">
                    <button
                      onClick={() => setShowSmartDownload(!showSmartDownload)}
                      disabled={smartDownloading}
                      className="bg-[#1d1b38] hover:bg-[#25224e] text-cyan-400 hover:text-cyan-300 font-extrabold py-3.5 px-6 rounded-2xl border border-cyan-500/20 hover:border-cyan-500/50 transition-all flex items-center gap-2 disabled:opacity-50 shadow-lg shadow-cyan-500/5"
                    >
                      {smartDownloading ? (
                        <><Loader2 className="w-5 h-5 animate-spin" />{smartDownloadProgress || "Processing..."}</>
                      ) : (
                        <><FolderOpen className="w-5 h-5" />Smart Download</>
                      )}
                    </button>

                    {/* Smart Download Modal */}
                    {showSmartDownload && !smartDownloading && (
                      <div className="absolute bottom-full mb-3 left-0 w-80 bg-[#12101f] border border-white/10 rounded-2xl p-5 shadow-2xl shadow-black/50 z-50">
                        <div className="flex items-center justify-between mb-4">
                          <h4 className="text-sm font-bold text-white flex items-center gap-2">
                            <FolderOpen className="w-4 h-4 text-cyan-400" />
                            Folderized Download
                          </h4>
                          <button onClick={() => setShowSmartDownload(false)} className="text-gray-500 hover:text-white">
                            <X className="w-4 h-4" />
                          </button>
                        </div>

                        <p className="text-[11px] text-gray-500 mb-4">
                          Randomly distributes videos into account folders inside a single archive.
                        </p>

                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <label className="text-xs text-gray-400 font-semibold">Accounts (folders)</label>
                            <input
                              type="number" min={1} max={50}
                              value={smartAccounts}
                              onChange={e => setSmartAccounts(Math.max(1, parseInt(e.target.value) || 1))}
                              className="w-16 bg-black/30 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs text-center focus:outline-none focus:border-cyan-500"
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <label className="text-xs text-gray-400 font-semibold">Videos per account</label>
                            <input
                              type="number" min={1} max={100}
                              value={smartVidsPerAccount}
                              onChange={e => setSmartVidsPerAccount(Math.max(1, parseInt(e.target.value) || 1))}
                              className="w-16 bg-black/30 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs text-center focus:outline-none focus:border-cyan-500"
                            />
                          </div>
                        </div>

                        <div className="mt-3 bg-cyan-500/5 border border-cyan-500/10 rounded-lg px-3 py-2">
                          <p className="text-[10px] text-cyan-300">
                            Total: <span className="font-bold">{smartAccounts * smartVidsPerAccount}</span> videos needed
                            {' '}• Available: <span className="font-bold">{activeBatch.items?.filter(i => i.status === "RENDERED" || i.status === "UPLOADED").length}</span>
                          </p>
                        </div>

                        <button
                          onClick={() => handleSmartDownload(activeBatch.id)}
                          disabled={(smartAccounts * smartVidsPerAccount) > (activeBatch.items?.filter(i => i.status === "RENDERED" || i.status === "UPLOADED").length || 0)}
                          className="mt-4 w-full bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-30 text-white font-bold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 text-sm"
                        >
                          <Download className="w-4 h-4" />
                          Generate & Download Archive
                        </button>
                      </div>
                    )}
                  </div>
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
                  <div className="flex flex-wrap gap-3">
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
                        if (confirm("Are you sure you want to re-render all videos in this batch? This will delete all existing rendered files and start over.")) {
                          const itemIds = activeBatch.items?.map(i => i.id) || [];
                          handleReRenderItems(activeBatch.id, itemIds);
                        }
                      }}
                      className="bg-amber-500/10 hover:bg-amber-500 text-amber-400 hover:text-black font-extrabold py-3.5 px-6 rounded-2xl border border-amber-500/20 hover:border-amber-500 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-amber-500/5 transition-all duration-300"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Re-render Whole Batch ({activeBatch.items?.length || 0} videos)
                    </button>
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

                      <div className="flex items-center gap-2">
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
                          onClick={() => handleDeleteBatch(b.id)}
                          disabled={!!deletingItemIds[b.id]}
                          className="bg-red-500/10 hover:bg-red-500/80 text-red-400 hover:text-white px-2.5 py-2 rounded-xl text-xs font-bold transition-all border border-red-500/15 hover:border-red-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                          title="Delete this batch permanently"
                        >
                          {deletingItemIds[b.id] ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </button>
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
                <div className={`w-full ${previewAspectRatio === "1:1" ? "aspect-square" : "aspect-[9/16]"} max-h-[60vh] rounded-2xl overflow-hidden bg-black border border-white/5 relative shadow-inner`}>
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

      {isLyricsEditorOpen && lyricsEditingTrack && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md transition-all duration-300">
          <div className="relative w-full max-w-4xl bg-[#0e0e16] border border-white/10 rounded-3xl overflow-hidden shadow-2xl shadow-purple-500/10 flex flex-col max-h-[85vh]">
            {/* Modal Header */}
            <div className="flex justify-between items-center px-6 py-4 border-b border-white/5 bg-black/20">
              <div>
                <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                  <Edit3 className="w-4 h-4 text-purple-400" />
                  Edit Lyrics Transcription
                </h3>
                <p className="text-[10px] text-gray-400 mt-1 uppercase tracking-wider font-semibold">
                  Track: <strong className="text-amber-400">{lyricsEditingTrack.title}</strong> — {lyricsEditingTrack.artist}
                </p>
              </div>
              <button
                onClick={() => {
                  setIsLyricsEditorOpen(false);
                  setLyricsEditingTrack(null);
                }}
                className="p-1.5 rounded-full bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto bg-black/40 flex-1">
              <div className="bg-amber-500/5 border border-amber-500/10 rounded-2xl p-4 mb-5 flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-xs font-bold text-amber-400 uppercase tracking-wider">Spelling Correction Guide</p>
                  <p className="text-[10px] text-gray-400 leading-relaxed">
                    Whisper transcription aligns timestamps to individual words. Correct the spelling in each word box below. Do not change words unnecessarily to keep timings synchronized. Empty words will be removed upon saving.
                  </p>
                </div>
              </div>

              {editingWords.length === 0 ? (
                <div className="text-center py-12 text-gray-500 text-sm italic">
                  No transcription words found.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {editingWords.map((w, idx) => (
                    <div key={idx} className="flex items-center gap-1.5 p-2 bg-white/5 border border-white/5 hover:border-white/10 rounded-xl transition-all">
                      <span className="text-[9px] font-mono text-purple-400 font-bold min-w-[32px] bg-purple-500/5 px-1.5 py-0.5 rounded border border-purple-500/10 text-center">
                        {w.start.toFixed(1)}s
                      </span>
                      <input
                        type="text"
                        value={w.word}
                        onChange={(e) => {
                          const newWords = [...editingWords];
                          newWords[idx].word = e.target.value;
                          setEditingWords(newWords);
                        }}
                        className="bg-black/40 border border-white/15 focus:border-purple-500 rounded-lg px-2 py-1 text-xs text-white focus:outline-none w-full font-bold transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setEditingWords(editingWords.filter((_, i) => i !== idx));
                        }}
                        className="text-gray-500 hover:text-red-400 p-1 rounded-lg hover:bg-red-500/5 transition-all shrink-0 cursor-pointer"
                        title="Delete word"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex justify-between items-center px-6 py-4 border-t border-white/5 bg-black/20">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    const lower = editingWords.map(w => ({ ...w, word: w.word.toLowerCase() }));
                    setEditingWords(lower);
                    toast.success("Converted all words to lowercase");
                  }}
                  className="bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all border border-white/5 cursor-pointer"
                >
                  All Lowercase
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const upper = editingWords.map(w => ({ ...w, word: w.word.toUpperCase() }));
                    setEditingWords(upper);
                    toast.success("Converted all words to UPPERCASE");
                  }}
                  className="bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all border border-white/5 cursor-pointer"
                >
                  All Uppercase
                </button>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={savingLyrics}
                  onClick={() => {
                    setIsLyricsEditorOpen(false);
                    setLyricsEditingTrack(null);
                  }}
                  className="px-5 py-2 bg-white/5 hover:bg-white/10 text-white font-bold rounded-xl text-xs transition-all border border-white/5 cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={savingLyrics}
                  onClick={handleSaveLyrics}
                  className="px-5 py-2 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-white font-extrabold rounded-xl text-xs transition-all shadow-lg hover:shadow-purple-500/10 cursor-pointer disabled:opacity-50 flex items-center gap-2"
                >
                  {savingLyrics ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      Save Lyrics
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LRC Synced Lyrics Search Modal */}
      {isLrcSearchModalOpen && setupLyricalTrackId && (() => {
        const selectedTrack = tracks.find(t => t.id === setupLyricalTrackId);
        if (!selectedTrack) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md transition-all duration-300">
            <div className="relative w-full max-w-xl bg-[#0e0e16] border border-white/10 rounded-3xl overflow-hidden shadow-2xl shadow-purple-500/10 flex flex-col max-h-[85vh]">
              {/* Modal Header */}
              <div className="flex justify-between items-center px-6 py-4 border-b border-white/5 bg-black/20">
                <div>
                  <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                    <Music className="w-4 h-4 text-amber-400" />
                    Import LRC Synced Lyrics
                  </h3>
                  <p className="text-[10px] text-gray-400 mt-1 uppercase tracking-wider font-semibold">
                    Track: <strong className="text-amber-400">{selectedTrack.title}</strong> — {selectedTrack.artist}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setIsLrcSearchModalOpen(false);
                    setSelectedLrcSong(null);
                  }}
                  className="p-1.5 rounded-full bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-all cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6 overflow-y-auto bg-black/40 flex-1 space-y-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Artist / Song Title..."
                    value={lyricsSearchQuery}
                    onChange={(e) => setLyricsSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearchLyrics()}
                    className="flex-1 bg-black/45 border border-white/10 focus:border-amber-500/50 rounded-xl px-3 py-2 text-xs text-white focus:outline-none transition-all"
                  />
                  <button
                    type="button"
                    onClick={handleSearchLyrics}
                    disabled={searchingLyrics || !lyricsSearchQuery.trim()}
                    className="bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-black font-extrabold px-3 py-2 rounded-xl text-xs transition-all flex items-center gap-1 cursor-pointer"
                  >
                    {searchingLyrics ? <Loader2 className="w-3 h-3 animate-spin" /> : "Search"}
                  </button>
                </div>

                {/* Search Results */}
                {lyricsSearchResults.length > 0 && !selectedLrcSong && (
                  <div className="max-h-[250px] overflow-y-auto border border-white/5 rounded-xl bg-black/35 divide-y divide-white/5 pr-1">
                    {lyricsSearchResults.map((song) => (
                      <div
                        key={song.id}
                        onClick={() => {
                          setSelectedLrcSong(song);
                          setLrcStartLine(0);
                          setLrcEndLine(Math.min(4, song.parsedLines.length - 1));
                        }}
                        className="p-3 hover:bg-white/5 cursor-pointer flex justify-between items-center text-xs"
                      >
                        <div className="truncate pr-2">
                          <p className="font-bold text-white truncate">{song.trackName}</p>
                          <p className="text-gray-500 truncate">{song.artistName} {song.albumName ? `(${song.albumName})` : ""}</p>
                        </div>
                        <span className="text-amber-400 font-extrabold text-[10px] uppercase flex-shrink-0">
                          {song.syncedLyrics ? "Synced ✅" : "Unsynced"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Selected Song Preview and Range Picker */}
                {selectedLrcSong && (
                  <div className="space-y-4 bg-black/40 p-4 border border-white/5 rounded-2xl">
                    <div className="flex justify-between items-center">
                      <span className="text-xs uppercase tracking-wider font-extrabold text-amber-400 truncate">
                        Selected: {selectedLrcSong.trackName}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedLrcSong(null)}
                        className="text-[10px] uppercase tracking-wider font-black text-gray-500 hover:text-white"
                      >
                        Change Selection
                      </button>
                    </div>

                    {selectedLrcSong.parsedLines && selectedLrcSong.parsedLines.length > 0 ? (
                      <>
                        <div className="grid grid-cols-1 gap-3">
                          <div className="space-y-1">
                            <label className="block text-[10px] uppercase tracking-wider font-extrabold text-gray-500">Start Line</label>
                            <select
                              value={lrcStartLine}
                              onChange={(e) => {
                                const val = parseInt(e.target.value);
                                setLrcStartLine(val);
                                if (val > lrcEndLine) setLrcEndLine(val);
                              }}
                              className="w-full bg-black/60 border border-white/10 hover:border-white/20 rounded-xl px-3 py-2 text-xs text-white focus:outline-none font-bold"
                            >
                              {selectedLrcSong.parsedLines.map((line: any, idx: number) => (
                                <option key={idx} value={idx}>
                                  [{formatTime(line.start)}] {line.text || "(instrumental)"}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label className="block text-[10px] uppercase tracking-wider font-extrabold text-gray-500">End Line</label>
                            <select
                              value={lrcEndLine}
                              onChange={(e) => setLrcEndLine(parseInt(e.target.value))}
                              className="w-full bg-black/60 border border-white/10 hover:border-white/20 rounded-xl px-3 py-2 text-xs text-white focus:outline-none font-bold"
                            >
                              {selectedLrcSong.parsedLines.map((line: any, idx: number) => (
                                <option key={idx} value={idx} disabled={idx < lrcStartLine}>
                                  [{formatTime(line.end)}] {line.text || "(instrumental)"}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="text-xs text-gray-500 bg-black/20 p-3 rounded-lg border border-white/5 leading-relaxed font-semibold">
                          <span className="font-bold text-gray-400">Normalizing offsets:</span> The selected range spans from{" "}
                          <span className="text-white font-extrabold">
                            {selectedLrcSong.parsedLines[lrcStartLine].start.toFixed(1)}s
                          </span>{" "}
                          to{" "}
                          <span className="text-white font-extrabold">
                            {selectedLrcSong.parsedLines[lrcEndLine].end.toFixed(1)}s
                          </span>{" "}
                          (Total:{" "}
                          <span className="text-amber-400 font-extrabold">
                            {(selectedLrcSong.parsedLines[lrcEndLine].end - selectedLrcSong.parsedLines[lrcStartLine].start).toFixed(1)}s
                          </span>
                          ). Sliced lyrics words will be shifted to start at 0.0s for composition.
                        </div>

                        <button
                          type="button"
                          disabled={savingLyrics}
                          onClick={() => handleApplyLrcLyrics(selectedTrack.id)}
                          className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-black font-extrabold py-3 rounded-2xl text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          {savingLyrics ? <Loader2 className="w-4 h-4 animate-spin" /> : "Apply Synced Lyrics & Crop"}
                        </button>
                      </>
                    ) : (
                      <p className="text-xs text-red-400 font-semibold uppercase tracking-wider">No synchronized lyrics available for this match.</p>
                    )}
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="flex justify-end px-6 py-4 border-t border-white/5 bg-black/20">
                <button
                  type="button"
                  onClick={() => {
                    setIsLrcSearchModalOpen(false);
                    setSelectedLrcSong(null);
                  }}
                  className="px-5 py-2 bg-white/5 hover:bg-white/10 text-white font-bold rounded-xl text-xs transition-all border border-white/5 cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ────────────────────────────────────────────────────────────────────────
          TAB: LYRIC GENERATOR
      ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === "lyric-gen" && (
        <div className="bg-[#0d0d16]/80 backdrop-blur-md border border-white/10 rounded-3xl overflow-hidden">
          {/* Header */}
          <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 border border-emerald-500/30 flex items-center justify-center">
                <Mic className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">Lyric Generator</h2>
                <p className="text-[10px] text-gray-500">Upload audio → Whisper transcription → select lines → create lyrical track</p>
              </div>
            </div>
            {lgStep > 1 && (
              <button
                onClick={lgResetWizard}
                className="text-[10px] text-gray-500 hover:text-white transition-colors flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                Start Over
              </button>
            )}
          </div>

          {/* Step Indicator */}
          <div className="px-6 py-3 border-b border-white/5 bg-black/20">
            <div className="flex items-center gap-2">
              {[
                { n: 1, label: "Upload" },
                { n: 2, label: "Transcribe" },
                { n: 3, label: "Lines" },
                { n: 4, label: "Create" },
              ].map((s, i) => (
                <div key={s.n} className="flex items-center gap-2">
                  {i > 0 && <div className={`w-8 h-px ${lgStep >= s.n ? "bg-emerald-500/50" : "bg-white/10"}`} />}
                  <div
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
                      lgStep === s.n
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                        : lgStep > s.n
                        ? "bg-emerald-500/10 text-emerald-500/60"
                        : "text-gray-600"
                    }`}
                  >
                    {lgStep > s.n ? (
                      <CheckCircle2 className="w-3 h-3" />
                    ) : (
                      <span className="w-3.5 h-3.5 rounded-full border border-current flex items-center justify-center text-[8px]">
                        {s.n}
                      </span>
                    )}
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="p-6 space-y-5">
            {/* ── STEP 1: Upload Audio ─────────────────────────────────────────── */}
            {lgStep === 1 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-2">
                      Song Title *
                    </label>
                    <input
                      type="text"
                      value={lgTitle}
                      onChange={(e) => setLgTitle(e.target.value)}
                      placeholder="Von Dutch"
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500/50 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-2">
                      Artist
                    </label>
                    <input
                      type="text"
                      value={lgArtist}
                      onChange={(e) => setLgArtist(e.target.value)}
                      placeholder="Charli XCX"
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500/50 transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-2">
                    Audio File *
                  </label>
                  <div
                    className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer ${
                      lgAudioFile
                        ? "border-emerald-500/40 bg-emerald-500/5"
                        : "border-white/10 hover:border-white/20 bg-black/20"
                    }`}
                    onClick={() => document.getElementById("lg-audio-input")?.click()}
                  >
                    <input
                      id="lg-audio-input"
                      type="file"
                      accept="audio/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          setLgAudioFile(f);
                          // Auto-fill title from filename if empty
                          if (!lgTitle) {
                            const name = f.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
                            setLgTitle(name);
                          }
                        }
                      }}
                    />
                    {lgAudioFile ? (
                      <div className="space-y-1">
                        <Music className="w-6 h-6 text-emerald-400 mx-auto" />
                        <p className="text-sm text-white font-bold">{lgAudioFile.name}</p>
                        <p className="text-[10px] text-gray-500">
                          {(lgAudioFile.size / (1024 * 1024)).toFixed(1)} MB · Click to change
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Upload className="w-6 h-6 text-gray-500 mx-auto" />
                        <p className="text-xs text-gray-500">Click to upload audio file</p>
                        <p className="text-[9px] text-gray-600">MP3, WAV, M4A, OGG supported</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={lgHandleUpload}
                    disabled={lgUploading || !lgAudioFile || !lgTitle.trim()}
                    className="px-5 py-3 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 disabled:opacity-40 text-white font-bold text-xs rounded-xl transition-all flex items-center gap-2"
                  >
                    {lgUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {lgUploading ? "Uploading..." : "Upload & Continue"}
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 2: Transcription ────────────────────────────────────────── */}
            {lgStep === 2 && (
              <div className="space-y-5">
                {/* Audio uploaded confirmation */}
                <div className="flex items-center gap-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div className="text-xs">
                    <span className="text-white font-bold">{lgTitle}</span>
                    {lgArtist && <span className="text-gray-500"> — {lgArtist}</span>}
                    <span className="text-gray-600 ml-2">({lgAudioDuration ? `${Math.round(lgAudioDuration)}s` : "uploaded"})</span>
                  </div>
                </div>

                {/* Lyrics source selector */}
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-2">
                    Lyrics Source
                  </label>
                  <div className="flex gap-2">
                    {[
                      { key: "whisper" as const, label: "Whisper AI", icon: <Mic className="w-3 h-3" />, desc: "Auto-transcribe with stable-ts" },
                      { key: "lrclib" as const, label: "LRCLIB", icon: <Search className="w-3 h-3" />, desc: "Search for synced lyrics" },
                      { key: "manual" as const, label: "Paste LRC", icon: <FileText className="w-3 h-3" />, desc: "Paste .lrc content" },
                    ].map((mode) => (
                      <button
                        key={mode.key}
                        onClick={() => setLgLyricsMode(mode.key)}
                        className={`flex-1 p-3 rounded-xl border text-left transition-all ${
                          lgLyricsMode === mode.key
                            ? "bg-emerald-500/10 border-emerald-500/30 text-white"
                            : "bg-black/20 border-white/5 text-gray-400 hover:border-white/20"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 text-[10px] font-bold mb-0.5">
                          {mode.icon}
                          {mode.label}
                        </div>
                        <p className="text-[9px] text-gray-600">{mode.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Whisper mode */}
                {lgLyricsMode === "whisper" && (
                  <div className="space-y-3">
                    <p className="text-xs text-gray-400">
                      Whisper will transcribe your audio with word-level timestamps using <span className="text-emerald-400 font-bold">stable-ts + faster-whisper</span>.
                      This runs on the server and may take 30–120 seconds depending on audio length.
                    </p>
                    <button
                      onClick={lgRunWhisper}
                      disabled={lgTranscribing}
                      className="px-5 py-3 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 disabled:opacity-40 text-white font-bold text-xs rounded-xl transition-all flex items-center gap-2"
                    >
                      {lgTranscribing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Transcribing with Whisper... (this may take a minute)
                        </>
                      ) : (
                        <>
                          <Mic className="w-4 h-4" />
                          Run Whisper Transcription
                        </>
                      )}
                    </button>
                  </div>
                )}

                {/* LRCLIB mode */}
                {lgLyricsMode === "lrclib" && (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={lgLrclibQuery}
                        onChange={(e) => setLgLrclibQuery(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && lgSearchLrclib()}
                        placeholder="Search LRCLIB for synced lyrics..."
                        className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500/50 transition-colors"
                      />
                      <button
                        onClick={lgSearchLrclib}
                        disabled={lgLrclibSearching || !lgLrclibQuery.trim()}
                        className="px-4 py-3 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-400 font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 disabled:opacity-40"
                      >
                        {lgLrclibSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                        Search
                      </button>
                    </div>

                    {lgLrclibResults.length > 0 && (
                      <div className="space-y-1.5 max-h-[250px] overflow-y-auto">
                        {lgLrclibResults.map((lrc: any) => (
                          <button
                            key={lrc.id}
                            onClick={() => {
                              lgHandleSelectLrc(lrc);
                              setLgStep(3);
                            }}
                            className={`w-full text-left p-2.5 rounded-xl border transition-all text-xs ${
                              lgSelectedLrc?.id === lrc.id
                                ? "bg-emerald-500/10 border-emerald-500/30 text-white"
                                : "bg-black/20 border-white/5 text-gray-400 hover:border-white/20 hover:text-white"
                            }`}
                          >
                            <div className="font-bold truncate">{lrc.trackName}</div>
                            <div className="text-[9px] text-gray-500 mt-0.5 flex items-center gap-2">
                              <span>{lrc.artistName}</span>
                              <span>·</span>
                              <span>{lrc.albumName}</span>
                              <span>·</span>
                              <span>{lrc.parsedLines?.length || 0} lines</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Manual LRC mode */}
                {lgLyricsMode === "manual" && (
                  <div className="space-y-3">
                    <textarea
                      value={lgManualLrc}
                      onChange={(e) => setLgManualLrc(e.target.value)}
                      placeholder={"[00:07.50] I went my own way and I made it\n[00:10.19] I'm your favorite reference, baby\n[00:12.06] Call me Gabbriette..."}
                      rows={8}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500/50 transition-colors font-mono"
                    />
                    <button
                      onClick={() => {
                        lgParseManualLrc();
                        // lgParsedLines won't be updated synchronously, but lgParseManualLrc sets it.
                        // Navigate based on whether the raw input has any timestamps.
                        const hasTimestamps = /\[\d+:\d+/.test(lgManualLrc);
                        if (hasTimestamps) {
                          setTimeout(() => setLgStep(3), 50);
                        }
                      }}
                      disabled={!lgManualLrc.trim()}
                      className="px-4 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-400 font-bold text-[10px] rounded-lg transition-all disabled:opacity-40"
                    >
                      Parse & Continue →
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── STEP 3: Line Range Selection ─────────────────────────────────── */}
            {lgStep === 3 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-white">Select Line Range</h3>
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      Click a line to set <span className="text-emerald-400 font-bold">START</span>, click another to set <span className="text-cyan-400 font-bold">END</span>. Auto-computes clip timestamps.
                    </p>
                  </div>
                  {lgGetClipInfo() && (
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2 flex items-center gap-3">
                      <div className="text-[10px]">
                        <span className="text-emerald-400 font-mono font-bold">{lgFormatTime(lgGetClipInfo()!.startTime)}</span>
                        <span className="text-gray-500 mx-1">→</span>
                        <span className="text-cyan-400 font-mono font-bold">{lgFormatTime(lgGetClipInfo()!.endTime)}</span>
                      </div>
                      <div className="text-[9px] text-gray-500">
                        {lgGetClipInfo()!.lineCount} lines · {Math.round(lgGetClipInfo()!.duration)}s
                      </div>
                    </div>
                  )}
                </div>

                {/* Song info */}
                <div className="flex items-center gap-2 text-[10px] text-gray-500">
                  <Music className="w-3 h-3" />
                  <span className="font-bold text-white">{lgTitle}</span>
                  {lgArtist && (
                    <>
                      <span>—</span>
                      <span>{lgArtist}</span>
                    </>
                  )}
                  <span className="text-gray-600 ml-1">
                    ({lgLyricsMode === "whisper" ? "Whisper" : lgLyricsMode === "lrclib" ? "LRCLIB" : "Manual LRC"} · {lgParsedLines.length} lines)
                  </span>
                </div>

                {/* Lyrics Lines */}
                <div className="bg-black/30 rounded-2xl border border-white/5 max-h-[450px] overflow-y-auto">
                  {lgParsedLines.map((line: any, idx: number) => {
                    const isStart = lgStartLine === idx;
                    const isEnd = lgEndLine === idx;
                    const isInRange =
                      lgStartLine !== null &&
                      lgEndLine !== null &&
                      idx >= lgStartLine &&
                      idx <= lgEndLine;
                    const isOutOfRange =
                      lgStartLine !== null &&
                      lgEndLine !== null &&
                      !isInRange;

                    return (
                      <button
                        key={idx}
                        onClick={() => lgHandleLineClick(idx)}
                        className={`w-full text-left px-4 py-2 flex items-center gap-3 border-b border-white/[0.03] transition-all group ${
                          isStart
                            ? "bg-emerald-500/15 border-l-2 border-l-emerald-500"
                            : isEnd
                            ? "bg-cyan-500/15 border-l-2 border-l-cyan-500"
                            : isInRange
                            ? "bg-emerald-500/5 border-l-2 border-l-emerald-500/30"
                            : isOutOfRange
                            ? "opacity-30"
                            : "hover:bg-white/[0.03]"
                        }`}
                      >
                        <span className="text-[9px] font-mono text-gray-600 w-5 text-right shrink-0">
                          {idx + 1}
                        </span>
                        <span className={`text-[9px] font-mono shrink-0 w-14 ${
                          isStart ? "text-emerald-400" : isEnd ? "text-cyan-400" : "text-gray-600"
                        }`}>
                          [{lgFormatTime(line.start)}]
                        </span>
                        <span className={`text-xs flex-1 ${
                          isStart || isEnd ? "text-white font-bold" : isInRange ? "text-white/80" : "text-gray-400"
                        }`}>
                          {line.text || <span className="text-gray-700 italic">♫ (instrumental)</span>}
                        </span>
                        {isStart && (
                          <span className="text-[8px] bg-emerald-500/30 text-emerald-300 px-1.5 py-0.5 rounded font-bold uppercase shrink-0">
                            Start
                          </span>
                        )}
                        {isEnd && (
                          <span className="text-[8px] bg-cyan-500/30 text-cyan-300 px-1.5 py-0.5 rounded font-bold uppercase shrink-0">
                            End
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setLgStep(2)}
                    className="text-[10px] text-gray-500 hover:text-white transition-colors flex items-center gap-1"
                  >
                    ← Back to Transcription
                  </button>
                  <button
                    onClick={() => {
                      if (lgStartLine === null || lgEndLine === null) {
                        toast.error("Please select both a start and end line");
                        return;
                      }
                      setLgStep(4);
                    }}
                    disabled={lgStartLine === null || lgEndLine === null}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold text-xs rounded-xl transition-all flex items-center gap-1.5"
                  >
                    Review & Create
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 4: Confirm & Create Track ───────────────────────────────── */}
            {lgStep === 4 && (
              <div className="space-y-5">
                <div className="bg-gradient-to-br from-emerald-500/5 to-cyan-500/5 rounded-2xl border border-emerald-500/10 p-5 space-y-4">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    Ready to Create Lyrical Track
                  </h3>

                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <span className="text-gray-500 text-[10px] uppercase tracking-wider">Song</span>
                      <p className="text-white font-bold mt-0.5">{lgTitle || "—"}</p>
                    </div>
                    <div>
                      <span className="text-gray-500 text-[10px] uppercase tracking-wider">Artist</span>
                      <p className="text-white font-bold mt-0.5">{lgArtist || "—"}</p>
                    </div>
                    <div>
                      <span className="text-gray-500 text-[10px] uppercase tracking-wider">Line Range</span>
                      <p className="text-white font-bold mt-0.5">
                        Lines {(lgStartLine || 0) + 1} – {(lgEndLine || 0) + 1} ({lgGetClipInfo()?.lineCount || 0} lines)
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500 text-[10px] uppercase tracking-wider">Clip Duration</span>
                      <p className="text-white font-bold mt-0.5">
                        {lgGetClipInfo() ? `${lgFormatTime(lgGetClipInfo()!.startTime)} → ${lgFormatTime(lgGetClipInfo()!.endTime)} (${Math.round(lgGetClipInfo()!.duration)}s)` : "—"}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500 text-[10px] uppercase tracking-wider">Lyrics Source</span>
                      <p className="text-white font-bold mt-0.5">
                        {lgLyricsMode === "whisper" ? "Whisper AI (stable-ts)" : lgLyricsMode === "lrclib" ? "LRCLIB" : "Manual .lrc"}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500 text-[10px] uppercase tracking-wider">Word-level Timing</span>
                      <p className="text-white font-bold mt-0.5">
                        {lgLyricsMode === "whisper" ? "✓ Exact (Whisper)" : "∼ Proportional (estimated)"}
                      </p>
                    </div>
                  </div>

                  {/* Preview selected lines */}
                  <div className="bg-black/30 rounded-xl p-3 max-h-32 overflow-y-auto">
                    <p className="text-[9px] uppercase tracking-wider text-gray-600 mb-1.5">Selected Lyrics Preview</p>
                    {lgParsedLines.slice(lgStartLine || 0, (lgEndLine || 0) + 1).map((line: any, i: number) => (
                      <p key={i} className="text-[10px] text-gray-300 leading-relaxed">
                        <span className="text-gray-600 font-mono mr-2">[{lgFormatTime(line.start)}]</span>
                        {line.text}
                      </p>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setLgStep(3)}
                    className="text-[10px] text-gray-500 hover:text-white transition-colors flex items-center gap-1"
                  >
                    ← Back to Line Selection
                  </button>
                  <button
                    onClick={lgHandleGenerate}
                    disabled={lgGenerating}
                    className="px-6 py-3 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 disabled:opacity-40 text-white font-bold text-sm rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/10"
                  >
                    {lgGenerating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Creating Track...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Create Lyrical Track
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
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
