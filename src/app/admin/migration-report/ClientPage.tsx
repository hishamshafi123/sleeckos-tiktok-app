"use client";

import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Copy, AlertCircle, FileText, Hash, FolderTree } from "lucide-react";

type BackupGroup = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
};

type BackupSection = {
  sectionId: string;
  name: string;
  slug: string;
  descFixedText: string | null;
  descFixedTextEnabled: boolean;
  descTags: string | null;
  descTagCount: number | null;
  groups: BackupGroup[];
};

function CopyBlock({ text, label }: { text: string; label: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Copy failed");
    }
  };

  return (
    <div className="relative group/block">
      <pre className="whitespace-pre-wrap break-words bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 pr-10 text-xs text-zinc-300 font-mono">
        {text}
      </pre>
      <button
        onClick={copy}
        title={`Copy ${label}`}
        className="absolute top-1.5 right-1.5 p-1.5 rounded-md text-zinc-500 hover:text-white hover:bg-zinc-800 opacity-0 group-hover/block:opacity-100 transition-all"
      >
        <Copy className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export default function MigrationReportClientPage() {
  const [sections, setSections] = useState<BackupSection[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/migration-report");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load migration report");
        setSections(data.sections || []);
      } catch (err: any) {
        setError(err?.message || String(err));
      }
    })();
  }, []);

  if (error) {
    return (
      <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-2xl px-5 py-4 text-sm text-red-300">
        <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
        {error}
      </div>
    );
  }

  if (!sections) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 text-zinc-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Migration Report — Fixed Text Reassignment</h1>
        <p className="text-zinc-500 mt-1 text-sm max-w-3xl">
          The Groups layer was removed and Section fixed text moved to Campaigns.
          Nothing was auto-assigned: the old values below are preserved verbatim from the migration backups.
          Add each text to the <span className="text-zinc-300 font-medium">Fixed texts</span> pool on the
          appropriate Campaign&rsquo;s detail page to reactivate it — one entry per text; one is chosen at
          random per post. Hashtag pools (<span className="text-zinc-300 font-medium">descTags</span>)
          are unchanged and still live on Sections.
        </p>
      </div>

      {sections.length === 0 && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-12 text-center text-zinc-500 text-sm">
          No preserved Section fixed text found.
        </div>
      )}

      {sections.map((s) => (
        <div key={s.sectionId} className="bg-zinc-900/60 border border-zinc-800 rounded-2xl overflow-hidden">
          {/* Section header */}
          <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-white">{s.name}</h2>
              <p className="text-xs text-zinc-500 font-mono">/{s.slug}</p>
            </div>
            <span className="text-xs text-zinc-500">
              {s.groups.length} old group{s.groups.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="p-5 space-y-5">
            {/* Fixed text */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                <FileText className="w-3.5 h-3.5 text-zinc-500" />
                Section Fixed Text
                {s.descFixedText ? (
                  <span className={`normal-case font-medium ${s.descFixedTextEnabled ? "text-green-400" : "text-zinc-500"}`}>
                    (was {s.descFixedTextEnabled ? "enabled" : "disabled"})
                  </span>
                ) : (
                  <span className="normal-case font-medium text-zinc-600">(none set)</span>
                )}
              </div>
              {s.descFixedText && <CopyBlock text={s.descFixedText} label="Fixed text" />}
            </div>

            {/* Tags (informational — still active on the Section) */}
            {s.descTags && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  <Hash className="w-3.5 h-3.5 text-zinc-500" />
                  Hashtag Pool
                  <span className="normal-case font-medium text-zinc-600">
                    (unchanged — still on this Section, {s.descTagCount ?? "?"} per video)
                  </span>
                </div>
                <p className="text-xs text-zinc-400 font-mono">{s.descTags}</p>
              </div>
            )}

            {/* Old groups */}
            {s.groups.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  <FolderTree className="w-3.5 h-3.5 text-zinc-500" />
                  Removed Groups
                </div>
                <div className="divide-y divide-zinc-800 border border-zinc-800 rounded-xl overflow-hidden">
                  {s.groups.map((g) => (
                    <div key={g.id} className="px-4 py-3 bg-zinc-950/40 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-zinc-200">{g.name}</span>
                        <span className="text-[10px] text-zinc-600 font-mono">/{g.slug}</span>
                      </div>
                      {g.description ? (
                        <CopyBlock text={g.description} label={`${g.name} description`} />
                      ) : (
                        <p className="text-[11px] text-zinc-600 italic">No description</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
