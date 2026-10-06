"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TicketCheck, ArrowRight } from "lucide-react";

interface MyTicketRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  assignedAt: string | null;
  creator: { id: string; name: string | null; email: string };
}

const PRIORITY_DOT: Record<string, string> = {
  URGENT: "bg-red-500",
  HIGH: "bg-amber-500",
  MEDIUM: "bg-zinc-500",
  LOW: "bg-zinc-600",
};

const STATUS_CHIP: Record<string, string> = {
  OPEN: "bg-zinc-900/20 text-zinc-300 border-zinc-800",
  IN_PROGRESS: "bg-blue-950/20 text-blue-400 border-blue-900/50",
  DONE: "bg-emerald-950/20 text-emerald-400 border-emerald-900/50",
  CANCELLED: "bg-red-950/20 text-red-400 border-red-900/50",
};

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  DONE: "Done",
  CANCELLED: "Cancelled",
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function TicketsButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  const [rows, setRows] = useState<MyTicketRow[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tickets/mine-summary", { cache: "no-store" });
      if (res.status === 403) {
        setHidden(true);
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      setOpenCount(data.openCount ?? 0);
      setRows(data.rows ?? []);
    } catch {
      // button must never break the chrome
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoading(true);
      await load();
      setLoading(false);
    }
  };

  if (hidden) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        aria-label="My tickets"
        className="relative p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 transition-colors"
      >
        <TicketCheck className="w-4 h-4" />
        {openCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-amber-500 text-black text-[8px] font-bold flex items-center justify-center">
            {openCount > 99 ? "99+" : openCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 w-80 max-h-96 overflow-y-auto rounded-md border border-[#27272a] bg-[#09090b] shadow-xl shadow-black/50 z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[#27272a] sticky top-0 bg-[#09090b]">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              My tickets
            </span>
            <span className="text-[10px] font-bold text-amber-500">
              {openCount} open
            </span>
          </div>

          {loading && rows.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-zinc-600">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-zinc-600">
              No open tickets assigned to you
            </div>
          ) : (
            rows.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setOpen(false);
                  router.push("/admin/tickets");
                }}
                className="w-full text-left px-3 py-2.5 border-b border-[#27272a]/60 last:border-0 hover:bg-zinc-900/60 transition-colors"
              >
                <div className="flex items-start gap-2">
                  <span
                    className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      PRIORITY_DOT[t.priority] ?? PRIORITY_DOT.MEDIUM
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-medium text-zinc-200 leading-snug truncate flex-1">
                        {t.title}
                      </p>
                      <span
                        className={`px-1.5 py-0.5 rounded-full text-[9px] font-semibold border whitespace-nowrap flex-shrink-0 ${
                          STATUS_CHIP[t.status] ?? STATUS_CHIP.OPEN
                        }`}
                      >
                        {STATUS_LABELS[t.status] ?? t.status}
                      </span>
                    </div>
                    <p className="text-[9px] text-zinc-600 mt-1">
                      {t.creator.name || t.creator.email.split("@")[0]}
                      {t.assignedAt && <> · assigned {relativeTime(t.assignedAt)}</>}
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}

          <button
            onClick={() => {
              setOpen(false);
              router.push("/admin/tickets");
            }}
            className="w-full flex items-center justify-center gap-1 px-3 py-2 border-t border-[#27272a] sticky bottom-0 bg-[#09090b] text-[10px] font-semibold text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 transition-colors"
          >
            View all tickets
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}
