"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Film,
  FolderOpen,
  Loader2,
  Music2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Upload,
  X,
} from "lucide-react";
import {
  DEFAULT_MIXER_SETTINGS,
  MIXER_FONTS,
  MIXER_LOOKS,
  MIXER_MAX_BATCH,
  record,
  type MixerSelection,
  type MixerSettings,
} from "@/lib/campaign-mixer/schema";
import type { MixerPlan } from "@/lib/services/campaign-mixer/planner";
import MixerPreview from "./MixerPreview";
import Image from "next/image";
import {
  MIXER_API,
  mixerRequest,
  buttonClass,
  fieldClass,
  primaryClass,
  type Asset,
  type BatchData,
  type WorkspaceData,
} from "./types";

type IndexData = {
  workspaces: {
    id: string;
    name: string;
    _count: { assets: number; texts: number; batches: number };
  }[];
  campaigns: { id: string; title: string }[];
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : "This action failed. Please retry.";
const toggle = (list: string[], id: string) =>
  list.includes(id) ? list.filter((v) => v !== id) : [...list, id];
const seconds = (value: number) => `${value.toFixed(1)}s`;
function ids(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

export default function CampaignMixer({
  onSmartExport,
}: {
  onSmartExport: (groupId: string) => Promise<void> | void;
}) {
  const [index, setIndex] = useState<IndexData>({
    workspaces: [],
    campaigns: [],
  });
  const [workspaceId, setWorkspaceId] = useState("");
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [campaignId, setCampaignId] = useState("");
  const [tab, setTab] = useState<"clips" | "texts" | "music" | "looks">(
    "clips",
  );
  const [clipIds, setClipIds] = useState<string[]>([]),
    [textIds, setTextIds] = useState<string[]>([]),
    [musicIds, setMusicIds] = useState<string[]>([]),
    [presetIds, setPresetIds] = useState<string[]>(["reference-dark"]);
  const [settings, setSettings] = useState<MixerSettings>(
    DEFAULT_MIXER_SETTINGS,
  );
  const [count, setCount] = useState(30),
    [seed, setSeed] = useState(() => crypto.randomUUID());
  const [focusClip, setFocusClip] = useState("");
  const [assetEditor, setAssetEditor] = useState<Asset | null>(null),
    [assetDraft, setAssetDraft] = useState<Record<string, unknown>>({});
  const [textInput, setTextInput] = useState("");
  const [editingText, setEditingText] = useState<string | null>(null),
    [editedText, setEditedText] = useState("");
  const [editedTags, setEditedTags] = useState("");
  const [lookDraft, setLookDraft] = useState(MIXER_LOOKS[0].settings),
    [lookName, setLookName] = useState("");
  const [plan, setPlan] = useState<MixerPlan | null>(null),
    [previewIndex, setPreviewIndex] = useState(0);
  const [sample, setSample] = useState<string | null>(null),
    [batch, setBatch] = useState<BatchData | null>(null);
  const [batchPage, setBatchPage] = useState(0),
    [history, setHistory] = useState(false);
  const [filter, setFilter] = useState("all"),
    [query, setQuery] = useState("");
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [saveState, setSaveState] = useState("Saved"),
    [uploadState, setUploadState] = useState<
      { name: string; progress: number; error?: string }[]
    >([]);
  const [changed, setChanged] = useState(0);
  const revision = useRef(0),
    activeWorkspace = useRef(""),
    draftSnapshot = useRef<Record<string, unknown>>({});
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve()),
    idempotency = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const selection: MixerSelection = useMemo(
    () => ({ clipIds, textIds, musicIds, presetIds, count, seed, settings }),
    [clipIds, textIds, musicIds, presetIds, count, seed, settings],
  );
  const currentSelection = useRef(selection);
  currentSelection.current = selection;
  const assets = data?.assets.filter((a) => !a.archived) || [];
  const texts = data?.texts.filter((t) => !t.archived) || [];
  const selectedClip =
    assets.find((a) => a.id === focusClip) ||
    assets.find((a) => clipIds.includes(a.id));
  const selectedMusic = assets.find((a) => musicIds.includes(a.id));
  const selectedLook = data?.looks.find((l) => presetIds.includes(l.id));
  const selectedText = texts.find((t) => textIds.includes(t.id));
  const recipe = plan?.recipes[previewIndex];

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const promise = saveQueue.current.catch(() => {}).then(task);
    saveQueue.current = promise;
    return promise;
  }
  const refreshIndex = useCallback(async () => {
    const payload = await mixerRequest<IndexData>("workspaces");
    setIndex(payload);
  }, []);
  useEffect(() => {
    void refreshIndex().catch((e) => setError(message(e)));
  }, [refreshIndex]);
  async function loadWorkspace(id: string, initialize = false) {
    const payload = await mixerRequest<WorkspaceData>(`workspaces/${id}`);
    if (activeWorkspace.current !== id) return;
    revision.current = payload.workspace.revision;
    setData(payload);
    if (initialize) {
      draftSnapshot.current = payload.workspace.draft || {};
      const defaults = {
        ...DEFAULT_MIXER_SETTINGS,
        ...payload.workspace.defaults,
      };
      setSettings(defaults);
      setClipIds([]);
      setFocusClip("");
      const lastTexts = ids(draftSnapshot.current.textIds).filter((id) =>
        payload.texts.some((t) => t.id === id && !t.archived),
      );
      const lastMusic = ids(draftSnapshot.current.musicIds).filter((id) =>
        payload.assets.some((a) => a.id === id && !a.archived),
      );
      const lastLooks = ids(draftSnapshot.current.presetIds).filter((id) =>
        payload.looks.some((l) => l.id === id),
      );
      setTextIds(
        lastTexts.length
          ? lastTexts
          : payload.texts.filter((t) => !t.archived).map((t) => t.id),
      );
      setMusicIds(
        lastMusic.length
          ? lastMusic
          : payload.assets
              .filter((a) => a.kind === "music" && !a.archived)
              .map((a) => a.id),
      );
      setPresetIds(lastLooks.length ? lastLooks : ["reference-dark"]);
      setCount(Number(draftSnapshot.current.count) || 30);
      setSeed(crypto.randomUUID());
      setChanged(0);
      setSaveState("Saved");
    }
  }
  useEffect(() => {
    activeWorkspace.current = workspaceId;
    setData(null);
    setPlan(null);
    setBatch(null);
    setHistory(false);
    setError("");
    setSample(null);
    if (workspaceId)
      void loadWorkspace(workspaceId, true).catch((e) => setError(message(e)));
    // A workspace switch is the only event that initializes a new day's selection.
  }, [workspaceId]);
  function invalidate() {
    setPlan(null);
    setSample(null);
    idempotency.current = null;
    setChanged((v) => v + 1);
  }
  async function saveDraft() {
    const id = activeWorkspace.current,
      selectionSnapshot = currentSelection.current;
    if (!id || !data) return;
    setSaveState("Saving…");
    try {
      await enqueue(async () => {
        const saved = await mixerRequest<{ revision: number }>(
          `workspaces/${id}`,
          "PATCH",
          {
            revision: revision.current,
            defaults: selectionSnapshot.settings,
            draft: selectionSnapshot,
          },
        );
        if (activeWorkspace.current === id) {
          revision.current = saved.revision;
          draftSnapshot.current = selectionSnapshot as unknown as Record<
            string,
            unknown
          >;
        }
      });
      setSaveState("Saved");
    } catch (e) {
      setSaveState("Save failed");
      setError(message(e));
      throw e;
    }
  }
  async function switchWorkspace(id: string) {
    await act("Saving campaign", async () => {
      if (data && changed) await saveDraft();
      await saveQueue.current;
      setChanged(0);
      setWorkspaceId(id);
    });
  }
  useEffect(() => {
    if (!changed || !data) return;
    const timer = setTimeout(() => {
      void saveDraft().catch(() => {});
    }, 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changed, workspaceId]);
  async function act(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  }
  async function mutate(path: string, method: string, body: unknown) {
    await enqueue(async () => {
      await mixerRequest(`workspaces/${workspaceId}/${path}`, method, body);
      await loadWorkspace(workspaceId);
    });
    invalidate();
  }
  function updateSetting<K extends keyof MixerSettings>(
    key: K,
    value: MixerSettings[K],
  ) {
    setSettings((s) => ({ ...s, [key]: value }));
    invalidate();
  }
  function newBatch() {
    setBatch(null);
    setPlan(null);
    setHistory(false);
    setClipIds([]);
    setFocusClip("");
    setSample(null);
    setSeed(crypto.randomUUID());
    setNotice(
      "Select the clips you want in this batch. Your library and settings are saved.",
    );
  }
  function restoreDraft() {
    const d = draftSnapshot.current;
    setClipIds(ids(d.clipIds).filter((id) => assets.some((a) => a.id === id)));
    if (ids(d.textIds).length)
      setTextIds(ids(d.textIds).filter((id) => texts.some((t) => t.id === id)));
    if (ids(d.musicIds).length)
      setMusicIds(
        ids(d.musicIds).filter((id) => assets.some((a) => a.id === id)),
      );
    setSeed(crypto.randomUUID());
    invalidate();
  }
  async function upload(files: FileList | null) {
    if (!files?.length || !workspaceId) return;
    const kind = tab === "music" ? "music" : "clip",
      list = Array.from(files);
    setUploadState(list.map((f) => ({ name: f.name, progress: 0 })));
    await act("Uploading files", async () => {
      for (let i = 0; i < list.length; i++) {
        try {
          const result = await enqueue(
            () =>
              new Promise<{ assetId: string; duplicate: boolean }>(
                (resolve, reject) => {
                  const xhr = new XMLHttpRequest();
                  xhr.open(
                    "POST",
                    `${MIXER_API}/workspaces/${workspaceId}/upload?kind=${kind}&name=${encodeURIComponent(list[i].name)}`,
                  );
                  xhr.timeout = 300_000;
                  xhr.setRequestHeader(
                    "Content-Type",
                    "application/octet-stream",
                  );
                  xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable)
                      setUploadState((old) =>
                        old.map((s, n) =>
                          n === i
                            ? {
                                ...s,
                                progress: Math.min(
                                  95,
                                  Math.round((e.loaded / e.total) * 95),
                                ),
                              }
                            : s,
                        ),
                      );
                  };
                  xhr.onerror = () =>
                    reject(
                      new Error("Upload connection failed. Retry this file."),
                    );
                  xhr.ontimeout = () =>
                    reject(
                      new Error(
                        "Processing timed out. Refresh the library before retrying; the file may have arrived.",
                      ),
                    );
                  xhr.onload = () => {
                    let p;
                    try {
                      p = JSON.parse(xhr.responseText);
                    } catch {
                      reject(
                        new Error(
                          `Upload returned ${xhr.status}. Check the file size and retry.`,
                        ),
                      );
                      return;
                    }
                    if (xhr.status >= 200 && xhr.status < 300) resolve(p);
                    else reject(new Error(p.error || "Upload failed."));
                  };
                  xhr.send(list[i]);
                },
              ),
          );
          await enqueue(() => loadWorkspace(workspaceId));
          if (kind === "clip") {
            setClipIds((old) => [...new Set([...old, result.assetId])]);
            setFocusClip(result.assetId);
          } else setMusicIds((old) => [...new Set([...old, result.assetId])]);
          setUploadState((old) =>
            old.map((s, n) => (n === i ? { ...s, progress: 100 } : s)),
          );
        } catch (e) {
          setUploadState((old) =>
            old.map((s, n) => (n === i ? { ...s, error: message(e) } : s)),
          );
        }
      }
      invalidate();
      await refreshIndex();
    });
    if (fileInput.current) fileInput.current.value = "";
  }
  async function preview() {
    await act("Preparing preview", async () => {
      await saveDraft();
      const snapshot = currentSelection.current;
      const p = await mixerRequest<MixerPlan>(
        `workspaces/${workspaceId}/plan`,
        "POST",
        { selection: snapshot },
      );
      if (snapshot === currentSelection.current) {
        setPlan(p);
        setPreviewIndex(0);
        setSample(null);
        idempotency.current = crypto.randomUUID();
      }
    });
  }
  async function confirm() {
    if (!plan) return;
    await act("Queuing batch", async () => {
      const result = await mixerRequest<{ batchId: string }>(
        `workspaces/${workspaceId}/confirm`,
        "POST",
        {
          selection,
          planHash: plan.planHash,
          idempotencyKey: idempotency.current,
        },
      );
      setBatch(await mixerRequest<BatchData>(`batches/${result.batchId}`));
      setBatchPage(0);
      setPlan(null);
      await loadWorkspace(workspaceId);
      setNotice("Batch queued. You can leave this page; rendering continues.");
    });
  }
  const pollingBatchId = batch?.id,
    pollingBatchStatus = batch?.status;
  useEffect(() => {
    if (
      !pollingBatchId ||
      !pollingBatchStatus ||
      !["QUEUED", "RENDERING", "PAUSED"].includes(pollingBatchStatus)
    )
      return;
    let stopped = false;
    const timer = setInterval(() => {
      void mixerRequest<BatchData>(`batches/${pollingBatchId}`)
        .then((b) => {
          if (!stopped) setBatch(b);
        })
        .catch((e) => {
          if (!stopped) setError(`Progress could not refresh: ${message(e)}`);
        });
    }, 4000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [pollingBatchId, pollingBatchStatus]);
  async function batchControl(action: string) {
    if (!batch) return;
    await act(
      action === "retry" ? "Retrying failed videos" : "Updating batch",
      async () => {
        await mixerRequest(`batches/${batch.id}/control`, "POST", { action });
        setBatch(await mixerRequest<BatchData>(`batches/${batch.id}`));
        await loadWorkspace(workspaceId);
      },
    );
  }
  const activeAssets = assets.filter(
    (a) =>
      a.kind === (tab === "music" ? "music" : "clip") &&
      a.name.toLowerCase().includes(query.toLowerCase()) &&
      (filter !== "unused" || a.usage.count === 0) &&
      (filter !== "new" ||
        Date.now() - new Date(a.createdAt).getTime() < 86400000) &&
      (filter !== "used" || a.usage.count > 0),
  );
  const completed =
    batch?.recipes.filter((r) => r.output?.status === "COMPLETED") || [];
  const failed =
    batch?.recipes.filter((r) => r.output?.status === "FAILED") || [];
  const pending =
    batch?.recipes.filter(
      (r) =>
        r.output &&
        ["PENDING", "RENDERING", "PAUSED"].includes(r.output.status),
    ) || [];

  return (
    <section
      className="min-w-0 space-y-5 select-text"
      aria-label="Campaign Mixer"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Campaign Mixer</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Your clips, words, and music. A fresh batch whenever you need it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Saved campaign"
            className={`${fieldClass} !w-auto max-w-[260px]`}
            value={workspaceId}
            disabled={!!busy}
            onChange={(e) => void switchWorkspace(e.target.value)}
          >
            <option value="">Open a saved campaign</option>
            {index.workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          {data && (
            <>
              <span
                role="status"
                className={`text-xs ${saveState === "Save failed" ? "text-red-300" : "text-zinc-500"}`}
              >
                {saveState}
              </span>
              <button
                className={buttonClass}
                disabled={!!busy}
                onClick={newBatch}
              >
                <Plus size={15} />
                New batch
              </button>
              <button
                className={buttonClass}
                disabled={!!busy}
                onClick={() => {
                  setHistory((v) => !v);
                  setBatch(null);
                  void loadWorkspace(workspaceId).catch((e) =>
                    setError(message(e)),
                  );
                }}
              >
                History
              </button>
            </>
          )}
        </div>
      </div>
      {error && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200"
        >
          <div>
            {error}
            {saveState === "Save failed" && (
              <button
                className="ml-3 underline"
                onClick={() =>
                  void act("Reloading library", () =>
                    loadWorkspace(workspaceId),
                  )
                }
              >
                Reload library
              </button>
            )}
          </div>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="rounded-lg border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-200"
        >
          {notice}
        </div>
      )}
      {!workspaceId ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="min-h-64 rounded-xl border border-zinc-800 p-6">
            <FolderOpen className="mb-4 text-rose-400" size={28} />
            <h3 className="text-lg font-medium">Start with a campaign</h3>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-400">
              Keep a reusable library, select only today&apos;s clips, and
              preview your variations before rendering one batch.
            </p>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {index.workspaces.map((w) => (
                <button
                  key={w.id}
                  className={`${buttonClass} !justify-start !p-4 !text-left`}
                  onClick={() => setWorkspaceId(w.id)}
                >
                  <div>
                    <div>{w.name}</div>
                    <div className="mt-1 text-xs font-normal text-zinc-500">
                      {w._count.assets} media files · {w._count.texts} texts ·{" "}
                      {w._count.batches} batches
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="font-medium">Add a campaign library</h3>
            <label className="mt-4 block text-xs text-zinc-400">
              Campaign
              <select
                className={`${fieldClass} mt-2`}
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
              >
                <option value="">Choose a campaign</option>
                {index.campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={`${primaryClass} mt-4 w-full`}
              disabled={!campaignId || !!busy}
              onClick={() =>
                void act("Creating library", async () => {
                  const w = await mixerRequest<{ id: string }>(
                    "workspaces",
                    "POST",
                    { campaignId },
                  );
                  await refreshIndex();
                  setWorkspaceId(w.id);
                })
              }
            >
              {busy ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Plus size={16} />
              )}
              Create library
            </button>
          </div>
        </div>
      ) : !data ? (
        <div className="flex items-center gap-2 py-20 text-zinc-400">
          <Loader2 className="animate-spin" size={20} />
          Loading saved campaign…
        </div>
      ) : history ? (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-900 text-xs text-zinc-400">
              <tr>
                <th className="p-4">Batch</th>
                <th>Status</th>
                <th>Videos</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.batches.map((b) => (
                <tr key={b.id} className="border-t border-zinc-800">
                  <td className="p-4">{b.name}</td>
                  <td>{b.status.toLowerCase()}</td>
                  <td>
                    {b.counts.COMPLETED || 0} / {b.requestedCount}
                  </td>
                  <td className="text-zinc-500">
                    {new Date(b.createdAt).toLocaleDateString(undefined, {
                      timeZone: b.timezone,
                    })}
                  </td>
                  <td className="p-3">
                    <button
                      className={buttonClass}
                      onClick={() =>
                        void act("Opening batch", async () => {
                          setBatch(
                            await mixerRequest<BatchData>(`batches/${b.id}`),
                          );
                          setHistory(false);
                          setBatchPage(0);
                        })
                      }
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.batches.length && (
            <p className="p-8 text-sm text-zinc-500">
              Your confirmed batches will appear here.
            </p>
          )}
        </div>
      ) : batch ? (
        <div className="space-y-5">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-medium">{batch.name}</h3>
                <p className="mt-1 text-sm text-zinc-400">
                  {completed.length} complete · {pending.length} waiting or
                  rendering · {failed.length} failed
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {batch.status.toLowerCase()} · {batch.requestedCount}{" "}
                  requested · {batch.timezone}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {["QUEUED", "RENDERING"].includes(batch.status) && (
                  <button
                    className={buttonClass}
                    disabled={!!busy}
                    onClick={() => void batchControl("pause")}
                  >
                    <Pause size={14} />
                    Pause
                  </button>
                )}
                {batch.status === "PAUSED" && (
                  <button
                    className={buttonClass}
                    disabled={!!busy}
                    onClick={() => void batchControl("resume")}
                  >
                    <Play size={14} />
                    Resume
                  </button>
                )}
                {failed.length > 0 &&
                  !["CANCELED", "PAUSED", "CLEARED"].includes(batch.status) && (
                    <button
                      className={buttonClass}
                      disabled={!!busy}
                      onClick={() => void batchControl("retry")}
                    >
                      <RefreshCw size={14} />
                      Retry failed ({failed.length})
                    </button>
                  )}
                {pending.length > 0 && (
                  <button
                    className={buttonClass}
                    disabled={!!busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Cancel unfinished videos? Completed videos and your saved library will remain available.",
                        )
                      )
                        void batchControl("cancel");
                    }}
                  >
                    Cancel unfinished
                  </button>
                )}
                <button
                  className={primaryClass}
                  disabled={!!busy || !completed.length || !batch.groupId}
                  onClick={() =>
                    void act("Opening Smart Export", async () => {
                      await onSmartExport(batch.groupId!);
                    })
                  }
                >
                  Smart Export ({completed.length})
                </button>
                {!!completed.length && (
                  <a
                    className={buttonClass}
                    href={`${MIXER_API}/batches/${batch.id}/download`}
                    download
                  >
                    Download batch (.zip)
                  </a>
                )}
              </div>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-rose-500 transition-[width]"
                style={{
                  width: `${(completed.length / Math.max(1, batch.requestedCount)) * 100}%`,
                }}
              />
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              Smart Export delivers to the selected accounts&apos; Drive
              folders. Posting continues through the existing publishing
              workflow.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {batch.recipes
              .slice(batchPage * 24, (batchPage + 1) * 24)
              .map((r, i) => (
                <div
                  key={r.id}
                  className="rounded-lg border border-zinc-800 p-4"
                >
                  <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
                    <span>Video {batchPage * 24 + i + 1}</span>
                    <span
                      className={
                        r.output?.status === "FAILED"
                          ? "text-red-300"
                          : r.output?.status === "COMPLETED"
                            ? "text-emerald-300"
                            : ""
                      }
                    >
                      {(r.output?.status || r.status).toLowerCase()}
                    </span>
                  </div>
                  <p className="line-clamp-3 text-sm">{r.snapshot.text.text}</p>
                  <p className="mt-2 truncate text-xs text-zinc-500">
                    {r.snapshot.clip.name} · {r.snapshot.look.name}
                  </p>
                  <p className="mt-1 truncate text-xs text-zinc-500">
                    {r.snapshot.music.name} · {seconds(r.snapshot.duration)}
                  </p>
                  {r.output?.errorMessage && (
                    <p className="mt-3 text-xs leading-relaxed text-red-300">
                      {r.output.errorMessage}
                    </p>
                  )}
                  {r.output?.outputRef && (
                    <div className="mt-3 flex gap-3 text-xs">
                      <a
                        className="text-rose-300 underline"
                        href={r.output.outputRef}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Watch
                      </a>
                      <a
                        className="text-rose-300 underline"
                        download
                        href={r.output.outputRef}
                      >
                        Download
                      </a>
                      <span className="text-zinc-500">
                        {r.output.exportStatus.replaceAll("_", " ")}
                      </span>
                    </div>
                  )}
                </div>
              ))}
          </div>
          <div className="flex items-center justify-center gap-4">
            <button
              className={buttonClass}
              disabled={!batchPage}
              onClick={() => setBatchPage((p) => p - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs text-zinc-500">
              Page {batchPage + 1} of{" "}
              {Math.max(1, Math.ceil(batch.recipes.length / 24))}
            </span>
            <button
              className={buttonClass}
              disabled={(batchPage + 1) * 24 >= batch.recipes.length}
              onClick={() => setBatchPage((p) => p + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 space-y-4">
              {plan ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">Review your batch</h3>
                      <p className="mt-1 text-xs text-zinc-400">
                        {plan.represented.clips} clips ·{" "}
                        {plan.represented.texts} texts ·{" "}
                        {plan.represented.music} tracks ·{" "}
                        {plan.represented.looks} looks used
                      </p>
                    </div>
                    <button
                      className={buttonClass}
                      disabled={!!busy}
                      onClick={() => {
                        setPlan(null);
                        setSample(null);
                      }}
                    >
                      Edit selection
                    </button>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-sm">
                    <p>
                      <strong>{plan.totalPossible.toLocaleString()}</strong>{" "}
                      possible variations ·{" "}
                      <strong>{plan.unused.toLocaleString()}</strong> unused
                    </p>
                    <p className="mt-2 text-xs text-zinc-500">
                      {plan.baseCombinations.toLocaleString()} clip/text/music
                      combinations before extra looks. {plan.previouslyUsed}{" "}
                      variations already reserved or used.
                    </p>
                    <p className="mt-2 text-xs text-zinc-400">
                      This batch: {plan.newContentCombinations} new
                      clip/text/music combinations · {plan.additionalTreatments}{" "}
                      additional visual treatments.
                    </p>
                    <p className="mt-2 text-xs text-zinc-500">
                      Estimated rendered files:{" "}
                      {Math.ceil(
                        plan.recipes.reduce(
                          (sum, r) => sum + r.duration * 1.1,
                          0,
                        ),
                      )}{" "}
                      MB. Render-time estimate is not available yet.
                    </p>
                  </div>
                  {plan.warnings.map((w) => (
                    <p
                      key={w}
                      className="rounded-lg border border-amber-900/70 bg-amber-950/20 p-3 text-xs text-amber-200"
                    >
                      {w}
                    </p>
                  ))}
                  {plan.exclusions.length > 0 && (
                    <details className="rounded-lg border border-zinc-800 p-3 text-xs">
                      <summary className="cursor-pointer text-zinc-300">
                        Excluded combinations ({plan.exclusions.length} reasons)
                      </summary>
                      <div className="mt-3 max-h-48 space-y-2 overflow-auto">
                        {plan.exclusions.map((e, i) => (
                          <p key={i} className="text-zinc-500">
                            <strong className="text-zinc-300">{e.name}:</strong>{" "}
                            {e.reason}
                          </p>
                        ))}
                      </div>
                    </details>
                  )}
                  <div className="max-h-[460px] overflow-auto rounded-lg border border-zinc-800">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-zinc-900 text-zinc-400">
                        <tr>
                          <th className="p-3">Video</th>
                          <th>Text</th>
                          <th>Music / look</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.recipes.map((r, i) => (
                          <tr
                            key={r.recipeKey}
                            className={`cursor-pointer border-t border-zinc-800 ${previewIndex === i ? "bg-rose-950/30" : "hover:bg-zinc-900"}`}
                          >
                            <td className="p-3">
                              <button
                                aria-label={`Preview video ${i + 1}`}
                                onClick={() => {
                                  setPreviewIndex(i);
                                  setSample(null);
                                }}
                                className="text-left"
                              >
                                <span className="text-rose-300">{i + 1}</span>
                                <span className="mt-1 block max-w-32 truncate text-zinc-500">
                                  {r.clip.name}
                                </span>
                              </button>
                            </td>
                            <td className="max-w-64 p-2">
                              <button
                                className="line-clamp-2 text-left"
                                onClick={() => {
                                  setPreviewIndex(i);
                                  setSample(null);
                                }}
                              >
                                {r.text.text}
                              </button>
                            </td>
                            <td className="p-3 text-zinc-500">
                              <div className="max-w-40 truncate">
                                {r.music.name}
                              </div>
                              <div className="mt-1 text-zinc-300">
                                {r.look.name}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1 border-b border-zinc-800 pb-2">
                    {(["clips", "texts", "music", "looks"] as const).map(
                      (t) => (
                        <button
                          key={t}
                          onClick={() => {
                            setTab(t);
                            setFilter("all");
                            setQuery("");
                          }}
                          className={`rounded-lg px-4 py-2 text-sm capitalize ${tab === t ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-white"}`}
                        >
                          {t}{" "}
                          <span className="ml-1 text-xs text-zinc-500">
                            {t === "clips"
                              ? clipIds.length
                              : t === "texts"
                                ? textIds.length
                                : t === "music"
                                  ? musicIds.length
                                  : presetIds.length}
                          </span>
                        </button>
                      ),
                    )}
                  </div>
                  {(tab === "clips" || tab === "music") && (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          className={primaryClass}
                          disabled={!!busy}
                          onClick={() => fileInput.current?.click()}
                        >
                          <Upload size={15} />
                          Add {tab}
                        </button>
                        <input
                          ref={fileInput}
                          type="file"
                          multiple
                          accept={tab === "music" ? "audio/*" : "video/*"}
                          className="hidden"
                          onChange={(e) => void upload(e.target.files)}
                        />
                        <select
                          className={`${fieldClass} !w-auto`}
                          aria-label="Library filter"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        >
                          <option value="all">All files</option>
                          <option value="new">Added in last 24h</option>
                          <option value="unused">Unused</option>
                          <option value="used">Used before</option>
                        </select>
                        <div className="relative min-w-40 flex-1">
                          <Search
                            size={14}
                            className="absolute left-3 top-3 text-zinc-500"
                          />
                          <input
                            aria-label="Search library"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Find a file"
                            className={`${fieldClass} !pl-9`}
                          />
                        </div>
                        <button
                          className={buttonClass}
                          onClick={() => {
                            const list = activeAssets.map((a) => a.id);
                            if (tab === "clips") setClipIds(list);
                            else setMusicIds(list);
                            invalidate();
                          }}
                        >
                          Select shown
                        </button>
                        <button
                          className={buttonClass}
                          onClick={() => {
                            if (tab === "clips") setClipIds([]);
                            else setMusicIds([]);
                            invalidate();
                          }}
                        >
                          Clear
                        </button>
                      </div>
                      {tab === "clips" &&
                        ids(draftSnapshot.current.clipIds).length > 0 && (
                          <button
                            className="text-xs text-rose-300 underline"
                            onClick={restoreDraft}
                          >
                            Use saved selection
                          </button>
                        )}
                      {!!uploadState.length && (
                        <div className="max-h-40 space-y-2 overflow-auto rounded-lg border border-zinc-800 p-3">
                          {uploadState.map((u, i) => (
                            <div key={`${u.name}-${i}`} className="text-xs">
                              <div className="flex justify-between gap-3">
                                <span className="truncate text-zinc-400">
                                  {u.name}
                                </span>
                                <span
                                  className={
                                    u.error ? "text-red-300" : "text-zinc-500"
                                  }
                                >
                                  {u.error
                                    ? "Failed"
                                    : u.progress === 100
                                      ? "Ready"
                                      : u.progress >= 95
                                        ? "Processing…"
                                        : `${u.progress}%`}
                                </span>
                              </div>
                              {u.error && (
                                <p className="mt-1 text-red-300">
                                  {u.error} Use Add {tab} to retry this file.
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      <div
                        className={
                          tab === "clips"
                            ? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
                            : "space-y-3"
                        }
                      >
                        {activeAssets.map((a) => {
                          const selected = (
                            tab === "clips" ? clipIds : musicIds
                          ).includes(a.id);
                          return (
                            <article
                              key={a.id}
                              className={`overflow-hidden rounded-lg border ${selected ? "border-rose-500/80 bg-rose-950/10" : "border-zinc-800 bg-zinc-900/30"}`}
                            >
                              {a.kind === "clip" && (
                                <button
                                  className="relative block aspect-[4/3] w-full overflow-hidden bg-zinc-950"
                                  aria-label={`Preview ${a.name}`}
                                  onClick={() => setFocusClip(a.id)}
                                >
                                  <Image
                                    unoptimized
                                    fill
                                    sizes="220px"
                                    src={`${MIXER_API}/media/${a.id}?thumbnail=1`}
                                    alt=""
                                    loading="lazy"
                                    className="h-full w-full object-cover"
                                  />
                                  <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-[10px] text-white">
                                    {seconds(a.duration)}
                                  </span>
                                </button>
                              )}
                              <div className="space-y-2 p-3">
                                <label className="flex cursor-pointer items-start gap-2">
                                  <input
                                    type="checkbox"
                                    className="mt-0.5 accent-rose-500"
                                    checked={selected}
                                    onChange={() => {
                                      if (a.kind === "clip") {
                                        setClipIds((old) => toggle(old, a.id));
                                        setFocusClip(a.id);
                                      } else
                                        setMusicIds((old) => toggle(old, a.id));
                                      invalidate();
                                    }}
                                  />
                                  <span
                                    className="min-w-0 flex-1 truncate text-xs font-medium"
                                    title={a.name}
                                  >
                                    {a.name}
                                  </span>
                                </label>
                                {a.kind === "music" && (
                                  <audio
                                    controls
                                    preload="none"
                                    src={`${MIXER_API}/media/${a.id}`}
                                    className="h-8 w-full"
                                  />
                                )}
                                <p className="text-[10px] text-zinc-500">
                                  {a.usage.count
                                    ? `Used ${a.usage.count} times`
                                    : "Unused"}
                                  {a.kind === "music"
                                    ? ` · ${seconds(a.duration)}`
                                    : ""}
                                </p>
                                <div className="flex justify-between gap-2 text-[10px]">
                                  <button
                                    className="text-zinc-300 hover:text-white"
                                    onClick={() => {
                                      setAssetEditor(a);
                                      setAssetDraft({
                                        ...record(a.settings),
                                        tags: a.tags.join(", "),
                                        name: a.name,
                                      });
                                    }}
                                  >
                                    Adjust
                                  </button>
                                  <button
                                    className="text-zinc-500 hover:text-red-300"
                                    disabled={!!busy}
                                    onClick={() =>
                                      void act("Archiving asset", async () => {
                                        await mutate(
                                          `assets/${a.id}`,
                                          "PATCH",
                                          { archived: true },
                                        );
                                        setClipIds((old) =>
                                          old.filter((id) => id !== a.id),
                                        );
                                        setMusicIds((old) =>
                                          old.filter((id) => id !== a.id),
                                        );
                                      })
                                    }
                                  >
                                    Archive
                                  </button>
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                      {!activeAssets.length && (
                        <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-zinc-700 p-8 text-center">
                          {tab === "clips" ? (
                            <Film className="mb-3 text-zinc-600" size={28} />
                          ) : (
                            <Music2 className="mb-3 text-zinc-600" size={28} />
                          )}
                          <p className="text-sm text-zinc-400">
                            {query || filter !== "all"
                              ? "No files match this filter."
                              : `Add your ${tab} to start this library.`}
                          </p>
                          <p className="mt-2 max-w-sm text-xs text-zinc-600">
                            Files stay here for future batches. Only your
                            checked selections will be used.
                          </p>
                        </div>
                      )}
                    </>
                  )}
                  {tab === "texts" && (
                    <>
                      <div className="rounded-lg border border-zinc-800 p-4">
                        <label
                          className="text-sm font-medium"
                          htmlFor="mixer-texts"
                        >
                          Add on-screen texts
                        </label>
                        <textarea
                          id="mixer-texts"
                          className={`${fieldClass} mt-3 min-h-28`}
                          value={textInput}
                          onChange={(e) => setTextInput(e.target.value)}
                          placeholder="Paste one text per line, or rows from a spreadsheet."
                        />
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <p className="text-xs text-zinc-500">
                            Edit a saved row for intentional line breaks.
                            Posting captions are separate.
                          </p>
                          <button
                            className={primaryClass}
                            disabled={!!busy || !textInput.trim()}
                            onClick={() =>
                              void act("Saving texts", async () => {
                                const entries = textInput
                                  .split(/\r?\n/)
                                  .map((s) => s.split("\t")[0].trim())
                                  .filter(Boolean);
                                await mutate("texts", "POST", {
                                  texts: entries,
                                });
                                setTextInput("");
                                const fresh = await mixerRequest<WorkspaceData>(
                                  `workspaces/${workspaceId}`,
                                );
                                setTextIds(
                                  fresh.texts
                                    .filter((t) => !t.archived)
                                    .map((t) => t.id),
                                );
                              })
                            }
                          >
                            Add texts
                          </button>
                        </div>
                      </div>
                      <div className="flex gap-3 text-xs">
                        <button
                          className="text-rose-300"
                          onClick={() => {
                            setTextIds(texts.map((t) => t.id));
                            invalidate();
                          }}
                        >
                          Select all
                        </button>
                        <button
                          className="text-zinc-500"
                          onClick={() => {
                            setTextIds([]);
                            invalidate();
                          }}
                        >
                          Clear selection
                        </button>
                      </div>
                      <div className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
                        {texts.map((t) => (
                          <div
                            key={t.id}
                            className="flex items-start gap-3 p-4"
                          >
                            <input
                              type="checkbox"
                              aria-label={`Select text ${t.text.slice(0, 35)}`}
                              checked={textIds.includes(t.id)}
                              onChange={() => {
                                setTextIds((old) => toggle(old, t.id));
                                invalidate();
                              }}
                              className="mt-1 accent-rose-500"
                            />
                            <div className="min-w-0 flex-1">
                              {editingText === t.id ? (
                                <>
                                  <textarea
                                    className={fieldClass}
                                    value={editedText}
                                    onChange={(e) =>
                                      setEditedText(e.target.value)
                                    }
                                  />
                                  <label className="mt-2 block text-xs text-zinc-400">
                                    Match clip tags (optional, comma separated)
                                    <input
                                      className={`${fieldClass} mt-1`}
                                      value={editedTags}
                                      onChange={(e) =>
                                        setEditedTags(e.target.value)
                                      }
                                    />
                                  </label>
                                  <p className="mt-1 text-xs text-zinc-500">
                                    Leave empty to use this text with any clip.
                                  </p>
                                  <div className="mt-2 flex gap-2">
                                    <button
                                      className={buttonClass}
                                      disabled={!!busy}
                                      onClick={() =>
                                        void act("Updating text", async () => {
                                          await mutate(
                                            `texts/${t.id}`,
                                            "PATCH",
                                            {
                                              text: editedText,
                                              tags: editedTags
                                                .split(",")
                                                .map((tag) => tag.trim())
                                                .filter(Boolean),
                                            },
                                          );
                                          setEditingText(null);
                                        })
                                      }
                                    >
                                      Save text
                                    </button>
                                    <button
                                      className={buttonClass}
                                      onClick={() => setEditingText(null)}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </>
                              ) : (
                                <p className="whitespace-pre-wrap text-sm leading-relaxed">
                                  {t.text}
                                </p>
                              )}
                            </div>
                            <button
                              className="text-xs text-zinc-500"
                              onClick={() => {
                                setEditingText(t.id);
                                setEditedText(t.text);
                                setEditedTags(t.tags.join(", "));
                              }}
                            >
                              Edit
                            </button>
                            <button
                              className="text-xs text-zinc-500"
                              disabled={!!busy}
                              onClick={() =>
                                void act("Archiving text", async () => {
                                  await mutate(`texts/${t.id}`, "PATCH", {
                                    archived: true,
                                  });
                                  setTextIds((old) =>
                                    old.filter((id) => id !== t.id),
                                  );
                                })
                              }
                            >
                              Archive
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {tab === "looks" && (
                    <>
                      <p className="text-sm text-zinc-400">
                        Select several looks. The planner spreads them across
                        the requested videos.
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {data.looks.map((l) => (
                          <label
                            key={l.id}
                            className={`cursor-pointer rounded-lg border p-4 ${presetIds.includes(l.id) ? "border-rose-500/80 bg-rose-950/10" : "border-zinc-800"}`}
                          >
                            <div
                              className="mb-4 h-20 overflow-hidden rounded bg-zinc-800"
                              style={{
                                background: `linear-gradient(130deg,${l.settings.saturation === 0 ? "#626262" : l.settings.warmth > 0.03 ? "#9b7354" : "#597284"},#18181b)`,
                                filter: `brightness(${1 + l.settings.brightness}) contrast(${l.settings.contrast}) saturate(${l.settings.saturation})`,
                              }}
                            >
                              <div
                                className="flex h-full items-center px-5 text-sm text-white"
                                style={{
                                  background: `radial-gradient(ellipse, transparent,rgba(0,0,0,${l.settings.vignette}))`,
                                }}
                              >
                                A different perspective.
                              </div>
                            </div>
                            <span className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                className="accent-rose-500"
                                checked={presetIds.includes(l.id)}
                                onChange={() => {
                                  setPresetIds((old) => toggle(old, l.id));
                                  invalidate();
                                }}
                              />
                              {l.name}
                            </span>
                            <span className="mt-2 block text-xs text-zinc-500">
                              {l.settings.fade}s fade ·{" "}
                              {l.settings.saturation === 0
                                ? "Black and white"
                                : l.settings.saturation < 0.9
                                  ? "Muted color"
                                  : "Natural color"}
                            </span>
                          </label>
                        ))}
                      </div>
                      <details className="rounded-lg border border-zinc-800 p-4">
                        <summary className="cursor-pointer text-sm">
                          Save a custom look
                        </summary>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <label className="text-xs text-zinc-400">
                            Name
                            <input
                              className={`${fieldClass} mt-2`}
                              value={lookName}
                              onChange={(e) => setLookName(e.target.value)}
                            />
                          </label>
                          {(
                            [
                              ["contrast", 0.7, 1.5],
                              ["brightness", -0.2, 0.15],
                              ["saturation", 0, 1.5],
                              ["vignette", 0, 1],
                              ["warmth", -0.15, 0.15],
                              ["fade", 0, 1],
                            ] as const
                          ).map(([key, min, max]) => (
                            <label
                              key={key}
                              className="text-xs capitalize text-zinc-400"
                            >
                              {key} ({lookDraft[key]})
                              <input
                                type="range"
                                className="mt-3 block w-full accent-rose-500"
                                min={min}
                                max={max}
                                step="0.01"
                                value={lookDraft[key]}
                                onChange={(e) =>
                                  setLookDraft((l) => ({
                                    ...l,
                                    [key]: Number(e.target.value),
                                  }))
                                }
                              />
                            </label>
                          ))}
                        </div>
                        <button
                          className={`${primaryClass} mt-4`}
                          disabled={!!busy || !lookName.trim()}
                          onClick={() =>
                            void act("Saving look", async () => {
                              await mutate("presets", "POST", {
                                name: lookName,
                                settings: lookDraft,
                              });
                              setLookName("");
                            })
                          }
                        >
                          Save look
                        </button>
                      </details>
                    </>
                  )}
                </>
              )}
            </div>
            <aside className="space-y-5 xl:sticky xl:top-5">
              <MixerPreview
                recipe={recipe}
                clip={selectedClip}
                music={selectedMusic}
                text={selectedText?.text}
                look={selectedLook}
                settings={settings}
                renderedSample={sample}
              />
              {plan && recipe ? (
                <button
                  className={`${buttonClass} w-full`}
                  disabled={!!busy}
                  onClick={() =>
                    void act("Rendering sample", async () => {
                      const r = await mixerRequest<{ outputRef: string }>(
                        `workspaces/${workspaceId}/sample`,
                        "POST",
                        {
                          selection,
                          planHash: plan.planHash,
                          index: previewIndex,
                        },
                      );
                      setSample(r.outputRef);
                    })
                  }
                >
                  {busy === "Rendering sample" ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Play size={16} />
                  )}
                  Render sample {previewIndex + 1}
                </button>
              ) : (
                <div className="space-y-4 rounded-lg border border-zinc-800 p-4">
                  <h3 className="flex items-center gap-2 text-sm font-medium">
                    <SlidersHorizontal size={15} />
                    Text and sound
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs text-zinc-400">
                      Placement
                      <select
                        className={`${fieldClass} mt-1`}
                        value={settings.position}
                        onChange={(e) =>
                          updateSetting(
                            "position",
                            e.target.value as "upper" | "middle",
                          )
                        }
                      >
                        <option value="upper">Upper</option>
                        <option value="middle">Middle</option>
                      </select>
                    </label>
                    <label className="text-xs text-zinc-400">
                      Align
                      <select
                        className={`${fieldClass} mt-1`}
                        value={settings.align}
                        onChange={(e) =>
                          updateSetting(
                            "align",
                            e.target.value as "left" | "center",
                          )
                        }
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                      </select>
                    </label>
                  </div>
                  <label className="block text-xs text-zinc-400">
                    Font
                    <select
                      className={`${fieldClass} mt-1`}
                      value={settings.fontFamily}
                      onChange={(e) =>
                        updateSetting("fontFamily", e.target.value)
                      }
                    >
                      {MIXER_FONTS.map((f) => (
                        <option key={f}>{f}</option>
                      ))}
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs text-zinc-400">
                      Weight
                      <select
                        className={`${fieldClass} mt-1`}
                        value={settings.fontWeight}
                        onChange={(e) =>
                          updateSetting("fontWeight", Number(e.target.value))
                        }
                      >
                        <option value={400}>Regular</option>
                        <option value={600}>Semibold</option>
                        <option value={700}>Bold</option>
                      </select>
                    </label>
                    <label className="text-xs text-zinc-400">
                      Size
                      <input
                        type="number"
                        min={40}
                        max={76}
                        className={`${fieldClass} mt-1`}
                        value={settings.fontSize}
                        onChange={(e) =>
                          updateSetting("fontSize", Number(e.target.value))
                        }
                      />
                    </label>
                  </div>
                  <p className="text-[10px] leading-relaxed text-zinc-500">
                    Text auto-fits within readable limits. The original
                    reference font is unverified; these are installed
                    alternatives.
                  </p>
                  <label className="flex items-center gap-2 text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      className="accent-rose-500"
                      checked={settings.keepSourceAudio}
                      onChange={(e) =>
                        updateSetting("keepSourceAudio", e.target.checked)
                      }
                    />
                    Keep original sound
                  </label>
                  <label className="block text-xs text-zinc-400">
                    Music volume · {Math.round(settings.musicVolume * 100)}%
                    <input
                      type="range"
                      min="0.05"
                      max="1.5"
                      step="0.05"
                      value={settings.musicVolume}
                      onChange={(e) =>
                        updateSetting("musicVolume", Number(e.target.value))
                      }
                      className="mt-2 w-full accent-rose-500"
                    />
                  </label>
                  {settings.keepSourceAudio && (
                    <>
                      <label className="block text-xs text-zinc-400">
                        Original volume ·{" "}
                        {Math.round(settings.sourceVolume * 100)}%
                        <input
                          type="range"
                          min="0"
                          max="1.5"
                          step="0.05"
                          value={settings.sourceVolume}
                          onChange={(e) =>
                            updateSetting(
                              "sourceVolume",
                              Number(e.target.value),
                            )
                          }
                          className="mt-2 w-full accent-rose-500"
                        />
                      </label>
                      <label className="flex items-center gap-2 text-xs text-zinc-300">
                        <input
                          type="checkbox"
                          checked={settings.duckMusic}
                          onChange={(e) =>
                            updateSetting("duckMusic", e.target.checked)
                          }
                          className="accent-rose-500"
                        />
                        Lower music under original sound
                      </label>
                    </>
                  )}
                  <label className="flex items-center gap-2 text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      checked={settings.loopMusic}
                      onChange={(e) =>
                        updateSetting("loopMusic", e.target.checked)
                      }
                      className="accent-rose-500"
                    />
                    Loop tracks that are too short
                  </label>
                  <label className="block text-xs text-zinc-400">
                    Output quality
                    <select
                      className={`${fieldClass} mt-1`}
                      value={settings.resolution}
                      onChange={(e) =>
                        updateSetting(
                          "resolution",
                          Number(e.target.value) as 720 | 1080,
                        )
                      }
                    >
                      <option value={1080}>1080p · reference size</option>
                      <option value={720}>720p · faster rendering</option>
                    </select>
                  </label>
                </div>
              )}
            </aside>
          </div>
          <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-zinc-700 bg-zinc-950/95 p-4 backdrop-blur">
            <div>
              <p className="text-sm">
                {clipIds.length} clips · {textIds.length} texts ·{" "}
                {musicIds.length} tracks · {presetIds.length} looks
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {plan
                  ? `${plan.unused.toLocaleString()} unused eligible variations`
                  : `Up to ${(clipIds.length * textIds.length * musicIds.length * presetIds.length).toLocaleString()} variations before validation and previous usage`}
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs text-zinc-400">
                Total outputs
                <input
                  aria-label="Total outputs"
                  type="number"
                  min={1}
                  max={MIXER_MAX_BATCH}
                  value={count}
                  disabled={!!plan || !!busy}
                  onChange={(e) => {
                    setCount(Number(e.target.value));
                    invalidate();
                  }}
                  className={`${fieldClass} mt-1 !w-28`}
                />
              </label>
              <button
                className={primaryClass}
                disabled={
                  !!busy ||
                  !clipIds.length ||
                  !textIds.length ||
                  !musicIds.length ||
                  !presetIds.length ||
                  (plan
                    ? plan.recipes.length !== count
                    : count < 1 || count > MIXER_MAX_BATCH)
                }
                onClick={() => void (plan ? confirm() : preview())}
              >
                {busy ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : plan ? (
                  <Check size={16} />
                ) : (
                  <Play size={16} />
                )}
                {busy ||
                  (plan
                    ? `Confirm and render ${count} videos`
                    : "Preview batch")}
              </button>
            </div>
          </div>
        </>
      )}
      {assetEditor && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Adjust asset"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl border border-zinc-700 bg-zinc-950 p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">
                Adjust {assetEditor.kind === "clip" ? "clip" : "music"}
              </h3>
              <button
                aria-label="Close adjustments"
                onClick={() => setAssetEditor(null)}
              >
                <X size={18} />
              </button>
            </div>
            <label className="mt-4 block text-xs text-zinc-400">
              Name
              <input
                className={`${fieldClass} mt-1`}
                value={String(assetDraft.name || "")}
                onChange={(e) =>
                  setAssetDraft((d) => ({ ...d, name: e.target.value }))
                }
              />
            </label>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="text-xs text-zinc-400">
                Start (seconds)
                <input
                  type="number"
                  min={0}
                  max={assetEditor.duration - 0.5}
                  step="0.1"
                  className={`${fieldClass} mt-1`}
                  value={Number(assetDraft.start || 0)}
                  onChange={(e) =>
                    setAssetDraft((d) => ({
                      ...d,
                      start: Number(e.target.value),
                    }))
                  }
                />
              </label>
              {assetEditor.kind === "clip" && (
                <label className="text-xs text-zinc-400">
                  End (seconds)
                  <input
                    type="number"
                    min={1}
                    max={assetEditor.duration}
                    step="0.1"
                    className={`${fieldClass} mt-1`}
                    value={Number(assetDraft.end ?? assetEditor.duration)}
                    onChange={(e) =>
                      setAssetDraft((d) => ({
                        ...d,
                        end: Number(e.target.value),
                      }))
                    }
                  />
                </label>
              )}
            </div>
            {assetEditor.kind === "clip" && (
              <>
                {(["cropX", "cropY"] as const).map((key) => (
                  <label key={key} className="mt-4 block text-xs text-zinc-400">
                    {key === "cropX"
                      ? "Horizontal framing"
                      : "Vertical framing"}
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step="0.01"
                      className="mt-2 w-full accent-rose-500"
                      value={Number(assetDraft[key] ?? 0.5)}
                      onChange={(e) =>
                        setAssetDraft((d) => ({
                          ...d,
                          [key]: Number(e.target.value),
                        }))
                      }
                    />
                  </label>
                ))}
                <label className="mt-4 block text-xs text-zinc-400">
                  Text placement override
                  <select
                    className={`${fieldClass} mt-1`}
                    value={String(assetDraft.position || "")}
                    onChange={(e) =>
                      setAssetDraft((d) => ({ ...d, position: e.target.value }))
                    }
                  >
                    <option value="">Use campaign setting</option>
                    <option value="upper">Upper</option>
                    <option value="middle">Middle</option>
                  </select>
                </label>
                <label className="mt-4 block text-xs text-zinc-400">
                  Tags (comma separated)
                  <input
                    className={`${fieldClass} mt-1`}
                    value={String(assetDraft.tags || "")}
                    onChange={(e) =>
                      setAssetDraft((d) => ({ ...d, tags: e.target.value }))
                    }
                  />
                </label>
              </>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                className={buttonClass}
                onClick={() => setAssetEditor(null)}
              >
                Cancel
              </button>
              <button
                className={primaryClass}
                disabled={!!busy}
                onClick={() =>
                  void act("Saving adjustments", async () => {
                    const { tags, name, ...settings } = assetDraft;
                    await mutate(`assets/${assetEditor.id}`, "PATCH", {
                      name,
                      settings,
                      tags: String(tags || "")
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean),
                    });
                    setFocusClip(assetEditor.id);
                    setAssetEditor(null);
                  })
                }
              >
                Save adjustments
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
