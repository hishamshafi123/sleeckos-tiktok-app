"use client";

import { useState } from "react";
import { Check, Code2, Copy, Download, Eye, EyeOff, Terminal, X } from "lucide-react";

export default function ApiQuickstartModal({
  open,
  onClose,
  accessCode,
  selectedSlug,
  origin,
}: {
  open: boolean;
  onClose: () => void;
  accessCode: string;
  selectedSlug: string | null;
  origin: string;
}) {
  const [revealKey, setRevealKey] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!open) return null;

  const base = origin || "https://sleeckos.com";
  const displayKey = revealKey
    ? accessCode
    : `${accessCode.slice(0, 4)}${"•".repeat(Math.max(4, accessCode.length - 4))}`;
  const statePath = selectedSlug || "georgia";

  const snippets = [
    {
      id: "summary",
      title: "Portfolio summary & all state accounts",
      method: "GET",
      path: "/api/public/v1/state-accounts?days=30",
      curl: `curl "${base}/api/public/v1/state-accounts?days=30" \\\n  -H "x-api-key: ${accessCode}"`,
      displayCurl: `curl "${base}/api/public/v1/state-accounts?days=30" \\\n  -H "x-api-key: ${displayKey}"`,
    },
    {
      id: "single",
      title: `Single state account detail (${selectedSlug ? selectedSlug : "slug, 2-letter code, or ID"})`,
      method: "GET",
      path: `/api/public/v1/state-accounts/${statePath}?days=30`,
      curl: `curl "${base}/api/public/v1/state-accounts/${statePath}?days=30" \\\n  -H "x-api-key: ${accessCode}"`,
      displayCurl: `curl "${base}/api/public/v1/state-accounts/${statePath}?days=30" \\\n  -H "x-api-key: ${displayKey}"`,
    },
    {
      id: "posts",
      title: "Tracked videos & links (filterable by state, date, sort)",
      method: "GET",
      path: selectedSlug
        ? `/api/public/v1/state-accounts/${selectedSlug}/posts?sort=views&limit=100`
        : `/api/public/v1/state-accounts/posts?sort=views&limit=100`,
      curl: `curl "${base}/api/public/v1/state-accounts/${selectedSlug ? `${selectedSlug}/` : ""}posts?sort=views&limit=100" \\\n  -H "x-api-key: ${accessCode}"`,
      displayCurl: `curl "${base}/api/public/v1/state-accounts/${selectedSlug ? `${selectedSlug}/` : ""}posts?sort=views&limit=100" \\\n  -H "x-api-key: ${displayKey}"`,
    },
  ];

  const copy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1800);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="State Accounts API Quickstart"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-[#0c0c10] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/[0.07] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-rose-500/25 bg-rose-500/10 text-rose-400">
              <Terminal size={15} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">
                State Accounts REST API
              </h2>
              <p className="text-[11px] text-zinc-400">
                Read-only JSON endpoints · Hourly sync · Browser CORS enabled
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"
            aria-label="Close API guide"
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[75vh] space-y-4 overflow-y-auto p-6">
          {/* Key bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-zinc-950/70 px-3.5 py-2.5">
            <div className="flex items-center gap-2 text-xs">
              <Code2 size={14} className="text-zinc-500" />
              <span className="text-zinc-400">Header:</span>
              <code className="font-mono text-zinc-100">
                x-api-key: {displayKey}
              </code>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setRevealKey((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] px-2 py-1 text-[11px] text-zinc-400 transition hover:border-white/20 hover:text-zinc-200"
              >
                {revealKey ? <EyeOff size={12} /> : <Eye size={12} />}
                {revealKey ? "Hide" : "Reveal"}
              </button>
              <button
                type="button"
                onClick={() => copy("key", accessCode)}
                className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-zinc-200 transition hover:bg-white/[0.09]"
              >
                {copiedId === "key" ? (
                  <Check size={12} className="text-emerald-400" />
                ) : (
                  <Copy size={12} />
                )}
                {copiedId === "key" ? "Copied" : "Copy key"}
              </button>
            </div>
          </div>

          {/* Endpoint snippets */}
          <div className="space-y-3">
            {snippets.map((s) => (
              <div
                key={s.id}
                className="overflow-hidden rounded-xl border border-white/[0.07] bg-zinc-950/50"
              >
                <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-3.5 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-400">
                      {s.method}
                    </span>
                    <span className="truncate text-xs font-medium text-zinc-200">
                      {s.title}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => copy(s.id, s.curl)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-100"
                  >
                    {copiedId === s.id ? (
                      <Check size={12} className="text-emerald-400" />
                    ) : (
                      <Copy size={12} />
                    )}
                    {copiedId === s.id ? "Copied" : "Copy cURL"}
                  </button>
                </div>
                <pre className="overflow-x-auto p-3.5 font-mono text-[11px] leading-relaxed text-zinc-300">
                  {s.displayCurl}
                </pre>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs text-zinc-400">
            <span>
              Supports <code className="text-zinc-200">?days=1..90</code>,{" "}
              <code className="text-zinc-200">?from=YYYY-MM-DD&amp;to=YYYY-MM-DD</code>,
              and <code className="text-zinc-200">?limit=1..500</code>.
            </span>
            <a
              href="/docs/state-accounts-client-api.md"
              download
              className="inline-flex items-center gap-1.5 font-medium text-rose-400 transition hover:text-rose-300"
            >
              <Download size={13} />
              Full API Docs (.md)
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
