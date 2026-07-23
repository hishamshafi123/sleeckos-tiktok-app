"use client";

import React, { useMemo, useState } from "react";
import {
  Copy, Image as ImageIcon, LayoutGrid, Loader2, Play, Search,
} from "lucide-react";

/**
 * CapCut-style template gallery — the Style Lab home.
 *
 * Cards show the seed-rendered thumbnail and swap to a muted looping
 * webm (rendered next to it at seed time) on hover/focus. Cards are
 * keyboard-operable: Tab focuses a card, Enter/Space opens it in the
 * editor; the action buttons stop propagation.
 */

export interface GalleryTemplate {
  id: string;
  key: string;
  name: string;
  family: "lyric" | "quote";
  tags: string[];
  source: string;
  status: string;
  thumbnail: string | null;
  previewUrl: string | null;
  defaultParams: Record<string, any>;
  paramSchema: string;
}

interface TemplateGalleryProps {
  templates: GalleryTemplate[];
  loading: boolean;
  onUse: (tpl: GalleryTemplate) => void;
  onDuplicate: (tpl: GalleryTemplate) => void;
}

const TAG_ORDER = [
  "minimal", "bold", "news", "trend", "karaoke", "overlay", "brat",
  "kinetic", "cinematic", "statement", "subtitle",
];
/** Family is already a tab; these internal labels add noise as chips. */
const TAG_HIDE = new Set(["style-lab", "base", "lyric", "quote"]);

// Same checkerboard the editor preview uses — honest transparency display.
const CHECKERBOARD_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Crect width='16' height='16' fill='%2327272a'/%3E%3Crect width='8' height='8' fill='%233f3f46'/%3E%3Crect x='8' y='8' width='8' height='8' fill='%233f3f46'/%3E%3C/svg%3E\")";

function TemplateCard({
  tpl,
  onUse,
  onDuplicate,
}: {
  tpl: GalleryTemplate;
  onUse: () => void;
  onDuplicate: () => void;
}) {
  const [hover, setHover] = useState(false);
  const tags = (tpl.tags ?? []).filter((t) => !TAG_HIDE.has(t));

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Use template ${tpl.name}`}
      onClick={onUse}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onUse();
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      className="group bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden flex flex-col transition hover:border-zinc-600 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E11D48]"
    >
      {/* Thumbnail → hover preview swap */}
      <div
        className="relative aspect-[3/4] border-b border-zinc-900 overflow-hidden"
        style={{ backgroundImage: CHECKERBOARD_BG, backgroundSize: "16px 16px", backgroundColor: "#040406" }}
      >
        {tpl.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={tpl.thumbnail}
            alt={tpl.name}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-zinc-700">
            <ImageIcon size={20} />
            <span className="text-[9px] font-mono uppercase tracking-wider">No preview yet</span>
          </div>
        )}
        {hover && tpl.previewUrl && (
          <video
            src={tpl.previewUrl}
            className="absolute inset-0 w-full h-full object-cover"
            autoPlay
            muted
            loop
            playsInline
          />
        )}
        <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/70 border border-zinc-800 text-[9px] font-mono uppercase tracking-wider text-zinc-300">
          {tpl.family}
        </span>
        {hover && tpl.previewUrl && (
          <span className="absolute top-2 right-2 p-1 rounded bg-black/70 border border-zinc-800 text-[#E11D48]">
            <Play size={10} />
          </span>
        )}
      </div>

      <div className="p-3.5 flex flex-col gap-2.5 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-xs font-bold text-zinc-200 leading-snug">{tpl.name}</h4>
          <span
            className={`px-1.5 py-0.5 rounded text-[9px] font-mono shrink-0 border ${
              tpl.source === "imported"
                ? "bg-zinc-900 border-zinc-800 text-zinc-500"
                : "bg-[#E11D48]/10 border-[#E11D48]/25 text-rose-300"
            }`}
          >
            {tpl.source}
          </span>
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.slice(0, 4).map((t) => (
              <span
                key={t}
                className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[9px] text-zinc-400 font-mono"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1.5 border-t border-zinc-900 pt-2.5 mt-auto">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUse();
            }}
            className="flex-1 bg-[#E11D48] hover:bg-rose-700 text-white font-bold py-1.5 rounded transition text-[10px] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#E11D48]"
          >
            Use template
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate();
            }}
            title="Duplicate as a saved style"
            aria-label={`Duplicate ${tpl.name} as a saved style`}
            className="p-1.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded transition focus:outline-none focus-visible:ring-1 focus-visible:ring-[#E11D48]"
          >
            <Copy size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function TemplateGallery({ templates, loading, onUse, onDuplicate }: TemplateGalleryProps) {
  const [familyFilter, setFamilyFilter] = useState<"all" | "lyric" | "quote">("all");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [search, setSearch] = useState("");

  const availableTags = useMemo(() => {
    const present = new Set<string>();
    for (const tpl of templates) {
      for (const t of tpl.tags ?? []) {
        if (!TAG_HIDE.has(t)) present.add(t);
      }
    }
    const ordered = TAG_ORDER.filter((t) => present.has(t));
    const rest = [...present].filter((t) => !TAG_ORDER.includes(t)).sort();
    return [...ordered, ...rest];
  }, [templates]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((tpl) => {
      if (familyFilter !== "all" && tpl.family !== familyFilter) return false;
      if (tagFilter && !(tpl.tags ?? []).includes(tagFilter)) return false;
      if (q && !tpl.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [templates, familyFilter, tagFilter, search]);

  const published = filtered.filter((t) => t.status !== "draft");
  const drafts = filtered.filter((t) => t.status === "draft");

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-zinc-500 text-xs gap-1.5 border border-zinc-800 rounded-md bg-[#09090b]">
        <Loader2 size={12} className="animate-spin text-zinc-400" />
        Loading templates...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="border border-zinc-800 rounded-md bg-[#09090b] p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex bg-zinc-950 border border-zinc-800 rounded p-0.5 text-[11px] font-semibold text-zinc-400 self-start">
            {(["all", "lyric", "quote"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFamilyFilter(f)}
                aria-pressed={familyFilter === f}
                className={`px-3 py-1 rounded transition capitalize ${
                  familyFilter === f ? "bg-zinc-800 text-zinc-100" : "hover:text-zinc-200"
                }`}
              >
                {f === "all" ? "All" : f}
              </button>
            ))}
          </div>

          <div className="relative flex-1 max-w-sm">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600" />
            <input
              type="text"
              placeholder="Search templates by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded pl-7 pr-2.5 py-1.5 text-zinc-100 focus:outline-none focus:border-zinc-600 text-[11px]"
            />
          </div>
        </div>

        {availableTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-t border-zinc-900 pt-3">
            {availableTags.map((tag) => {
              const active = tagFilter === tag;
              return (
                <button
                  key={tag}
                  onClick={() => setTagFilter(active ? "" : tag)}
                  aria-pressed={active}
                  className={`px-2 py-0.5 rounded border text-[10px] font-mono transition ${
                    active
                      ? "bg-[#E11D48]/15 border-[#E11D48]/40 text-rose-300"
                      : "bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700"
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Grid */}
      {published.length === 0 ? (
        <div className="text-center py-16 space-y-2 text-zinc-500 border border-zinc-800 rounded-md bg-[#09090b]">
          <LayoutGrid size={24} className="mx-auto text-zinc-700" />
          <p className="text-xs italic">
            {templates.length === 0
              ? "No templates registered yet — run the Style Lab seed."
              : "No templates match this filter."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {published.map((tpl) => (
            <TemplateCard
              key={tpl.key}
              tpl={tpl}
              onUse={() => onUse(tpl)}
              onDuplicate={() => onDuplicate(tpl)}
            />
          ))}
        </div>
      )}

      {/* Drafts shelf — only rendered once draft templates exist (Part 7). */}
      {drafts.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider border-t border-zinc-900 pt-4">
            Drafts
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {drafts.map((tpl) => (
              <TemplateCard
                key={tpl.key}
                tpl={tpl}
                onUse={() => onUse(tpl)}
                onDuplicate={() => onDuplicate(tpl)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
