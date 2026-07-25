"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Users,
  UserX,
  Search,
  RefreshCw,
  Loader2,
  AlertCircle,
  Check,
  X,
  MonitorSmartphone,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  ShieldOff,
  LogIn,
} from "lucide-react";
import { toast } from "sonner";

/* ---------- types ---------- */

type PresenceStatus = "online" | "idle" | "offline";

interface OnlineUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
  lastSeenAt: string | null;
  activeSessionCount: number;
  deviceSummary: string;
}

interface ActivityUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
  status: PresenceStatus;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
}

interface SessionInfo {
  id: string;
  deviceSummary: string;
  ipAddress: string | null;
  createdAt: string;
  lastSeenAt: string;
}

interface AbsentUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
  lastLoginAt: string | null;
}

interface LoginEventRow {
  id: string;
  userId: string | null;
  userName: string | null;
  attemptedUsername: string | null;
  success: boolean;
  createdAt: string;
  ipAddress: string | null;
  deviceSummary: string;
}

type Tab = "online" | "activity" | "absent";
type SortKey = "name" | "lastLoginAt" | "lastSeenAt";

/* ---------- helpers ---------- */

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatIST(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  );
  return `${parts.day} ${parts.month}, ${parts.hour}:${parts.minute} ${(parts.dayPeriod || "").toUpperCase()} IST`;
}

function istDateString(d: Date): string {
  // YYYY-MM-DD in IST — the server does the actual day-boundary math in the org tz
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`); // noon UTC keeps us safely inside the IST day
  d.setUTCDate(d.getUTCDate() + days);
  return istDateString(d);
}

const STATUS_META: Record<PresenceStatus, { label: string; dot: string; text: string }> = {
  online: { label: "Online", dot: "bg-emerald-400", text: "text-emerald-400" },
  idle: { label: "Idle", dot: "bg-amber-400", text: "text-amber-400" },
  offline: { label: "Offline", dot: "bg-zinc-600", text: "text-zinc-500" },
};

function StatusDot({ status, pulse }: { status: PresenceStatus; pulse?: boolean }) {
  const meta = STATUS_META[status];
  return (
    <span className="relative inline-flex w-2 h-2">
      {pulse && status === "online" && (
        <span className={`absolute inline-flex w-full h-full rounded-full ${meta.dot} opacity-60 animate-ping`} />
      )}
      <span className={`relative inline-flex w-2 h-2 rounded-full ${meta.dot}`} />
    </span>
  );
}

/* ---------- page ---------- */

export default function ClientPage() {
  const [tab, setTab] = useState<Tab>("online");

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-zinc-900 border border-[#27272a] flex items-center justify-center text-[#E11D48]">
          <Activity className="w-4.5 h-4.5" />
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tight text-zinc-100">Team Activity</h1>
          <p className="text-xs text-zinc-500">Who's online, who logged in, who didn't.</p>
        </div>
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="Activity views" className="flex gap-1 border-b border-[#27272a]">
        {(
          [
            { key: "online", label: "Who's online", icon: Activity },
            { key: "activity", label: "Login activity", icon: Users },
            { key: "absent", label: "Who hasn't logged in", icon: UserX },
          ] as const
        ).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
              tab === key
                ? "border-[#E11D48] text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {tab === "online" && <OnlineTab active={tab === "online"} />}
      {tab === "activity" && <ActivityTab />}
      {tab === "absent" && <AbsentTab />}
    </div>
  );
}

/* ---------- tab a: who's online ---------- */

function OnlineTab({ active }: { active: boolean }) {
  const [users, setUsers] = useState<OnlineUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOnline = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const res = await fetch("/api/admin/activity/online");
      if (!res.ok) throw new Error("Failed to load online users");
      const data = await res.json();
      setUsers(data.users);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to load online users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    fetchOnline(true);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") fetchOnline();
    }, 30_000);
    return () => clearInterval(interval);
  }, [active, fetchOnline]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-zinc-500 gap-2 text-xs">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading online users…
      </div>
    );
  }
  if (error) {
    return <ErrorState message={error} onRetry={() => fetchOnline(true)} />;
  }
  if (users.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
        <Users className="w-8 h-8 text-zinc-700" />
        <p className="text-sm text-zinc-400 font-medium">No one is online right now</p>
        <p className="text-xs text-zinc-600">This refreshes automatically every 30 seconds.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        <span className="text-emerald-400 font-semibold">{users.length}</span>{" "}
        {users.length === 1 ? "person" : "people"} online · refreshes every 30s
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {users.map((u) => (
          <div
            key={u.id}
            className="bg-[#18181b] border border-[#27272a] rounded-lg p-4 flex items-start gap-3"
          >
            <div className="mt-1">
              <StatusDot status="online" pulse />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold text-zinc-100 truncate">
                  {u.name || u.email}
                </p>
                <span className="text-[10px] uppercase tracking-wider font-bold text-zinc-500 bg-zinc-900 border border-[#27272a] rounded px-1.5 py-0.5">
                  {u.role}
                </span>
              </div>
              <p className="text-xs text-zinc-500 truncate">{u.email}</p>
              <div className="mt-2 flex items-center gap-3 text-[11px] text-zinc-500 flex-wrap">
                <span className="flex items-center gap-1">
                  <MonitorSmartphone className="w-3 h-3" />
                  {u.deviceSummary}
                </span>
                <span>
                  {u.activeSessionCount} active {u.activeSessionCount === 1 ? "session" : "sessions"}
                </span>
                <span title={formatIST(u.lastSeenAt)}>last seen {timeAgo(u.lastSeenAt)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- tab b: login activity ---------- */

function ActivityTab() {
  const [users, setUsers] = useState<ActivityUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (roleFilter) params.set("role", roleFilter);
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/admin/activity/users?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load user activity");
      const data = await res.json();
      setUsers(data.users);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to load user activity");
    } finally {
      setLoading(false);
    }
  }, [roleFilter, statusFilter]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const roles = useMemo(
    () => [...new Set(users.map((u) => u.role))].sort(),
    [users]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? users.filter(
          (u) =>
            (u.name || "").toLowerCase().includes(q) ||
            u.email.toLowerCase().includes(q)
        )
      : users;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === "name") {
        return dir * (a.name || a.email).localeCompare(b.name || b.email);
      }
      const av = a[sortKey] ? new Date(a[sortKey] as string).getTime() : null;
      const bv = b[sortKey] ? new Date(b[sortKey] as string).getTime() : null;
      if (av === null && bv === null) return 0;
      if (av === null) return 1; // nulls last
      if (bv === null) return -1;
      return dir * (av - bv);
    });
  }, [users, search, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const SortHeader = ({ label, k }: { label: string; k: SortKey }) => (
    <button
      onClick={() => toggleSort(k)}
      className="flex items-center gap-1 hover:text-zinc-200 transition-colors"
      aria-label={`Sort by ${label}`}
    >
      {label}
      {sortKey === k ? (
        sortDir === "asc" ? (
          <ChevronUp className="w-3 h-3" />
        ) : (
          <ChevronDown className="w-3 h-3" />
        )
      ) : (
        <ArrowUpDown className="w-3 h-3 opacity-40" />
      )}
    </button>
  );

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email…"
            className="w-full bg-[#18181b] border border-[#27272a] rounded-md pl-9 pr-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-[#E11D48]/50"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          aria-label="Filter by role"
          className="bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-[#E11D48]/50"
        >
          <option value="">All roles</option>
          {roles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
          className="bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-[#E11D48]/50"
        >
          <option value="">All statuses</option>
          <option value="online">Online</option>
          <option value="idle">Idle</option>
          <option value="offline">Offline</option>
        </select>
        <button
          onClick={fetchUsers}
          className="flex items-center gap-1.5 px-3 py-2 text-xs text-zinc-400 bg-[#18181b] border border-[#27272a] rounded-md hover:text-zinc-200 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-zinc-500 gap-2 text-xs">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading user activity…
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={fetchUsers} />
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
          <Users className="w-8 h-8 text-zinc-700" />
          <p className="text-sm text-zinc-400 font-medium">No users match these filters</p>
        </div>
      ) : (
        <div className="bg-[#18181b] border border-[#27272a] rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#27272a] text-zinc-500 text-left">
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium"><SortHeader label="Name" k="name" /></th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium"><SortHeader label="Last login" k="lastLoginAt" /></th>
                <th className="px-4 py-3 font-medium"><SortHeader label="Last seen" k="lastSeenAt" /></th>
                <th className="px-4 py-3 font-medium text-right">Sessions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((u) => (
                <React.Fragment key={u.id}>
                  <tr className="border-b border-[#27272a]/60 last:border-0 hover:bg-zinc-900/40">
                    <td className="px-4 py-3">
                      <span className={`flex items-center gap-2 ${STATUS_META[u.status].text}`}>
                        <StatusDot status={u.status} pulse />
                        {STATUS_META[u.status].label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-zinc-100 font-medium">{u.name || "—"}</p>
                      <p className="text-zinc-500">{u.email}</p>
                    </td>
                    <td className="px-4 py-3 text-zinc-400">{u.role}</td>
                    <td className="px-4 py-3 text-zinc-400" title={formatIST(u.lastLoginAt)}>
                      {u.lastLoginAt ? timeAgo(u.lastLoginAt) : "never"}
                    </td>
                    <td className="px-4 py-3 text-zinc-400" title={formatIST(u.lastSeenAt)}>
                      {u.lastSeenAt ? timeAgo(u.lastSeenAt) : "never"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() =>
                          setExpandedUserId(expandedUserId === u.id ? null : u.id)
                        }
                        aria-expanded={expandedUserId === u.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-[#27272a] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 transition-colors"
                      >
                        Sessions
                        {expandedUserId === u.id ? (
                          <ChevronUp className="w-3 h-3" />
                        ) : (
                          <ChevronDown className="w-3 h-3" />
                        )}
                      </button>
                    </td>
                  </tr>
                  {expandedUserId === u.id && (
                    <tr className="border-b border-[#27272a]/60 last:border-0">
                      <td colSpan={6} className="px-4 py-3 bg-zinc-900/30">
                        <SessionsPanel user={u} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RecentEventsStrip />
    </div>
  );
}

function SessionsPanel({ user }: { user: ActivityUser }) {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/activity/users/${user.id}/sessions`);
      if (!res.ok) throw new Error("Failed to load sessions");
      const data = await res.json();
      setSessions(data.sessions);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to load sessions");
    }
  }, [user.id]);

  useEffect(() => {
    load();
  }, [load]);

  const revokeOne = async (sessionId: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/activity/sessions/${sessionId}/revoke`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to revoke session");
      toast.success("Session revoked");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to revoke session");
    } finally {
      setBusy(false);
    }
  };

  const revokeAll = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/activity/users/${user.id}/revoke-all`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to revoke sessions");
      toast.success(`Revoked ${data.revoked} session${data.revoked === 1 ? "" : "s"}`);
      setConfirmRevokeAll(false);
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to revoke sessions");
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return <ErrorState message={error} onRetry={load} compact />;
  }
  if (sessions === null) {
    return (
      <div className="flex items-center gap-2 py-3 text-xs text-zinc-500">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading sessions…
      </div>
    );
  }

  return (
    <div className="space-y-3 py-1">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wider font-bold text-zinc-500">
          Active sessions for {user.name || user.email}
        </p>
        {sessions.length > 0 &&
          (confirmRevokeAll ? (
            <span className="flex items-center gap-2">
              <span className="text-[11px] text-zinc-400">Revoke all sessions?</span>
              <button
                onClick={revokeAll}
                disabled={busy}
                autoFocus
                className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-[#E11D48] text-white hover:bg-[#be123c] disabled:opacity-50 transition-colors"
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirmRevokeAll(false)}
                disabled={busy}
                className="px-2.5 py-1 text-[11px] rounded-md border border-[#27272a] text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmRevokeAll(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md border border-[#E11D48]/40 text-[#E11D48] hover:bg-[#E11D48]/10 transition-colors"
            >
              <ShieldOff className="w-3 h-3" />
              Revoke all
            </button>
          ))}
      </div>
      {sessions.length === 0 ? (
        <p className="text-xs text-zinc-600 py-2">No active sessions.</p>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-3 bg-[#18181b] border border-[#27272a] rounded-md px-3 py-2"
            >
              <div className="flex items-center gap-4 text-[11px] text-zinc-400 flex-wrap min-w-0">
                <span className="flex items-center gap-1.5 text-zinc-200">
                  <MonitorSmartphone className="w-3.5 h-3.5 text-zinc-500" />
                  {s.deviceSummary}
                </span>
                <span>{s.ipAddress || "unknown IP"}</span>
                <span title={formatIST(s.createdAt)}>created {timeAgo(s.createdAt)}</span>
                <span title={formatIST(s.lastSeenAt)}>last seen {timeAgo(s.lastSeenAt)}</span>
              </div>
              <button
                onClick={() => revokeOne(s.id)}
                disabled={busy}
                className="px-2.5 py-1 text-[11px] font-medium rounded-md border border-[#27272a] text-zinc-400 hover:text-[#E11D48] hover:border-[#E11D48]/40 disabled:opacity-50 transition-colors flex-shrink-0"
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RecentEventsStrip() {
  const [events, setEvents] = useState<LoginEventRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/activity/events?limit=15");
      if (!res.ok) throw new Error("Failed to load login events");
      const data = await res.json();
      setEvents(data.events);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to load login events");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center gap-2">
        <LogIn className="w-3.5 h-3.5 text-zinc-500" />
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
          Recent login events
        </h2>
      </div>
      {error ? (
        <ErrorState message={error} onRetry={load} compact />
      ) : events === null ? (
        <div className="flex items-center gap-2 py-4 text-xs text-zinc-500">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading events…
        </div>
      ) : events.length === 0 ? (
        <p className="text-xs text-zinc-600 py-2">No login events recorded yet.</p>
      ) : (
        <div className="bg-[#18181b] border border-[#27272a] rounded-lg divide-y divide-[#27272a]/60">
          {events.map((e) => (
            <div key={e.id} className="flex items-center gap-3 px-4 py-2.5 text-xs">
              {e.success ? (
                <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" aria-label="Success" />
              ) : (
                <X className="w-3.5 h-3.5 text-red-500 flex-shrink-0" aria-label="Failed" />
              )}
              <span className="text-zinc-200 font-medium truncate">
                {e.userName || e.attemptedUsername || "Unknown"}
              </span>
              {!e.success && e.attemptedUsername && e.userName && (
                <span className="text-zinc-500 truncate">tried: {e.attemptedUsername}</span>
              )}
              <span className="text-zinc-600 hidden sm:inline">{e.deviceSummary}</span>
              <span className="text-zinc-600 hidden md:inline">{e.ipAddress || ""}</span>
              <span className="ml-auto text-zinc-500 flex-shrink-0" title={formatIST(e.createdAt)}>
                {timeAgo(e.createdAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- tab c: who hasn't logged in ---------- */

type Preset = "today" | "yesterday" | "7d" | "month" | "custom";

function presetRange(preset: Exclude<Preset, "custom">): { from: string; to: string; label: string } {
  const today = istDateString(new Date());
  if (preset === "today") return { from: today, to: today, label: "today" };
  if (preset === "yesterday") {
    const y = addDays(today, -1);
    return { from: y, to: y, label: "yesterday" };
  }
  if (preset === "7d") return { from: addDays(today, -6), to: today, label: "in the last 7 days" };
  return { from: `${today.slice(0, 8)}01`, to: today, label: "this month" };
}

function AbsentTab() {
  const [preset, setPreset] = useState<Preset>("today");
  const [customFrom, setCustomFrom] = useState(istDateString(new Date()));
  const [customTo, setCustomTo] = useState(istDateString(new Date()));
  const [result, setResult] = useState<{
    loggedInCount: number;
    totalUsers: number;
    notLoggedIn: AbsentUser[];
  } | null>(null);
  const [rangeLabel, setRangeLabel] = useState("today");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const runQuery = useCallback(
    async (from: string, to: string, label: string) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/activity/absent?from=${from}&to=${to}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to check logins");
        setResult(data);
        setRangeLabel(label);
        setError(null);
      } catch (err: any) {
        setError(err.message || "Failed to check logins");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (preset === "custom") return;
    const { from, to, label } = presetRange(preset);
    runQuery(from, to, label);
  }, [preset, runQuery]);

  const applyCustom = () => {
    if (!customFrom || !customTo) return;
    runQuery(customFrom, customTo, `from ${customFrom} to ${customTo}`);
  };

  const presets: { key: Preset; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "yesterday", label: "Yesterday" },
    { key: "7d", label: "Last 7 days" },
    { key: "month", label: "This month" },
    { key: "custom", label: "Custom" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {presets.map((p) => (
          <button
            key={p.key}
            onClick={() => setPreset(p.key)}
            aria-pressed={preset === p.key}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
              preset === p.key
                ? "bg-[#E11D48]/10 text-[#E11D48] border-[#E11D48]/40"
                : "border-[#27272a] text-zinc-400 hover:text-zinc-200 bg-[#18181b]"
            }`}
          >
            {p.label}
          </button>
        ))}
        {preset === "custom" && (
          <span className="flex items-center gap-2">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              aria-label="From date"
              className="bg-[#18181b] border border-[#27272a] rounded-md px-2 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-[#E11D48]/50"
            />
            <span className="text-zinc-600 text-xs">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              aria-label="To date"
              className="bg-[#18181b] border border-[#27272a] rounded-md px-2 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-[#E11D48]/50"
            />
            <button
              onClick={applyCustom}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-[#E11D48] text-white hover:bg-[#be123c] transition-colors"
            >
              Apply
            </button>
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-zinc-500 gap-2 text-xs">
          <Loader2 className="w-4 h-4 animate-spin" /> Checking logins…
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={() => {
          if (preset === "custom") applyCustom();
          else {
            const { from, to, label } = presetRange(preset);
            runQuery(from, to, label);
          }
        }} />
      ) : result ? (
        <div className="space-y-4">
          <p className="text-sm text-zinc-300">
            <span className="font-semibold text-zinc-100">{result.loggedInCount} of {result.totalUsers}</span>{" "}
            users logged in {rangeLabel} ·{" "}
            <span className={result.notLoggedIn.length > 0 ? "text-[#E11D48] font-semibold" : "text-emerald-400 font-semibold"}>
              {result.notLoggedIn.length} did not
            </span>
          </p>
          {result.notLoggedIn.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center space-y-2">
              <Check className="w-8 h-8 text-emerald-400" />
              <p className="text-sm text-zinc-400 font-medium">Everyone logged in {rangeLabel}</p>
            </div>
          ) : (
            <div className="bg-[#18181b] border border-[#27272a] rounded-lg divide-y divide-[#27272a]/60">
              {result.notLoggedIn.map((u) => (
                <div key={u.id} className="flex items-center gap-3 px-4 py-3 text-xs">
                  <UserX className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-zinc-100 font-medium truncate">{u.name || u.email}</p>
                    <p className="text-zinc-500 truncate">{u.email}</p>
                  </div>
                  <span className="text-[10px] uppercase tracking-wider font-bold text-zinc-500 bg-zinc-900 border border-[#27272a] rounded px-1.5 py-0.5">
                    {u.role}
                  </span>
                  <span className="ml-auto text-zinc-500 flex-shrink-0" title={formatIST(u.lastLoginAt)}>
                    last login: {u.lastLoginAt ? timeAgo(u.lastLoginAt) : "never"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- shared ---------- */

function ErrorState({
  message,
  onRetry,
  compact,
}: {
  message: string;
  onRetry: () => void;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center space-y-3 ${compact ? "py-6" : "py-16"}`}>
      <AlertCircle className="w-6 h-6 text-[#E11D48]" />
      <p className="text-xs text-zinc-400">{message}</p>
      <button
        onClick={onRetry}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-[#27272a] text-zinc-300 hover:bg-zinc-900 transition-colors"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        Retry
      </button>
    </div>
  );
}
