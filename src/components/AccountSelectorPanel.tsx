"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, Loader2, Minus, Plus, Search, X } from "lucide-react";
import { naturalCompare } from "@/lib/utils/sorting";

/**
 * AccountSelectorPanel — shared account picker.
 *
 * Implements the tab-selector interaction pattern (search with account/Drive-folder
 * mode toggle, compact colored tabs, click + drag-paint + shift-range + paste-list
 * selection, red accounts excluded, per-account count steppers) against
 * /api/accounts/search — self-contained, nothing imported from the multiplier.
 *
 * Two presentation variants:
 * - "slideover" (default): fixed right slide-over with backdrop + Done button
 *   (used by the Video Factory distribute flows).
 * - "inline": bordered panel rendered in place (used by Bulk Link Sourcing).
 *
 * Selection is keyed by ManagedAccount id, so Drive-mode rows without a linked
 * account are disabled. Callers can disable additional rows via `disableRow`
 * (e.g. accounts without a connected Drive folder).
 */

const COLOR_MAP: Record<string, string> = {
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#f59e0b",
  green: "#10b981",
  blue: "#3b82f6",
  purple: "#8b5cf6",
  pink: "#ec4899",
  zinc: "#71717a",
  gray: "#71717a",
};

export interface AccountSelectorSelection {
  accountId: string;
  username: string;
  color: string;
  defaultPostCount: number;
  count: number;
  driveFolderId?: string;
  driveFolderName?: string;
}

export interface AccountSearchRow {
  driveFolderId: string;
  driveFolderName: string;
  color: string | null;
  defaultPostCount: number;
  account: { id: string; tiktokUsername: string } | null;
}

interface ResultTab {
  accountId: string;
  username: string;
  color: string;
  defaultPostCount: number;
  driveFolderId?: string;
  driveFolderName?: string;
  /** Human-readable reason the row is disabled, or null when selectable. */
  disabledReason: string | null;
}

function resolveHex(colorKey: string): string {
  const key = (colorKey || "zinc").toLowerCase();
  return COLOR_MAP[key] || (key.startsWith("#") ? key : null) || COLOR_MAP.zinc;
}

export default function AccountSelectorPanel(props: {
  selected: AccountSelectorSelection[];
  onChange: React.Dispatch<React.SetStateAction<AccountSelectorSelection[]>>;
  /** "slideover" (default) renders a fixed slide-over; "inline" renders in place. */
  variant?: "slideover" | "inline";
  /** Slide-over only: whether the panel is open. Inline variant is always active. */
  open?: boolean;
  /** Slide-over only: close handler (backdrop, X button, Done button, Esc). */
  onClose?: () => void;
  title?: string;
  subtitle?: string;
  /** Extra per-row disable predicate; return a tooltip reason or null. */
  disableRow?: (row: AccountSearchRow) => string | null;
  /** Empty-results message when no search query is entered. */
  emptyMessage?: string;
}) {
  const {
    selected,
    onChange,
    variant = "slideover",
    open = true,
    onClose,
    title = "Select Accounts",
    subtitle = "Click, drag across, shift-click a range, or paste a list. Red accounts are excluded.",
    disableRow,
    emptyMessage = "No accounts with a connected Drive folder.",
  } = props;

  const active = variant === "inline" || open;

  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<"account" | "drive">("account");
  const [results, setResults] = useState<ResultTab[]>([]);
  const [searching, setSearching] = useState(false);
  const [pasteInput, setPasteInput] = useState("");
  const [pasteLoading, setPasteLoading] = useState(false);
  const [pasteResult, setPasteResult] = useState<{ selected: number; notFound: string[]; skippedRed: string[] } | null>(null);
  const [dragPainting, setDragPainting] = useState(false);

  const resultsContainerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    pendingId: string | null;
    dragging: boolean;
    lastX: number;
    lastY: number;
    snapshot: AccountSelectorSelection[] | null;
  }>({ pointerId: null, startX: 0, startY: 0, pendingId: null, dragging: false, lastX: 0, lastY: 0, snapshot: null });
  const autoScrollRef = useRef<number | null>(null);
  const autoScrollDirRef = useRef(0);
  const lastClickedRef = useRef<string | null>(null);

  const mapRow = (r: AccountSearchRow): ResultTab => {
    const colKey = (r.color || "zinc").toLowerCase();
    const hex = resolveHex(colKey);
    const isRed = colKey === "red" || hex === COLOR_MAP.red || (r.defaultPostCount ?? 1) <= 0;
    const extraReason = disableRow?.(r) ?? null;
    if (!r.account) {
      // Drive folder with no linked ManagedAccount — selection is per account.
      return {
        accountId: `folder:${r.driveFolderId}`,
        username: r.driveFolderName,
        color: r.color || "zinc",
        defaultPostCount: r.defaultPostCount ?? 1,
        driveFolderId: r.driveFolderId,
        driveFolderName: r.driveFolderName,
        disabledReason: "Drive folder is not linked to a managed account",
      };
    }
    return {
      accountId: r.account.id,
      username: r.account.tiktokUsername,
      color: r.color || "zinc",
      defaultPostCount: r.defaultPostCount ?? 1,
      driveFolderId: r.driveFolderId,
      driveFolderName: r.driveFolderName,
      disabledReason: isRed ? "Red accounts are excluded" : extraReason,
    };
  };

  const runSearch = async (q: string, m: "account" | "drive") => {
    setSearching(true);
    try {
      const res = await fetch(`/api/accounts/search?q=${encodeURIComponent(q)}&mode=${m}`);
      if (res.ok) {
        const data = await res.json();
        const tabs = ((data.results || []) as AccountSearchRow[]).map(mapRow);
        tabs.sort((a, b) => naturalCompare(a.username, b.username));
        setResults(tabs);
      }
    } catch (err) {
      console.error("Account search failed:", err);
    } finally {
      setSearching(false);
    }
  };

  // Load everything on activate (empty query matches all), re-run on mode change.
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => runSearch(search, mode), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, mode]);

  // Debounced search on query change.
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => runSearch(search, mode), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const isSelected = (accountId: string) => selected.some((s) => s.accountId === accountId);

  const toSelection = (tab: ResultTab): AccountSelectorSelection => ({
    accountId: tab.accountId,
    username: tab.username,
    color: tab.color,
    defaultPostCount: tab.defaultPostCount,
    count: Math.max(1, tab.defaultPostCount),
    driveFolderId: tab.driveFolderId,
    driveFolderName: tab.driveFolderName,
  });

  const toggleTab = (tab: ResultTab) => {
    if (tab.disabledReason) return;
    onChange((prev) =>
      prev.some((s) => s.accountId === tab.accountId)
        ? prev.filter((s) => s.accountId !== tab.accountId)
        : [...prev, toSelection(tab)]
    );
  };

  // Additive-only add: never toggles off, skips disabled + already-selected.
  // Functional update: safe to call in rapid succession while drag-painting.
  const addByIds = (ids: string[]) => {
    onChange((prev) => {
      const have = new Set(prev.map((s) => s.accountId));
      const additions = ids
        .map((id) => results.find((r) => r.accountId === id))
        .filter((r): r is ResultTab => !!r && !r.disabledReason && !have.has(r.accountId))
        .map(toSelection);
      return additions.length > 0 ? [...prev, ...additions] : prev;
    });
  };

  // ── Drag-paint selection (5px click/drag threshold, auto-scroll, Esc revert) ──

  const stopAutoScroll = () => {
    autoScrollDirRef.current = 0;
    if (autoScrollRef.current != null) {
      cancelAnimationFrame(autoScrollRef.current);
      autoScrollRef.current = null;
    }
  };

  const startAutoScroll = () => {
    if (autoScrollRef.current != null) return;
    const tick = () => {
      const container = resultsContainerRef.current;
      const d = dragRef.current;
      if (!container || !d.dragging || autoScrollDirRef.current === 0) {
        autoScrollRef.current = null;
        return;
      }
      container.scrollTop += autoScrollDirRef.current * 14;
      const el = document.elementFromPoint(d.lastX, d.lastY);
      const tab = el?.closest?.("[data-account-tab]") as HTMLElement | null;
      if (tab?.dataset.accountTab) addByIds([tab.dataset.accountTab]);
      autoScrollRef.current = requestAnimationFrame(tick);
    };
    autoScrollRef.current = requestAnimationFrame(tick);
  };

  const resetDrag = () => {
    dragRef.current = { pointerId: null, startX: 0, startY: 0, pendingId: null, dragging: false, lastX: 0, lastY: 0, snapshot: null };
    setDragPainting(false);
    stopAutoScroll();
  };

  const handleGridPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const tab = (e.target as HTMLElement).closest("[data-account-tab]") as HTMLElement | null;
    if (!tab?.dataset.accountTab) return;
    const result = results.find((r) => r.accountId === tab.dataset.accountTab);
    if (!result || result.disabledReason) return;
    e.preventDefault();
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      pendingId: result.accountId,
      dragging: false,
      lastX: e.clientX,
      lastY: e.clientY,
      snapshot: selected,
    };
    try {
      resultsContainerRef.current?.setPointerCapture(e.pointerId);
    } catch {}
  };

  const handleGridPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (d.pointerId !== e.pointerId || !d.pendingId) return;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    if (!d.dragging) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) <= 5) return;
      d.dragging = true;
      setDragPainting(true);
      addByIds([d.pendingId]);
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const tab = el?.closest?.("[data-account-tab]") as HTMLElement | null;
    if (tab?.dataset.accountTab) addByIds([tab.dataset.accountTab]);
    const container = resultsContainerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      let dir = 0;
      if (e.clientY < rect.top + 40) dir = -1;
      else if (e.clientY > rect.bottom - 40) dir = 1;
      if (dir !== autoScrollDirRef.current) {
        autoScrollDirRef.current = dir;
        if (dir !== 0) startAutoScroll();
        else stopAutoScroll();
      }
    }
  };

  const handleGridPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (d.pointerId !== e.pointerId || !d.pendingId) return;
    const wasDragging = d.dragging;
    const pendingId = d.pendingId;
    resetDrag();
    if (wasDragging) return;
    const result = results.find((r) => r.accountId === pendingId);
    if (!result) return;
    // Shift-click extends the selection over the visible results order.
    if (e.shiftKey && lastClickedRef.current) {
      const order = results.map((r) => r.accountId);
      const a = order.indexOf(lastClickedRef.current);
      const b = order.indexOf(pendingId);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        addByIds(order.slice(lo, hi + 1));
        return;
      }
    }
    toggleTab(result);
    if (!e.metaKey && !e.ctrlKey) lastClickedRef.current = pendingId;
  };

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const d = dragRef.current;
      if (d.pendingId) {
        if (d.dragging && d.snapshot) onChange(d.snapshot);
        resetDrag();
      } else if (variant === "slideover") {
        onClose?.();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, onClose, variant]);

  // ── Paste-select: usernames separated by spaces/commas/newlines ──

  const handlePasteSelect = async (rawOverride?: string) => {
    if (pasteLoading) return;
    const terms = Array.from(
      new Set(
        (rawOverride ?? pasteInput)
          .split(/[\s,;]+/)
          .map((s) => s.trim().replace(/^@+/, "").toLowerCase())
          .filter(Boolean)
      )
    ).slice(0, 100);
    if (terms.length === 0) return;
    setPasteLoading(true);
    setPasteResult(null);
    try {
      const notFound: string[] = [];
      const skippedRed: string[] = [];
      const matched: ResultTab[] = [];
      for (let i = 0; i < terms.length; i += 10) {
        const chunk = terms.slice(i, i + 10);
        const chunkResults = await Promise.all(
          chunk.map(async (term) => {
            try {
              const res = await fetch(`/api/accounts/search?q=${encodeURIComponent(term)}&mode=account`);
              if (!res.ok) return { term, tab: null as ResultTab | null };
              const data = await res.json();
              const rows = (data.results || []) as AccountSearchRow[];
              const exact = rows.find((r) => r.account?.tiktokUsername?.toLowerCase() === term);
              const row = exact || (rows.length === 1 ? rows[0] : null);
              return { term, tab: row ? mapRow(row) : null };
            } catch {
              return { term, tab: null as ResultTab | null };
            }
          })
        );
        for (const { term, tab } of chunkResults) {
          if (!tab || tab.disabledReason === "Drive folder is not linked to a managed account") {
            notFound.push(term);
            continue;
          }
          if (tab.disabledReason) {
            skippedRed.push(term);
            continue;
          }
          matched.push(tab);
        }
      }
      const seen = new Set<string>();
      const deduped = matched.filter((m) => !seen.has(m.accountId) && (seen.add(m.accountId), true));
      let addedCount = 0;
      onChange((prev) => {
        const have = new Set(prev.map((s) => s.accountId));
        const additions = deduped.filter((m) => !have.has(m.accountId)).map(toSelection);
        addedCount = additions.length;
        return additions.length > 0 ? [...prev, ...additions] : prev;
      });
      setPasteResult({ selected: addedCount, notFound, skippedRed });
    } finally {
      setPasteLoading(false);
      setPasteInput("");
    }
  };

  const setCount = (accountId: string, count: number) => {
    onChange((prev) => prev.map((s) => (s.accountId === accountId ? { ...s, count: Math.max(1, Math.min(500, count)) } : s)));
  };

  const totalVideos = selected.reduce((sum, s) => sum + s.count, 0);
  const sortedSelected = [...selected].sort((a, b) => naturalCompare(a.username, b.username));

  const body = (
    <>
      <div className={`flex items-center justify-between px-4 py-3 flex-shrink-0 ${variant === "slideover" ? "border-b border-[#27272a]" : ""}`}>
        <div>
          <h3 className="text-sm font-bold text-white">{title}</h3>
          <p className="text-[10px] text-[#71717a] mt-0.5">{subtitle}</p>
        </div>
        {variant === "slideover" && onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-[#71717a] hover:text-white transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Search row */}
      <div className="px-4 pt-3 flex items-center gap-2 flex-shrink-0">
        <div className="flex items-center bg-[#09090b] border border-[#27272a] rounded-lg overflow-hidden flex-shrink-0">
          {(["account", "drive"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-2.5 py-1.5 text-[10px] font-semibold transition-colors cursor-pointer ${
                mode === m ? "bg-[#E11D48] text-white" : "text-[#a1a1aa] hover:text-white"
              }`}
            >
              {m === "account" ? "Accounts" : "Drive folders"}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-[#71717a] absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder={mode === "account" ? "Search account names…" : "Search Drive folder names…"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#09090b] border border-[#27272a] rounded-lg pl-8 pr-3 py-1.5 text-white placeholder-[#71717a] text-[11px] focus:outline-none focus:border-[#E11D48]"
          />
        </div>
      </div>

      {/* Paste row */}
      <div className="px-4 pt-2 flex items-center gap-2 flex-shrink-0">
        <input
          type="text"
          placeholder="Paste account names (spaces, commas or newlines)…"
          value={pasteInput}
          onChange={(e) => setPasteInput(e.target.value)}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (text.trim()) {
              e.preventDefault();
              setPasteInput(text);
              handlePasteSelect(text);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handlePasteSelect();
            }
          }}
          className="flex-1 bg-[#09090b] border border-[#27272a] rounded-lg px-3 py-1.5 text-white placeholder-[#71717a] text-[11px] focus:outline-none focus:border-[#E11D48]"
        />
        <button
          type="button"
          onClick={() => handlePasteSelect()}
          disabled={pasteLoading || !pasteInput.trim()}
          className="px-3 py-1.5 bg-[#27272a] hover:bg-[#3f3f46] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 flex-shrink-0"
        >
          {pasteLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
          Go
        </button>
      </div>
      {pasteResult && (
        <div className="mx-4 mt-2 flex items-center gap-2 flex-shrink-0 bg-[#09090b] border border-[#27272a] rounded-lg px-2.5 py-1.5 text-[10px] text-[#a1a1aa]">
          <span className="flex-1 truncate" title={[...pasteResult.notFound, ...pasteResult.skippedRed].join(", ")}>
            <span className="font-bold text-green-400">{pasteResult.selected} selected</span>
            {pasteResult.notFound.length > 0 && (
              <>
                {" · "}
                <span className="font-bold text-[#fafafa]">{pasteResult.notFound.length} not found</span> (
                {pasteResult.notFound.slice(0, 5).join(", ")}
                {pasteResult.notFound.length > 5 ? ", …" : ""})
              </>
            )}
            {pasteResult.skippedRed.length > 0 && (
              <>
                {" · "}
                <span className="font-bold text-red-400">{pasteResult.skippedRed.length} skipped</span> (
                {pasteResult.skippedRed.slice(0, 5).join(", ")}
                {pasteResult.skippedRed.length > 5 ? ", …" : ""})
              </>
            )}
          </span>
          <button
            type="button"
            onClick={() => setPasteResult(null)}
            className="text-[#71717a] hover:text-white transition-colors cursor-pointer flex-shrink-0"
            title="Dismiss"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Results grid: wrapping colored tabs */}
      <div
        ref={resultsContainerRef}
        onPointerDown={handleGridPointerDown}
        onPointerMove={handleGridPointerMove}
        onPointerUp={handleGridPointerUp}
        onPointerCancel={() => resetDrag()}
        className={`${
          variant === "slideover" ? "flex-1 min-h-0" : "max-h-72 min-h-[120px]"
        } overflow-y-auto custom-scrollbar bg-[#09090b] border border-[#27272a] rounded-xl p-2 mx-4 mt-2 select-none`}
        style={{ touchAction: dragPainting ? "none" : "pan-y" }}
      >
        {searching && results.length === 0 ? (
          <div className="h-full min-h-[100px] flex items-center justify-center text-[#71717a] text-[11px]">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : results.length === 0 ? (
          <div className="h-full min-h-[100px] flex items-center justify-center text-[#71717a] text-[11px] italic">
            {search.trim() ? `No results for “${search}”.` : emptyMessage}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5 content-start">
            {results.map((tab) => {
              const baseColor = resolveHex(tab.color);
              const tabSelected = isSelected(tab.accountId);
              const disabled = !!tab.disabledReason;
              return (
                <div
                  key={tab.accountId}
                  data-account-tab={tab.accountId}
                  role="button"
                  tabIndex={disabled ? -1 : 0}
                  aria-disabled={disabled}
                  title={tab.disabledReason ?? `@${tab.username}`}
                  onKeyDown={(e) => {
                    if (disabled) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleTab(tab);
                      lastClickedRef.current = tab.accountId;
                    }
                  }}
                  className={`flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors ${
                    disabled ? "opacity-40 cursor-not-allowed text-[#71717a]" : "text-[#e4e4e7] hover:text-white cursor-pointer"
                  }`}
                  style={{
                    borderColor: tabSelected ? "#E11D48" : `${baseColor}33`,
                    borderLeft: `3px solid ${baseColor}`,
                    backgroundColor: tabSelected ? "rgba(225, 29, 72, 0.12)" : disabled ? "transparent" : `${baseColor}14`,
                    boxShadow: tabSelected ? "0 0 0 1px #E11D48 inset" : undefined,
                  }}
                >
                  {tabSelected && <Check className="w-3 h-3 text-[#E11D48] flex-shrink-0" />}
                  <span className="truncate max-w-[150px]">
                    {tab.disabledReason === "Drive folder is not linked to a managed account" ? tab.username : `@${tab.username}`}
                  </span>
                  <span className="text-[9px] text-[#71717a] font-mono flex-shrink-0">·{tab.defaultPostCount}/day</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Selected list with per-account counts */}
      <div className="flex-shrink-0 border-t border-[#27272a] mt-2 px-4 py-3 max-h-[38%] flex flex-col">
        <div className="flex items-center justify-between pb-2 flex-shrink-0">
          <h4 className="font-bold uppercase tracking-wider text-[10px] text-[#71717a]">Selected Accounts</h4>
          <p className="text-[10px] font-semibold text-[#a1a1aa]">
            {selected.length} selected · {totalVideos} videos
          </p>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar bg-[#09090b] border border-[#27272a] rounded-xl p-2">
          {sortedSelected.length === 0 ? (
            <p className="text-[10px] text-[#71717a] italic px-1 py-0.5">
              No accounts selected — click, drag across, or paste from the results above.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {sortedSelected.map((acc) => {
                const baseColor = resolveHex(acc.color);
                return (
                  <div
                    key={acc.accountId}
                    className="flex items-center gap-2 pl-2 pr-1.5 py-1.5 rounded-md border text-[11px] font-medium text-white"
                    style={{ borderColor: `${baseColor}55`, borderLeft: `3px solid ${baseColor}`, backgroundColor: `${baseColor}14` }}
                  >
                    <span className="truncate flex-1 min-w-0" title={`@${acc.username}`}>
                      @{acc.username}
                    </span>
                    <div className="flex items-center bg-[#09090b]/80 border border-[#27272a] rounded overflow-hidden flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => setCount(acc.accountId, acc.count - 1)}
                        className="px-1.5 py-1 hover:bg-[#27272a] text-[#a1a1aa] hover:text-white transition-colors cursor-pointer"
                        title="Decrease count"
                      >
                        <Minus className="w-2.5 h-2.5" />
                      </button>
                      <span className="w-7 text-center text-[10px] font-bold text-white font-mono">{acc.count}</span>
                      <button
                        type="button"
                        onClick={() => setCount(acc.accountId, acc.count + 1)}
                        className="px-1.5 py-1 hover:bg-[#27272a] text-[#a1a1aa] hover:text-white transition-colors cursor-pointer"
                        title="Increase count"
                      >
                        <Plus className="w-2.5 h-2.5" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => onChange((prev) => prev.filter((s) => s.accountId !== acc.accountId))}
                      className="text-[#71717a] hover:text-white transition-colors cursor-pointer flex-shrink-0"
                      title="Remove from selection"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {variant === "slideover" && onClose && (
          <button
            type="button"
            onClick={onClose}
            className="mt-3 w-full py-2 bg-[#E11D48] hover:bg-[#be123c] text-white text-xs font-bold rounded-lg transition-colors cursor-pointer flex-shrink-0"
          >
            Done — {selected.length} accounts, {totalVideos} videos
          </button>
        )}
      </div>
    </>
  );

  if (variant === "inline") {
    return <div className="bg-[#18181b] border border-[#27272a] rounded-xl flex flex-col overflow-hidden">{body}</div>;
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={onClose}
      />
      {/* Slide-over */}
      <div
        className={`fixed inset-y-0 right-0 z-50 w-full max-w-[560px] bg-[#18181b] border-l border-[#27272a] flex flex-col transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!open}
      >
        {body}
      </div>
    </>
  );
}
