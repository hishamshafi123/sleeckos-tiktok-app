"use client";

import React, { useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import type { StyleFamily } from "@/lib/style-lab/schema";

/**
 * Admin "New template" dialog (Part 7): describe a trending style → Gemini
 * designs a validated layered draft that lands on the gallery's drafts
 * shelf. Raw-code generation is intentionally not used — drafts are layer
 * stacks rendered through the layered-style composition.
 */
export function NewTemplateDialog({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (description: string, family: StyleFamily) => void;
}) {
  const [description, setDescription] = useState("");
  const [family, setFamily] = useState<StyleFamily>("lyric");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="New AI template"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-md border border-zinc-800 rounded-md bg-[#09090b] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
            <Sparkles size={14} className="text-[#E11D48]" />
            New Template from Trend
          </h3>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label="Close dialog"
            className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition disabled:opacity-50"
          >
            <X size={14} />
          </button>
        </div>

        <p className="text-[11px] text-zinc-500 leading-normal">
          Describe a trending caption style. The AI designs a layered draft
          (no code execution) that lands on the <span className="text-amber-300/90">Drafts</span> shelf —
          validate it, tweak it in the editor, then publish.
        </p>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-300" htmlFor="ai-draft-desc">
            Style description
          </label>
          <textarea
            id="ai-draft-desc"
            rows={4}
            autoFocus
            placeholder='e.g. "Bold karaoke captions like the viral subway singalong videos — huge condensed type, active word in hot pink, thin black strip behind the text"'
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-100 focus:outline-none focus:border-zinc-600 text-[11px] resize-y"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-300" htmlFor="ai-draft-family">
            Family
          </label>
          <select
            id="ai-draft-family"
            value={family}
            onChange={(e) => setFamily(e.target.value as StyleFamily)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-100 focus:outline-none focus:border-zinc-600 text-[11px]"
          >
            <option value="lyric">Lyric</option>
            <option value="quote">Quote</option>
          </select>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onSubmit(description.trim(), family)}
            disabled={busy || !description.trim()}
            className="flex-1 flex items-center justify-center gap-1.5 bg-[#E11D48] hover:bg-rose-700 text-white font-bold py-2 rounded transition text-[11px] disabled:opacity-50"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {busy ? "Generating draft…" : "Generate draft"}
          </button>
          <button
            onClick={onClose}
            disabled={busy}
            className="px-3 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 py-2 rounded transition text-[11px] font-semibold disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
