"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  CalendarCheck2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  ListChecks,
  Loader2,
  Package,
  Pencil,
  Search,
  Truck,
  Users,
  X,
} from "lucide-react";

const ACCENT = "#E11D48";

// ── Types (mirror the /api/distribution payload) ────────────────────────────
type Confirmation = {
  scheduledAt: string | null;
  scheduledBy: string | null;
  postedCount: number | null;
  postedAt: string | null;
  postedBy: string | null;
  note: string | null;
};

type DeliveryRow = {
  id: string;
  accountId: string;
  campaignId: string | null;
  batchId: string | null;
  videoCount: number;
  deliveredAt: string;
  status: "delivered" | "scheduled" | "posted";
  postingMode: "manual" | "auto_schedule" | "auto_post";
  outputFolderId: string | null;
  account: { id: string; tiktokUsername: string; color: string; driveFolderName: string | null } | null;
  campaign: { id: string; title: string } | null;
  confirmation: Confirmation | null;
  scheduledByUser: { id: string; name: string | null; email: string } | null;
  postedByUser: { id: string; name: string | null; email: string } | null;
};

type Summary = {
  delivered: number;
  accountsDelivered: number;
  scheduledCount: number;
  postedCount: number;
  pendingCount: number;
};

type AccountSearchResult = {
  driveFolderId: string;
  driveFolderName: string;
  color: string | null;
  account: { id: string; tiktokUsername: string } | null;
};

// ── Small helpers ────────────────────────────────────────────────────────────
const numFmt = new Intl.NumberFormat("en-US");

function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (diff < 0) return "just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function dayKeyFor(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "00";
  const d = parts.find((p) => p.type === "day")?.value ?? "00";
  return `${y}-${m}-${d}`;
}

function fmtDayHeader(dayKey: string, todayKey: string): string {
  if (dayKey === todayKey) return "Today";
  const d = new Date(`${dayKey}T12:00:00Z`);
  const yesterday = new Date(`${todayKey}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (dayKey === yesterday.toISOString().slice(0, 10)) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(d);
}

function fmtDateTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function userLabel(u: { name: string | null; email: string } | null): string {
  if (!u) return "unknown";
  return u.name || u.email.split("@")[0];
}

// ── Summary card ─────────────────────────────────────────────────────────────
function SummaryCard(props: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3.5 bg-zinc-900/60 ${
        props.highlight ? "border-[#E11D48]/40" : "border-zinc-800"
      }`}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {props.icon}
        {props.label}
      </div>
      <div className="mt-1.5 text-2xl font-bold text-white tabular-nums leading-none">{props.value}</div>
      {props.sub && <div className="mt-1.5 text-[11px] text-zinc-500">{props.sub}</div>}
    </div>
  );
}

// ── Posting mode chip ────────────────────────────────────────────────────────
function ModeChip({ mode, status }: { mode: DeliveryRow["postingMode"]; status: DeliveryRow["status"] }) {
  if (mode === "manual") {
    const needsTick = status === "delivered";
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium border ${
          needsTick
            ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
            : "bg-zinc-800/60 border-zinc-700/60 text-zinc-400"
        }`}
      >
        <ClipboardList className="w-3 h-3" />
        {needsTick ? "manual · tick needed" : "manual"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium border bg-zinc-800/60 border-zinc-700/60 text-zinc-400">
      {mode === "auto_schedule" ? "auto-schedule" : "auto-post"}
    </span>
  );
}

// ── Inline posted form (confirm + edit) ──────────────────────────────────────
function PostedForm(props: {
  defaultCount: number;
  defaultNote?: string;
  busy: boolean;
  submitLabel: string;
  onSubmit: (count: number, note: string) => void;
  onCancel?: () => void;
}) {
  const [count, setCount] = useState(String(props.defaultCount));
  const [note, setNote] = useState(props.defaultNote ?? "");

  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        const n = parseInt(count, 10);
        if (isNaN(n) || n < 0) {
          toast.error("Enter a valid count");
          return;
        }
        props.onSubmit(n, note.trim());
      }}
    >
      <input
        type="number"
        min={0}
        value={count}
        onChange={(e) => setCount(e.target.value)}
        aria-label="Posted count"
        className="w-16 bg-zinc-950 border border-zinc-700 rounded-md px-2 py-1 text-xs text-zinc-200 tabular-nums focus:outline-none focus:border-[#E11D48]"
      />
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        aria-label="Note"
        className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 rounded-md px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-[#E11D48]"
      />
      <button
        type="submit"
        disabled={props.busy}
        title={props.submitLabel}
        className="shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-white disabled:opacity-50 transition-colors"
        style={{ backgroundColor: ACCENT }}
      >
        {props.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
        {props.submitLabel}
      </button>
      {props.onCancel && (
        <button
          type="button"
          onClick={props.onCancel}
          className="shrink-0 p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          title="Cancel"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </form>
  );
}

// ── One delivery row ─────────────────────────────────────────────────────────
function DeliveryRowView(props: {
  row: DeliveryRow;
  timezone: string;
  selected: boolean;
  busy: boolean;
  editingPosted: boolean;
  onToggleSelect: () => void;
  onTickScheduled: () => void;
  onTickPosted: (count: number, note: string) => void;
  onStartEditPosted: () => void;
  onCancelEditPosted: () => void;
}) {
  const { row, timezone } = props;
  const conf = row.confirmation;
  const isPosted = !!conf?.postedAt;

  return (
    <div
      className={`grid grid-cols-[24px_minmax(150px,1.1fr)_110px_64px_minmax(150px,0.9fr)_minmax(260px,1.5fr)] gap-3 items-center px-4 py-2.5 border-b border-zinc-800/70 last:border-b-0 transition-colors ${
        props.selected ? "bg-[#E11D48]/5" : "hover:bg-zinc-800/20"
      }`}
    >
      {/* Select */}
      <input
        type="checkbox"
        checked={props.selected}
        onChange={props.onToggleSelect}
        aria-label={`Select delivery for ${row.account?.tiktokUsername ?? row.accountId}`}
        className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-900 accent-[#E11D48] cursor-pointer"
      />

      {/* Account + delivered time */}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: row.account?.color || "#71717a" }}
          />
          <span className="text-xs font-medium text-zinc-100 truncate">
            @{row.account?.tiktokUsername ?? "unknown"}
          </span>
        </div>
        <div className="mt-0.5 text-[10px] text-zinc-500 pl-3.5" title={fmtDateTime(row.deliveredAt, timezone)}>
          delivered {relTime(row.deliveredAt)}
        </div>
      </div>

      {/* Mode chip */}
      <div>
        <ModeChip mode={row.postingMode} status={row.status} />
      </div>

      {/* Delivered count */}
      <div className="text-xs text-zinc-300 tabular-nums">
        <span className="font-semibold text-zinc-100">{numFmt.format(row.videoCount)}</span>
        <span className="text-zinc-500"> vid{row.videoCount === 1 ? "" : "s"}</span>
      </div>

      {/* Scheduled state */}
      <div className="min-w-0">
        {conf?.scheduledAt ? (
          <div className="flex items-center gap-1.5 text-xs">
            <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-zinc-300 truncate">{userLabel(row.scheduledByUser)}</div>
              <div className="text-[10px] text-zinc-500" title={fmtDateTime(conf.scheduledAt, timezone)}>
                {relTime(conf.scheduledAt)}
              </div>
            </div>
          </div>
        ) : row.status !== "posted" ? (
          <button
            onClick={props.onTickScheduled}
            disabled={props.busy}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-700 hover:border-zinc-500 px-2 py-1 text-[11px] font-medium text-zinc-300 hover:text-white transition-colors disabled:opacity-50"
          >
            <CalendarCheck2 className="w-3 h-3" />
            Mark scheduled
          </button>
        ) : (
          <span className="text-[10px] text-zinc-600">—</span>
        )}
      </div>

      {/* Posted state */}
      <div className="min-w-0">
        {isPosted && !props.editingPosted ? (
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-zinc-200">
                <span className="font-semibold tabular-nums">{numFmt.format(conf!.postedCount ?? row.videoCount)}</span>{" "}
                posted
                <span className="text-zinc-500"> · {userLabel(row.postedByUser)}</span>
              </div>
              <div className="text-[10px] text-zinc-500 truncate" title={conf!.note ?? undefined}>
                <span title={fmtDateTime(conf!.postedAt!, timezone)}>{relTime(conf!.postedAt!)}</span>
                {conf!.note ? <span className="text-zinc-400"> · {conf!.note}</span> : null}
              </div>
            </div>
            <button
              onClick={props.onStartEditPosted}
              className="shrink-0 p-1 rounded-md text-zinc-600 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              title="Correct count / note"
            >
              <Pencil className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <PostedForm
            defaultCount={conf?.postedCount ?? row.videoCount}
            defaultNote={conf?.note ?? ""}
            busy={props.busy}
            submitLabel={isPosted ? "Save" : "Mark posted"}
            onSubmit={(count, note) => props.onTickPosted(count, note)}
            onCancel={isPosted ? props.onCancelEditPosted : undefined}
          />
        )}
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function DistributionClientPage() {
  const [data, setData] = useState<{ deliveries: DeliveryRow[]; summary: Summary; timezone: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [campaignId, setCampaignId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accountLabel, setAccountLabel] = useState<{ username: string; color: string | null } | null>(null);
  const [status, setStatus] = useState<"" | "delivered" | "scheduled" | "posted">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // Campaign options
  const [campaigns, setCampaigns] = useState<{ id: string; title: string }[]>([]);

  // Account search
  const [acctQuery, setAcctQuery] = useState("");
  const [acctResults, setAcctResults] = useState<AccountSearchResult[]>([]);
  const [acctOpen, setAcctOpen] = useState(false);
  const [acctSearching, setAcctSearching] = useState(false);
  const acctBoxRef = useRef<HTMLDivElement>(null);

  // Worklist
  const [worklist, setWorklist] = useState(false);
  const [pending, setPending] = useState<DeliveryRow[] | null>(null);
  const [pendingLoading, setPendingLoading] = useState(false);

  // Selection + actions
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkNote, setBulkNote] = useState("");
  const [acting, setActing] = useState(false);
  const [editingPostedId, setEditingPostedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (campaignId) params.set("campaignId", campaignId);
      if (accountId) params.set("accountId", accountId);
      if (status) params.set("status", status);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`/api/distribution?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load distribution");
      setData(json);
    } catch (err: any) {
      setError(err?.message || "Failed to load distribution");
    } finally {
      setLoading(false);
    }
  }, [campaignId, accountId, status, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const loadPending = useCallback(async () => {
    setPendingLoading(true);
    try {
      const res = await fetch("/api/distribution/pending");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load worklist");
      setPending(json.deliveries || []);
    } catch (err: any) {
      toast.error(err?.message || "Failed to load worklist");
      setPending([]);
    } finally {
      setPendingLoading(false);
    }
  }, []);

  useEffect(() => {
    if (worklist) loadPending();
  }, [worklist, loadPending]);

  // Campaign select options — from /api/managed/campaigns, falling back to
  // campaigns seen on the loaded deliveries (in case the user lacks the
  // multiplier permission that route requires).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/managed/campaigns");
        if (!res.ok) return;
        const json = await res.json();
        if (Array.isArray(json)) {
          setCampaigns(json.map((c: any) => ({ id: c.id, title: c.title })));
        }
      } catch {
        /* fall back below */
      }
    })();
  }, []);

  const campaignOptions = useMemo(() => {
    const map = new Map<string, string>(campaigns.map((c) => [c.id, c.title]));
    for (const d of data?.deliveries ?? []) {
      if (d.campaign && !map.has(d.campaign.id)) map.set(d.campaign.id, d.campaign.title);
    }
    return [...map.entries()].map(([id, title]) => ({ id, title }));
  }, [campaigns, data]);

  // Account search (debounced)
  useEffect(() => {
    if (accountId) return; // chip selected — search disabled
    const timer = setTimeout(async () => {
      setAcctSearching(true);
      try {
        const res = await fetch(`/api/accounts/search?mode=account&q=${encodeURIComponent(acctQuery)}`);
        if (res.ok) {
          const json = await res.json();
          setAcctResults(json.results || []);
        } else {
          setAcctResults([]);
        }
      } catch {
        setAcctResults([]);
      } finally {
        setAcctSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [acctQuery, accountId]);

  // Close account dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (acctBoxRef.current && !acctBoxRef.current.contains(e.target as Node)) {
        setAcctOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Actions
  const postAction = useCallback(
    async (url: string, body: any, successMsg: string) => {
      setActing(true);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Action failed");
        toast.success(successMsg);
        setSelected(new Set());
        setBulkNote("");
        setEditingPostedId(null);
        await load();
        if (worklist) await loadPending();
      } catch (err: any) {
        toast.error(err?.message || "Action failed");
      } finally {
        setActing(false);
      }
    },
    [load, loadPending, worklist]
  );

  const tickScheduled = useCallback(
    (ids: string[]) =>
      postAction(
        "/api/distribution/mark-scheduled",
        { deliveryIds: ids },
        `Marked ${ids.length} deliver${ids.length === 1 ? "y" : "ies"} scheduled`
      ),
    [postAction]
  );

  const tickPosted = useCallback(
    (ids: string[], opts: { postedCount?: number; note?: string } = {}) =>
      postAction(
        "/api/distribution/mark-posted",
        { deliveryIds: ids, ...opts },
        `Marked ${ids.length} deliver${ids.length === 1 ? "y" : "ies"} posted`
      ),
    [postAction]
  );

  // Selection helpers
  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const timezone = data?.timezone || "Asia/Kolkata";
  const todayKey = dayKeyFor(new Date().toISOString(), timezone);

  // Group deliveries by org-tz date + campaign
  const groups = useMemo(() => {
    if (!data) return [];
    const map = new Map<
      string,
      { date: string; campaignId: string | null; title: string; rows: DeliveryRow[]; totalVideos: number }
    >();
    for (const d of data.deliveries) {
      const date = dayKeyFor(d.deliveredAt, timezone);
      const key = `${date}::${d.campaignId ?? "none"}`;
      let g = map.get(key);
      if (!g) {
        g = { date, campaignId: d.campaignId, title: d.campaign?.title ?? "No campaign", rows: [], totalVideos: 0 };
        map.set(key, g);
      }
      g.rows.push(d);
      g.totalVideos += d.videoCount;
    }
    return [...map.values()].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.title.localeCompare(b.title);
    });
  }, [data, timezone]);

  const summary = data?.summary;
  const postedGap = summary ? summary.delivered - summary.postedCount : 0;
  const hasFilters = !!(campaignId || accountId || status || from || to);

  const renderRow = (row: DeliveryRow) => (
    <DeliveryRowView
      key={row.id}
      row={row}
      timezone={timezone}
      selected={selected.has(row.id)}
      busy={acting}
      editingPosted={editingPostedId === row.id}
      onToggleSelect={() => toggleSelect(row.id)}
      onTickScheduled={() => tickScheduled([row.id])}
      onTickPosted={(count, note) => tickPosted([row.id], { postedCount: count, note: note || undefined })}
      onStartEditPosted={() => setEditingPostedId(row.id)}
      onCancelEditPosted={() => setEditingPostedId(null)}
    />
  );

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Distribution</h1>
          <p className="text-zinc-500 mt-1 text-sm">
            Track delivered videos through scheduling and posting. Tick off manual accounts as work is done.
          </p>
        </div>
        <button
          onClick={() => setWorklist((w) => !w)}
          aria-pressed={worklist}
          className={`shrink-0 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
            worklist
              ? "border-[#E11D48]/50 bg-[#E11D48]/10 text-white"
              : "border-zinc-700 bg-zinc-900/60 text-zinc-300 hover:border-zinc-500"
          }`}
        >
          <ListChecks className="w-4 h-4" style={{ color: worklist ? ACCENT : undefined }} />
          Today&apos;s worklist
          {summary && summary.pendingCount > 0 && (
            <span
              className="ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white"
              style={{ backgroundColor: ACCENT }}
            >
              {summary.pendingCount}
            </span>
          )}
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard
          icon={<Truck className="w-3 h-3" />}
          label="Videos Delivered"
          value={summary ? numFmt.format(summary.delivered) : "—"}
        />
        <SummaryCard
          icon={<Users className="w-3 h-3" />}
          label="Accounts"
          value={summary ? numFmt.format(summary.accountsDelivered) : "—"}
        />
        <SummaryCard
          icon={<CalendarCheck2 className="w-3 h-3" />}
          label="Scheduled"
          value={summary ? numFmt.format(summary.scheduledCount) : "—"}
        />
        <SummaryCard
          icon={<CheckCircle2 className="w-3 h-3" />}
          label="Posted"
          value={summary ? numFmt.format(summary.postedCount) : "—"}
          sub={
            summary ? (
              postedGap > 0 ? (
                <span className="text-amber-400">{numFmt.format(postedGap)} short of delivered</span>
              ) : (
                <span className="text-emerald-400">matches delivered</span>
              )
            ) : undefined
          }
        />
        <SummaryCard
          icon={<ClipboardList className="w-3 h-3" />}
          label="Pending Tick-offs"
          value={summary ? numFmt.format(summary.pendingCount) : "—"}
          highlight={!!summary && summary.pendingCount > 0}
        />
      </div>

      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
        {/* Campaign select */}
        <div className="relative">
          <select
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            aria-label="Filter by campaign"
            className="appearance-none bg-zinc-950 border border-zinc-700 rounded-lg pl-3 pr-8 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-[#E11D48] max-w-[220px] truncate"
          >
            <option value="">All campaigns</option>
            {campaignOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-zinc-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Account search/select */}
        <div className="relative" ref={acctBoxRef}>
          {accountId && accountLabel ? (
            <span className="inline-flex items-center gap-1.5 bg-zinc-950 border border-zinc-700 rounded-lg pl-2.5 pr-1.5 py-1 text-xs text-zinc-200">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: accountLabel.color || "#71717a" }}
              />
              @{accountLabel.username}
              <button
                onClick={() => {
                  setAccountId("");
                  setAccountLabel(null);
                }}
                className="p-0.5 rounded text-zinc-500 hover:text-white transition-colors"
                aria-label="Clear account filter"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ) : (
            <>
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={acctQuery}
                onChange={(e) => {
                  setAcctQuery(e.target.value);
                  setAcctOpen(true);
                }}
                onFocus={() => setAcctOpen(true)}
                placeholder="Search account…"
                aria-label="Search accounts"
                className="bg-zinc-950 border border-zinc-700 rounded-lg pl-8 pr-7 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-[#E11D48] w-48"
              />
              {acctSearching && (
                <Loader2 className="w-3.5 h-3.5 text-zinc-500 animate-spin absolute right-2.5 top-1/2 -translate-y-1/2" />
              )}
              {acctOpen && acctResults.length > 0 && (
                <div className="absolute z-30 mt-1 w-64 max-h-64 overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
                  {acctResults.map((r) =>
                    r.account ? (
                      <button
                        key={r.account.id}
                        onClick={() => {
                          setAccountId(r.account!.id);
                          setAccountLabel({ username: r.account!.tiktokUsername, color: r.color });
                          setAcctOpen(false);
                          setAcctQuery("");
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-800 transition-colors"
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: r.color || "#71717a" }}
                        />
                        <span className="truncate">@{r.account.tiktokUsername}</span>
                        <span className="ml-auto text-[10px] text-zinc-500 truncate">{r.driveFolderName}</span>
                      </button>
                    ) : null
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Status segmented */}
        <div className="flex items-center rounded-lg border border-zinc-700 overflow-hidden" role="group" aria-label="Filter by status">
          {(["", "delivered", "scheduled", "posted"] as const).map((s) => (
            <button
              key={s || "all"}
              onClick={() => setStatus(s)}
              aria-pressed={status === s}
              className={`px-2.5 py-1.5 text-[11px] font-medium capitalize transition-colors ${
                status === s ? "text-white" : "text-zinc-400 hover:text-zinc-200 bg-zinc-950"
              }`}
              style={status === s ? { backgroundColor: ACCENT } : undefined}
            >
              {s || "All"}
            </button>
          ))}
        </div>

        {/* Date range */}
        <div className="flex items-center gap-1.5">
          <CalendarDays className="w-3.5 h-3.5 text-zinc-500" />
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="From date"
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-[#E11D48] [color-scheme:dark]"
          />
          <span className="text-zinc-600 text-xs">→</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="To date"
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-[#E11D48] [color-scheme:dark]"
          />
        </div>

        {hasFilters && (
          <button
            onClick={() => {
              setCampaignId("");
              setAccountId("");
              setAccountLabel(null);
              setStatus("");
              setFrom("");
              setTo("");
            }}
            className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-200 transition-colors ml-auto"
          >
            <X className="w-3 h-3" />
            Clear filters
          </button>
        )}
      </div>

      {/* Body */}
      {worklist ? (
        // ── Today's worklist ──
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ListChecks className="w-4 h-4" style={{ color: ACCENT }} />
              <h2 className="text-sm font-semibold text-white">Today&apos;s worklist</h2>
              <span className="text-xs text-zinc-500">manual deliveries awaiting tick-off, oldest first</span>
            </div>
            {pending && (
              <span className="text-xs text-zinc-500 tabular-nums">
                {pending.length} deliver{pending.length === 1 ? "y" : "ies"}
              </span>
            )}
          </div>
          {pendingLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
            </div>
          ) : pending && pending.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mb-3" />
              <div className="text-sm font-medium text-zinc-200">All clear</div>
              <div className="text-xs text-zinc-500 mt-1">No manual deliveries waiting to be ticked off.</div>
            </div>
          ) : (
            <div>{(pending ?? []).map(renderRow)}</div>
          )}
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-6 h-6 text-zinc-500 animate-spin" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl px-5 py-4 text-sm text-red-300">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
          {error}
          <button
            onClick={load}
            className="ml-auto text-xs font-medium text-red-200 hover:text-white underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center rounded-xl border border-zinc-800 bg-zinc-900/60">
          <Package className="w-10 h-10 text-zinc-600 mb-3" />
          <div className="text-sm font-medium text-zinc-300">No deliveries found</div>
          <div className="text-xs text-zinc-500 mt-1">
            {hasFilters ? "Try widening the filters." : "Deliveries recorded by the factory will appear here."}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div
              key={`${g.date}::${g.campaignId ?? "none"}`}
              className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden"
            >
              <div className="px-4 py-2.5 border-b border-zinc-800 flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-white">{fmtDayHeader(g.date, todayKey)}</span>
                <span className="text-zinc-600 text-xs">·</span>
                <span className="text-xs text-zinc-300 truncate">{g.title}</span>
                <span className="ml-auto text-[11px] text-zinc-500 tabular-nums">
                  {g.rows.length} deliver{g.rows.length === 1 ? "y" : "ies"} · {numFmt.format(g.totalVideos)} videos
                </span>
              </div>
              <div>{g.rows.map(renderRow)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-full border border-zinc-700 bg-zinc-900 pl-5 pr-3 py-2 shadow-2xl">
          <span className="text-xs font-medium text-zinc-200 tabular-nums">{selected.size} selected</span>
          <button
            onClick={() => setSelected(new Set())}
            className="p-1 rounded-full text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors"
            aria-label="Clear selection"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          <span className="w-px h-5 bg-zinc-700" />
          <input
            type="text"
            value={bulkNote}
            onChange={(e) => setBulkNote(e.target.value)}
            placeholder="Note for posted (optional)"
            aria-label="Note for bulk mark posted"
            className="bg-zinc-950 border border-zinc-700 rounded-full px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-[#E11D48] w-48"
          />
          <button
            onClick={() => tickScheduled([...selected])}
            disabled={acting}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-600 hover:border-zinc-400 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors disabled:opacity-50"
          >
            <CalendarCheck2 className="w-3.5 h-3.5" />
            Mark scheduled ({selected.size})
          </button>
          <button
            onClick={() => tickPosted([...selected], { note: bulkNote.trim() || undefined })}
            disabled={acting}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-50"
            style={{ backgroundColor: ACCENT }}
          >
            {acting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            Mark posted ({selected.size})
          </button>
        </div>
      )}
    </div>
  );
}
