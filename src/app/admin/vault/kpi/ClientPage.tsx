"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  TrendingUp,
  User,
  FolderOpen,
  Calendar,
  AlertTriangle,
  Award,
  Loader2,
  RefreshCw,
  Clock,
  CheckCircle,
  FileText,
  Layers,
  Settings,
  Plus,
  Trash,
  Download,
  AlertCircle,
  ShieldCheck,
  UserPlus
} from "lucide-react";
import { toast } from "sonner";

interface ClientPageProps {
  currentUserId: string;
  userRole: string; // "admin" | "team_lead" | "editor" | "curator" | "user"
  orgTimezone: string;
}

export default function KpiClientPage({ currentUserId, userRole, orgTimezone }: ClientPageProps) {
  const isManager = userRole === "admin" || userRole === "team_lead";

  const [activeTab, setActiveTab] = useState<"self" | "manager">("self");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Self View States
  const [selfKpi, setSelfKpi] = useState<any[]>([]);
  const [warmupChecklist, setWarmupChecklist] = useState<any[]>([]);
  
  // Manual Log Form States
  const [schedulerLogs, setSchedulerLogs] = useState({
    postsDone: 0,
    accountsPostedTo: 0
  });
  const [editorLogs, setEditorLogs] = useState<Array<{ campaignId: string; count: number }>>([
    { campaignId: "", count: 0 }
  ]);
  const [submittingLogs, setSubmittingLogs] = useState(false);

  // Manager View States
  const [managerKpi, setManagerKpi] = useState<any>(null);
  const [pipelineHealth, setPipelineHealth] = useState<any>(null);
  const [filterFunction, setFilterFunction] = useState<string>("");
  const [filterCampaign, setFilterCampaign] = useState<string>("");
  const [filterRange, setFilterRange] = useState<string>("week");

  // KPI Settings Management States
  const [usersList, setUsersList] = useState<any[]>([]);
  const [campaignsList, setCampaignsList] = useState<any[]>([]);
  const [assignmentsList, setAssignmentsList] = useState<any[]>([]);
  const [goalsList, setGoalsList] = useState<any[]>([]);

  const [newAssignment, setNewAssignment] = useState({
    userId: "",
    functionType: "generator",
    startDate: new Date().toISOString().split("T")[0],
    endDate: ""
  });

  const [newGoal, setNewGoal] = useState({
    userId: "",
    functionType: "generator",
    period: "day",
    target: 10,
    startDate: new Date().toISOString().split("T")[0],
    endDate: ""
  });

  // Cross-checking Actual Posts vs Manual Scheduler Posts State
  const [crossChecks, setCrossChecks] = useState<any[]>([]);

  // Load initial resources
  const loadMetaData = useCallback(async () => {
    try {
      const [usersRes, campaignsRes] = await Promise.all([
        fetch("/api/managed/vault/users"),
        fetch("/api/campaigns")
      ]);
      if (usersRes.ok) {
        const users = await usersRes.json();
        setUsersList(users || []);
      }
      if (campaignsRes.ok) {
        const campaigns = await campaignsRes.json();
        setCampaignsList(campaigns || []);
      }
    } catch (err) {
      console.warn("Failed to fetch initial dropdowns metadata:", err);
    }
  }, []);

  // Fetch data for employees (Self View)
  const fetchSelfData = async () => {
    setLoading(true);
    try {
      const [kpiRes, checklistRes] = await Promise.all([
        fetch("/api/managed/kpi/activity?mode=self"),
        fetch("/api/managed/kpi/warmup/checklist")
      ]);
      if (kpiRes.ok) {
        setSelfKpi(await kpiRes.json());
      }
      if (checklistRes.ok) {
        setWarmupChecklist(await checklistRes.json());
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to load performance checklist");
    } finally {
      setLoading(false);
    }
  };

  // Fetch data for managers
  const fetchManagerData = async () => {
    setLoading(true);
    try {
      let url = `/api/managed/kpi/activity?mode=manager&range=${filterRange}`;
      if (filterFunction) url += `&functionType=${filterFunction}`;
      if (filterCampaign) url += `&campaignId=${filterCampaign}`;

      const [activityRes, pipelineRes, assignmentsRes, goalsRes] = await Promise.all([
        fetch(url),
        fetch("/api/managed/kpi/warmup/pipeline"),
        fetch("/api/managed/kpi/assignments"),
        fetch("/api/managed/kpi/goals")
      ]);

      if (activityRes.ok) {
        setManagerKpi(await activityRes.json());
      }
      if (pipelineRes.ok) {
        setPipelineHealth(await pipelineRes.json());
      }
      if (assignmentsRes.ok) {
        setAssignmentsList(await assignmentsRes.json());
      }
      if (goalsRes.ok) {
        setGoalsList(await goalsRes.json());
      }

      // Load post cross-check if Scheduler function is selected
      if (filterFunction === "scheduler" || !filterFunction) {
        const checkRes = await fetch("/api/managed/queue"); // Fetch actual scheduled posts list
        if (checkRes.ok) {
          const posts = await checkRes.json();
          // Group actual posts by user and compile counts for comparison
          const actualCounts: Record<string, number> = {};
          posts.forEach((p: any) => {
            if (p.status === "POSTED" || p.status === "SUCCESS") {
              const uId = p.createdBy || "unknown";
              actualCounts[uId] = (actualCounts[uId] || 0) + 1;
            }
          });
          setCrossChecks(Object.entries(actualCounts).map(([uId, c]) => ({ userId: uId, actualCount: c })));
        }
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to load manager performance data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMetaData();
  }, [loadMetaData]);

  useEffect(() => {
    if (activeTab === "self") {
      fetchSelfData();
    } else if (activeTab === "manager" && isManager) {
      fetchManagerData();
    }
  }, [activeTab, filterRange, filterFunction, filterCampaign]);

  const handleRefresh = async () => {
    setRefreshing(true);
    if (activeTab === "self") {
      await fetchSelfData();
    } else {
      await fetchManagerData();
    }
    setRefreshing(false);
  };

  // Check off checklist item
  const handleCheckoffWarmup = async (enrollmentId: string) => {
    try {
      const res = await fetch("/api/managed/kpi/warmup/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enrollmentId })
      });
      if (!res.ok) throw new Error("Failed to complete checklist task");
      toast.success("Warm-up checklist task completed!");
      fetchSelfData();
    } catch (err: any) {
      toast.error(err.message || "Failed to checkoff task");
    }
  };

  // Submit Scheduler Manual Logs
  const handleSubmitScheduler = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingLogs(true);
    try {
      const res = await fetch("/api/managed/kpi/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          functionType: "scheduler",
          count: schedulerLogs.postsDone,
          meta: {
            accountsPostedTo: schedulerLogs.accountsPostedTo
          }
        })
      });
      if (!res.ok) throw new Error("Failed to submit scheduler logs");
      toast.success("Scheduler logs saved successfully");
      setSchedulerLogs({ postsDone: 0, accountsPostedTo: 0 });
      fetchSelfData();
    } catch (err: any) {
      toast.error(err.message || "Submission failed");
    } finally {
      setSubmittingLogs(false);
    }
  };

  // Submit Editor Manual Logs
  const handleSubmitEditor = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = editorLogs
      .filter((item) => item.campaignId && item.count > 0)
      .map((item) => ({
        functionType: "editor",
        count: item.count,
        campaignId: item.campaignId
      }));

    if (payload.length === 0) {
      toast.error("Add at least one valid video count & campaign");
      return;
    }

    setSubmittingLogs(true);
    try {
      const res = await fetch("/api/managed/kpi/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error("Failed to submit editor logs");
      toast.success("Editor campaign logs saved successfully");
      setEditorLogs([{ campaignId: "", count: 0 }]);
      fetchSelfData();
    } catch (err: any) {
      toast.error(err.message || "Editor submission failed");
    } finally {
      setSubmittingLogs(false);
    }
  };

  // Assign job function
  const handleAssignFunction = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/managed/kpi/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newAssignment)
      });
      if (!res.ok) throw new Error("Failed to assign function");
      toast.success("Job function assigned successfully");
      setNewAssignment({
        userId: "",
        functionType: "generator",
        startDate: new Date().toISOString().split("T")[0],
        endDate: ""
      });
      fetchManagerData();
    } catch (err: any) {
      toast.error(err.message || "Failed to assign function");
    }
  };

  // Set KPI goal target
  const handleSetGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/managed/kpi/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newGoal)
      });
      if (!res.ok) throw new Error("Failed to set target goal");
      toast.success("Goal target updated successfully");
      setNewGoal({
        userId: "",
        functionType: "generator",
        period: "day",
        target: 10,
        startDate: new Date().toISOString().split("T")[0],
        endDate: ""
      });
      fetchManagerData();
    } catch (err: any) {
      toast.error(err.message || "Failed to set goal");
    }
  };

  // Export report CSV
  const handleExportCsv = () => {
    let url = `/api/managed/kpi/activity?mode=manager&export=csv&range=${filterRange}`;
    if (filterFunction) url += `&functionType=${filterFunction}`;
    if (filterCampaign) url += `&campaignId=${filterCampaign}`;
    window.open(url);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-900 pb-5">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
            <Award className="w-7 h-7 text-purple-400" />
            Performance & KPI Hub
          </h1>
          <p className="text-zinc-400 text-xs mt-1 flex items-center gap-1.5 font-semibold">
            <Clock className="w-3.5 h-3.5 text-zinc-500" />
            Reporting buckets zoned to organization timezone:{" "}
            <span className="text-purple-400 bg-purple-950/40 border border-purple-900/35 px-1.5 py-0.5 rounded font-bold">
              {orgTimezone} (IST)
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isManager && (
            <div className="flex bg-zinc-950 p-1 rounded-xl border border-zinc-850">
              <button
                onClick={() => setActiveTab("self")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === "self" ? "bg-purple-600 text-white" : "text-zinc-400 hover:text-white"
                }`}
              >
                Self View
              </button>
              <button
                onClick={() => setActiveTab("manager")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === "manager" ? "bg-purple-600 text-white" : "text-zinc-400 hover:text-white"
                }`}
              >
                Manager Dashboard
              </button>
            </div>
          )}
          <button
            onClick={handleRefresh}
            disabled={loading || refreshing}
            className="flex items-center gap-1.5 px-3 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-850 rounded-xl text-xs font-bold text-zinc-300 hover:text-white transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-24 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
          <p className="text-zinc-500 text-xs italic">Syncing performance records...</p>
        </div>
      ) : activeTab === "self" ? (
        /* ==================== EMPLOYEE SELF VIEW ==================== */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Columns - Tasks Checklist & Forms */}
          <div className="lg:col-span-2 space-y-6">
            {/* Warmup Worklist Checklist */}
            <div className="border border-zinc-900 bg-zinc-950/20 rounded-2xl p-5 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-purple-400" />
                  Today's Warmup worklist Checklist
                </h3>
                <p className="text-zinc-500 text-[10px] font-semibold mt-0.5">
                  Complete checklists to maintain account health and log warm-up KPIs.
                </p>
              </div>

              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                {warmupChecklist.length === 0 ? (
                  <div className="py-10 text-center border border-dashed border-zinc-900 rounded-xl bg-zinc-950/40">
                    <ShieldCheck className="w-7 h-7 text-emerald-500 mx-auto mb-2 opacity-50" />
                    <p className="text-zinc-400 text-xs font-bold">All Warmup Tasks Completed!</p>
                    <p className="text-[10px] text-zinc-500 mt-0.5">Check back tomorrow for the next due list.</p>
                  </div>
                ) : (
                  warmupChecklist.map((task) => (
                    <div
                      key={task.enrollmentId}
                      className={`flex items-center justify-between p-3.5 rounded-xl border bg-zinc-950/40 transition-all ${
                        task.isOverdue ? "border-red-950 hover:border-red-900" : "border-zinc-900 hover:border-zinc-850"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          {task.tiktokAvatarUrl ? (
                            <img src={task.tiktokAvatarUrl} className="w-9 h-9 rounded-full object-cover" alt="" />
                          ) : (
                            <div className="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 font-bold text-xs">
                              {task.tiktokUsername.substring(0, 2).toUpperCase()}
                            </div>
                          )}
                          {task.isOverdue && (
                            <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-red-600 flex items-center justify-center text-[8px] font-extrabold text-white">
                              !
                            </span>
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-white">@{task.tiktokUsername}</span>
                            <span
                              className={`text-[8px] px-1 rounded font-bold uppercase tracking-wider ${
                                task.type === "initial" ? "bg-blue-950 text-blue-400" : "bg-purple-950 text-purple-400"
                              }`}
                            >
                              {task.type === "initial" ? `Initial Ramp (Day ${task.currentDay})` : "Maintenance"}
                            </span>
                          </div>
                          <p className="text-zinc-400 text-xs font-semibold mt-1">{task.taskInstructions}</p>
                          {task.isOverdue && (
                            <span className="text-[9px] text-red-500 font-bold mt-1 flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" /> Overdue
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={() => handleCheckoffWarmup(task.enrollmentId)}
                        className="px-3 py-1.5 bg-purple-650 hover:bg-purple-600 text-white rounded-lg text-[10px] font-extrabold transition-all"
                      >
                        Check Off
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Scheduler Manual Logger Form */}
            <div className="border border-zinc-900 bg-zinc-950/20 rounded-2xl p-5 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-400" />
                  Scheduler Manual Activity Log
                </h3>
                <p className="text-zinc-500 text-[10px] font-semibold mt-0.5">
                  Record daily posting logs. These can be cross-checked against actual Sleeckos post queues.
                </p>
              </div>

              <form onSubmit={handleSubmitScheduler} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                <div>
                  <label className="block text-[9px] uppercase font-bold text-zinc-500 mb-1">Posts Completed Today</label>
                  <input
                    type="number"
                    min="0"
                    value={schedulerLogs.postsDone}
                    onChange={(e) => setSchedulerLogs({ ...schedulerLogs, postsDone: parseInt(e.target.value) || 0 })}
                    className="w-full bg-[#111] border border-zinc-800 rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 focus:outline-none focus:border-blue-500/50"
                  />
                </div>
                <div>
                  <label className="block text-[9px] uppercase font-bold text-zinc-500 mb-1">Accounts Posted To</label>
                  <input
                    type="number"
                    min="0"
                    value={schedulerLogs.accountsPostedTo}
                    onChange={(e) =>
                      setSchedulerLogs({ ...schedulerLogs, accountsPostedTo: parseInt(e.target.value) || 0 })
                    }
                    className="w-full bg-[#111] border border-zinc-800 rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 focus:outline-none focus:border-blue-500/50"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submittingLogs}
                  className="bg-blue-650 hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg text-xs font-bold py-2 px-4 transition-all flex items-center justify-center gap-1.5 h-[34px]"
                >
                  {submittingLogs && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Submit Posts
                </button>
              </form>
            </div>

            {/* Editor Manual Logger Form */}
            <div className="border border-zinc-900 bg-zinc-950/20 rounded-2xl p-5 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Layers className="w-4 h-4 text-emerald-400" />
                  Editor Video logs (Split by Campaign)
                </h3>
                <p className="text-zinc-500 text-[10px] font-semibold mt-0.5">
                  Log videos edited today. Add multiple rows to attribute outputs to different active campaigns.
                </p>
              </div>

              <form onSubmit={handleSubmitEditor} className="space-y-3">
                {editorLogs.map((log, index) => (
                  <div key={index} className="flex gap-2 items-center">
                    <div className="flex-1">
                      <select
                        value={log.campaignId}
                        onChange={(e) => {
                          const updated = [...editorLogs];
                          updated[index].campaignId = e.target.value;
                          setEditorLogs(updated);
                        }}
                        className="w-full bg-[#111] border border-zinc-800 rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 focus:outline-none focus:border-emerald-500/50"
                      >
                        <option value="">-- Choose Campaign --</option>
                        {campaignsList.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.title}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="w-32">
                      <input
                        type="number"
                        min="1"
                        placeholder="Edited count"
                        value={log.count || ""}
                        onChange={(e) => {
                          const updated = [...editorLogs];
                          updated[index].count = parseInt(e.target.value) || 0;
                          setEditorLogs(updated);
                        }}
                        className="w-full bg-[#111] border border-zinc-800 rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 focus:outline-none focus:border-emerald-500/50"
                      />
                    </div>
                    {editorLogs.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setEditorLogs(editorLogs.filter((_, idx) => idx !== index))}
                        className="p-2 bg-zinc-950 border border-zinc-850 hover:bg-zinc-900 rounded-lg text-zinc-500 hover:text-red-400 transition-all"
                      >
                        <Trash className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => setEditorLogs([...editorLogs, { campaignId: "", count: 0 }])}
                    className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white font-bold"
                  >
                    <Plus className="w-3.5 h-3.5 text-emerald-500" /> Add Campaign Split
                  </button>
                  <button
                    type="submit"
                    disabled={submittingLogs}
                    className="bg-emerald-650 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-lg text-xs font-bold py-2 px-4 transition-all flex items-center justify-center gap-1.5"
                  >
                    {submittingLogs && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Save Editor Log
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Right Column - Targets Progress */}
          <div className="space-y-6">
            <div className="border border-zinc-900 bg-zinc-950/40 rounded-2xl p-5 space-y-4 shadow-xl">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-purple-400" />
                  Your Active Targets & Progress
                </h3>
                <p className="text-zinc-500 text-[10px] font-semibold mt-0.5">
                  Zoned progress tracking against set KPI targets.
                </p>
              </div>

              <div className="space-y-4">
                {selfKpi.length === 0 ? (
                  <p className="text-zinc-550 text-xs italic text-center py-6">
                    You have no active job function assignments or goals configured.
                  </p>
                ) : (
                  selfKpi.map((kpi) => (
                    <div key={kpi.functionType} className="space-y-2 border-b border-zinc-900 pb-3 last:border-0 last:pb-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white capitalize">{kpi.functionType}</span>
                        <span className="text-[10px] text-zinc-500 uppercase font-mono">IST Boundary</span>
                      </div>

                      {/* Day Progress */}
                      {kpi.day.target > 0 && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[10px] font-semibold">
                            <span className="text-zinc-400">Today</span>
                            <span className="text-white">
                              {kpi.day.done} / {kpi.day.target}
                            </span>
                          </div>
                          <div className="w-full bg-zinc-900 h-2 rounded-full overflow-hidden">
                            <div
                              className="bg-purple-650 h-full rounded-full transition-all"
                              style={{ width: `${Math.min((kpi.day.done / kpi.day.target) * 100, 100)}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Week Progress */}
                      {kpi.week.target > 0 && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[10px] font-semibold">
                            <span className="text-zinc-400">This Week</span>
                            <span className="text-white">
                              {kpi.week.done} / {kpi.week.target}
                            </span>
                          </div>
                          <div className="w-full bg-zinc-900 h-2 rounded-full overflow-hidden">
                            <div
                              className="bg-blue-650 h-full rounded-full transition-all"
                              style={{ width: `${Math.min((kpi.week.done / kpi.week.target) * 100, 100)}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Month Progress */}
                      {kpi.month.target > 0 && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[10px] font-semibold">
                            <span className="text-zinc-400">This Month</span>
                            <span className="text-white">
                              {kpi.month.done} / {kpi.month.target}
                            </span>
                          </div>
                          <div className="w-full bg-zinc-900 h-2 rounded-full overflow-hidden">
                            <div
                              className="bg-emerald-650 h-full rounded-full transition-all"
                              style={{ width: `${Math.min((kpi.month.done / kpi.month.target) * 100, 100)}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ==================== MANAGER DASHBOARD VIEW ==================== */
        <div className="space-y-6">
          {/* Pipeline Health Section */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="border border-zinc-900 rounded-2xl p-5 bg-gradient-to-br from-zinc-950/20 to-zinc-950/60 shadow-xl relative overflow-hidden group">
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Ramping Accounts</p>
              <p className="text-3xl font-extrabold text-white mt-2 tracking-tight">
                {pipelineHealth?.stageInitialCount || 0}
              </p>
              <span className="text-[9px] text-blue-400 bg-blue-950/40 border border-blue-900/30 px-1.5 py-0.5 rounded font-bold inline-block mt-3">
                Initial stage (1-6 days)
              </span>
            </div>

            <div className="border border-zinc-900 rounded-2xl p-5 bg-gradient-to-br from-zinc-950/20 to-zinc-950/60 shadow-xl relative overflow-hidden group">
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Maintenance Accounts</p>
              <p className="text-3xl font-extrabold text-white mt-2 tracking-tight">
                {pipelineHealth?.stageMaintenanceCount || 0}
              </p>
              <span className="text-[9px] text-purple-400 bg-purple-950/40 border border-purple-900/30 px-1.5 py-0.5 rounded font-bold inline-block mt-3">
                Recurring (2-3 days)
              </span>
            </div>

            <div className="border border-zinc-900 rounded-2xl p-5 bg-gradient-to-br from-zinc-950/20 to-zinc-950/60 shadow-xl relative overflow-hidden group">
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Overdue Warmup Tasks</p>
              <p className="text-3xl font-extrabold text-red-500 mt-2 tracking-tight">
                {pipelineHealth?.overdueCount || 0}
              </p>
              <span className="text-[9px] text-red-400 bg-red-950/40 border border-red-900/30 px-1.5 py-0.5 rounded font-bold inline-block mt-3">
                Needs attention
              </span>
            </div>

            <div className="border border-zinc-900 rounded-2xl p-5 bg-gradient-to-br from-zinc-950/20 to-zinc-950/60 shadow-xl relative overflow-hidden group">
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Warmer On-Time Rate</p>
              <p className="text-3xl font-extrabold text-emerald-400 mt-2 tracking-tight">
                {pipelineHealth?.onTimeRate !== undefined ? `${pipelineHealth.onTimeRate.toFixed(1)}%` : "100.0%"}
              </p>
              <span className="text-[9px] text-emerald-400 bg-emerald-950/40 border border-emerald-900/30 px-1.5 py-0.5 rounded font-bold inline-block mt-3">
                Checklist completion accuracy
              </span>
            </div>
          </div>

          {/* Filters card */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-zinc-950/40 p-4 border border-zinc-900 rounded-2xl">
            <div>
              <label className="block text-[9px] uppercase font-bold text-zinc-500 mb-1 flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                Time Period
              </label>
              <select
                value={filterRange}
                onChange={(e) => setFilterRange(e.target.value)}
                className="w-full bg-[#111] border border-zinc-800 rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 focus:outline-none"
              >
                <option value="day">Today (IST)</option>
                <option value="week">This Week (Mon-Sun)</option>
                <option value="month">This Month</option>
                <option value="all">All-time</option>
              </select>
            </div>

            <div>
              <label className="block text-[9px] uppercase font-bold text-zinc-500 mb-1 flex items-center gap-1">
                <Settings className="w-3 h-3" />
                Filter Job Function
              </label>
              <select
                value={filterFunction}
                onChange={(e) => setFilterFunction(e.target.value)}
                className="w-full bg-[#111] border border-zinc-800 rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 focus:outline-none"
              >
                <option value="">-- All Functions --</option>
                <option value="generator">Generator</option>
                <option value="warmup">Warm-up</option>
                <option value="scheduler">Scheduler</option>
                <option value="editor">Editor</option>
                <option value="curator">Curator</option>
              </select>
            </div>

            <div>
              <label className="block text-[9px] uppercase font-bold text-zinc-500 mb-1 flex items-center gap-1">
                <FolderOpen className="w-3 h-3" />
                Filter Campaign (Editor split)
              </label>
              <select
                value={filterCampaign}
                onChange={(e) => setFilterCampaign(e.target.value)}
                className="w-full bg-[#111] border border-zinc-800 rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 focus:outline-none"
              >
                <option value="">-- All Campaigns --</option>
                {campaignsList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end">
              <button
                onClick={handleExportCsv}
                className="w-full flex items-center justify-center gap-1.5 py-2 bg-blue-650 hover:bg-blue-600 text-white rounded-lg text-xs font-bold transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV Report
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Leaderboard Table */}
            <div className="lg:col-span-2 border border-zinc-900 bg-zinc-950/20 rounded-2xl p-5 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Award className="w-4 h-4 text-purple-400" />
                  Unified Employee Leaderboard
                </h3>
                <p className="text-zinc-500 text-[10px] mt-0.5">Rankings based on credited outputs in range.</p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-zinc-900 text-zinc-500 text-[10px] uppercase font-bold">
                      <th className="py-2.5">Rank</th>
                      <th className="py-2.5">Employee</th>
                      <th className="py-2.5">Total Count</th>
                      <th className="py-2.5">SleeckOS Cross-check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {managerKpi?.leaderboard?.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-zinc-650 italic">
                          No logging recorded in range.
                        </td>
                      </tr>
                    ) : (
                      managerKpi?.leaderboard?.map((entry: any, index: number) => {
                        const actual = crossChecks.find((cc) => cc.userId === entry.userId)?.actualCount || 0;
                        const hasGap = Math.abs(entry.successes - actual) > 3;

                        return (
                          <tr key={entry.userId} className="border-b border-zinc-900/60 hover:bg-zinc-950/30">
                            <td className="py-3 font-bold text-zinc-400">{index + 1}</td>
                            <td className="py-3">
                              <div className="font-bold text-white">{entry.name}</div>
                              <div className="text-[10px] text-zinc-500">{entry.email}</div>
                            </td>
                            <td className="py-3 text-white font-extrabold">{entry.successes}</td>
                            <td className="py-3">
                              {filterFunction === "scheduler" || !filterFunction ? (
                                <div className="flex items-center gap-2">
                                  <span className="text-zinc-400 font-semibold">{actual} actual posts</span>
                                  {hasGap && (
                                    <span className="px-1.5 py-0.5 rounded bg-red-950/40 border border-red-900/30 text-red-400 font-bold text-[9px] flex items-center gap-1">
                                      <AlertCircle className="w-3 h-3" /> Gap Flag
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-zinc-600">N/A</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Quality ratios info panel */}
              <div className="grid grid-cols-2 gap-4 bg-zinc-950 p-4 border border-zinc-900 rounded-xl">
                <div>
                  <span className="block text-[10px] uppercase font-bold text-zinc-500">Generator Success Rate</span>
                  <span className="text-lg font-extrabold text-white">
                    {managerKpi?.qualityRatios?.generator?.toFixed(1) || "100.0"}%
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase font-bold text-zinc-500">Curator Approval Rate</span>
                  <span className="text-lg font-extrabold text-white">
                    {managerKpi?.qualityRatios?.curator?.toFixed(1) || "100.0"}%
                  </span>
                </div>
              </div>
            </div>

            {/* KPI Configuration Sidepanel */}
            <div className="space-y-6">
              {/* Assign Function Box */}
              <div className="border border-zinc-900 bg-zinc-950/20 rounded-2xl p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <UserPlus className="w-4 h-4 text-purple-400" />
                    Assign Job Function
                  </h3>
                  <p className="text-zinc-500 text-[10px] mt-0.5">Assign tracked functions to employees.</p>
                </div>

                <form onSubmit={handleAssignFunction} className="space-y-3">
                  <div>
                    <label className="block text-[9px] uppercase font-bold text-zinc-500 mb-1">Select User</label>
                    <select
                      value={newAssignment.userId}
                      onChange={(e) => setNewAssignment({ ...newAssignment, userId: e.target.value })}
                      className="w-full bg-[#111] border border-zinc-800 rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 focus:outline-none focus:border-purple-500/50"
                      required
                    >
                      <option value="">-- Select Employee --</option>
                      {usersList.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name || "Unknown"} ({u.email})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[9px] uppercase font-bold text-zinc-500 mb-1">Function Type</label>
                    <select
                      value={newAssignment.functionType}
                      onChange={(e) => setNewAssignment({ ...newAssignment, functionType: e.target.value })}
                      className="w-full bg-[#111] border border-zinc-800 rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 focus:outline-none focus:border-purple-500/50"
                      required
                    >
                      <option value="generator">Generator</option>
                      <option value="warmup">Warm-up</option>
                      <option value="scheduler">Scheduler</option>
                      <option value="editor">Editor</option>
                      <option value="curator">Curator</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[9px] uppercase font-bold text-zinc-500 mb-1">Start Date</label>
                      <input
                        type="date"
                        value={newAssignment.startDate}
                        onChange={(e) => setNewAssignment({ ...newAssignment, startDate: e.target.value })}
                        className="w-full bg-[#111] border border-zinc-800 rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 focus:outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] uppercase font-bold text-zinc-500 mb-1">End Date (optional)</label>
                      <input
                        type="date"
                        value={newAssignment.endDate}
                        onChange={(e) => setNewAssignment({ ...newAssignment, endDate: e.target.value })}
                        className="w-full bg-[#111] border border-zinc-800 rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 focus:outline-none"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-purple-650 hover:bg-purple-600 text-white rounded-lg text-xs font-bold py-2 transition-all"
                  >
                    Assign Assignment
                  </button>
                </form>
              </div>

              {/* Set KPI Goal targets Box */}
              <div className="border border-zinc-900 bg-zinc-950/20 rounded-2xl p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <Settings className="w-4 h-4 text-blue-400" />
                    Configure Volume Target
                  </h3>
                  <p className="text-zinc-500 text-[10px] mt-0.5">Define goal targets per function and period.</p>
                </div>

                <form onSubmit={handleSetGoal} className="space-y-3">
                  <div>
                    <label className="block text-[9px] uppercase font-bold text-zinc-500 mb-1">Select User</label>
                    <select
                      value={newGoal.userId}
                      onChange={(e) => setNewGoal({ ...newGoal, userId: e.target.value })}
                      className="w-full bg-[#111] border border-zinc-800 rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 focus:outline-none focus:border-blue-500/50"
                      required
                    >
                      <option value="">-- Select Employee --</option>
                      {usersList.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name || "Unknown"} ({u.email})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[9px] uppercase font-bold text-zinc-500 mb-1">Function</label>
                      <select
                        value={newGoal.functionType}
                        onChange={(e) => setNewGoal({ ...newGoal, functionType: e.target.value })}
                        className="w-full bg-[#111] border border-zinc-800 rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 focus:outline-none focus:border-blue-500/50"
                        required
                      >
                        <option value="generator">Generator</option>
                        <option value="warmup">Warm-up</option>
                        <option value="scheduler">Scheduler</option>
                        <option value="editor">Editor</option>
                        <option value="curator">Curator</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[9px] uppercase font-bold text-zinc-500 mb-1">Period</label>
                      <select
                        value={newGoal.period}
                        onChange={(e) => setNewGoal({ ...newGoal, period: e.target.value })}
                        className="w-full bg-[#111] border border-zinc-800 rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 focus:outline-none focus:border-blue-500/50"
                        required
                      >
                        <option value="day">Day</option>
                        <option value="week">Week</option>
                        <option value="month">Month</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[9px] uppercase font-bold text-zinc-500 mb-1">Volume Target</label>
                      <input
                        type="number"
                        min="1"
                        value={newGoal.target}
                        onChange={(e) => setNewGoal({ ...newGoal, target: parseInt(e.target.value) || 0 })}
                        className="w-full bg-[#111] border border-zinc-800 rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 focus:outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] uppercase font-bold text-zinc-500 mb-1">Start Date</label>
                      <input
                        type="date"
                        value={newGoal.startDate}
                        onChange={(e) => setNewGoal({ ...newGoal, startDate: e.target.value })}
                        className="w-full bg-[#111] border border-zinc-800 rounded-lg px-3 py-2 text-xs font-bold text-zinc-300 focus:outline-none"
                        required
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-blue-650 hover:bg-blue-600 text-white rounded-lg text-xs font-bold py-2 transition-all"
                  >
                    Set Target Target
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
