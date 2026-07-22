"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Save,
  Trash2,
  Plus,
  Link2,
  FileText,
  Bookmark,
  AlertTriangle,
  Loader2,
  Calendar,
  Layers,
  CheckCircle,
  FileEdit,
  FolderClosed,
  CheckSquare,
  FolderOpen,
  TrendingUp,
  BarChart3,
  Upload,
  CheckCircle2,
  AlertCircle
} from "lucide-react";
import { toast } from "sonner";
import { Campaign, CampaignResource, CampaignStatus } from "@prisma/client";

// Auto-post caption fields (added to the Campaign model concurrently with this UI)
type CampaignAutoPostFields = {
  fixedTexts?: string[];
  descTags?: string | null;
  descTagCount?: number | null;
};

interface CampaignDetailClientProps {
  campaign: Campaign & { resources: CampaignResource[] } & CampaignAutoPostFields;
  exportAnalytics: {
    totalExported: number;
    dailyExports: { date: string; count: number }[];
    recentExports: {
      id: string;
      updatedAt: string;
      driveFolderId: string;
      driveFolderName: string;
      tiktokUsername: string;
      video: {
        id: string;
        driveFileName: string | null;
        group: { name: string };
      };
    }[];
    groupsBreakdown: {
      id: string;
      name: string;
      status: string;
      totalOutputs: number;
      exportedCount: number;
    }[];
  };
}

type StatsRange = "today" | "7d" | "30d" | "all";

interface CampaignStats {
  totals: { exported: number; posted: number; failed: number; postSuccessRate: number };
  rangeTotals: { exported: number; posted: number; failed: number };
  daily: { date: string; exported: number; posted: number; failed: number }[];
  recentEvents: {
    id: string;
    type: "export" | "post_success" | "post_failed";
    count: number;
    meta: {
      accountUsername?: string;
      accountId?: string;
      driveFileName?: string;
      groupName?: string;
      failureReason?: string;
      tiktokPostUrl?: string;
    };
    createdAt: string;
  }[];
}

const RANGE_OPTIONS: { value: StatsRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "all", label: "All" },
];

const timeAgo = (dateStr: string) => {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const formatRate = (rate: number) => (rate % 1 === 0 ? `${rate}` : rate.toFixed(1));

export default function CampaignDetailClient({ campaign: initialCampaign, exportAnalytics }: CampaignDetailClientProps) {
  const router = useRouter();
  const [campaign, setCampaign] = useState(initialCampaign);
  
  // Meta fields
  const [title, setTitle] = useState(campaign.title || campaign.name || "");
  const [type, setType] = useState(campaign.type || "other");
  const [status, setStatus] = useState<CampaignStatus>(campaign.status);

  // Calculator inputs
  const [targetViews, setTargetViews] = useState(campaign.targetViews || 1000000);
  const [accountsCount, setAccountsCount] = useState(campaign.accountsCount || 5);
  const [avgViewsPerVideo, setAvgViewsPerVideo] = useState(campaign.avgViewsPerVideo || 10000);
  const [videosPerAccountPerDay, setVideosPerAccountPerDay] = useState(campaign.videosPerAccountPerDay || 2);

  // Auto-post captions
  const [fixedTexts, setFixedTexts] = useState<string[]>(
    campaign.fixedTexts && campaign.fixedTexts.length > 0 ? campaign.fixedTexts : [""]
  );
  const [descTags, setDescTags] = useState(campaign.descTags || "");
  const [descTagCount, setDescTagCount] = useState(campaign.descTagCount ?? 3);

  // Notion-style editor
  const [infoContent, setInfoContent] = useState(campaign.infoContent || "");
  const [editorMode, setEditorMode] = useState<"write" | "preview">("write");

  // Resources state
  const [resources, setResources] = useState<CampaignResource[]>(campaign.resources);
  const [resLabel, setResLabel] = useState("");
  const [resUrl, setResUrl] = useState("");
  const [resType, setResType] = useState("link");

  // Save states
  const [isSavingMeta, setIsSavingMeta] = useState(false);
  const [isSavingCaptions, setIsSavingCaptions] = useState(false);
  const [isSavingInfo, setIsSavingInfo] = useState(false);
  const [saveIndicator, setSaveIndicator] = useState<"idle" | "saving" | "saved">("idle");
  const [isDeleting, setIsDeleting] = useState(false);
  const [isAddingResource, setIsAddingResource] = useState(false);

  // Debounced auto-save for Notion-style editor
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Clip mixer folders states (Phase 4)
  const [folders, setFolders] = useState<any[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [sections, setSections] = useState<any[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  // Campaign activity stats (range-filtered)
  const [statsRange, setStatsRange] = useState<StatsRange>("7d");
  const [stats, setStats] = useState<CampaignStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const fetchStats = async () => {
      setStatsLoading(true);
      setStatsError(null);
      try {
        const res = await fetch(`/api/campaigns/${campaign.id}/stats?range=${statsRange}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
        const data: CampaignStats = await res.json();
        setStats(data);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setStats(null);
        setStatsError(err instanceof Error ? err.message : "Failed to load campaign stats");
      } finally {
        if (!controller.signal.aborted) setStatsLoading(false);
      }
    };

    fetchStats();
    return () => controller.abort();
  }, [campaign.id, statsRange]);

  useEffect(() => {
    // Fetch sections
    const fetchSections = async () => {
      try {
        const res = await fetch("/api/managed/sections");
        if (res.ok) {
          const data = await res.json();
          setSections(data);
          if (data.length > 0) {
            setSelectedSectionId(data[0].id);
          }
        }
      } catch (err) {
        console.error("Failed to fetch sections:", err);
      }
    };

    // Fetch folders for this campaign
    const fetchCampaignFolders = async () => {
      setLoadingFolders(true);
      try {
        const res = await fetch(`/api/managed/clip-mixer/folders?campaignId=${campaign.id}`);
        if (res.ok) {
          const data = await res.json();
          setFolders(data);
        }
      } catch (err) {
        console.error("Failed to fetch campaign folders:", err);
      } finally {
        setLoadingFolders(false);
      }
    };

    fetchSections();
    fetchCampaignFolders();
  }, [campaign.id]);

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim() || !selectedSectionId) {
      toast.error("Folder name and section are required");
      return;
    }

    setIsCreatingFolder(true);
    try {
      const res = await fetch("/api/managed/clip-mixer/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CREATE_FOLDER",
          sectionId: selectedSectionId,
          name: newFolderName.trim(),
          campaignId: campaign.id,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create folder");
      }

      toast.success("Folder created successfully");
      setNewFolderName("");
      
      // Re-fetch campaign folders
      const foldersRes = await fetch(`/api/managed/clip-mixer/folders?campaignId=${campaign.id}`);
      if (foldersRes.ok) {
        const data = await foldersRes.json();
        setFolders(data);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to create folder");
    } finally {
      setIsCreatingFolder(false);
    }
  };

  // Calculator outputs logic
  const hasValidInputs =
    targetViews > 0 &&
    accountsCount > 0 &&
    avgViewsPerVideo > 0 &&
    videosPerAccountPerDay > 0;

  const totalVideosNeeded = hasValidInputs ? Math.ceil(targetViews / avgViewsPerVideo) : 0;
  const videosPerDay = hasValidInputs ? accountsCount * videosPerAccountPerDay : 0;
  const viewsPerDay = hasValidInputs ? videosPerDay * avgViewsPerVideo : 0;
  const daysToGoal = hasValidInputs ? Math.ceil(totalVideosNeeded / videosPerDay) : 0;
  const showHealthWarning = videosPerAccountPerDay > 3;

  // Auto-save the info content changes
  const handleInfoChange = (newVal: string) => {
    setInfoContent(newVal);
    setSaveIndicator("saving");

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    autoSaveTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/campaigns/${campaign.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ infoContent: newVal }),
        });

        if (!res.ok) throw new Error("Auto-save failed");
        
        setSaveIndicator("saved");
        setTimeout(() => setSaveIndicator("idle"), 2000);
      } catch (err) {
        setSaveIndicator("idle");
        toast.error("Failed to auto-save info page");
      }
    }, 1500); // Save after 1.5s of inactivity
  };

  useEffect(() => {
    return () => {
      if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
    };
  }, []);

  // Save Meta/Calculator Settings
  const handleSaveSettings = async () => {
    setIsSavingMeta(true);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          name: title.trim(),
          type,
          status,
          targetViews: Number(targetViews),
          accountsCount: Number(accountsCount),
          avgViewsPerVideo: Number(avgViewsPerVideo),
          videosPerAccountPerDay: Number(videosPerAccountPerDay),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save settings");
      }

      const updated = await res.json();
      setCampaign(updated);
      toast.success("Settings saved successfully");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsSavingMeta(false);
    }
  };

  // Fixed texts pool list helpers
  const handleFixedTextChange = (index: number, value: string) => {
    setFixedTexts((prev) => prev.map((t, i) => (i === index ? value : t)));
  };

  const handleAddFixedText = () => {
    setFixedTexts((prev) => [...prev, ""]);
  };

  const handleRemoveFixedText = (index: number) => {
    setFixedTexts((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length > 0 ? next : [""];
    });
  };

  // Save Auto-post Captions (fixed texts pool + hashtag pool)
  const handleSaveCaptions = async () => {
    setIsSavingCaptions(true);
    const cleanedTexts = fixedTexts.map((t) => t.trim()).filter((t) => t.length > 0);
    const trimmedTags = descTags.trim();
    const clampedCount = Math.min(20, Math.max(0, Number(descTagCount) || 0));
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fixedTexts: cleanedTexts,
          descTags: trimmedTags.length > 0 ? trimmedTags : null,
          descTagCount: clampedCount,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save auto-post captions");
      }

      const updated = await res.json();
      setCampaign(updated);
      setFixedTexts(cleanedTexts.length > 0 ? cleanedTexts : [""]);
      setDescTagCount(clampedCount);
      toast.success("Auto-post captions saved successfully");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsSavingCaptions(false);
    }
  };

  // Add Resource
  const handleAddResource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resLabel.trim() || !resUrl.trim()) {
      toast.error("Label and URL are required");
      return;
    }

    setIsAddingResource(true);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/resources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: resLabel.trim(),
          url: resUrl.trim(),
          type: resType,
        }),
      });

      if (!res.ok) throw new Error("Failed to add resource");
      
      const newRes = await res.json();
      setResources([...resources, newRes]);
      setResLabel("");
      setResUrl("");
      toast.success("Resource added successfully");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsAddingResource(false);
    }
  };

  // Delete Resource
  const handleDeleteResource = async (resourceId: string) => {
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/resources?resourceId=${resourceId}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to delete resource");
      
      setResources(resources.filter((r) => r.id !== resourceId));
      toast.success("Resource removed");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // Delete Campaign
  const handleDeleteCampaign = async () => {
    if (!confirm("Are you sure you want to delete this campaign permanently? All resources will be deleted.")) {
      return;
    }

    setIsDeleting(true);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to delete campaign");
      
      toast.success("Campaign deleted");
      router.push("/admin/campaigns");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message);
      setIsDeleting(false);
    }
  };

  // SVG Chart Projection calculation
  const renderProjectionChart = () => {
    if (!hasValidInputs || daysToGoal <= 0) return null;

    const dataPoints: { day: number; views: number }[] = [];
    const step = Math.max(1, Math.ceil(daysToGoal / 10)); // max 10 points
    
    for (let day = 0; day <= daysToGoal; day += step) {
      const cumulativeViews = Math.min(targetViews, day * viewsPerDay);
      dataPoints.push({ day, views: cumulativeViews });
    }
    
    // Add final endpoint if it didn't align exactly
    if (dataPoints[dataPoints.length - 1].day !== daysToGoal) {
      dataPoints.push({ day: daysToGoal, views: targetViews });
    }

    const width = 450;
    const height = 155;
    const padding = { top: 15, right: 25, bottom: 25, left: 55 };

    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const maxDay = daysToGoal;
    const maxViews = targetViews;

    const getX = (day: number) => padding.left + (day / maxDay) * chartW;
    const getY = (views: number) => padding.top + chartH - (views / maxViews) * chartH;

    // SVG path string
    let pathD = "";
    dataPoints.forEach((p, idx) => {
      const x = getX(p.day);
      const y = getY(p.views);
      if (idx === 0) {
        pathD += `M ${x} ${y}`;
      } else {
        pathD += ` L ${x} ${y}`;
      }
    });

    // Filled area path
    const areaD = `${pathD} L ${getX(dataPoints[dataPoints.length - 1].day)} ${getY(0)} L ${getX(0)} ${getY(0)} Z`;

    return (
      <div className="bg-zinc-950/40 border border-[#27272a] rounded p-3.5 space-y-2 mt-4 select-none">
        <h4 className="text-[11px] font-semibold text-zinc-400">Cumulative View Projections</h4>
        <div className="w-full flex justify-center">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-w-[480px]">
            {/* Grid Lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
              const y = padding.top + ratio * chartH;
              const viewVal = maxViews * (1 - ratio);
              return (
                <g key={i}>
                  <line
                    x1={padding.left}
                    y1={y}
                    x2={width - padding.right}
                    y2={y}
                    stroke="#27272a"
                    strokeWidth={1}
                    strokeDasharray="4 4"
                  />
                  <text
                    x={padding.left - 8}
                    y={y + 3}
                    textAnchor="end"
                    fill="#71717a"
                    className="text-[9px] font-mono font-medium"
                  >
                    {viewVal >= 1000000
                      ? `${(viewVal / 1000000).toFixed(1)}M`
                      : viewVal >= 1000
                      ? `${(viewVal / 1000).toFixed(0)}k`
                      : viewVal}
                  </text>
                </g>
              );
            })}

            {/* X-Axis labels */}
            {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
              const dayVal = Math.round(maxDay * ratio);
              const x = padding.left + ratio * chartW;
              return (
                <text
                  key={i}
                  x={x}
                  y={height - 8}
                  textAnchor="middle"
                  fill="#71717a"
                  className="text-[9px] font-mono font-medium"
                >
                  Day {dayVal}
                </text>
              );
            })}

            {/* Fill Area */}
            <path d={areaD} fill="url(#blue-gradient)" className="opacity-15" />

            {/* Line Path */}
            <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth={2} />

            {/* Points */}
            {dataPoints.map((p, i) => (
              <circle
                key={i}
                cx={getX(p.day)}
                cy={getY(p.views)}
                r={i === 0 || i === dataPoints.length - 1 ? 3.5 : 2.5}
                fill={i === dataPoints.length - 1 ? "#10b981" : "#3b82f6"}
                stroke="#09090b"
                strokeWidth={1}
              />
            ))}

            {/* Definitions */}
            <defs>
              <linearGradient id="blue-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      </div>
    );
  };

  const renderExportVelocityChart = () => {
    // Generate data for the last 10 days
    const last10DaysData = Array.from({ length: 10 }).map((_, idx) => {
      const d = new Date();
      d.setDate(d.getDate() - (9 - idx));
      const dateStr = d.toISOString().split("T")[0];
      const match = exportAnalytics.dailyExports.find((de) => de.date === dateStr);
      return {
        label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        count: match ? match.count : 0,
      };
    });

    const maxCount = Math.max(5, ...last10DaysData.map((d) => d.count));
    const width = 450;
    const height = 155;
    const padding = { top: 15, right: 15, bottom: 25, left: 35 };

    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const getX = (index: number) => padding.left + (index / 9) * chartW;
    const getY = (count: number) => padding.top + chartH - (count / maxCount) * chartH;

    return (
      <div className="bg-zinc-950/40 border border-[#27272a] rounded p-3.5 space-y-2 mt-4 select-none">
        <h4 className="text-[11px] font-semibold text-zinc-400">Daily Google Drive Exports (Last 10 Days)</h4>
        <div className="w-full flex justify-center">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-w-[480px]">
            {/* Grid Lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
              const y = padding.top + ratio * chartH;
              const val = Math.round(maxCount * (1 - ratio));
              return (
                <g key={i}>
                  <line
                    x1={padding.left}
                    y1={y}
                    x2={width - padding.right}
                    y2={y}
                    stroke="#27272a"
                    strokeWidth={1}
                    strokeDasharray="4 4"
                  />
                  <text
                    x={padding.left - 8}
                    y={y + 3}
                    textAnchor="end"
                    fill="#71717a"
                    className="text-[9px] font-mono font-medium"
                  >
                    {val}
                  </text>
                </g>
              );
            })}

            {/* X-Axis Labels */}
            {last10DaysData.map((d, i) => {
              if (i % 2 !== 0) return null;
              const x = getX(i);
              return (
                <text
                  key={i}
                  x={x}
                  y={height - 8}
                  textAnchor="middle"
                  fill="#71717a"
                  className="text-[8px] font-mono font-medium"
                >
                  {d.label}
                </text>
              );
            })}

            {/* Bars */}
            {last10DaysData.map((d, i) => {
              const x = getX(i) - 8;
              const y = getY(d.count);
              const barH = padding.top + chartH - y;
              return (
                <g key={i} className="group">
                  <rect
                    x={x}
                    y={y}
                    width={16}
                    height={Math.max(2, barH)}
                    rx={2}
                    fill={d.count > 0 ? "#8b5cf6" : "#27272a"}
                    className="transition-colors hover:fill-purple-400"
                  />
                  <title>{`${d.count} videos exported`}</title>
                  {d.count > 0 && (
                    <text
                      x={x + 8}
                      y={y - 4}
                      textAnchor="middle"
                      fill="#a78bfa"
                      className="text-[8px] font-mono font-bold"
                    >
                      {d.count}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    );
  };

  // CSS grouped bar chart: Exported (zinc) vs Posted (emerald) vs Failed (red) per day
  const renderActivityChart = () => {
    if (!stats) return null;

    const daily = stats.daily;
    const hasActivity = daily.some((d) => d.exported > 0 || d.posted > 0 || d.failed > 0);

    if (daily.length === 0 || !hasActivity) {
      return (
        <div className="bg-zinc-950/40 border border-[#27272a] rounded p-8 text-center select-none">
          <BarChart3 className="w-5 h-5 text-zinc-600 mx-auto mb-2" />
          <p className="text-[11px] text-zinc-500 italic">No activity in this range.</p>
        </div>
      );
    }

    const maxCount = Math.max(5, ...daily.flatMap((d) => [d.exported, d.posted, d.failed]));
    const labelEvery = Math.max(1, Math.ceil(daily.length / 8));
    const formatDay = (dateStr: string) =>
      new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const barHeight = (v: number) => ({
      height: `${(v / maxCount) * 100}%`,
      minHeight: v > 0 ? 2 : 0,
    });

    return (
      <div className="bg-zinc-950/40 border border-[#27272a] rounded p-3.5 space-y-2 select-none">
        {/* Legend */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-[10px] text-zinc-400">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-zinc-400 inline-block" /> Exported
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" /> Posted
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-red-500 inline-block" /> Failed
            </span>
          </div>
          <span className="text-[9px] text-zinc-600 font-mono">per day</span>
        </div>

        {/* Plot area */}
        <div className="relative h-36">
          {/* Grid lines + Y labels */}
          {[1, 0.75, 0.5, 0.25, 0].map((ratio) => (
            <div
              key={ratio}
              className="absolute left-0 right-0 border-t border-dashed border-[#27272a] pointer-events-none"
              style={{ top: `${(1 - ratio) * 100}%` }}
            >
              <span className="absolute -top-2 left-0 text-[8px] text-zinc-600 font-mono bg-[#09090b] pr-1">
                {Math.round(maxCount * ratio)}
              </span>
            </div>
          ))}

          {/* Bars */}
          <div className="absolute inset-0 pl-7 flex items-end gap-[3px] overflow-x-auto">
            {daily.map((d) => (
              <div
                key={d.date}
                className="flex-1 min-w-[14px] h-full flex items-end justify-center gap-[2px]"
                title={`${formatDay(d.date)} — ${d.exported} exported, ${d.posted} posted, ${d.failed} failed`}
              >
                <div className="w-1.5 sm:w-2 rounded-sm bg-zinc-400 hover:bg-zinc-300 transition-colors" style={barHeight(d.exported)} />
                <div className="w-1.5 sm:w-2 rounded-sm bg-emerald-500 hover:bg-emerald-400 transition-colors" style={barHeight(d.posted)} />
                <div className="w-1.5 sm:w-2 rounded-sm bg-red-500 hover:bg-red-400 transition-colors" style={barHeight(d.failed)} />
              </div>
            ))}
          </div>
        </div>

        {/* X-axis labels (sparse) */}
        <div className="pl-7 flex gap-[3px] overflow-x-auto">
          {daily.map((d, i) => (
            <div key={d.date} className="flex-1 min-w-[14px] text-center text-[8px] text-zinc-600 font-mono truncate">
              {i % labelEvery === 0 ? formatDay(d.date) : ""}
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Recent activity feed event presentation
  const renderEventRow = (e: CampaignStats["recentEvents"][number]) => {
    let icon = <Upload size={13} className="text-zinc-400 flex-shrink-0" />;
    let text = "Export to Drive folder";

    if (e.type === "post_success") {
      icon = <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0" />;
      text = e.meta.accountUsername ? `Posted to @${e.meta.accountUsername}` : "Post published";
    } else if (e.type === "post_failed") {
      icon = <AlertCircle size={13} className="text-red-500 flex-shrink-0" />;
      text = `Post failed${e.meta.accountUsername ? ` for @${e.meta.accountUsername}` : ""}${
        e.meta.failureReason ? ` — ${e.meta.failureReason}` : ""
      }`;
    } else if (e.meta.driveFileName) {
      text = `Export to Drive folder — ${e.meta.driveFileName}`;
    }

    return (
      <div
        key={e.id}
        className="flex items-center justify-between gap-3 bg-zinc-950/40 border border-[#27272a] rounded px-2.5 py-1.5"
      >
        <div className="flex items-center gap-2 min-w-0">
          {icon}
          <p className="text-[11px] text-zinc-300 truncate" title={text}>
            {text}
            {e.count > 1 && <span className="text-zinc-500 font-mono"> ×{e.count}</span>}
          </p>
          {e.type === "post_success" && e.meta.tiktokPostUrl && (
            <a
              href={e.meta.tiktokPostUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-blue-400 hover:text-blue-300 font-semibold flex-shrink-0 hover:underline"
            >
              View
            </a>
          )}
        </div>
        <span className="text-[9px] text-zinc-600 font-mono flex-shrink-0">{timeAgo(e.createdAt)}</span>
      </div>
    );
  };

  // Lifetime stat cards (header row) — fed by the stats endpoint totals
  const renderLifetimeStats = () => {
    const card = (label: string, value: React.ReactNode, valueClass: string) => (
      <div key={label} className="bg-[#18181b]/10 border border-[#27272a] rounded p-3 space-y-1 text-center">
        <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider block">{label}</span>
        {statsLoading && !stats ? (
          <span className="block h-5 w-14 mx-auto bg-zinc-800 rounded animate-pulse" />
        ) : (
          <span className={`text-base font-bold font-mono ${valueClass}`}>{value}</span>
        )}
      </div>
    );

    const postAttempts = stats ? stats.totals.posted + stats.totals.failed : 0;
    const rate = stats?.totals.postSuccessRate ?? 0;
    const rateClass =
      postAttempts === 0
        ? "text-zinc-500"
        : rate >= 90
        ? "text-emerald-400"
        : rate >= 70
        ? "text-amber-400"
        : "text-red-400";

    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {card("Videos Exported", stats ? stats.totals.exported.toLocaleString() : "—", "text-zinc-100")}
        {card("Posts Successful", stats ? stats.totals.posted.toLocaleString() : "—", "text-emerald-400")}
        {card(
          "Posts Failed",
          stats ? stats.totals.failed.toLocaleString() : "—",
          stats && stats.totals.failed > 0 ? "text-red-400" : "text-zinc-500"
        )}
        {card(
          "Post Success Rate",
          !stats ? "—" : postAttempts === 0 ? "—" : `${formatRate(rate)}%`,
          rateClass
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 text-zinc-100 bg-[#09090b]">
      {/* Workspace Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-[#27272a] pb-5 gap-4">
        <div className="space-y-2">
          <Link
            href="/admin/campaigns"
            className="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-100 transition text-[11px]"
          >
            <ArrowLeft size={12} />
            Back to campaigns
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight">{campaign.title || campaign.name}</h1>
            <span className="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-0.5 bg-zinc-900 border border-[#27272a] rounded text-zinc-300">
              {type === "political" ? "Political" : type === "music" ? "Music" : "General"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Status Select */}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as CampaignStatus)}
            className="bg-[#09090b] border border-[#27272a] rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-zinc-500"
          >
            <option value="ACTIVE">Active</option>
            <option value="PAUSED">Paused</option>
            <option value="DONE">Done</option>
            <option value="DRAFT">Draft</option>
          </select>

          {/* Delete Button */}
          <button
            onClick={handleDeleteCampaign}
            disabled={isDeleting}
            className="flex items-center justify-center p-2 bg-red-950/20 text-red-400 hover:bg-red-950/40 border border-red-900/30 rounded transition text-xs"
            title="Delete Campaign"
          >
            {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          </button>
        </div>
      </div>

      {/* Lifetime Header Stats */}
      {renderLifetimeStats()}

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Columns (Workspace and Projections) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Calculator Section */}
          <div className="border border-[#27272a] rounded-md bg-[#09090b] p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#27272a] pb-3">
              <h3 className="text-sm font-semibold text-zinc-200">View-Goal Calculator</h3>
              <button
                onClick={handleSaveSettings}
                disabled={isSavingMeta}
                className="flex items-center gap-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-950 text-[11px] font-semibold px-2.5 py-1 rounded transition disabled:opacity-50"
              >
                {isSavingMeta ? (
                  <>
                    <Loader2 size={11} className="animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save size={11} />
                    Save Config
                  </>
                )}
              </button>
            </div>

            {/* Calculator Inputs Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div className="space-y-1.5">
                <label className="text-zinc-400 font-medium">Target Total Views</label>
                <input
                  type="number"
                  min={1}
                  value={targetViews}
                  onChange={(e) => setTargetViews(Number(e.target.value))}
                  className="w-full bg-[#09090b] border border-[#27272a] rounded px-3 py-1.5 text-zinc-100 font-mono focus:border-zinc-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-zinc-400 font-medium">Active Accounts</label>
                <input
                  type="number"
                  min={1}
                  value={accountsCount}
                  onChange={(e) => setAccountsCount(Number(e.target.value))}
                  className="w-full bg-[#09090b] border border-[#27272a] rounded px-3 py-1.5 text-zinc-100 font-mono focus:border-zinc-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-zinc-400 font-medium">Avg Views / Video</label>
                <input
                  type="number"
                  min={1}
                  value={avgViewsPerVideo}
                  onChange={(e) => setAvgViewsPerVideo(Number(e.target.value))}
                  className="w-full bg-[#09090b] border border-[#27272a] rounded px-3 py-1.5 text-zinc-100 font-mono focus:border-zinc-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-zinc-400 font-medium">Videos / Account / Day</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={videosPerAccountPerDay}
                  onChange={(e) => setVideosPerAccountPerDay(Number(e.target.value))}
                  className={`w-full bg-[#09090b] border rounded px-3 py-1.5 text-zinc-100 font-mono focus:outline-none ${
                    showHealthWarning ? "border-amber-500/50 focus:border-amber-500" : "border-[#27272a] focus:border-zinc-500"
                  }`}
                />
              </div>
            </div>

            {/* Account Health Warning */}
            {showHealthWarning && (
              <div className="flex items-start gap-2.5 bg-amber-500/5 border border-amber-500/20 text-amber-400 rounded p-3 text-xs">
                <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
                <div>
                  <span className="font-semibold">Account Health Shadowban Warning:</span> Exceeding 3 videos posted per account per day increases the risk of suspension and account throttling. Consider adding more active accounts to lower posting frequency.
                </div>
              </div>
            )}

            {/* Live Outputs Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t border-[#27272a] text-center">
              <div className="bg-[#18181b]/10 border border-[#27272a] rounded p-2.5 space-y-1.5">
                <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider block">Videos Needed</span>
                <span className="text-sm font-bold text-zinc-100 font-mono">{totalVideosNeeded.toLocaleString()}</span>
              </div>
              <div className="bg-[#18181b]/10 border border-[#27272a] rounded p-2.5 space-y-1.5">
                <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider block">Videos / Day</span>
                <span className="text-sm font-bold text-zinc-100 font-mono">{videosPerDay.toLocaleString()}</span>
              </div>
              <div className="bg-[#18181b]/10 border border-[#27272a] rounded p-2.5 space-y-1.5">
                <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider block">Views / Day</span>
                <span className="text-sm font-bold text-zinc-100 font-mono">
                  {viewsPerDay >= 1000000
                    ? `${(viewsPerDay / 1000000).toFixed(1)}M`
                    : viewsPerDay.toLocaleString()}
                </span>
              </div>
              <div className="bg-[#18181b]/10 border border-[#27272a] rounded p-2.5 space-y-1.5">
                <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider block">Days to Goal</span>
                <span className="text-sm font-bold text-emerald-400 font-mono">{daysToGoal.toLocaleString()} days</span>
              </div>
            </div>

            {/* Projection Chart */}
            {renderProjectionChart()}
          </div>

          {/* Auto-post Captions Section */}
          <div className="border border-[#27272a] rounded-md bg-[#09090b] p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#27272a] pb-3">
              <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                <FileEdit className="w-4 h-4 text-emerald-400" />
                Auto-post Captions
              </h3>
              <button
                onClick={handleSaveCaptions}
                disabled={isSavingCaptions}
                className="flex items-center gap-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-950 text-[11px] font-semibold px-2.5 py-1 rounded transition disabled:opacity-50"
              >
                {isSavingCaptions ? (
                  <>
                    <Loader2 size={11} className="animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save size={11} />
                    Save Captions
                  </>
                )}
              </button>
            </div>

            {/* Fixed Texts Pool */}
            <div className="space-y-2 text-xs">
              <label className="text-zinc-400 font-medium">Fixed Texts Pool</label>
              <p className="text-[11px] text-zinc-500 leading-normal">
                One of these is chosen at random for every auto-post from this campaign and placed at the beginning of the description.
              </p>
              <div className="space-y-2">
                {fixedTexts.map((text, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <textarea
                      value={text}
                      onChange={(e) => handleFixedTextChange(idx, e.target.value)}
                      rows={2}
                      placeholder={`Fixed text #${idx + 1} (e.g. Follow for daily uploads!)`}
                      className="flex-1 bg-[#09090b] border border-[#27272a] rounded px-3 py-1.5 text-zinc-100 focus:border-zinc-500 focus:outline-none resize-y placeholder-zinc-600"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveFixedText(idx)}
                      className="text-zinc-500 hover:text-red-400 transition p-1.5"
                      title="Remove this text"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={handleAddFixedText}
                className="flex items-center gap-1 text-[11px] font-semibold text-zinc-300 hover:text-zinc-100 bg-zinc-900 border border-[#27272a] hover:border-zinc-600 rounded px-2.5 py-1 transition"
              >
                <Plus size={11} />
                Add another text
              </button>
            </div>

            {/* Hashtag Pool */}
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-4 pt-3 border-t border-[#27272a] text-xs">
              <div className="space-y-1.5">
                <label className="text-zinc-400 font-medium">Hashtag Pool</label>
                <input
                  type="text"
                  value={descTags}
                  onChange={(e) => setDescTags(e.target.value)}
                  placeholder="#music,#viral,#fyp"
                  className="w-full bg-[#09090b] border border-[#27272a] rounded px-3 py-1.5 text-zinc-100 font-mono focus:border-zinc-500 focus:outline-none placeholder-zinc-600"
                />
                <p className="text-[11px] text-zinc-500 leading-normal">
                  Comma-separated. When set, this pool overrides the section hashtag pool; hashtags are appended at the bottom of the description. Leave empty to fall back to the section pool.
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-zinc-400 font-medium">Tags per Post</label>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={descTagCount}
                  onChange={(e) => setDescTagCount(Math.min(20, Math.max(0, Number(e.target.value))))}
                  className="w-full bg-[#09090b] border border-[#27272a] rounded px-3 py-1.5 text-zinc-100 font-mono focus:border-zinc-500 focus:outline-none"
                />
                <p className="text-[11px] text-zinc-500 leading-normal">Randomly picked per post (0-20).</p>
              </div>
            </div>
          </div>

          {/* Campaign Activity (range-filtered stats) */}
          <div className="border border-[#27272a] rounded-md bg-[#09090b] p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#27272a] pb-3">
              <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-[#E11D48]" />
                Campaign Activity
              </h3>

              {/* Range segmented control */}
              <div
                role="group"
                aria-label="Stats time range"
                className="flex bg-[#09090b] border border-[#27272a] rounded p-0.5 text-[10px] font-semibold text-zinc-400 self-start sm:self-auto"
              >
                {RANGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={statsRange === opt.value}
                    onClick={() => setStatsRange(opt.value)}
                    className={`px-2.5 py-1 rounded transition focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 ${
                      statsRange === opt.value ? "bg-[#E11D48] text-white" : "hover:text-zinc-200"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Error state */}
            {statsError && (
              <div className="flex items-start gap-2.5 bg-red-950/20 border border-red-900/30 text-red-400 rounded p-3 text-xs">
                <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
                <div>
                  <span className="font-semibold">Failed to load activity stats:</span> {statsError}
                </div>
              </div>
            )}

            {/* Loading skeleton (initial load) */}
            {statsLoading && !stats && !statsError && (
              <div className="space-y-3">
                <div className="h-3.5 w-56 bg-zinc-900 rounded animate-pulse" />
                <div className="h-40 bg-zinc-900/60 border border-[#27272a] rounded animate-pulse" />
                <div className="space-y-1.5">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-8 bg-zinc-900/60 border border-[#27272a] rounded animate-pulse" />
                  ))}
                </div>
              </div>
            )}

            {/* Stats content */}
            {stats && (
              <div className={`space-y-4 transition ${statsLoading ? "opacity-50 pointer-events-none" : ""}`}>
                {/* Range totals strip */}
                <p className="text-[11px] text-zinc-500">
                  In this range:{" "}
                  <span className="text-zinc-300 font-mono">{stats.rangeTotals.exported.toLocaleString()}</span> exported
                  <span className="text-zinc-700"> · </span>
                  <span className="text-emerald-400 font-mono">{stats.rangeTotals.posted.toLocaleString()}</span> posted
                  <span className="text-zinc-700"> · </span>
                  <span
                    className={`font-mono ${stats.rangeTotals.failed > 0 ? "text-red-400" : "text-zinc-500"}`}
                  >
                    {stats.rangeTotals.failed.toLocaleString()}
                  </span>{" "}
                  failed
                </p>

                {/* Daily activity chart */}
                {renderActivityChart()}

                {/* Recent activity feed */}
                <div className="space-y-2 pt-1">
                  <h4 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Recent Activity</h4>
                  <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
                    {stats.recentEvents.length > 0 ? (
                      stats.recentEvents.map(renderEventRow)
                    ) : (
                      <p className="text-[11px] text-zinc-500 italic text-center py-3">
                        No recent activity in this range.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Export Analytics & Live Tracker Section */}
          <div className="border border-[#27272a] rounded-md bg-[#09090b] p-5 space-y-5">
            <div className="flex items-center justify-between border-b border-[#27272a] pb-3">
              <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-purple-400" />
                Google Drive Export Analytics
              </h3>
              <span className="text-[10px] font-semibold text-zinc-400 bg-zinc-900 border border-[#27272a] px-2 py-0.5 rounded">
                Live Stats
              </span>
            </div>

            {/* Drive Export Progress Bar */}
            {totalVideosNeeded > 0 && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-400 font-medium">Export Goal Progress</span>
                  <span className="text-zinc-300 font-bold font-mono">
                    {exportAnalytics.totalExported.toLocaleString()} / {totalVideosNeeded.toLocaleString()} videos (
                    {Math.min(100, Math.round((exportAnalytics.totalExported / totalVideosNeeded) * 100))}%
                    )
                  </span>
                </div>
                <div className="w-full bg-[#18181b] rounded-full h-2 border border-[#27272a] overflow-hidden">
                  <div
                    className="bg-purple-600 h-2 rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, (exportAnalytics.totalExported / totalVideosNeeded) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Telemetry Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
              <div className="bg-[#18181b]/10 border border-[#27272a] rounded p-3 space-y-1">
                <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider block">Drive Exports</span>
                <span className="text-base font-bold text-purple-400 font-mono">
                  {exportAnalytics.totalExported.toLocaleString()}
                </span>
              </div>
              <div className="bg-[#18181b]/10 border border-[#27272a] rounded p-3 space-y-1">
                <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider block">Active Groups</span>
                <span className="text-base font-bold text-zinc-100 font-mono">
                  {exportAnalytics.groupsBreakdown.filter((g) => g.exportedCount > 0).length} /{" "}
                  {exportAnalytics.groupsBreakdown.length}
                </span>
              </div>
              <div className="bg-[#18181b]/10 border border-[#27272a] rounded p-3 space-y-1">
                <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider block">Export Velocity</span>
                <span className="text-base font-bold text-zinc-100 font-mono flex items-center justify-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                  {exportAnalytics.dailyExports.length > 0
                    ? (exportAnalytics.totalExported / exportAnalytics.dailyExports.length).toFixed(1)
                    : "0"}
                  <span className="text-[9px] text-zinc-500 lowercase font-normal">/day</span>
                </span>
              </div>
            </div>

            {/* Velocity Chart */}
            {renderExportVelocityChart()}

            {/* Group Contribution Breakdown */}
            <div className="space-y-2 pt-2">
              <h4 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Group Contribution Breakdown</h4>
              <div className="border border-[#27272a] rounded overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="bg-zinc-950/40 border-b border-[#27272a] text-zinc-500 text-[10px] uppercase font-bold">
                      <th className="px-3 py-2 font-semibold">Group Name</th>
                      <th className="px-3 py-2 font-semibold text-center">Status</th>
                      <th className="px-3 py-2 font-semibold text-right">Completed</th>
                      <th className="px-3 py-2 font-semibold text-right">Exported</th>
                      <th className="px-3 py-2 font-semibold text-right">Progress</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#27272a] text-zinc-300">
                    {exportAnalytics.groupsBreakdown.map((g) => {
                      const percent = g.totalOutputs > 0 ? Math.round((g.exportedCount / g.totalOutputs) * 100) : 0;
                      return (
                        <tr key={g.id} className="hover:bg-zinc-950/20">
                          <td className="px-3 py-2.5 font-medium truncate max-w-[150px]" title={g.name}>
                            {g.name}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span
                              className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                                g.status === "COMPLETED"
                                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                  : g.status === "RENDERING"
                                  ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                                  : "bg-zinc-800 text-zinc-400"
                              }`}
                            >
                              {g.status}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono">{g.totalOutputs}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-purple-400">{g.exportedCount}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-[10px] text-zinc-500">
                            {percent}%
                          </td>
                        </tr>
                      );
                    })}
                    {exportAnalytics.groupsBreakdown.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-4 text-center text-zinc-500 italic text-[11px]">
                          No multiplier groups created for this campaign yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Recent Exports Log */}
            <div className="space-y-2 pt-2">
              <h4 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Recent Google Drive Uploads</h4>
              <div className="space-y-2">
                {exportAnalytics.recentExports.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between bg-zinc-950/40 border border-[#27272a] rounded p-2.5 gap-2"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-xs text-zinc-100 font-medium truncate" title={item.video.driveFileName || ""}>
                        {item.video.driveFileName}
                      </p>
                      <p className="text-[10px] text-zinc-500">
                        Group: <span className="text-zinc-400">{item.video.group.name}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-3 justify-between sm:justify-end">
                      <a
                        href={`https://drive.google.com/drive/folders/${item.driveFolderId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 font-semibold bg-blue-500/10 px-2 py-0.5 rounded transition hover:bg-blue-500/20"
                        title={`Open connected folder for @${item.tiktokUsername}`}
                      >
                        <FolderOpen className="w-3 h-3" />
                        @{item.tiktokUsername} ({item.driveFolderName})
                      </a>
                      <span className="text-[9px] text-zinc-600 font-mono flex-shrink-0">
                        {new Date(item.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
                {exportAnalytics.recentExports.length === 0 && (
                  <p className="text-[11px] text-zinc-500 italic text-center py-2">
                    No videos have been exported to Google Drive yet.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Notion-style Info Content Editor */}
          <div className="border border-[#27272a] rounded-md bg-[#09090b] overflow-hidden flex flex-col min-h-[350px]">
            {/* Header controls */}
            <div className="flex items-center justify-between border-b border-[#27272a] px-4 py-3 bg-zinc-950">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold text-zinc-200">Campaign Notes & SOP</h3>
                {saveIndicator === "saving" && (
                  <span className="text-[10px] text-zinc-500 italic flex items-center gap-1">
                    <Loader2 size={10} className="animate-spin" /> Saving...
                  </span>
                )}
                {saveIndicator === "saved" && (
                  <span className="text-[10px] text-emerald-500 flex items-center gap-0.5">
                    <CheckCircle size={10} /> Saved
                  </span>
                )}
              </div>

              {/* View/Edit toggle */}
              <div className="flex bg-[#09090b] border border-[#27272a] rounded p-0.5 text-[10px] font-semibold text-zinc-400">
                <button
                  onClick={() => setEditorMode("write")}
                  className={`px-2 py-0.5 rounded transition ${editorMode === "write" ? "bg-zinc-800 text-zinc-100" : "hover:text-zinc-200"}`}
                >
                  Edit Markdown
                </button>
                <button
                  onClick={() => setEditorMode("preview")}
                  className={`px-2 py-0.5 rounded transition ${editorMode === "preview" ? "bg-zinc-800 text-zinc-100" : "hover:text-zinc-200"}`}
                >
                  Preview
                </button>
              </div>
            </div>

            {/* Editor Workspace */}
            <div className="flex-1 p-4 bg-[#09090b]">
              {editorMode === "write" ? (
                <textarea
                  value={infoContent}
                  onChange={(e) => handleInfoChange(e.target.value)}
                  placeholder="Dump files, styling guides, hashtags list, or details here using Markdown..."
                  className="w-full min-h-[280px] bg-transparent text-zinc-200 border-0 focus:ring-0 p-0 text-xs font-mono resize-none focus:outline-none placeholder-zinc-600"
                />
              ) : (
                <div className="prose prose-sm prose-invert max-w-none text-xs text-zinc-300 min-h-[280px] overflow-y-auto font-sans leading-relaxed whitespace-pre-wrap">
                  {infoContent.trim() ? (
                    infoContent
                  ) : (
                    <span className="text-zinc-600 italic">No notes created yet. Toggle to 'Edit Markdown' to add details.</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column (Resources & Integrations) */}
        <div className="space-y-6">
          {/* Resources Panel */}
          <div className="border border-[#27272a] rounded-md bg-[#09090b] p-4 space-y-4">
            <h3 className="text-xs font-semibold text-zinc-200 border-b border-[#27272a] pb-2">Campaign Resources</h3>

            {/* Resources List */}
            <div className="space-y-2 max-h-[220px] overflow-y-auto">
              {resources.map((r) => (
                <div key={r.id} className="flex items-center justify-between bg-zinc-950/40 border border-[#27272a] rounded p-2 text-xs group">
                  <div className="flex items-center gap-2 overflow-hidden">
                    {r.type === "file" ? (
                      <FileText size={13} className="text-blue-400 flex-shrink-0" />
                    ) : r.type === "reference" ? (
                      <Bookmark size={13} className="text-amber-400 flex-shrink-0" />
                    ) : (
                      <Link2 size={13} className="text-emerald-400 flex-shrink-0" />
                    )}
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-zinc-200 hover:text-zinc-100 truncate hover:underline"
                    >
                      {r.label}
                    </a>
                  </div>
                  <button
                    onClick={() => handleDeleteResource(r.id)}
                    className="text-zinc-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition p-1"
                    title="Delete resource"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              {resources.length === 0 && (
                <p className="text-[11px] text-zinc-500 italic text-center py-4">No resources linked.</p>
              )}
            </div>

            {/* Add Resource Form */}
            <form onSubmit={handleAddResource} className="pt-3 border-t border-[#27272a] space-y-2 text-[11px]">
              <div className="space-y-1">
                <input
                  type="text"
                  placeholder="Resource Label (e.g. Asset Folder)"
                  value={resLabel}
                  onChange={(e) => setResLabel(e.target.value)}
                  className="w-full bg-[#09090b] border border-[#27272a] rounded px-2.5 py-1 text-zinc-100 focus:outline-none focus:border-zinc-500"
                />
              </div>
              <div className="space-y-1">
                <input
                  type="text"
                  placeholder="Resource URL (e.g. https://drive.google.com/...)"
                  value={resUrl}
                  onChange={(e) => setResUrl(e.target.value)}
                  className="w-full bg-[#09090b] border border-[#27272a] rounded px-2.5 py-1 text-zinc-100 focus:outline-none focus:border-zinc-500 font-mono text-[10px]"
                />
              </div>
              <div className="flex gap-2">
                <select
                  value={resType}
                  onChange={(e) => setResType(e.target.value)}
                  className="flex-1 bg-[#09090b] border border-[#27272a] rounded px-2.5 py-1 text-zinc-300 focus:outline-none text-[11px]"
                >
                  <option value="link">Link</option>
                  <option value="file">File</option>
                  <option value="reference">Reference</option>
                </select>
                <button
                  type="submit"
                  disabled={isAddingResource}
                  className="bg-zinc-100 hover:bg-zinc-200 text-zinc-950 font-semibold px-3 py-1 rounded transition flex items-center gap-1 disabled:opacity-50"
                >
                  {isAddingResource ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                  Add
                </button>
              </div>
            </form>
          </div>

          {/* Clip Mixer Subfolders (Phase 4) */}
          <div className="border border-[#27272a] rounded-md bg-[#09090b] p-4 space-y-4">
            <h3 className="text-xs font-semibold text-zinc-300 border-b border-[#27272a] pb-2 flex items-center gap-1.5">
              <FolderClosed size={13} className="text-zinc-500" />
              Clip Mixer Subfolders (Phase 4)
            </h3>
            
            {/* Folders list */}
            <div className="space-y-2 max-h-[220px] overflow-y-auto">
              {loadingFolders ? (
                <div className="flex items-center justify-center py-4 text-xs text-zinc-500 gap-1.5">
                  <Loader2 size={12} className="animate-spin text-zinc-400" />
                  Loading folders...
                </div>
              ) : folders.length === 0 ? (
                <p className="text-[11px] text-zinc-500 italic text-center py-4">No folders associated with this campaign.</p>
              ) : (
                folders.map((folder) => (
                  <div key={folder.id} className="flex items-center justify-between bg-zinc-950/40 border border-[#27272a] rounded p-2 text-xs">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <FolderClosed size={13} className="text-purple-400 flex-shrink-0" />
                      <span className="font-medium text-zinc-200 truncate">{folder.name}</span>
                      <span className="text-[10px] text-zinc-500 font-mono">
                        ({folder.clips?.length || 0} clips)
                      </span>
                    </div>
                    <Link
                      href={`/admin/clip-mixer?campaignId=${campaign.id}&folderId=${folder.id}`}
                      className="text-[11px] text-purple-400 hover:text-purple-300 font-semibold hover:underline flex-shrink-0 ml-2"
                    >
                      Open Mixer
                    </Link>
                  </div>
                ))
              )}
            </div>

            {/* Folder creation form */}
            <form onSubmit={handleCreateFolder} className="pt-3 border-t border-[#27272a] space-y-2 text-[11px]">
              <div className="space-y-1">
                <input
                  type="text"
                  placeholder="New Folder Name (e.g. Hooks, Slices)"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  className="w-full bg-[#09090b] border border-[#27272a] rounded px-2.5 py-1 text-zinc-100 focus:outline-none focus:border-zinc-500"
                />
              </div>
              <div className="flex gap-2">
                <select
                  value={selectedSectionId}
                  onChange={(e) => setSelectedSectionId(e.target.value)}
                  className="flex-1 bg-[#09090b] border border-[#27272a] rounded px-2.5 py-1 text-zinc-300 focus:outline-none text-[11px]"
                >
                  <option value="" disabled>Select Account Section...</option>
                  {sections.map((sec) => (
                    <option key={sec.id} value={sec.id}>
                      {sec.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={isCreatingFolder}
                  className="bg-zinc-100 hover:bg-zinc-200 text-zinc-950 font-semibold px-3 py-1 rounded transition flex items-center gap-1 disabled:opacity-50"
                >
                  {isCreatingFolder ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                  Create
                </button>
              </div>
            </form>
          </div>

          <div className="border border-[#27272a] rounded-md bg-[#09090b] p-4 space-y-4">
            <h3 className="text-xs font-semibold text-zinc-300 border-b border-[#27272a] pb-2 flex items-center gap-1.5">
              <CheckSquare size={13} className="text-zinc-500" />
              Project Management (Phase 7)
            </h3>
            <div className="bg-zinc-950/40 border border-[#27272a] rounded p-3 text-[11px] text-zinc-400 leading-normal">
              Curator pipelines, editorial comments, @mention Telegram communication, and task checkpoints will sync here in Phase 7.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
