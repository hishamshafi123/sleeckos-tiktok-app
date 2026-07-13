"use client";

import React, { useState, useEffect } from "react";
import {
  TrendingUp,
  User,
  FolderOpen,
  Calendar,
  AlertTriangle,
  Award,
  Loader2,
  RefreshCw,
  Clock
} from "lucide-react";
import { toast } from "sonner";

interface ClientPageProps {
  currentUserId: string;
  userRole: string; // "admin" | "team_lead" | "editor" | "curator"
  orgTimezone: string;
}

export default function KpiClientPage({ currentUserId, userRole, orgTimezone }: ClientPageProps) {
  const isAdminOrLead = userRole === "admin" || userRole === "team_lead";

  const [range, setRange] = useState<"day" | "week" | "month" | "all">("week");
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>(
    isAdminOrLead ? "" : currentUserId
  );

  const [loading, setLoading] = useState(true);
  const [kpiData, setKpiData] = useState<any>(null);

  const [folders, setFolders] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);

  // Fetch initial filters list
  useEffect(() => {
    const fetchFilters = async () => {
      try {
        // Load folders
        const folderRes = await fetch("/api/managed/vault/folders");
        if (folderRes.ok) {
          const folderData = await folderRes.json();
          // Filter folders that are children/subfolders of "Acc Generators" parent
          const accGenFolder = folderData.find(
            (f: any) => f.name === "Acc Generators" && f.parentFolderId === null
          );
          if (accGenFolder) {
            // Find all descendants of "Acc Generators"
            const sub = folderData.filter(
              (f: any) => f.parentFolderId === accGenFolder.id || f.id === accGenFolder.id
            );
            setFolders(sub);
          } else {
            setFolders(folderData);
          }
        }

        // Load employees
        if (isAdminOrLead) {
          const userRes = await fetch("/api/managed/vault/users");
          if (userRes.ok) {
            const userData = await userRes.json();
            setEmployees(userData || []);
          }
        }
      } catch (err) {
        console.error("Failed to load filters:", err);
      }
    };
    fetchFilters();
  }, [isAdminOrLead]);

  // Fetch KPI data on filter change
  const fetchKpiData = async () => {
    setLoading(true);
    try {
      let url = `/api/managed/vault/kpi?range=${range}`;
      if (selectedFolderId) url += `&folderId=${selectedFolderId}`;
      if (selectedEmployeeId) url += `&employeeId=${selectedEmployeeId}`;

      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch KPI summary");
      setKpiData(data);
    } catch (err: any) {
      toast.error(err.message || "Failed to load performance metrics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKpiData();
  }, [range, selectedFolderId, selectedEmployeeId]);

  // Helper to draw a beautiful SVG Line/Area Chart for trends
  const renderTrendChart = (trend: Array<{ date: string; successes: number; fails: number }>) => {
    if (!trend || trend.length === 0) {
      return (
        <div className="h-64 flex items-center justify-center text-zinc-500 italic text-xs">
          No trend data recorded.
        </div>
      );
    }

    const maxVal = Math.max(...trend.map((d) => Math.max(d.successes, d.fails)), 2);
    const chartHeight = 160;
    const chartWidth = 520;
    const paddingLeft = 35;
    const paddingRight = 15;
    const paddingTop = 15;
    const paddingBottom = 25;

    const graphWidth = chartWidth - paddingLeft - paddingRight;
    const graphHeight = chartHeight - paddingTop - paddingBottom;

    // Generate path points
    const successPoints = trend.map((d, idx) => {
      const x = paddingLeft + (idx / Math.max(trend.length - 1, 1)) * graphWidth;
      const y = paddingTop + graphHeight - (d.successes / maxVal) * graphHeight;
      return `${x},${y}`;
    });

    const failPoints = trend.map((d, idx) => {
      const x = paddingLeft + (idx / Math.max(trend.length - 1, 1)) * graphWidth;
      const y = paddingTop + graphHeight - (d.fails / maxVal) * graphHeight;
      return `${x},${y}`;
    });

    const successPath = successPoints.length > 0 ? `M ${successPoints.join(" L ")}` : "";
    const failPath = failPoints.length > 0 ? `M ${failPoints.join(" L ")}` : "";

    // Area closed path for gradient fill
    const successAreaPath =
      successPoints.length > 0
        ? `${successPath} L ${paddingLeft + graphWidth},${paddingTop + graphHeight} L ${paddingLeft},${paddingTop + graphHeight} Z`
        : "";

    return (
      <div className="relative w-full overflow-hidden bg-zinc-950/20 rounded-xl p-4 border border-zinc-900">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-xs font-bold text-zinc-200">Daily Accounts Generated Trend</span>
          </div>
          <div className="flex items-center gap-3 text-[10px] font-semibold">
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded bg-emerald-500" />
              <span className="text-zinc-400">Successes</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded bg-red-500" />
              <span className="text-zinc-400">Failures</span>
            </div>
          </div>
        </div>

        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-auto overflow-visible">
          <defs>
            <linearGradient id="successGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((r, idx) => {
            const y = paddingTop + r * graphHeight;
            const val = Math.round(maxVal * (1 - r));
            return (
              <g key={idx} className="opacity-40">
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={paddingLeft + graphWidth}
                  y2={y}
                  stroke="#27272a"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                />
                <text
                  x={paddingLeft - 8}
                  y={y + 3}
                  fill="#71717a"
                  fontSize="8"
                  fontWeight="bold"
                  textAnchor="end"
                >
                  {val}
                </text>
              </g>
            );
          })}

          {/* Zoned Area Graph Success */}
          {successAreaPath && <path d={successAreaPath} fill="url(#successGrad)" />}

          {/* Line Path Success */}
          {successPath && (
            <path d={successPath} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" />
          )}

          {/* Line Path Fail */}
          {failPath && (
            <path d={failPath} fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3 3" />
          )}

          {/* Draw dots */}
          {trend.map((d, idx) => {
            const x = paddingLeft + (idx / Math.max(trend.length - 1, 1)) * graphWidth;
            const successY = paddingTop + graphHeight - (d.successes / maxVal) * graphHeight;
            const failY = paddingTop + graphHeight - (d.fails / maxVal) * graphHeight;

            return (
              <g key={idx}>
                {d.successes > 0 && (
                  <circle cx={x} cy={successY} r="3" fill="#10b981" className="cursor-pointer hover:r-4 transition-all" />
                )}
                {d.fails > 0 && (
                  <circle cx={x} cy={failY} r="2.5" fill="#ef4444" className="cursor-pointer" />
                )}
              </g>
            );
          })}

          {/* X axis labels */}
          {trend.map((d, idx) => {
            if (trend.length > 10 && idx % 2 !== 0) return null; // skip alternating dates for spacing
            const x = paddingLeft + (idx / Math.max(trend.length - 1, 1)) * graphWidth;
            // Format "YYYY-MM-DD" → "MM/DD"
            const parts = d.date.split("-");
            const label = parts.length === 3 ? `${parts[1]}/${parts[2]}` : d.date;

            return (
              <text
                key={idx}
                x={x}
                y={chartHeight - 8}
                fill="#71717a"
                fontSize="8"
                fontWeight="bold"
                textAnchor="middle"
              >
                {label}
              </text>
            );
          })}
        </svg>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-900 pb-5">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
            <Award className="w-7 h-7 text-purple-400" />
            Generator KPIs
          </h1>
          <p className="text-zinc-400 text-xs mt-1 flex items-center gap-1.5 font-semibold">
            <Clock className="w-3.5 h-3.5 text-zinc-500" />
            Reporting buckets zoned to organization timezone:{" "}
            <span className="text-purple-400 bg-purple-950/40 border border-purple-900/35 px-1.5 py-0.5 rounded font-bold">
              {orgTimezone} (IST)
            </span>
          </p>
        </div>
        <button
          onClick={fetchKpiData}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-850 rounded-xl text-xs font-bold text-zinc-300 hover:text-white transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Filter Controls Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-zinc-950/40 p-4 border border-zinc-900 rounded-2xl">
        {/* Zoned time period */}
        <div>
          <label className="block text-[9px] uppercase font-bold text-zinc-500 mb-1 flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            Time Period
          </label>
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as any)}
            className="w-full bg-[#111] border border-zinc-800 rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 focus:outline-none"
          >
            <option value="day">Today (IST)</option>
            <option value="week">This Week (Mon-Sun)</option>
            <option value="month">This Month</option>
            <option value="all">All-time</option>
          </select>
        </div>

        {/* Generator Folder */}
        <div>
          <label className="block text-[9px] uppercase font-bold text-zinc-500 mb-1 flex items-center gap-1">
            <FolderOpen className="w-3 h-3" />
            Generator Folder
          </label>
          <select
            value={selectedFolderId}
            onChange={(e) => setSelectedFolderId(e.target.value)}
            className="w-full bg-[#111] border border-zinc-800 rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 focus:outline-none"
          >
            <option value="">-- All Subfolders --</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>

        {/* Employee attribution filter */}
        {isAdminOrLead && (
          <div>
            <label className="block text-[9px] uppercase font-bold text-zinc-500 mb-1 flex items-center gap-1">
              <User className="w-3 h-3" />
              Attributed Employee
            </label>
            <select
              value={selectedEmployeeId}
              onChange={(e) => setSelectedEmployeeId(e.target.value)}
              className="w-full bg-[#111] border border-zinc-800 rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 focus:outline-none"
            >
              <option value="">-- All Employees --</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name || "Unknown"} ({e.email})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Main KPI Dashboard View Grid */}
      {loading && !kpiData ? (
        <div className="py-20 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
          <p className="text-zinc-500 text-xs italic">Loading KPI statistics...</p>
        </div>
      ) : kpiData ? (
        <div className="space-y-6">
          {/* KPI Summary Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Today successes */}
            <div className="border border-zinc-900 hover:border-zinc-850 rounded-2xl p-5 bg-gradient-to-br from-zinc-950/20 to-zinc-950/60 shadow-xl transition-all relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-2xl group-hover:bg-emerald-500/10 transition-all" />
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Today Successes</p>
              <p className="text-3xl font-extrabold text-white mt-2 tracking-tight">
                {kpiData.summary?.successesToday || 0}
              </p>
              <span className="text-[9px] text-emerald-400 bg-emerald-950/40 border border-emerald-900/30 px-1.5 py-0.5 rounded font-bold inline-block mt-3">
                Today (Zoned)
              </span>
            </div>

            {/* This week successes */}
            <div className="border border-zinc-900 hover:border-zinc-850 rounded-2xl p-5 bg-gradient-to-br from-zinc-950/20 to-zinc-950/60 shadow-xl transition-all relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/5 rounded-full blur-2xl group-hover:bg-purple-500/10 transition-all" />
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">This Week Successes</p>
              <p className="text-3xl font-extrabold text-white mt-2 tracking-tight">
                {kpiData.summary?.successesWeek || 0}
              </p>
              <span className="text-[9px] text-purple-400 bg-purple-950/40 border border-purple-900/30 px-1.5 py-0.5 rounded font-bold inline-block mt-3">
                Mon - Sun
              </span>
            </div>

            {/* Total Range Successes */}
            <div className="border border-zinc-900 hover:border-zinc-850 rounded-2xl p-5 bg-gradient-to-br from-zinc-950/20 to-zinc-950/60 shadow-xl transition-all relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-full blur-2xl group-hover:bg-blue-500/10 transition-all" />
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Range Total Successes</p>
              <p className="text-3xl font-extrabold text-white mt-2 tracking-tight">
                {kpiData.summary?.totalSuccesses || 0}
              </p>
              <span className="text-[9px] text-blue-400 bg-blue-950/40 border border-blue-900/30 px-1.5 py-0.5 rounded font-bold inline-block mt-3">
                Filtered Range
              </span>
            </div>

            {/* Fail Rate card */}
            <div className="border border-zinc-900 hover:border-zinc-850 rounded-2xl p-5 bg-gradient-to-br from-zinc-950/20 to-zinc-950/60 shadow-xl transition-all relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-24 h-24 bg-red-500/5 rounded-full blur-2xl group-hover:bg-red-500/10 transition-all" />
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Generation Fail Rate</p>
              <p className="text-3xl font-extrabold text-white mt-2 tracking-tight">
                {kpiData.summary?.failRate !== undefined ? `${kpiData.summary.failRate.toFixed(1)}%` : "0.0%"}
              </p>
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold inline-block mt-3 border ${
                (kpiData.summary?.failRate || 0) > 30
                  ? "text-red-400 bg-red-950/40 border-red-900/30"
                  : "text-zinc-400 bg-zinc-900/40 border-zinc-800"
              }`}>
                {(kpiData.summary?.failRate || 0) > 30 ? "Attention Required" : "Stable Rate"}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Trend Area chart */}
            <div className="lg:col-span-2 space-y-4">
              {renderTrendChart(kpiData.summary?.trend)}
            </div>

            {/* Leaderboard side panel */}
            <div className="border border-zinc-900 bg-zinc-950/40 backdrop-blur-md rounded-2xl p-5 space-y-4 shadow-2xl flex flex-col max-h-[350px]">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <Award className="w-4 h-4 text-amber-500 animate-pulse" />
                  Employee Leaderboard
                </h3>
                <p className="text-zinc-500 text-[10px] font-semibold mt-0.5">Zoned successes in active period</p>
              </div>

              <div className="flex-1 overflow-y-auto pr-1 space-y-2">
                {kpiData.leaderboard?.length === 0 ? (
                  <p className="text-zinc-650 text-xs italic text-center py-6">No account generation success yet.</p>
                ) : (
                  kpiData.leaderboard
                    ?.filter((entry: any) => entry.successes > 0 || isAdminOrLead)
                    .map((entry: any, index: number) => {
                      const isSelf = entry.userId === currentUserId;
                      return (
                        <div
                          key={entry.userId}
                          className={`flex items-center justify-between p-2.5 rounded-xl border transition-all ${
                            isSelf
                              ? "bg-purple-950/20 border-purple-500/25"
                              : "bg-zinc-950/60 border-zinc-900/60 hover:border-zinc-850"
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold flex-shrink-0 ${
                              index === 0
                                ? "bg-amber-500/15 text-amber-400 border border-amber-500/20"
                                : index === 1
                                ? "bg-zinc-400/15 text-zinc-300 border border-zinc-400/20"
                                : index === 2
                                ? "bg-amber-700/15 text-amber-600 border border-amber-700/20"
                                : "bg-zinc-900 text-zinc-500"
                            }`}>
                              {index + 1}
                            </div>
                            <div className="min-w-0">
                              <p className={`text-xs font-bold truncate ${isSelf ? "text-purple-300" : "text-white"}`}>
                                {entry.name}
                              </p>
                              <p className="text-[9px] text-zinc-500 truncate">{entry.email}</p>
                            </div>
                          </div>

                          <div className="text-right flex-shrink-0">
                            <span className="text-xs font-extrabold text-white">{entry.successes}</span>
                            <span className="text-[9px] text-zinc-500 block leading-tight">Successes</span>
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="py-20 text-center border border-dashed border-zinc-900 rounded-2xl bg-zinc-950/10">
          <AlertTriangle className="w-8 h-8 text-zinc-500 mx-auto mb-2" />
          <p className="text-zinc-400 text-xs font-bold">No performance records found.</p>
          <p className="text-[10px] text-zinc-500 mt-1">Make sure column KPI tracking settings are enabled.</p>
        </div>
      )}
    </div>
  );
}
