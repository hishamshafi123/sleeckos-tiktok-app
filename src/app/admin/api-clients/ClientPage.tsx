"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Key,
  Plus,
  Copy,
  Check,
  Trash2,
  Loader2,
  Users,
  FolderOpen,
  X,
  Globe2,
} from "lucide-react";
import { STATES } from "@/lib/services/content-desk/rules";

interface ApiKeyRow {
  id: string;
  keyPrefix: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface ClientCampaign {
  id: string;
  campaignId: string;
  campaignTitle: string;
}

interface ClientStateAccess {
  allStates: boolean;
  stateNames: string[];
}

interface ApiClientRow {
  id: string;
  name: string;
  notes: string | null;
  createdAt: string;
  revokedAt: string | null;
  keys: ApiKeyRow[];
  campaigns: ClientCampaign[];
  stateAccess: ClientStateAccess | null;
}

interface CampaignOption {
  id: string;
  title: string;
  status?: string;
}

const KNOWN_STATE_NAMES = STATES.map((s) => s.name);

export default function ClientPage() {
  const [clients, setClients] = useState<ApiClientRow[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);

  // Newly generated raw key — shown once, never again.
  const [newRawKey, setNewRawKey] = useState<{ clientName: string; rawKey: string } | null>(null);
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [grantPickerFor, setGrantPickerFor] = useState<string | null>(null);
  const [stateEditorFor, setStateEditorFor] = useState<string | null>(null);
  const [stateDraftAll, setStateDraftAll] = useState(true);
  const [stateDraftNames, setStateDraftNames] = useState<string[]>([]);
  const [savingStateAccess, setSavingStateAccess] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchAll = async () => {
    try {
      const [clientsRes, campaignsRes] = await Promise.all([
        fetch("/api/api-clients"),
        fetch("/api/campaigns"),
      ]);
      if (clientsRes.ok) setClients((await clientsRes.json()).clients || []);
      if (campaignsRes.ok) setCampaigns(await campaignsRes.json());
    } catch (err) {
      console.error("Failed to load API clients:", err);
      toast.error("Failed to load API clients");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [clientsRes, campaignsRes] = await Promise.all([
          fetch("/api/api-clients"),
          fetch("/api/campaigns"),
        ]);
        if (!active) return;
        if (clientsRes.ok) setClients((await clientsRes.json()).clients || []);
        if (campaignsRes.ok) setCampaigns(await campaignsRes.json());
      } catch (err) {
        console.error("Failed to load API clients:", err);
        if (active) toast.error("Failed to load API clients");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/api-clients", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), notes: notes.trim() || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      setName("");
      setNotes("");
      toast.success("Client created — now generate a key for them");
      await fetchAll();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create client");
    } finally {
      setCreating(false);
    }
  };

  const handleGenerateKey = async (client: ApiClientRow) => {
    setGeneratingFor(client.id);
    try {
      const res = await fetch(`/api/api-clients/${client.id}/keys`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      const data = await res.json();
      setNewRawKey({ clientName: client.name, rawKey: data.rawKey });
      await fetchAll();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to generate key");
    } finally {
      setGeneratingFor(null);
    }
  };

  const handleRevokeKey = async (clientId: string, keyId: string) => {
    if (!confirm("Revoke this key? The client's integration stops working immediately.")) return;
    const res = await fetch(`/api/api-clients/${clientId}/keys/${keyId}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Key revoked");
      await fetchAll();
    } else {
      toast.error("Failed to revoke key");
    }
  };

  const handleGrant = async (clientId: string, campaignId: string) => {
    const res = await fetch(`/api/api-clients/${clientId}/campaigns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaignId }),
    });
    if (res.ok) {
      toast.success("Campaign access granted");
      setGrantPickerFor(null);
      await fetchAll();
    } else {
      toast.error("Failed to grant access");
    }
  };

  const handleRevokeGrant = async (clientId: string, campaignId: string) => {
    const res = await fetch(`/api/api-clients/${clientId}/campaigns`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaignId }),
    });
    if (res.ok) {
      toast.success("Campaign access removed");
      await fetchAll();
    } else {
      toast.error("Failed to remove access");
    }
  };

  const openStateEditor = (client: ApiClientRow) => {
    if (stateEditorFor === client.id) {
      setStateEditorFor(null);
      return;
    }
    setStateEditorFor(client.id);
    setStateDraftAll(client.stateAccess ? client.stateAccess.allStates : true);
    setStateDraftNames(client.stateAccess ? client.stateAccess.stateNames : []);
  };

  const handleSaveStateAccess = async (clientId: string) => {
    if (!stateDraftAll && stateDraftNames.length === 0) {
      toast.error("Select at least one state or grant all states");
      return;
    }
    setSavingStateAccess(true);
    try {
      const res = await fetch(`/api/api-clients/${clientId}/state-access`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          allStates: stateDraftAll,
          stateNames: stateDraftAll ? [] : stateDraftNames,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      toast.success("State Accounts API access saved");
      setStateEditorFor(null);
      await fetchAll();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save State Accounts access");
    } finally {
      setSavingStateAccess(false);
    }
  };

  const handleRevokeStateAccess = async (clientId: string) => {
    const res = await fetch(`/api/api-clients/${clientId}/state-access`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast.success("State Accounts access removed");
      setStateEditorFor(null);
      await fetchAll();
    } else {
      toast.error("Failed to remove State Accounts access");
    }
  };

  const copyRawKey = () => {
    if (!newRawKey) return;
    navigator.clipboard.writeText(newRawKey.rawKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
          <Key size={18} className="text-zinc-400" />
          API Clients
        </h1>
        <p className="text-xs text-zinc-500 mt-1">
          One API key per client, valid for every campaign and state account you grant them.
          Raw keys are shown once at creation; only a hash is stored. Docs:{" "}
          <a href="/docs/campaign-client-api.md" download className="underline hover:text-zinc-300">
            campaign-client-api.md
          </a>
          {" · "}
          <a href="/docs/state-accounts-client-api.md" download className="underline hover:text-zinc-300">
            state-accounts-client-api.md
          </a>
        </p>
      </div>

      {/* Create client */}
      <form
        onSubmit={handleCreate}
        className="flex flex-col sm:flex-row gap-2 border border-[#27272a] rounded-md bg-[#09090b] p-4"
      >
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Client name (e.g. Acme PAC)"
          className="flex-1 bg-[#18181b] border border-[#27272a] rounded px-3 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500 placeholder-zinc-600"
        />
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          className="flex-1 bg-[#18181b] border border-[#27272a] rounded px-3 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500 placeholder-zinc-600"
        />
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="flex items-center justify-center gap-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-950 text-xs font-semibold px-4 py-1.5 rounded transition disabled:opacity-50"
        >
          {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          Add client
        </button>
      </form>

      {/* One-time raw key display */}
      {newRawKey && (
        <div className="border border-emerald-900/50 bg-emerald-950/20 rounded-md p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-emerald-300">
              API key for {newRawKey.clientName} — shown once, copy it now
            </p>
            <button
              onClick={() => setNewRawKey(null)}
              className="text-zinc-500 hover:text-zinc-300 transition"
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[11px] font-mono text-zinc-100 bg-zinc-950 border border-[#27272a] rounded px-2.5 py-1.5 break-all">
              {newRawKey.rawKey}
            </code>
            <button
              onClick={copyRawKey}
              className="flex items-center gap-1 text-[11px] font-semibold text-zinc-300 hover:text-zinc-100 bg-zinc-900 border border-[#27272a] hover:border-zinc-600 rounded px-2.5 py-1.5 transition flex-shrink-0"
            >
              {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-[10px] text-zinc-500">
            If you lose it, revoke and generate a new one — it cannot be recovered.
          </p>
        </div>
      )}

      {/* Client list */}
      {loading ? (
        <div className="flex items-center justify-center py-10 text-xs text-zinc-500 gap-2">
          <Loader2 size={14} className="animate-spin" />
          Loading clients...
        </div>
      ) : clients.length === 0 ? (
        <div className="border border-[#27272a] rounded-md bg-[#09090b] py-10 text-center">
          <Users size={20} className="mx-auto text-zinc-600 mb-2" />
          <p className="text-xs text-zinc-500">No API clients yet — add one above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {clients.map((client) => (
            <div
              key={client.id}
              className={`border rounded-md bg-[#09090b] p-4 space-y-3 ${
                client.revokedAt ? "border-red-900/40 opacity-60" : "border-[#27272a]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-sm font-semibold text-zinc-100">{client.name}</span>
                  {client.notes && (
                    <span className="text-[11px] text-zinc-500 ml-2">{client.notes}</span>
                  )}
                  {client.revokedAt && (
                    <span className="ml-2 text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">
                      Revoked
                    </span>
                  )}
                </div>
                {!client.revokedAt && (
                  <button
                    onClick={() => handleGenerateKey(client)}
                    disabled={generatingFor === client.id}
                    className="flex items-center gap-1 text-[11px] font-semibold text-zinc-300 hover:text-zinc-100 bg-zinc-900 border border-[#27272a] hover:border-zinc-600 rounded px-2.5 py-1 transition flex-shrink-0"
                  >
                    {generatingFor === client.id ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Key size={11} />
                    )}
                    Generate key
                  </button>
                )}
              </div>

              {/* Keys */}
              {client.keys.length > 0 && (
                <div className="space-y-1">
                  {client.keys.map((k) => (
                    <div
                      key={k.id}
                      className="flex items-center justify-between bg-zinc-950/40 border border-[#27272a] rounded px-2.5 py-1.5"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`text-[11px] font-mono ${
                            k.revokedAt ? "text-zinc-600 line-through" : "text-zinc-200"
                          }`}
                        >
                          {k.keyPrefix}…
                        </span>
                        {k.lastUsedAt && !k.revokedAt && (
                          <span className="text-[9px] text-zinc-600">
                            last used {new Date(k.lastUsedAt).toLocaleDateString()}
                          </span>
                        )}
                        {k.revokedAt && (
                          <span className="text-[9px] font-semibold uppercase text-red-400">
                            revoked
                          </span>
                        )}
                      </div>
                      {!k.revokedAt && (
                        <button
                          onClick={() => handleRevokeKey(client.id, k.id)}
                          className="text-[10px] font-semibold text-red-400 hover:text-red-300 flex items-center gap-1 flex-shrink-0"
                        >
                          <Trash2 size={10} />
                          Revoke
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Campaign grants */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                    Campaign access
                  </span>
                  {!client.revokedAt && (
                    <button
                      onClick={() =>
                        setGrantPickerFor(grantPickerFor === client.id ? null : client.id)
                      }
                      className="flex items-center gap-1 text-[10px] font-semibold text-zinc-400 hover:text-zinc-200 transition"
                    >
                      <Plus size={10} />
                      Grant campaign
                    </button>
                  )}
                </div>

                {client.campaigns.length === 0 ? (
                  <p className="text-[11px] text-zinc-600 italic">
                    No campaigns granted — the key returns 404 until you grant one.
                  </p>
                ) : (
                  client.campaigns.map((g) => (
                    <div
                      key={g.id}
                      className="flex items-center justify-between bg-zinc-950/40 border border-[#27272a] rounded px-2.5 py-1.5"
                    >
                      <span className="text-[11px] text-zinc-300 flex items-center gap-1.5 min-w-0">
                        <FolderOpen size={10} className="text-zinc-500 flex-shrink-0" />
                        <span className="truncate">{g.campaignTitle}</span>
                        <span className="text-[9px] text-zinc-600 font-mono hidden sm:inline">
                          {g.campaignId.slice(0, 8)}…
                        </span>
                      </span>
                      {!client.revokedAt && (
                        <button
                          onClick={() => handleRevokeGrant(client.id, g.campaignId)}
                          className="text-[10px] font-semibold text-red-400 hover:text-red-300 flex-shrink-0 ml-2"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))
                )}

                {grantPickerFor === client.id && (
                  <select
                    autoFocus
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) handleGrant(client.id, e.target.value);
                    }}
                    className="w-full bg-[#18181b] border border-[#27272a] rounded px-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500"
                  >
                    <option value="" disabled>
                      Select a campaign to grant…
                    </option>
                    {campaigns
                      .filter((c) => !client.campaigns.some((g) => g.campaignId === c.id))
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                  </select>
                )}
              </div>

              {/* State Accounts API access */}
              <div className="space-y-1.5 pt-2 border-t border-[#27272a]/70">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                    State Accounts API access
                  </span>
                  {!client.revokedAt && (
                    <button
                      onClick={() => openStateEditor(client)}
                      className="flex items-center gap-1 text-[10px] font-semibold text-zinc-400 hover:text-zinc-200 transition"
                    >
                      <Globe2 size={10} />
                      {client.stateAccess ? "Edit access" : "Grant state access"}
                    </button>
                  )}
                </div>

                {!client.stateAccess ? (
                  <p className="text-[11px] text-zinc-600 italic">
                    No state accounts access — /api/public/v1/state-accounts returns 404.
                  </p>
                ) : (
                  <div className="flex items-center justify-between bg-zinc-950/40 border border-[#27272a] rounded px-2.5 py-1.5">
                    <span className="text-[11px] text-zinc-300 flex items-center gap-1.5 min-w-0">
                      <Globe2 size={11} className="text-emerald-400 flex-shrink-0" />
                      <span className="truncate">
                        {client.stateAccess.allStates
                          ? "All active state accounts"
                          : client.stateAccess.stateNames.join(", ")}
                      </span>
                    </span>
                    {!client.revokedAt && (
                      <button
                        onClick={() => handleRevokeStateAccess(client.id)}
                        className="text-[10px] font-semibold text-red-400 hover:text-red-300 flex-shrink-0 ml-2"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                )}

                {stateEditorFor === client.id && (
                  <div className="bg-zinc-950/70 border border-[#27272a] rounded p-3 space-y-2.5">
                    <div className="flex items-center gap-2 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setStateDraftAll(true)}
                        className={`rounded border px-2 py-1 font-medium transition ${
                          stateDraftAll
                            ? "border-blue-500/50 bg-blue-500/15 text-blue-200"
                            : "border-zinc-700 text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        All states
                      </button>
                      <button
                        type="button"
                        onClick={() => setStateDraftAll(false)}
                        className={`rounded border px-2 py-1 font-medium transition ${
                          !stateDraftAll
                            ? "border-blue-500/50 bg-blue-500/15 text-blue-200"
                            : "border-zinc-700 text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        Specific states
                      </button>
                    </div>

                    {!stateDraftAll && (
                      <div className="flex flex-wrap gap-1.5">
                        {KNOWN_STATE_NAMES.map((st) => {
                          const checked = stateDraftNames.includes(st);
                          return (
                            <button
                              key={st}
                              type="button"
                              onClick={() =>
                                setStateDraftNames((prev) =>
                                  prev.includes(st)
                                    ? prev.filter((x) => x !== st)
                                    : [...prev, st],
                                )
                              }
                              className={`rounded-full border px-2.5 py-0.5 text-[10px] font-medium transition ${
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
                    )}

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        disabled={savingStateAccess}
                        onClick={() => handleSaveStateAccess(client.id)}
                        className="rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-950 text-[11px] font-semibold px-3 py-1 transition disabled:opacity-50"
                      >
                        {savingStateAccess ? "Saving…" : "Save access"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setStateEditorFor(null)}
                        className="text-[11px] text-zinc-400 hover:text-zinc-200 px-2 py-1"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
