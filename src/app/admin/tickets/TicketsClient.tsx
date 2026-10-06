"use client";
import React, { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  Plus,
  X,
  Trash2,
  TicketCheck,
  Calendar,
  User,
  Users,
  LayoutList,
  AlertCircle,
  CheckCircle,
} from "lucide-react";

interface UserProfile {
  id: string;
  name: string | null;
  email: string;
  role: string;
}

interface AssigneeUser {
  id: string;
  name: string | null;
  email: string;
}

interface Ticket {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  assignedAt: string | null;
  completedAt: string | null;
  creator: AssigneeUser;
  assignee: AssigneeUser | null;
}

interface MemberTicket {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  createdAt: string;
  assignedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
  creator: AssigneeUser;
}

interface MemberBucket {
  user: AssigneeUser;
  counts: Record<string, number>;
  openCount: number;
  tickets: MemberTicket[];
}

interface ByMemberData {
  members: MemberBucket[];
  unassigned: { counts: Record<string, number>; tickets: MemberTicket[] };
}

interface TicketsClientProps {
  currentUser: UserProfile;
  isManagement: boolean;
}

type ViewKey = "mine" | "created" | "all";

const STATUSES = ["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  DONE: "Done",
  CANCELLED: "Cancelled",
};

const PRIORITY_STYLES: Record<string, string> = {
  URGENT: "bg-red-950/20 text-red-400 border-red-900/50",
  HIGH: "bg-amber-950/20 text-amber-400 border-amber-900/50",
  MEDIUM: "bg-blue-950/20 text-blue-400 border-blue-900/50",
  LOW: "bg-zinc-900/20 text-zinc-400 border-zinc-800",
};

const STATUS_STYLES: Record<string, string> = {
  OPEN: "bg-zinc-900/20 text-zinc-300 border-zinc-800",
  IN_PROGRESS: "bg-blue-950/20 text-blue-400 border-blue-900/50",
  DONE: "bg-emerald-950/20 text-emerald-400 border-emerald-900/50",
  CANCELLED: "bg-red-950/20 text-red-400 border-red-900/50",
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function displayName(u: AssigneeUser | null | undefined) {
  if (!u) return "Unassigned";
  return u.name || u.email.split("@")[0];
}

function isOverdue(t: Ticket) {
  return (
    !!t.dueDate &&
    t.status !== "DONE" &&
    t.status !== "CANCELLED" &&
    new Date(t.dueDate).getTime() < Date.now()
  );
}

const COUNT_CHIP_STYLES: Record<string, string> = {
  OPEN: "bg-zinc-900/20 text-zinc-300 border-zinc-800",
  IN_PROGRESS: "bg-blue-950/20 text-blue-400 border-blue-900/50",
  DONE: "bg-emerald-950/20 text-emerald-400 border-emerald-900/50",
  CANCELLED: "bg-zinc-900/20 text-zinc-600 border-zinc-800",
};

function AssigneeCombobox({
  assignees,
  value,
  onChange,
}: {
  assignees: AssigneeUser[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const selected = assignees.find((u) => u.id === value) || null;
  const q = query.trim().toLowerCase();
  const filtered = assignees.filter(
    (u) =>
      (u.name || "").toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
  );

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const select = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery("");
    setHighlight(0);
  };

  if (selected) {
    return (
      <span className="inline-flex items-center gap-1.5 w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs">
        <User className="w-3 h-3 text-zinc-500 flex-shrink-0" />
        <span className="truncate text-zinc-200">{selected.name || selected.email}</span>
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear assignee"
          className="ml-auto text-zinc-500 hover:text-zinc-200 flex-shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </span>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <input
        type="text"
        placeholder="Search people..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setHighlight((h) => Math.min(h + 1, filtered.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            if (open && filtered[highlight]) {
              e.preventDefault();
              select(filtered[highlight].id);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
      />
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 max-h-48 overflow-y-auto rounded-md border border-[#27272a] bg-[#09090b] shadow-xl shadow-black/50 z-50">
          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-center text-[11px] text-zinc-600">
              No matching people
            </div>
          ) : (
            filtered.map((u, i) => (
              <button
                key={u.id}
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => select(u.id)}
                className={`w-full text-left px-3 py-2 border-b border-[#27272a]/60 last:border-0 ${
                  i === highlight ? "bg-zinc-900" : ""
                }`}
              >
                <p className="text-xs font-medium text-zinc-200 truncate">
                  {u.name || u.email}
                </p>
                <p className="text-[10px] text-zinc-600 truncate">{u.email}</p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ClampedDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <p className="text-[11px] text-zinc-500 leading-snug mt-1">
      <span className={expanded ? "" : "line-clamp-2"}>{text}</span>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="ml-1 text-[10px] font-semibold text-zinc-400 hover:text-zinc-200"
      >
        {expanded ? "less" : "more"}
      </button>
    </p>
  );
}

function MemberCard({
  name,
  email,
  assignee,
  counts,
  openCount,
  tickets,
  onOpen,
}: {
  name: string;
  email: string | null;
  assignee: AssigneeUser | null;
  counts: Record<string, number>;
  openCount: number;
  tickets: MemberTicket[];
  onOpen: (t: Ticket) => void;
}) {
  return (
    <div className="border border-[#27272a] rounded-lg bg-[#09090b]">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[#27272a]">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-100">
          <User className="w-3.5 h-3.5 text-zinc-500" />
          {name}
        </span>
        {email && <span className="text-[10px] text-zinc-600">{email}</span>}
        <div className="flex items-center gap-1.5 ml-auto">
          {STATUSES.map((s) =>
            (counts[s] || 0) > 0 ? (
              <span
                key={s}
                className={`px-1.5 py-0.5 rounded-full text-[9px] font-black border ${
                  COUNT_CHIP_STYLES[s]
                }`}
              >
                {STATUS_LABELS[s]} {counts[s]}
              </span>
            ) : null
          )}
          <span className="text-[10px] font-bold text-amber-500 whitespace-nowrap">
            {openCount} open
          </span>
        </div>
      </div>

      {tickets.length === 0 ? (
        <div className="px-4 py-4 text-[11px] text-zinc-600">No tickets</div>
      ) : (
        <div className="divide-y divide-[#27272a]/60">
          {tickets.map((t) => (
            <div key={t.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase border ${
                    PRIORITY_STYLES[t.priority] || PRIORITY_STYLES.MEDIUM
                  }`}
                >
                  {t.priority}
                </span>
                <button
                  onClick={() => onOpen({ ...t, assignee })}
                  className="text-xs font-semibold text-zinc-100 hover:text-white hover:underline text-left truncate min-w-0"
                >
                  {t.title}
                </button>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border whitespace-nowrap ${
                    STATUS_STYLES[t.status] || STATUS_STYLES.OPEN
                  }`}
                >
                  {STATUS_LABELS[t.status] || t.status}
                </span>
                <span className="text-[10px] text-zinc-600 whitespace-nowrap">
                  raised {timeAgo(t.createdAt)}
                  {t.assignedAt && <> · assigned {timeAgo(t.assignedAt)}</>}
                </span>
                {t.dueDate && (
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-zinc-400 whitespace-nowrap">
                    <Calendar className="w-3 h-3" />
                    {new Date(t.dueDate).toLocaleDateString()}
                  </span>
                )}
                <span className="text-[10px] text-zinc-600 whitespace-nowrap ml-auto">
                  by {displayName(t.creator)}
                </span>
              </div>
              {t.description && <ClampedDescription text={t.description} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TicketsClient({ currentUser, isManagement }: TicketsClientProps) {
  const [view, setView] = useState<ViewKey>("mine");
  const [layout, setLayout] = useState<"list" | "member">("list");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [assignees, setAssignees] = useState<AssigneeUser[]>([]);

  // By-member view states
  const [byMember, setByMember] = useState<ByMemberData | null>(null);
  const [byMemberLoading, setByMemberLoading] = useState(false);
  const [byMemberError, setByMemberError] = useState<string | null>(null);

  // Create modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPriority, setNewPriority] = useState("MEDIUM");
  const [newAssigneeId, setNewAssigneeId] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [creating, setCreating] = useState(false);

  // Detail modal states
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftStatus, setDraftStatus] = useState("OPEN");
  const [draftPriority, setDraftPriority] = useState("MEDIUM");
  const [draftAssigneeId, setDraftAssigneeId] = useState("");
  const [draftDueDate, setDraftDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchTickets();
  }, [view, statusFilter]);

  useEffect(() => {
    fetchAssignees();
  }, []);

  useEffect(() => {
    if (layout === "member" && !byMember && !byMemberLoading) fetchByMember();
  }, [layout]);

  const fetchByMember = async () => {
    setByMemberLoading(true);
    setByMemberError(null);
    try {
      const res = await fetch("/api/tickets/by-member");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load tickets by member");
      setByMember(data);
    } catch (err: any) {
      setByMemberError(err.message || "Failed to load tickets by member");
    } finally {
      setByMemberLoading(false);
    }
  };

  const fetchTickets = async () => {
    setTicketsLoading(true);
    try {
      const params = new URLSearchParams({ view });
      if (statusFilter.length > 0) params.set("status", statusFilter.join(","));
      const res = await fetch(`/api/tickets?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTickets(data.tickets || []);
    } catch (err: any) {
      toast.error(err.message || "Failed to load tickets");
    } finally {
      setTicketsLoading(false);
    }
  };

  const fetchAssignees = async () => {
    try {
      const res = await fetch("/api/tickets/assignees");
      const data = await res.json();
      if (res.ok) setAssignees(data.users || []);
    } catch (err) {
      console.error("Failed to fetch assignees:", err);
    }
  };

  const toggleStatusFilter = (status: string) => {
    setStatusFilter((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    );
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          description: newDesc || null,
          priority: newPriority,
          assigneeId: newAssigneeId || null,
          dueDate: newDueDate || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success("Ticket raised!");
      if (data.ticket) setTickets((prev) => [data.ticket, ...prev]);
      setShowCreateModal(false);
      setNewTitle("");
      setNewDesc("");
      setNewPriority("MEDIUM");
      setNewAssigneeId("");
      setNewDueDate("");
      fetchTickets();
    } catch (err: any) {
      toast.error(err.message || "Failed to create ticket");
    } finally {
      setCreating(false);
    }
  };

  const openDetail = (ticket: Ticket) => {
    setSelectedTicket(ticket);
    setDraftTitle(ticket.title);
    setDraftDesc(ticket.description || "");
    setDraftStatus(ticket.status);
    setDraftPriority(ticket.priority);
    setDraftAssigneeId(ticket.assignee?.id || "");
    setDraftDueDate(ticket.dueDate ? ticket.dueDate.substring(0, 10) : "");
  };

  const handleSaveTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/tickets/${selectedTicket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draftTitle.trim(),
          description: draftDesc || null,
          status: draftStatus,
          priority: draftPriority,
          assigneeId: draftAssigneeId || null,
          dueDate: draftDueDate || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success("Ticket updated");
      setSelectedTicket(null);
      fetchTickets();
    } catch (err: any) {
      toast.error(err.message || "Failed to update ticket");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTicket = async () => {
    if (!selectedTicket) return;
    if (!confirm("Are you sure you want to delete this ticket?")) return;
    try {
      const res = await fetch(`/api/tickets/${selectedTicket.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success("Ticket deleted");
      setTickets((prev) => prev.filter((t) => t.id !== selectedTicket.id));
      setSelectedTicket(null);
      fetchTickets();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete ticket");
    }
  };

  const statusCounts = STATUSES.reduce<Record<string, number>>((acc, s) => {
    acc[s] = tickets.filter((t) => t.status === s).length;
    return acc;
  }, {});

  const canEditSelected =
    !!selectedTicket && (isManagement || selectedTicket.creator.id === currentUser.id);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 text-zinc-100 bg-[#09090b]">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 border-b border-[#27272a] pb-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Tickets</h1>
          <p className="text-xs text-zinc-400">
            Raise and assign tasks across the team.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-[#27272a] rounded-md overflow-hidden">
            {(
              [
                { key: "list", label: "List", icon: LayoutList },
                { key: "member", label: "By member", icon: Users },
              ] as { key: "list" | "member"; label: string; icon: any }[]
            ).map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  onClick={() => setLayout(tab.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition ${
                    layout === tab.key
                      ? "bg-[#2563eb] text-white"
                      : "bg-[#121214] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {tab.label}
                </button>
              );
            })}
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2563eb] text-white rounded-md text-xs font-semibold hover:bg-blue-700 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            New ticket
          </button>
        </div>
      </div>

      {layout === "member" ? (
        <div className="space-y-4">
          {byMemberLoading && !byMember ? (
            <div className="space-y-4">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="border border-[#27272a] rounded-lg bg-[#09090b] p-4 animate-pulse"
                >
                  <div className="h-3 w-40 bg-zinc-800 rounded" />
                  <div className="mt-3 space-y-2">
                    <div className="h-2.5 w-full bg-zinc-900 rounded" />
                    <div className="h-2.5 w-3/4 bg-zinc-900 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : byMemberError ? (
            <div className="border border-[#27272a] rounded-lg bg-[#09090b] py-12 text-center space-y-3">
              <AlertCircle className="w-8 h-8 text-red-900 mx-auto" />
              <div className="text-zinc-500 text-xs">{byMemberError}</div>
              <button
                onClick={fetchByMember}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[#27272a] hover:bg-zinc-900 rounded-md text-xs font-semibold transition"
              >
                Retry
              </button>
            </div>
          ) : byMember ? (
            <>
              {[...byMember.members]
                .sort((a, b) => b.openCount - a.openCount)
                .map((m) => (
                  <MemberCard
                    key={m.user.id}
                    name={m.user.name || m.user.email}
                    email={m.user.email}
                    assignee={m.user}
                    counts={m.counts}
                    openCount={m.openCount}
                    tickets={m.tickets}
                    onOpen={openDetail}
                  />
                ))}
              {byMember.unassigned.tickets.length > 0 && (
                <MemberCard
                  name="Unassigned"
                  email={null}
                  assignee={null}
                  counts={byMember.unassigned.counts}
                  openCount={
                    (byMember.unassigned.counts.OPEN || 0) +
                    (byMember.unassigned.counts.IN_PROGRESS || 0)
                  }
                  tickets={byMember.unassigned.tickets}
                  onOpen={openDetail}
                />
              )}
            </>
          ) : null}
        </div>
      ) : (
      <>
      {/* View tabs */}
      <div className="flex gap-2 border-b border-[#27272a]">
        {(
          [
            { key: "mine", label: "Assigned to me" },
            { key: "created", label: "Created by me" },
            { key: "all", label: "All" },
          ] as { key: ViewKey; label: string }[]
        ).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setView(tab.key)}
            className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
              view === tab.key
                ? "border-[#2563eb] text-white"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Status filter chips */}
      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => {
          const active = statusFilter.includes(s);
          return (
            <button
              key={s}
              onClick={() => toggleStatusFilter(s)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider border transition-all ${
                active
                  ? "bg-[#2563eb]/10 text-[#2563eb] border-[#2563eb]/30"
                  : "bg-[#121214] text-zinc-400 border-[#27272a] hover:text-zinc-200 hover:border-zinc-700"
              }`}
            >
              {s === "DONE" ? (
                <CheckCircle className="w-3 h-3" />
              ) : s === "CANCELLED" ? (
                <X className="w-3 h-3" />
              ) : s === "IN_PROGRESS" ? (
                <AlertCircle className="w-3 h-3" />
              ) : (
                <TicketCheck className="w-3 h-3" />
              )}
              {STATUS_LABELS[s]}
              <span
                className={`px-1.5 py-0.5 rounded-full text-[9px] font-black ${
                  active ? "bg-[#2563eb]/20 text-[#2563eb]" : "bg-zinc-800 text-zinc-500"
                }`}
              >
                {statusCounts[s] || 0}
              </span>
            </button>
          );
        })}
      </div>

      {/* Ticket list */}
      <div className="border border-[#27272a] rounded-md bg-[#09090b] p-4">
        <div className="flex justify-between items-center pb-3 border-b border-[#27272a] mb-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
            {view === "mine"
              ? "Tickets assigned to you"
              : view === "created"
              ? "Tickets you raised"
              : "All team tickets"}
          </h2>
          <span className="text-[10px] text-zinc-500 font-bold bg-[#121214] px-1.5 py-0.5 rounded-full border border-zinc-800">
            {tickets.length} ticket(s)
          </span>
        </div>

        {ticketsLoading ? (
          <div className="text-zinc-500 py-10 text-center text-xs">Loading tickets...</div>
        ) : tickets.length === 0 ? (
          <div className="py-12 text-center space-y-3">
            <TicketCheck className="w-8 h-8 text-zinc-700 mx-auto" />
            <div className="text-zinc-500 text-xs">
              No tickets here — raise one to get the team moving.
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#2563eb] text-white rounded-md text-xs font-semibold hover:bg-blue-700 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              New ticket
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#27272a] text-zinc-500 font-bold uppercase tracking-wider">
                  <th className="py-2.5 pr-4">Priority</th>
                  <th className="py-2.5 pr-4">Title</th>
                  <th className="py-2.5 pr-4">Status</th>
                  <th className="py-2.5 pr-4">Assignee</th>
                  <th className="py-2.5 pr-4">Raised by</th>
                  <th className="py-2.5 pr-4">Due</th>
                  <th className="py-2.5 text-right">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#27272a]">
                {tickets.map((t) => (
                  <tr key={t.id} className="hover:bg-zinc-900/50 transition text-zinc-300">
                    <td className="py-3 pr-4">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase border ${
                          PRIORITY_STYLES[t.priority] || PRIORITY_STYLES.MEDIUM
                        }`}
                      >
                        {t.priority}
                      </span>
                    </td>
                    <td className="py-3 pr-4 max-w-[320px]">
                      <button
                        onClick={() => openDetail(t)}
                        className="font-semibold text-zinc-100 hover:text-white hover:underline text-left truncate block max-w-full"
                      >
                        {t.title}
                      </button>
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border whitespace-nowrap ${
                          STATUS_STYLES[t.status] || STATUS_STYLES.OPEN
                        }`}
                      >
                        {STATUS_LABELS[t.status] || t.status}
                      </span>
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap">
                      <span className="flex items-center gap-1 text-zinc-400">
                        <User className="w-3 h-3" />
                        {displayName(t.assignee)}
                      </span>
                      {t.assignee && t.assignedAt && (
                        <span className="block text-[9px] text-zinc-600 mt-0.5">
                          assigned {timeAgo(t.assignedAt)}
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-zinc-400 whitespace-nowrap">
                      {displayName(t.creator)}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap">
                      {t.dueDate ? (
                        <span
                          className={`flex items-center gap-1 text-[10px] font-semibold ${
                            isOverdue(t) ? "text-red-400" : "text-zinc-400"
                          }`}
                        >
                          <Calendar className="w-3 h-3" />
                          {new Date(t.dueDate).toLocaleDateString()}
                          {isOverdue(t) && (
                            <span className="px-1.5 py-0.5 rounded-full bg-red-950/20 border border-red-900/50 text-[8px] font-black uppercase">
                              Overdue
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-zinc-600 text-[10px]">—</span>
                      )}
                    </td>
                    <td className="py-3 text-right text-[10px] text-zinc-500 whitespace-nowrap">
                      {timeAgo(t.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </>
      )}

      {/* Create Ticket Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateTicket}
            className="w-full max-w-md border border-[#27272a] rounded-lg bg-[#09090b] p-6 space-y-4"
          >
            <div className="flex justify-between items-center border-b border-[#27272a] pb-3">
              <h3 className="font-bold text-sm text-white uppercase tracking-wider">New Ticket</h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-zinc-500 hover:text-zinc-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Title</label>
              <input
                type="text"
                required
                placeholder="e.g. Fix caption overlay on remix exports"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Description</label>
              <textarea
                placeholder="Context, links, expected outcome..."
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-blue-500 h-20 resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Priority</label>
                <select
                  value={newPriority}
                  onChange={(e) => setNewPriority(e.target.value)}
                  className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Assignee</label>
                <AssigneeCombobox
                  assignees={assignees}
                  value={newAssigneeId}
                  onChange={setNewAssigneeId}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Due Date</label>
              <input
                type="date"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none"
              />
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
                disabled={creating}
                className="px-3 py-1.5 bg-[#2563eb] text-white hover:bg-blue-700 rounded-md text-xs font-semibold transition disabled:opacity-50"
              >
                {creating ? "Raising..." : "Raise Ticket"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Ticket Detail Modal */}
      {selectedTicket && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveTicket}
            className="w-full max-w-lg border border-[#27272a] rounded-lg bg-[#09090b] p-6 space-y-4"
          >
            <div className="flex justify-between items-center border-b border-[#27272a] pb-3">
              <h3 className="font-bold text-sm text-white uppercase tracking-wider flex items-center gap-2">
                <TicketCheck className="w-4 h-4 text-[#2563eb]" />
                Ticket Detail
              </h3>
              <button
                type="button"
                onClick={() => setSelectedTicket(null)}
                className="text-zinc-500 hover:text-zinc-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Title</label>
              {canEditSelected ? (
                <input
                  type="text"
                  required
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                />
              ) : (
                <p className="text-sm font-semibold text-zinc-100 py-1">{selectedTicket.title}</p>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Description</label>
              {canEditSelected ? (
                <textarea
                  value={draftDesc}
                  onChange={(e) => setDraftDesc(e.target.value)}
                  className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-blue-500 h-20 resize-none"
                />
              ) : (
                <p className="text-xs text-zinc-300 whitespace-pre-wrap py-1">
                  {selectedTicket.description || "No description."}
                </p>
              )}
            </div>

            {/* Status segmented control */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Status</label>
              <div className="flex border border-[#27272a] rounded-md overflow-hidden">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setDraftStatus(s)}
                    className={`flex-1 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider transition ${
                      draftStatus === s
                        ? "bg-[#2563eb] text-white"
                        : "bg-[#121214] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
                    }`}
                  >
                    {STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Priority</label>
                <select
                  value={draftPriority}
                  onChange={(e) => setDraftPriority(e.target.value)}
                  className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Assignee</label>
                <AssigneeCombobox
                  assignees={assignees}
                  value={draftAssigneeId}
                  onChange={setDraftAssigneeId}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Due Date</label>
              <input
                type="date"
                value={draftDueDate}
                onChange={(e) => setDraftDueDate(e.target.value)}
                className="w-full bg-[#121214] border border-[#27272a] rounded-md px-3 py-2 text-xs focus:outline-none"
              />
            </div>

            {/* Meta */}
            <div className="border-t border-[#27272a] pt-3 space-y-1 text-[10px] text-zinc-500">
              <div>
                Raised by <span className="text-zinc-300 font-semibold">{displayName(selectedTicket.creator)}</span>{" "}
                on {new Date(selectedTicket.createdAt).toLocaleString()}
              </div>
              {selectedTicket.assignedAt && (
                <div>
                  Assigned to{" "}
                  <span className="text-zinc-300 font-semibold">{displayName(selectedTicket.assignee)}</span>{" "}
                  {timeAgo(selectedTicket.assignedAt)}
                </div>
              )}
              {selectedTicket.status === "DONE" && selectedTicket.completedAt && (
                <div>
                  Completed on{" "}
                  <span className="text-emerald-400 font-semibold">
                    {new Date(selectedTicket.completedAt).toLocaleString()}
                  </span>
                </div>
              )}
            </div>

            <div className="flex gap-3 justify-between pt-3">
              <div>
                {canEditSelected && (
                  <button
                    type="button"
                    onClick={handleDeleteTicket}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600/10 border border-red-900/50 text-red-400 hover:bg-red-600/20 rounded-md text-xs font-semibold transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedTicket(null)}
                  className="px-3 py-1.5 border border-[#27272a] hover:bg-zinc-900 rounded-md text-xs font-semibold transition"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-3 py-1.5 bg-[#2563eb] text-white hover:bg-blue-700 rounded-md text-xs font-semibold transition disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
