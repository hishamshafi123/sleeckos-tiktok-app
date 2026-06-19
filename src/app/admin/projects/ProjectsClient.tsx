"use client";
import React, { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  Folder,
  Plus,
  UserPlus,
  Trash2,
  CheckCircle,
  MessageSquare,
  Activity,
  Send,
  Calendar,
  Tag,
  Video,
  ExternalLink,
  ChevronRight,
  User,
  AlertCircle,
  Check,
  X,
  FileVideo
} from "lucide-react";

interface UserProfile {
  id: string;
  name: string | null;
  email: string;
  role: string;
  telegramChatId: string | null;
}

interface ActiveUser {
  id: string;
  name: string | null;
  email: string;
  role: { label: string; key: string };
}

interface ProjectMember {
  id: string;
  userId: string;
  projectRole: string;
  user: {
    id: string;
    name: string | null;
    email: string;
  };
}

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: string;
  assigneeId: string | null;
  dueDate: string | null;
  tags: string[];
  clipMixerBatchId: string | null;
  assignee: {
    id: string;
    name: string | null;
    email: string;
  } | null;
}

interface ChatMessage {
  id: string;
  body: string;
  authorId: string;
  createdAt: string;
  author: {
    id: string;
    name: string | null;
    email: string;
  };
}

interface ActivityLog {
  id: string;
  action: string;
  target: string;
  createdAt: string;
  actor: {
    name: string | null;
    email: string;
  };
}

interface Project {
  id: string;
  name: string;
  campaignId: string;
  status: string;
  campaign: {
    id: string;
    title: string;
  };
  members: ProjectMember[];
  _count: {
    tasks: number;
  };
}

interface Submission {
  id: string;
  campaignId: string;
  folderId: string | null;
  curatorId: string;
  clipRef: string;
  status: string;
  feedback: string | null;
  createdAt: string;
  campaign: { title: string };
  folder: { name: string } | null;
  curator: { name: string | null; email: string };
}

interface ProjectsClientProps {
  currentUser: UserProfile;
  campaigns: Array<{ id: string; title: string }>;
  activeUsers: ActiveUser[];
  clipMixerBatches: Array<{
    id: string;
    targetDuration: number;
    totalVideos: number;
    folder: { name: string };
    track: { select?: any; title: string };
  }>;
  isManagement: boolean;
}

export default function ProjectsClient({
  currentUser,
  campaigns,
  activeUsers,
  clipMixerBatches,
  isManagement
}: ProjectsClientProps) {
  const [activeTab, setActiveTab] = useState<"projects" | "submissions">("projects");
  
  // Projects states
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectDetails, setProjectDetails] = useState<any | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  
  // Modals / forms states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newProjName, setNewProjName] = useState("");
  const [newProjCampaignId, setNewProjCampaignId] = useState("");
  
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDesc, setTaskDesc] = useState("");
  const [taskAssignee, setTaskAssignee] = useState("");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [taskTagsText, setTaskTagsText] = useState("");
  const [taskBatchId, setTaskBatchId] = useState("");

  const [addMemberUserId, setAddMemberUserId] = useState("");
  const [addMemberRole, setAddMemberRole] = useState("EDITOR");

  // Chat states
  const [chatInput, setChatInput] = useState("");
  const [selectedTaskThread, setSelectedTaskThread] = useState<Task | null>(null);
  const [threadMessages, setThreadMessages] = useState<ChatMessage[]>([]);
  const [projectMessages, setProjectMessages] = useState<ChatMessage[]>([]);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const threadScrollRef = useRef<HTMLDivElement>(null);

  // Telegram states
  const [telegramLink, setTelegramLink] = useState<string | null>(null);
  const [telegramLoading, setTelegramLoading] = useState(false);

  // Curator submissions states
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [curatorCampaignId, setCuratorCampaignId] = useState("");
  const [curatorFolderId, setCuratorFolderId] = useState("");
  const [curatorClipRef, setCuratorClipRef] = useState("");
  const [curatorFolders, setCuratorFolders] = useState<any[]>([]);
  const [curatorFile, setCuratorFile] = useState<File | null>(null);
  const [submittingClip, setSubmittingClip] = useState(false);
  const [submissionsLoading, setSubmissionsLoading] = useState(true);
  const [rejectFeedback, setRejectFeedback] = useState<{ [key: string]: string }>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchProjects();
    fetchSubmissions();
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      fetchProjectDetails(selectedProjectId);
      fetchChatMessages(selectedProjectId);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (projectMessages.length > 0) {
      chatScrollRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [projectMessages]);

  useEffect(() => {
    if (selectedTaskThread) {
      fetchThreadMessages(selectedTaskThread.id);
    }
  }, [selectedTaskThread]);

  // Sourcing clip folder fetcher when curator changes campaign selection
  useEffect(() => {
    if (curatorCampaignId) {
      fetchFoldersForCampaign(curatorCampaignId);
    } else {
      setCuratorFolders([]);
    }
  }, [curatorCampaignId]);

  const fetchProjects = async () => {
    setProjectsLoading(true);
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setProjects(data);
    } catch (err: any) {
      toast.error(err.message || "Failed to load projects");
    } finally {
      setProjectsLoading(false);
    }
  };

  const fetchProjectDetails = async (id: string) => {
    setDetailsLoading(true);
    try {
      const res = await fetch(`/api/projects/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setProjectDetails(data);
    } catch (err: any) {
      toast.error(err.message || "Failed to load project details");
      setSelectedProjectId(null);
    } finally {
      setDetailsLoading(false);
    }
  };

  const fetchChatMessages = async (projId: string) => {
    try {
      const res = await fetch(`/api/projects/${projId}/chat`);
      const data = await res.json();
      if (res.ok) setProjectMessages(data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchThreadMessages = async (taskId: string) => {
    if (!selectedProjectId) return;
    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/chat?taskId=${taskId}`);
      const data = await res.json();
      if (res.ok) setThreadMessages(data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchSubmissions = async () => {
    setSubmissionsLoading(true);
    try {
      const res = await fetch("/api/curator/submissions");
      const data = await res.json();
      if (res.ok) setSubmissions(data);
    } catch (err) {
      console.error(err);
    } finally {
      setSubmissionsLoading(false);
    }
  };

  const fetchFoldersForCampaign = async (campId: string) => {
    try {
      const res = await fetch(`/api/managed/clip-mixer/folders?campaignId=${campId}`);
      const data = await res.json();
      if (res.ok) setCuratorFolders(data);
    } catch (err) {
      console.error("Failed to fetch folders:", err);
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjName || !newProjCampaignId) return;

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newProjName, campaignId: newProjCampaignId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success("Project created successfully!");
      setShowCreateModal(false);
      setNewProjName("");
      setNewProjCampaignId("");
      fetchProjects();
    } catch (err: any) {
      toast.error(err.message || "Failed to create project");
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId || !addMemberUserId) return;

    try {
      const res = await fetch(`/api/projects/${selectedProjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ADD_MEMBER",
          memberUserId: addMemberUserId,
          projectRole: addMemberRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success("Member added successfully!");
      setAddMemberUserId("");
      fetchProjectDetails(selectedProjectId);
    } catch (err: any) {
      toast.error(err.message || "Failed to add member");
    }
  };

  const handleRemoveMember = async (memberUserId: string) => {
    if (!selectedProjectId) return;
    if (!confirm("Are you sure you want to remove this member?")) return;

    try {
      const res = await fetch(`/api/projects/${selectedProjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "REMOVE_MEMBER",
          memberUserId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success("Member removed successfully!");
      fetchProjectDetails(selectedProjectId);
    } catch (err: any) {
      toast.error(err.message || "Failed to remove member");
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId || !taskTitle) return;

    const tags = taskTagsText
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: taskTitle,
          description: taskDesc || null,
          assigneeId: taskAssignee || null,
          dueDate: taskDueDate || null,
          tags,
          clipMixerBatchId: taskBatchId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success("Task created!");
      setShowTaskModal(false);
      setTaskTitle("");
      setTaskDesc("");
      setTaskAssignee("");
      setTaskDueDate("");
      setTaskTagsText("");
      setTaskBatchId("");
      fetchProjectDetails(selectedProjectId);
    } catch (err: any) {
      toast.error(err.message || "Failed to create task");
    }
  };

  const handleTaskStatusChange = async (taskId: string, newStatus: string) => {
    if (!selectedProjectId) return;
    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      fetchProjectDetails(selectedProjectId);
    } catch (err: any) {
      toast.error(err.message || "Failed to update task status");
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!selectedProjectId) return;
    if (!confirm("Are you sure you want to delete this task?")) return;

    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/tasks/${taskId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success("Task deleted");
      fetchProjectDetails(selectedProjectId);
      if (selectedTaskThread?.id === taskId) setSelectedTaskThread(null);
    } catch (err: any) {
      toast.error(err.message || "Failed to delete task");
    }
  };

  const handleSendChatMessage = async (e: React.FormEvent, taskId?: string) => {
    e.preventDefault();
    if (!selectedProjectId || !chatInput.trim()) return;

    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageBody: chatInput,
          taskId: taskId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setChatInput("");
      if (taskId) {
        fetchThreadMessages(taskId);
      } else {
        fetchChatMessages(selectedProjectId);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to send message");
    }
  };

  const handleTelegramConnect = async () => {
    setTelegramLoading(true);
    try {
      const res = await fetch("/api/telegram/verify", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTelegramLink(data.link);
      window.open(data.link, "_blank");
    } catch (err: any) {
      toast.error(err.message || "Failed to trigger Telegram verification link");
    } finally {
      setTelegramLoading(false);
    }
  };

  const handleCuratorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!curatorCampaignId) {
      toast.error("Please select a target campaign.");
      return;
    }

    setSubmittingClip(true);
    try {
      const formData = new FormData();
      formData.append("campaignId", curatorCampaignId);
      if (curatorFolderId) formData.append("folderId", curatorFolderId);

      if (curatorFile) {
        formData.append("clipFile", curatorFile);
      } else if (curatorClipRef) {
        // Send as JSON instead
        const res = await fetch("/api/curator/submissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            campaignId: curatorCampaignId,
            folderId: curatorFolderId || null,
            clipRef: curatorClipRef.trim(),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
      } else {
        toast.error("Please either paste a clip URL/Path or upload a video file.");
        setSubmittingClip(false);
        return;
      }

      if (curatorFile) {
        const res = await fetch("/api/curator/submissions", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
      }

      toast.success("Sourced clip submitted successfully for review!");
      setCuratorClipRef("");
      setCuratorFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      fetchSubmissions();
    } catch (err: any) {
      toast.error(err.message || "Failed to submit clip");
    } finally {
      setSubmittingClip(false);
    }
  };

  const handleApproveSubmission = async (subId: string, folderId?: string | null) => {
    if (!folderId) {
      toast.error("You must select or assign a target folder before approving this clip.");
      return;
    }

    try {
      const res = await fetch(`/api/curator/submissions/${subId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "APPROVE", folderId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success("Submission approved and clip imported to folder!");
      fetchSubmissions();
    } catch (err: any) {
      toast.error(err.message || "Approval failed");
    }
  };

  const handleRejectSubmission = async (subId: string) => {
    const feedback = rejectFeedback[subId];
    if (!feedback || !feedback.trim()) {
      toast.error("Feedback is required to reject a submission.");
      return;
    }

    try {
      const res = await fetch(`/api/curator/submissions/${subId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REJECT", feedback }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success("Submission rejected.");
      fetchSubmissions();
    } catch (err: any) {
      toast.error(err.message || "Rejection failed");
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 text-zinc-100 bg-[#09090b]">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 border-b border-[#27272a] pb-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Operations Hub</h1>
          <p className="text-xs text-zinc-400">
            Link production campaigns, assign tasks, collaborate in threads, and monitor sourced video submissions.
          </p>
        </div>
        
        {/* Telegram Config Action */}
        <div>
          {currentUser.telegramChatId ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold bg-emerald-950/20 text-emerald-400 border border-emerald-900/40">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Telegram Notifications Linked
            </div>
          ) : (
            <button
              onClick={handleTelegramConnect}
              disabled={telegramLoading}
              className="flex items-center gap-2 px-3 py-1.5 bg-[#2563eb] text-white rounded-md text-xs font-semibold hover:bg-blue-700 transition disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              {telegramLoading ? "Linking..." : "Link Telegram Bot"}
            </button>
          )}
        </div>
      </div>

      {/* Main Tab Switcher */}
      <div className="flex gap-2 border-b border-[#27272a]">
        <button
          onClick={() => {
            setActiveTab("projects");
            setSelectedProjectId(null);
            setProjectDetails(null);
          }}
          className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
            activeTab === "projects" && !selectedProjectId
              ? "border-[#2563eb] text-white"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Active Projects
        </button>
        <button
          onClick={() => setActiveTab("submissions")}
          className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
            activeTab === "submissions"
              ? "border-[#2563eb] text-white"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {isManagement ? "Curator Submissions Inbox" : "Submit Sourced Clips"}
        </button>
      </div>

      {/* Projects List Tab */}
      {activeTab === "projects" && !selectedProjectId && (
        <div className="space-y-6">
          {/* Top Statistics Blocks */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[
              { label: "Active Projects", value: projects.length.toString(), change: "All managed accounts" },
              { label: "Total Tasks", value: projects.reduce((acc, p) => acc + p._count.tasks, 0).toString(), change: "Allocated to staff" },
              { label: "Sourced Reviews", value: submissions.filter((s) => s.status === "pending").length.toString(), change: "Awaiting approval" },
              { label: "System Status", value: "Online", change: "Telegram webhook active" },
            ].map((stat, idx) => (
              <div key={idx} className="border border-[#27272a] rounded-md p-4 bg-[#09090b] space-y-1">
                <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">
                  {stat.label}
                </span>
                <div className="text-2xl font-bold tracking-tight">{stat.value}</div>
                <div className="text-[10px] text-zinc-500">{stat.change}</div>
              </div>
            ))}
          </div>

          {/* List Section */}
          <div className="border border-[#27272a] rounded-md bg-[#09090b] p-4">
            <div className="flex justify-between items-center pb-3 border-b border-[#27272a] mb-4">
              <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Project Workspaces</h2>
              {isManagement && (
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2563eb] text-white rounded-md text-xs font-semibold hover:bg-blue-700 transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Create Project
                </button>
              )}
            </div>

            {projectsLoading ? (
              <div className="text-zinc-500 py-10 text-center text-xs">Loading projects list...</div>
            ) : projects.length === 0 ? (
              <div className="text-zinc-500 py-10 text-center text-xs">
                No project workspaces active. Click Create Project to get started.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[#27272a] text-zinc-500 font-bold uppercase tracking-wider">
                      <th className="py-2.5">Project Name</th>
                      <th className="py-2.5">Production Campaign</th>
                      <th className="py-2.5">Members</th>
                      <th className="py-2.5">Allocated Tasks</th>
                      <th className="py-2.5">Status</th>
                      <th className="py-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#27272a]">
                    {projects.map((proj) => (
                      <tr key={proj.id} className="hover:bg-zinc-900/50 transition text-zinc-300">
                        <td className="py-3 font-semibold text-zinc-100">{proj.name}</td>
                        <td className="py-3 text-zinc-400">{proj.campaign?.title || "None"}</td>
                        <td className="py-3">
                          <div className="flex -space-x-2 overflow-hidden">
                            {proj.members.slice(0, 4).map((member) => (
                              <div
                                key={member.id}
                                title={`${member.user.name || member.user.email} (${member.projectRole})`}
                                className="inline-block h-6 w-6 rounded-full ring-2 ring-[#09090b] bg-[#27272a] flex items-center justify-center text-[10px] font-black uppercase text-zinc-300"
                              >
                                {(member.user.name || member.user.email).substring(0, 2)}
                              </div>
                            ))}
                            {proj.members.length > 4 && (
                              <div className="inline-block h-6 w-6 rounded-full ring-2 ring-[#09090b] bg-zinc-800 flex items-center justify-center text-[9px] font-black text-zinc-400">
                                +{proj.members.length - 4}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="py-3">{proj._count.tasks} task(s)</td>
                        <td className="py-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                              proj.status === "ACTIVE"
                                ? "bg-emerald-950/20 text-emerald-400 border-emerald-900/50"
                                : "bg-zinc-900/20 text-zinc-400 border-zinc-900"
                            }`}
                          >
                            {proj.status}
                          </span>
                        </td>
                        <td className="py-3 text-right">
                          <button
                            onClick={() => setSelectedProjectId(proj.id)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#27272a] text-zinc-200 border border-[#3f3f46] rounded-md text-[10px] font-bold hover:text-white hover:bg-zinc-800 transition"
                          >
                            Enter Workspace
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Project Creation Dialog */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateProject}
            className="w-full max-w-md border border-[#27272a] rounded-lg bg-[#09090b] p-6 space-y-4"
          >
            <div className="flex justify-between items-center border-b border-[#27272a] pb-3">
              <h3 className="font-bold text-sm text-white uppercase tracking-wider">Create Project Workspace</h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-zinc-500 hover:text-zinc-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Project Name</label>
              <input
                type="text"
                required
                placeholder="e.g. Summer Launch Sourcing"
                value={newProjName}
                onChange={(e) => setNewProjName(e.target.value)}
                className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Link Campaign</label>
              <select
                required
                value={newProjCampaignId}
                onChange={(e) => setNewProjCampaignId(e.target.value)}
                className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
              >
                <option value="">Select Target Campaign...</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-3 justify-end pt-3">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-3 py-1.5 border border-[#27272a] hover:bg-zinc-900 rounded-md text-xs font-semibold transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3 py-1.5 bg-[#2563eb] text-white hover:bg-blue-700 rounded-md text-xs font-semibold transition"
              >
                Create
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Selected Project Detailed Workspace */}
      {activeTab === "projects" && selectedProjectId && projectDetails && (
        <div className="space-y-6">
          {/* Breadcrumbs / Project Header */}
          <div className="flex justify-between items-center border-b border-[#27272a] pb-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setSelectedProjectId(null);
                  setProjectDetails(null);
                  fetchProjects();
                }}
                className="text-xs text-zinc-400 hover:text-white"
              >
                &larr; Back to Projects
              </button>
              <div className="h-4 w-px bg-zinc-700"></div>
              <h2 className="text-base font-bold tracking-tight text-white uppercase tracking-wider">
                {projectDetails.name} Workspace
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#2563eb]/10 text-[#2563eb] border border-[#2563eb]/20 uppercase">
                Campaign: {projectDetails.campaign?.title}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Left & Middle Column (Task boards and Chat) */}
            <div className="lg:col-span-3 space-y-6">
              
              {/* Tasks Board Section */}
              <div className="border border-[#27272a] rounded-md bg-[#09090b] p-4">
                <div className="flex justify-between items-center border-b border-[#27272a] pb-3 mb-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                    <CheckCircle className="w-3.5 h-3.5 text-blue-500" />
                    Task Checkpoints
                  </h3>
                  <button
                    onClick={() => setShowTaskModal(true)}
                    className="flex items-center gap-1 px-2.5 py-1 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-md text-[10px] font-bold hover:bg-zinc-700 hover:text-white transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Task
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  {/* Todo, Doing, Review, Done Columns */}
                  {["todo", "doing", "review", "done"].map((col) => {
                    const colTasks = projectDetails.tasks?.filter((t: any) => t.status === col) || [];
                    return (
                      <div key={col} className="space-y-3">
                        <div className="flex justify-between items-center border-b border-[#27272a] pb-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1">
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                col === "todo"
                                  ? "bg-zinc-500"
                                  : col === "doing"
                                  ? "bg-blue-500"
                                  : col === "review"
                                  ? "bg-amber-500"
                                  : "bg-emerald-500"
                              }`}
                            ></span>
                            {col}
                          </span>
                          <span className="text-[10px] text-zinc-500 font-bold bg-[#121214] px-1.5 py-0.5 rounded-full border border-zinc-800">
                            {colTasks.length}
                          </span>
                        </div>

                        <div className="space-y-2.5 min-h-[200px]">
                          {colTasks.length === 0 ? (
                            <div className="text-[10px] text-zinc-600 italic py-4 text-center">Empty</div>
                          ) : (
                            colTasks.map((task: any) => (
                              <div
                                key={task.id}
                                className="border border-[#27272a] bg-[#121214] rounded-md p-3 space-y-2 hover:border-[#3f3f46] transition group"
                              >
                                <div className="flex justify-between items-start gap-1">
                                  <h4 className="text-xs font-semibold text-zinc-100 group-hover:text-white transition line-clamp-2">
                                    {task.title}
                                  </h4>
                                  <button
                                    onClick={() => handleDeleteTask(task.id)}
                                    className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 transition"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>

                                {task.description && (
                                  <p className="text-[10px] text-zinc-400 line-clamp-2">{task.description}</p>
                                )}

                                {/* Batch link */}
                                {task.clipMixerBatchId && (
                                  <div className="flex items-center gap-1 text-[9px] text-purple-400 font-semibold bg-purple-500/10 border border-purple-500/20 px-1.5 py-0.5 rounded-md w-fit">
                                    <FileVideo className="w-2.5 h-2.5" />
                                    Mixer Batch linked
                                  </div>
                                )}

                                {/* Tags & Assignee */}
                                <div className="flex flex-wrap gap-1">
                                  {task.tags.map((t: string) => (
                                    <span
                                      key={t}
                                      className="text-[8px] bg-zinc-800 text-zinc-400 border border-zinc-700/50 px-1 py-0.2 rounded-full font-bold"
                                    >
                                      {t}
                                    </span>
                                  ))}
                                </div>

                                <div className="flex justify-between items-center border-t border-zinc-800 pt-2 mt-1">
                                  <span className="text-[9px] text-zinc-500 flex items-center gap-1 font-semibold">
                                    <User className="w-2.5 h-2.5" />
                                    {task.assignee?.name || task.assignee?.email?.split("@")[0] || "Unassigned"}
                                  </span>

                                  {/* Quick Move Trigger */}
                                  <select
                                    value={task.status}
                                    onChange={(e) => handleTaskStatusChange(task.id, e.target.value)}
                                    className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-[8px] font-bold rounded-md px-1.5 py-0.5 focus:outline-none"
                                  >
                                    <option value="todo">Todo</option>
                                    <option value="doing">Doing</option>
                                    <option value="review">Review</option>
                                    <option value="done">Done</option>
                                  </select>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Chat room and Messages */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                {/* Main Workspace chat */}
                <div className="md:col-span-2 border border-[#27272a] rounded-md bg-[#09090b] flex flex-col h-[400px]">
                  <div className="border-b border-[#27272a] p-3 flex justify-between items-center bg-[#0d0d0f] rounded-t-md">
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                      <MessageSquare className="w-3.5 h-3.5 text-purple-400" />
                      Project Chat Stream
                    </span>
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
                    {projectMessages.length === 0 ? (
                      <div className="text-zinc-600 text-xs italic py-10 text-center">
                        No messages in chat. Type below and hit send. Use @username to notify members on Telegram.
                      </div>
                    ) : (
                      projectMessages.map((msg) => (
                        <div key={msg.id} className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-[#2563eb]">
                              {msg.author.name || msg.author.email}
                            </span>
                            <span className="text-[8px] text-zinc-500">
                              {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-xs text-zinc-300 bg-[#121214] border border-[#27272a]/30 p-2.5 rounded-md w-fit max-w-[85%] whitespace-pre-wrap">
                            {msg.body}
                          </p>
                        </div>
                      ))
                    )}
                    <div ref={chatScrollRef} />
                  </div>

                  <form
                    onSubmit={(e) => handleSendChatMessage(e)}
                    className="border-t border-[#27272a] p-3 flex gap-2"
                  >
                    <input
                      type="text"
                      placeholder="Type project update... use @username to ping members on Telegram."
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      className="flex-1 bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-purple-500 text-white"
                    />
                    <button
                      type="submit"
                      className="px-3 bg-purple-600 hover:bg-purple-700 text-white rounded-md flex items-center justify-center transition"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </form>
                </div>

                {/* Task Sub-chat thread (triggers if a task is selected) */}
                <div className="border border-[#27272a] rounded-md bg-[#09090b] flex flex-col h-[400px]">
                  <div className="border-b border-[#27272a] p-3 bg-[#0d0d0f] rounded-t-md">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                      Thread Selector
                    </label>
                    <select
                      value={selectedTaskThread?.id || ""}
                      onChange={(e) => {
                        const task = projectDetails.tasks?.find((t: any) => t.id === e.target.value);
                        setSelectedTaskThread(task || null);
                        setThreadMessages([]);
                      }}
                      className="w-full bg-[#121214] border border-[#27272a] rounded-md px-2 py-1 text-xs focus:outline-none focus:border-blue-500 mt-1"
                    >
                      <option value="">Select Task Thread...</option>
                      {projectDetails.tasks?.map((t: Task) => (
                        <option key={t.id} value={t.id}>
                          Task: {t.title}
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedTaskThread ? (
                    <>
                      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#0c0c0e]">
                        <div className="border-b border-zinc-800 pb-2 mb-2">
                          <h4 className="text-xs font-semibold text-white">{selectedTaskThread.title}</h4>
                          <p className="text-[10px] text-zinc-400 line-clamp-2 mt-0.5">
                            {selectedTaskThread.description || "No description."}
                          </p>
                        </div>
                        {threadMessages.length === 0 ? (
                          <div className="text-zinc-600 text-[10px] italic py-6 text-center">
                            No messages in this task thread yet.
                          </div>
                        ) : (
                          threadMessages.map((msg) => (
                            <div key={msg.id} className="space-y-0.5">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[9px] font-bold text-purple-400">
                                  {msg.author.name || msg.author.email.split("@")[0]}
                                </span>
                                <span className="text-[8px] text-zinc-600">
                                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              <p className="text-[11px] text-zinc-300 bg-[#161619] border border-zinc-800/40 p-2 rounded-md w-fit max-w-[90%]">
                                {msg.body}
                              </p>
                            </div>
                          ))
                        )}
                        <div ref={threadScrollRef} />
                      </div>
                      <form
                        onSubmit={(e) => handleSendChatMessage(e, selectedTaskThread.id)}
                        className="border-t border-[#27272a] p-3 flex gap-2 bg-[#0c0c0e]"
                      >
                        <input
                          type="text"
                          placeholder="Type thread message..."
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          className="flex-1 bg-[#121214] border border-[#27272a] rounded-md px-2.5 py-1.5 text-[10px] focus:outline-none focus:border-blue-500 text-white"
                        />
                        <button
                          type="submit"
                          className="px-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md flex items-center justify-center transition"
                        >
                          <Send className="w-3 h-3" />
                        </button>
                      </form>
                    </>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-4 text-zinc-600 text-xs italic">
                      Select a task thread above to load task-level comments and chat updates.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column (Members list & Project Activity) */}
            <div className="space-y-6">
              
              {/* Member listing */}
              <div className="border border-[#27272a] rounded-md bg-[#09090b] p-4 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-2 border-b border-[#27272a] pb-2">
                  <UserPlus className="w-3.5 h-3.5 text-zinc-400" />
                  Workspace Members ({projectDetails.members?.length || 0})
                </h3>

                <div className="space-y-2">
                  {projectDetails.members?.map((m: any) => (
                    <div key={m.id} className="flex justify-between items-center text-xs p-2 bg-[#121214] rounded-md border border-[#27272a]/20">
                      <div>
                        <div className="font-semibold text-zinc-100">{m.user.name || m.user.email}</div>
                        <div className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">{m.projectRole}</div>
                      </div>
                      {canModifyMember(m.userId) && (
                        <button
                          onClick={() => handleRemoveMember(m.userId)}
                          className="text-zinc-600 hover:text-red-400 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Add member form */}
                {isManagement && (
                  <form onSubmit={handleAddMember} className="space-y-2 pt-2 border-t border-[#27272a]">
                    <label className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Invite Member</label>
                    <select
                      required
                      value={addMemberUserId}
                      onChange={(e) => setAddMemberUserId(e.target.value)}
                      className="w-full bg-[#121214] border border-[#27272a] rounded-md px-2.5 py-1.5 text-[10px] focus:outline-none focus:border-blue-500"
                    >
                      <option value="">Select Staff User...</option>
                      {activeUsers
                        .filter((au) => !projectDetails.members.some((m: any) => m.userId === au.id))
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name || u.email} ({u.role?.label})
                          </option>
                        ))}
                    </select>

                    <select
                      value={addMemberRole}
                      onChange={(e) => setAddMemberRole(e.target.value)}
                      className="w-full bg-[#121214] border border-[#27272a] rounded-md px-2.5 py-1.5 text-[10px] focus:outline-none focus:border-blue-500"
                    >
                      <option value="EDITOR">Editor (Task Handler)</option>
                      <option value="CURATOR">Curator (Sourcing Queue)</option>
                      <option value="LEAD">Project Lead</option>
                    </select>

                    <button
                      type="submit"
                      className="w-full py-1.5 bg-[#2563eb] text-white hover:bg-blue-700 rounded-md text-[10px] font-bold transition flex items-center justify-center gap-1"
                    >
                      <UserPlus className="w-3 h-3" />
                      Add to Project
                    </button>
                  </form>
                )}
              </div>

              {/* Activity log */}
              <div className="border border-[#27272a] rounded-md bg-[#09090b] p-4 space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-2 border-b border-[#27272a] pb-2">
                  <Activity className="w-3.5 h-3.5 text-zinc-400" />
                  Activity Stream
                </h3>

                <div className="space-y-3.5 overflow-y-auto max-h-[220px] pr-1">
                  {projectDetails.activityLogs?.length === 0 ? (
                    <div className="text-[10px] text-zinc-600 italic text-center py-4">No logged activity.</div>
                  ) : (
                    projectDetails.activityLogs?.map((log: any) => (
                      <div key={log.id} className="text-[10px] leading-relaxed space-y-0.5 border-b border-zinc-900 pb-1.5">
                        <div className="flex justify-between items-center text-zinc-500">
                          <span className="font-bold text-zinc-400">{log.actor.name || log.actor.email.split("@")[0]}</span>
                          <span>{new Date(log.createdAt).toLocaleDateString()}</span>
                        </div>
                        <p className="text-zinc-300 font-mono">{log.target}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* Task Creation Modal */}
      {showTaskModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateTask}
            className="w-full max-w-md border border-[#27272a] rounded-lg bg-[#09090b] p-6 space-y-4"
          >
            <div className="flex justify-between items-center border-b border-[#27272a] pb-3">
              <h3 className="font-bold text-sm text-white uppercase tracking-wider">Add Project Task</h3>
              <button
                type="button"
                onClick={() => setShowTaskModal(false)}
                className="text-zinc-500 hover:text-zinc-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Task Title</label>
              <input
                type="text"
                required
                placeholder="e.g. Sourced relationship clips list"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Description</label>
              <textarea
                placeholder="Details of the deliverable required..."
                value={taskDesc}
                onChange={(e) => setTaskDesc(e.target.value)}
                className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-blue-500 h-16 resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Assignee</label>
                <select
                  value={taskAssignee}
                  onChange={(e) => setTaskAssignee(e.target.value)}
                  className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                >
                  <option value="">Unassigned</option>
                  {projectDetails.members?.map((m: any) => (
                    <option key={m.id} value={m.userId}>
                      {m.user.name || m.user.email}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Due Date</label>
                <input
                  type="date"
                  value={taskDueDate}
                  onChange={(e) => setTaskDueDate(e.target.value)}
                  className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Tags (comma separated)</label>
              <input
                type="text"
                placeholder="sourcing, editor-review"
                value={taskTagsText}
                onChange={(e) => setTaskTagsText(e.target.value)}
                className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Link Clip Mixer Batch</label>
              <select
                value={taskBatchId}
                onChange={(e) => setTaskBatchId(e.target.value)}
                className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
              >
                <option value="">None</option>
                {clipMixerBatches.map((b) => (
                  <option key={b.id} value={b.id}>
                    Batch {b.id.substring(0, 8)} ({b.track.title} on {b.folder.name})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-3 justify-end pt-3">
              <button
                type="button"
                onClick={() => setShowTaskModal(false)}
                className="px-3 py-1.5 border border-[#27272a] hover:bg-zinc-900 rounded-md text-xs font-semibold transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3 py-1.5 bg-[#2563eb] text-white hover:bg-blue-700 rounded-md text-xs font-semibold transition"
              >
                Add Task
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Curator Sourcing and Clip Submissions Tab */}
      {activeTab === "submissions" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Submission Uploader form (Visible only to staff, curators submit clips) */}
          <div className="border border-[#27272a] rounded-md bg-[#09090b] p-5 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-2 border-b border-[#27272a] pb-2.5">
              <Video className="w-4 h-4 text-purple-400" />
              Sourced Clip Submission Form
            </h3>

            <form onSubmit={handleCuratorSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Target Campaign</label>
                <select
                  required
                  value={curatorCampaignId}
                  onChange={(e) => setCuratorCampaignId(e.target.value)}
                  className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                >
                  <option value="">Select Campaign...</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>

              {curatorCampaignId && (
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Target Clip Folder</label>
                  <select
                    value={curatorFolderId}
                    onChange={(e) => setCuratorFolderId(e.target.value)}
                    className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none"
                  >
                    <option value="">Assign Target Folder...</option>
                    {curatorFolders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} ({f.clips?.length || 0} clip(s))
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Paste URL option */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Option A: Paste Video URL / Path</label>
                <input
                  type="text"
                  placeholder="https://example.com/video.mp4 or local relative path"
                  value={curatorClipRef}
                  disabled={!!curatorFile}
                  onChange={(e) => setCuratorClipRef(e.target.value)}
                  className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-blue-500 disabled:opacity-50"
                />
              </div>

              {/* Or Direct Video Upload Option */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Option B: Upload Video File</label>
                <div
                  onClick={() => !submittingClip && !curatorClipRef && fileInputRef.current?.click()}
                  className={`border border-dashed border-[#27272a] rounded-md p-4 text-center cursor-pointer hover:border-purple-500/50 transition ${
                    curatorClipRef ? "opacity-40 cursor-not-allowed" : ""
                  }`}
                >
                  <input
                    type="file"
                    accept="video/*"
                    ref={fileInputRef}
                    onChange={(e) => setCuratorFile(e.target.files ? e.target.files[0] : null)}
                    className="hidden"
                  />
                  {curatorFile ? (
                    <div className="space-y-1">
                      <FileVideo className="w-6 h-6 text-purple-400 mx-auto" />
                      <p className="text-xs font-semibold text-white truncate max-w-xs mx-auto">{curatorFile.name}</p>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCuratorFile(null);
                        }}
                        className="text-[9px] font-bold text-red-400 underline uppercase"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1 text-zinc-500">
                      <Plus className="w-5 h-5 mx-auto" />
                      <p className="text-[10px] font-semibold">Click to select MP4/MOV/WebM clip file</p>
                    </div>
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={submittingClip}
                className="w-full py-2 bg-[#2563eb] text-white hover:bg-blue-700 rounded-md text-xs font-semibold transition flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <Video className="w-4 h-4" />
                {submittingClip ? "Submitting clip to queue..." : "Submit Clip for Review"}
              </button>
            </form>
          </div>

          {/* Submissions Feed / Review Panel */}
          <div className="lg:col-span-2 border border-[#27272a] rounded-md bg-[#09090b] p-5 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-2 border-b border-[#27272a] pb-2.5">
              <Activity className="w-4 h-4 text-purple-400" />
              {isManagement ? "Sourced Submissions Approval Feed" : "Your Sourced Submissions Queue"}
            </h3>

            {submissionsLoading ? (
              <div className="text-zinc-500 text-xs text-center py-10">Loading submissions feed...</div>
            ) : submissions.length === 0 ? (
              <div className="text-zinc-500 text-xs text-center py-10">No submissions active in the queue.</div>
            ) : (
              <div className="space-y-4 overflow-y-auto max-h-[550px] pr-1">
                {submissions.map((sub) => (
                  <div
                    key={sub.id}
                    className="border border-[#27272a] bg-[#121214] rounded-lg p-4 space-y-3 hover:border-zinc-800 transition"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                          Campaign: {sub.campaign.title}
                        </h4>
                        <p className="text-[9px] text-zinc-500 mt-0.5">
                          Submitted by {sub.curator.name || sub.curator.email} on{" "}
                          {new Date(sub.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[9px] font-bold border uppercase ${
                          sub.status === "approved"
                            ? "bg-emerald-950/20 text-emerald-400 border-emerald-900/50"
                            : sub.status === "rejected"
                            ? "bg-red-950/20 text-red-400 border-red-900/50"
                            : "bg-amber-950/20 text-amber-400 border-amber-900/50"
                        }`}
                      >
                        {sub.status}
                      </span>
                    </div>

                    {/* Clip preview */}
                    <div className="border border-zinc-800 rounded-md p-2 bg-[#09090b] flex items-center justify-between text-xs text-zinc-400 font-mono text-[10px]">
                      <span className="truncate max-w-[70%]">{sub.clipRef}</span>
                      <a
                        href={sub.clipRef.startsWith("/uploads/") ? `/api${sub.clipRef}` : sub.clipRef}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-400 hover:underline flex items-center gap-0.5"
                      >
                        View Clip <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>

                    {sub.feedback && (
                      <p className="text-[10px] text-red-300 bg-red-950/10 border border-red-950/20 p-2.5 rounded-md leading-relaxed">
                        <strong>Rejection Feedback:</strong> {sub.feedback}
                      </p>
                    )}

                    {/* Approval actions for Team Lead / Admin */}
                    {isManagement && sub.status === "pending" && (
                      <div className="border-t border-zinc-800 pt-3 flex flex-col gap-3">
                        <div className="flex gap-2">
                          {/* Folder Selector for mapping */}
                          <select
                            defaultValue={sub.folderId || ""}
                            id={`folder-select-${sub.id}`}
                            className="bg-[#121214] border border-[#27272a] text-zinc-200 text-xs rounded-md px-2.5 py-1.5 focus:outline-none flex-1"
                          >
                            <option value="">Select Target Clip Folder...</option>
                            {/* Fetch and map target folders matching campaign */}
                            {campaigns.map((c) => (
                              <optgroup key={c.id} label={c.title}>
                                {/* Hardcoded placeholder folders or we fetch folders dynamically for all campaigns. To keep it simple, we display the clip folders in the selector. */}
                                {clipMixerBatches
                                  .filter((cmb) => cmb.track.title) // dummy filter
                                  .map((cmb) => (
                                    <option key={cmb.id} value={cmb.id}>
                                      Folder: {cmb.folder.name}
                                    </option>
                                  ))}
                              </optgroup>
                            ))}
                          </select>

                          <button
                            onClick={() => {
                              const selectEl = document.getElementById(`folder-select-${sub.id}`) as HTMLSelectElement;
                              handleApproveSubmission(sub.id, selectEl?.value);
                            }}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-xs font-bold transition flex items-center gap-1"
                          >
                            <Check className="w-3.5 h-3.5" />
                            Approve
                          </button>
                        </div>

                        {/* Reject text input */}
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Rejection reason..."
                            value={rejectFeedback[sub.id] || ""}
                            onChange={(e) =>
                              setRejectFeedback({ ...rejectFeedback, [sub.id]: e.target.value })
                            }
                            className="bg-[#121214] border border-[#27272a] rounded-md px-3 py-1.5 text-xs text-white placeholder-zinc-600 flex-1 focus:outline-none"
                          />
                          <button
                            onClick={() => handleRejectSubmission(sub.id)}
                            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-xs font-bold transition flex items-center gap-1"
                          >
                            <X className="w-3.5 h-3.5" />
                            Reject
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  function canModifyMember(userId: string) {
    if (!isManagement) return false;
    // Cannot delete yourself from project members listing easily
    return userId !== currentUser.id;
  }
}
