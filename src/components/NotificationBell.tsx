"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";

interface NotificationRow {
  id: string;
  createdAt: string;
  level: string;
  title: string;
  body: string;
  source: string;
  read: boolean;
}

const LEVEL_DOT: Record<string, string> = {
  error: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-sky-500",
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

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setUnreadCount(data.unreadCount ?? 0);
      setRows(data.rows ?? []);
    } catch {
      // bell must never break the chrome
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

  const markAllRead = async () => {
    await fetch("/api/admin/notifications/read", { method: "POST" });
    setUnreadCount(0);
    setRows((rs) => rs.map((r) => ({ ...r, read: true })));
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        aria-label="Notifications"
        className="relative p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 transition-colors"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 w-80 max-h-96 overflow-y-auto rounded-md border border-[#27272a] bg-[#09090b] shadow-xl shadow-black/50 z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[#27272a] sticky top-0 bg-[#09090b]">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Notifications
            </span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-200"
              >
                <CheckCheck className="w-3 h-3" />
                Mark all read
              </button>
            )}
          </div>

          {loading && rows.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-zinc-600">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-zinc-600">
              No notifications yet
            </div>
          ) : (
            rows.map((n) => (
              <div
                key={n.id}
                className={`px-3 py-2.5 border-b border-[#27272a]/60 last:border-0 ${
                  n.read ? "opacity-60" : ""
                }`}
              >
                <div className="flex items-start gap-2">
                  <span
                    className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      LEVEL_DOT[n.level] ?? LEVEL_DOT.info
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-zinc-200 leading-snug">{n.title}</p>
                    <p className="text-[11px] text-zinc-500 mt-0.5 leading-snug break-words">
                      {n.body}
                    </p>
                    <p className="text-[9px] text-zinc-600 mt-1">
                      {relativeTime(n.createdAt)} · {n.source}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
