"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Check,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Globe2,
  Key,
  Loader2,
  Plus,
  Share2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ShareRow = {
  id: string;
  code: string;
  title: string;
  label: string | null;
  allStates: boolean;
  stateNames: string[];
  createdBy: string | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
};

export default function ClientAccessDialog({
  open,
  onOpenChange,
  availableStates,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableStates: string[];
}) {
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [loadedAt, setLoadedAt] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const [title, setTitle] = useState("");
  const [label, setLabel] = useState("");
  const [allStates, setAllStates] = useState(true);
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [expiresInDays, setExpiresInDays] = useState<string>("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const loadShares = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/state-accounts/shares", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Could not load client portal links");
      const body = await res.json();
      setShares(body.shares || []);
      setLoadedAt(Date.now());
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load client links",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      void loadShares();
    }, 0);
    return () => clearTimeout(timer);
  }, [open, loadShares]);

  const toggleState = (name: string) => {
    setSelectedStates((prev) =>
      prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name],
    );
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Enter a report title for the client.");
      return;
    }
    if (!allStates && selectedStates.length === 0) {
      toast.error("Select at least one state or choose All states.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/state-accounts/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          label: label.trim() || undefined,
          allStates,
          stateNames: allStates ? [] : selectedStates,
          expiresInDays: expiresInDays ? Number(expiresInDays) : null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not create link");
      const createdCode = body.share?.code as string | undefined;
      if (createdCode && typeof window !== "undefined") {
        const directUrl = `${window.location.origin}/state-accounts/${createdCode}`;
        navigator.clipboard?.writeText(directUrl).catch(() => {});
        toast.success("Client link created & copied to clipboard");
      } else {
        toast.success("Client dashboard link created");
      }
      setTitle("");
      setLabel("");
      setAllStates(true);
      setSelectedStates([]);
      setExpiresInDays("");
      await loadShares();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create share link",
      );
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (
      !confirm(
        "Revoke this client link? Both the client dashboard URL and API access using this code will stop working immediately.",
      )
    )
      return;
    try {
      const res = await fetch("/api/admin/state-accounts/shares", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error("Failed to revoke link");
      toast.success("Client link revoked");
      await loadShares();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Revoke failed");
    }
  };

  const copyText = (key: string, text: string, msg: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    toast.success(msg);
    setTimeout(() => setCopiedKey((p) => (p === key ? null : p)), 1600);
  };

  const portalUrl = (code: string) =>
    typeof window !== "undefined"
      ? `${window.location.origin}/state-accounts/${code}`
      : `/state-accounts/${code}`;

  const activeShares = shares.filter((s) => !s.revokedAt);
  const revokedShares = shares.filter((s) => !!s.revokedAt);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-zinc-800 bg-zinc-950 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-white">
            <Share2 size={16} className="text-rose-400" />
            Client Dashboard Links &amp; API Access
          </DialogTitle>
          <p className="text-xs text-zinc-400">
            Generate private no-login client links at{" "}
            <code className="text-zinc-200">/state-accounts/CODE</code>. Clients
            open the dashboard directly with all internal team data hidden. The
            same code also works with{" "}
            <code className="text-zinc-200">/api/public/v1/state-accounts</code>
            .
          </p>
        </DialogHeader>

        {/* Create new share form */}
        <form
          onSubmit={handleCreate}
          className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4"
        >
          <p className="text-xs font-semibold text-zinc-200">
            Create client dashboard link
          </p>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Report title (e.g. Swing State Network)"
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
            />
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Internal note / client name (optional)"
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setAllStates(true)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                  allStates
                    ? "border-blue-500/50 bg-blue-500/15 text-blue-200"
                    : "border-zinc-700 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                All state accounts
              </button>
              <button
                type="button"
                onClick={() => setAllStates(false)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                  !allStates
                    ? "border-blue-500/50 bg-blue-500/15 text-blue-200"
                    : "border-zinc-700 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Selected states
              </button>
            </div>

            <select
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              className="rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-200 focus:outline-none"
              aria-label="Link expiration"
            >
              <option value="">No expiration</option>
              <option value="7">Expires in 7 days</option>
              <option value="30">Expires in 30 days</option>
              <option value="90">Expires in 90 days</option>
            </select>
          </div>

          {!allStates && (
            <div className="space-y-1.5 rounded-md border border-zinc-800 bg-zinc-950/70 p-3">
              <p className="text-[11px] text-zinc-400">
                Choose which states this client can view:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {availableStates.map((st) => {
                  const checked = selectedStates.includes(st);
                  return (
                    <button
                      key={st}
                      type="button"
                      onClick={() => toggleState(st)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                        checked
                          ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-200"
                          : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {checked ? "✓ " : ""}
                      {st}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={creating || !title.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-3.5 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-zinc-200 disabled:opacity-50"
          >
            {creating ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Plus size={13} />
            )}
            Generate client link
          </button>
        </form>

        {/* Active share links */}
        <div className="space-y-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Active client links ({activeShares.length})
          </h3>

          {loading ? (
            <div className="flex items-center gap-2 py-6 text-xs text-zinc-500">
              <Loader2 size={14} className="animate-spin" />
              Loading client links…
            </div>
          ) : activeShares.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-800 p-4 text-xs text-zinc-500">
              No active client dashboard links yet. Generate one above to share
              live results.
            </p>
          ) : (
            <div className="space-y-2">
              {activeShares.map((s) => {
                const url = portalUrl(s.code);
                const expired =
                  s.expiresAt !== null &&
                  loadedAt > 0 &&
                  Date.parse(s.expiresAt) < loadedAt;
                return (
                  <div
                    key={s.id}
                    className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3.5 space-y-2"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-zinc-100">
                            {s.title}
                          </span>
                          {s.label && (
                            <span className="text-xs text-zinc-500">
                              · {s.label}
                            </span>
                          )}
                          {expired && (
                            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                              Expired
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                          <span className="inline-flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-200">
                            {s.code}
                          </span>
                          <span className="inline-flex items-center gap-1 text-zinc-400">
                            <Globe2 size={11} />
                            {s.allStates
                              ? "All state accounts"
                              : s.stateNames.join(", ")}
                          </span>
                          {s.expiresAt && (
                            <span className="text-zinc-500">
                              · Expires{" "}
                              {new Date(s.expiresAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            copyText(`url-${s.id}`, url, "Portal link copied")
                          }
                          className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-200 transition hover:border-zinc-500 hover:text-white"
                        >
                          {copiedKey === `url-${s.id}` ? (
                            <Check size={11} className="text-emerald-400" />
                          ) : (
                            <Copy size={11} />
                          )}
                          Copy link
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            copyText(
                              `code-${s.id}`,
                              s.code,
                              "Code / API key copied",
                            )
                          }
                          className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 transition hover:border-zinc-500 hover:text-white"
                          title="Copy code (works as x-api-key too)"
                        >
                          <Code2 size={11} />
                          Code
                        </button>
                        <a
                          href={`/state-accounts/${s.code}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-blue-300 transition hover:border-blue-500/50 hover:text-blue-200"
                        >
                          <ExternalLink size={11} />
                          Open
                        </a>
                        <button
                          type="button"
                          onClick={() => handleRevoke(s.id)}
                          className="inline-flex items-center gap-1 rounded border border-red-900/40 px-2 py-1 text-[11px] text-red-400 transition hover:bg-red-950/40 hover:text-red-300"
                          title="Revoke link"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {revokedShares.length > 0 && (
            <details className="pt-2">
              <summary className="cursor-pointer text-[11px] text-zinc-500 hover:text-zinc-300">
                Revoked links ({revokedShares.length})
              </summary>
              <div className="mt-2 space-y-1.5">
                {revokedShares.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between rounded border border-zinc-800/70 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-500"
                  >
                    <span className="line-through">
                      {s.title} ({s.code})
                    </span>
                    <span className="text-[10px]">
                      Revoked{" "}
                      {s.revokedAt
                        ? new Date(s.revokedAt).toLocaleDateString()
                        : ""}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

        {/* Persistent API keys footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3 text-xs text-zinc-400">
          <div className="flex items-center gap-2">
            <Key size={13} className="text-zinc-400" />
            <span>
              Need persistent hashed <code className="text-zinc-200">slk_…</code>{" "}
              API keys?
            </span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/docs/state-accounts-client-api.md"
              download
              className="inline-flex items-center gap-1 font-medium text-zinc-300 hover:text-white"
            >
              <Download size={12} />
              API Docs
            </a>
            <Link
              href="/admin/api-clients"
              className="inline-flex items-center gap-1 font-medium text-blue-400 hover:text-blue-300"
            >
              Manage API Clients →
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
