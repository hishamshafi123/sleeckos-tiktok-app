"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { Film, Loader2, Upload, X, Undo2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NewsClip } from "@/remotion/content-clips/NewsClip";
import {
  defaultDraft,
  framesFor,
  FPS,
  MAX_BYTES,
  OVERLAYS,
  OUTROS,
  timecode,
  validateDraft,
  type Draft,
  type Word,
  type Suggestion,
} from "@/lib/content-clips/schema";
const field =
  "w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:ring-2 focus:ring-blue-400";
const button =
  "inline-flex items-center justify-center gap-2 rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-40 disabled:cursor-not-allowed";
const primary = `${button} bg-blue-600 border-blue-500 text-white hover:bg-blue-500`;
type Job = {
  id: string;
  kind: string;
  status: string;
  stage: string;
  error: string | null;
  downloadable: boolean;
  createdAt: string;
  draft?: Draft;
};
type Clip = {
  id: string;
  sourceName: string;
  sourceUrl: string | null;
  ready: boolean;
  duration: number | null;
  transcript: Word[] | null;
  suggestions: {
    clips: Suggestion[];
    transcriptVersion: number;
    selection: { start: number; end: number } | null;
  } | null;
  draft: Draft;
  version: number;
  jobs: Job[];
};
type Data = { clips: Clip[]; canEdit: boolean };
async function readResponse(response: Response) {
  try {
    return await response.json();
  } catch {
    throw new Error(
      response.status === 413
        ? "The server rejected this file's size. Upload a smaller video or ask an admin to increase the upload limit."
        : "The server could not complete this request. Retry; your saved work is preserved.",
    );
  }
}
async function api(body: Record<string, unknown>) {
  const res = await fetch("/api/admin/content-desk/clips", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await readResponse(res);
  if (!res.ok) throw new Error(result.error || "The action failed. Retry.");
  return result;
}
const media = (id: string, exportId?: string, download = false) =>
  `/api/admin/content-desk/clips/media?${new URLSearchParams({ id, ...(exportId ? { export: exportId } : {}), ...(download ? { download: "1" } : {}) })}`;
export default function ClipStudio({
  story,
}: {
  story: {
    id: string;
    title: string;
    items: {
      id: string;
      title: string;
      url: string;
      platform: string;
      publisher: string;
    }[];
  };
}) {
  const [open, setOpen] = useState(false);
  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  return (
    <>
      <button className={`${primary} w-full`} onClick={() => setOpen(true)}>
        <Film size={17} /> Open Clip Studio
      </button>
      <p className="mt-2 text-xs text-zinc-500">
        Find a clip, add your headline and branding, and export a video.
      </p>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) setOpen(true);
          else
            void flushRef.current().then((ok) => {
              if (ok) setOpen(false);
            });
        }}
      >
        <DialogContent className="flex h-[94dvh] w-[97vw] !max-w-[1600px] flex-col overflow-hidden border-zinc-800 bg-zinc-950 p-0 text-zinc-100">
          <DialogHeader className="shrink-0 border-b border-zinc-800 px-5 py-4 pr-12">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Film size={18} /> Clip Studio
            </DialogTitle>
            <p className="truncate text-sm text-zinc-400">{story.title}</p>
          </DialogHeader>
          {open && (
            <StudioBody key={story.id} story={story} flushRef={flushRef} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
function StudioBody({
  story,
  flushRef,
}: {
  flushRef: MutableRefObject<() => Promise<boolean>>;
  story: {
    id: string;
    items: {
      id: string;
      title: string;
      url: string;
      platform: string;
      publisher: string;
    }[];
  };
}) {
  const [data, setData] = useState<Data | null>(null);
  const [selected, setSelected] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/admin/content-desk/clips?story=${story.id}`,
        { cache: "no-store" },
      );
      const body = await readResponse(res);
      if (!res.ok) throw new Error(body.error);
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load Clip Studio.");
    }
  }, [story.id]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    const interval = setInterval(() => void load(), 5000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [load]);
  const current = data?.clips.find((c) => c.id === selected) || data?.clips[0];
  async function add(sourceUrl: string, name: string) {
    setBusy(true);
    setError("");
    try {
      const result = await api({
        action: "create",
        story: story.id,
        url: sourceUrl,
        name,
      });
      setSelected(result.id);
      setImportOpen(false);
      setUrl("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add video.");
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    if (file.size > MAX_BYTES) {
      setError("Choose a video smaller than 500 MB.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        `/api/admin/content-desk/clips/upload?${new URLSearchParams({ story: story.id, name: file.name })}`,
        {
          method: "POST",
          body: file,
          headers: { "Content-Type": "application/octet-stream" },
        },
      );
      const result = await readResponse(res);
      if (!res.ok) throw new Error(result.error);
      setSelected(result.id);
      setImportOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed. Retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-5 py-3">
        <select
          aria-label="Source video"
          className={`${field} !w-auto max-w-full flex-1`}
          value={current?.id || ""}
          onChange={(e) => {
            const value = e.target.value;
            void flushRef.current().then((ok) => {
              if (ok) setSelected(value);
            });
          }}
        >
          {!data?.clips.length && (
            <option value="">Choose a video to begin</option>
          )}
          {data?.clips.map((c) => (
            <option value={c.id} key={c.id}>
              {c.sourceName}
              {c.duration ? ` · ${timecode(c.duration)}` : " · Preparing"}
            </option>
          ))}
        </select>
        {data?.canEdit && (
          <button
            className={button}
            onClick={() =>
              void flushRef.current().then((ok) => {
                if (ok) setImportOpen((v) => !v);
              })
            }
          >
            Add video
          </button>
        )}
        {current?.ready && (
          <a className={button} href={media(current.id, undefined, true)}>
            Download source
          </a>
        )}
      </div>
      {error && (
        <div
          role="alert"
          className="m-5 flex items-center justify-between gap-3 rounded border border-amber-800 bg-amber-950/20 p-3 text-sm text-amber-200"
        >
          {error}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {!data ? (
        <p className="p-8 text-zinc-400">Loading videos…</p>
      ) : (importOpen || !data.clips.length) && data.canEdit ? (
        <div className="mx-auto max-w-3xl space-y-5 p-6">
          <div>
            <h3 className="text-xl font-semibold">
              Start with the source footage
            </h3>
            <p className="mt-2 text-sm text-zinc-400">
              Choose a video from this story, paste a direct video link, or
              upload a file. Up to 20 minutes and 500 MB.
            </p>
          </div>
          {story.items
            .filter((i) =>
              ["YOUTUBE", "TIKTOK", "INSTAGRAM"].includes(i.platform),
            )
            .map((i) => (
              <button
                key={i.id}
                disabled={busy}
                className={`${button} w-full justify-between text-left`}
                onClick={() => void add(i.url, i.publisher || i.title)}
              >
                <span>
                  {i.title}
                  <small className="mt-1 block text-zinc-400">
                    {i.publisher} · {i.platform}
                  </small>
                </span>
                <span>Use video</span>
              </button>
            ))}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void add(url, new URL(url).hostname);
            }}
          >
            <input
              required
              type="url"
              className={field}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="YouTube, TikTok, Instagram, or direct MP4 URL"
              aria-label="Video link"
            />
            <button disabled={busy || !url} className={primary}>
              Import
            </button>
          </form>
          <div className="flex items-center gap-3">
            <input
              ref={input}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = "";
              }}
            />
            <button
              disabled={busy}
              className={button}
              onClick={() => input.current?.click()}
            >
              <Upload size={16} /> Upload video
            </button>
            {busy && (
              <span className="flex items-center gap-2 text-sm text-blue-300">
                <Loader2 size={15} className="animate-spin" /> Uploading or
                adding source…
              </span>
            )}
          </div>
        </div>
      ) : current ? (
        <ClipEditor
          key={`${current.id}-${current.ready}`}
          clip={current}
          canEdit={data.canEdit}
          reload={load}
          flushRef={flushRef}
        />
      ) : (
        <p className="p-6 text-zinc-400">
          No videos have been added to this story.
        </p>
      )}
    </div>
  );
}
function ClipEditor({
  clip,
  canEdit,
  reload,
  flushRef,
}: {
  clip: Clip;
  canEdit: boolean;
  reload: () => Promise<void>;
  flushRef: MutableRefObject<() => Promise<boolean>>;
}) {
  const [draft, setDraft] = useState<Draft>(clip.draft);
  const [saveStatus, setSaveStatus] = useState("Saved");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState(60);
  const [tab, setTab] = useState<"clips" | "transcript">("clips");
  const [sourceTime, setSourceTime] = useState(0);
  const [sourceEnd, setSourceEnd] = useState<number | null>(null);
  const [editingWords, setEditingWords] = useState<Word[] | null>(null);
  const [exportPreview, setExportPreview] = useState("");
  const player = useRef<PlayerRef>(null);
  const source = useRef<HTMLVideoElement>(null);
  const version = useRef(clip.version);
  const saved = useRef(JSON.stringify(clip.draft));
  const latest = useRef(draft);
  const undo = useRef<Draft[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const saving = useRef<Promise<boolean> | null>(null);
  const active = clip.jobs.find(
    (j) => j.status === "QUEUED" || j.status === "RUNNING",
  );
  const failed = clip.jobs[0]?.status === "FAILED" ? clip.jobs[0] : null;
  const words = clip.transcript || [];
  const suggestion = clip.suggestions?.clips.find(
    (s) =>
      Math.abs(s.start - draft.start) < 0.2 &&
      Math.abs(s.end - draft.end) < 0.2,
  );
  const staleHooks =
    draft.suggestedStart !== null &&
    (Math.abs(draft.suggestedStart - draft.start) > 0.2 ||
      Math.abs((draft.suggestedEnd || 0) - draft.end) > 0.2);
  const change = (patch: Partial<Draft>) => {
    undo.current = [...undo.current.slice(-29), latest.current];
    setUndoCount(undo.current.length);
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setDraft(next);
    setSaveStatus("Unsaved");
  };
  const save = useCallback(async (): Promise<boolean> => {
    while (saving.current) {
      await saving.current;
    }
    const value = latest.current;
    if (JSON.stringify(value) === saved.current) return true;
    let valid: Draft;
    try {
      valid = validateDraft(value, clip.duration || 0);
    } catch (e) {
      setError((e as Error).message);
      setSaveStatus("Check trim");
      return false;
    }
    const task = (async () => {
      setSaveStatus("Saving…");
      try {
        const result = await api({
          action: "save",
          id: clip.id,
          version: version.current,
          draft: valid,
        });
        version.current = result.version;
        saved.current = JSON.stringify(value);
        setSaveStatus(
          JSON.stringify(latest.current) === saved.current
            ? "Saved"
            : "Unsaved",
        );
        return true;
      } catch (e) {
        setError((e as Error).message);
        setSaveStatus("Not saved");
        return false;
      } finally {
        saving.current = null;
      }
    })();
    saving.current = task;
    return task;
  }, [clip.id, clip.duration]);
  useEffect(() => {
    if (!canEdit || !clip.ready) return;
    const timer = setTimeout(() => void save(), 900);
    return () => clearTimeout(timer);
  }, [draft, canEdit, clip.ready, save]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (
        clip.version > version.current &&
        JSON.stringify(latest.current) === saved.current
      ) {
        version.current = clip.version;
        saved.current = JSON.stringify(clip.draft);
        latest.current = clip.draft;
        setDraft(clip.draft);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [clip.version, clip.draft]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (JSON.stringify(latest.current) !== saved.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  useEffect(() => {
    flushRef.current = async () => {
      if (editingWords) {
        setError(
          "Save or cancel transcript corrections before leaving this video.",
        );
        return false;
      }
      return canEdit ? save() : true;
    };
    return () => {
      flushRef.current = async () => true;
    };
  }, [flushRef, save, editingWords, canEdit]);
  let previewDraft = draft;
  try {
    previewDraft = validateDraft(draft, clip.duration || 30);
  } catch {
    previewDraft = clip.draft;
  }
  async function action(kind: string, selection = false, retryJob?: string) {
    setBusy(true);
    setError("");
    try {
      if (editingWords)
        throw new Error(
          "Save or cancel transcript corrections before processing this video.",
        );
      if (clip.ready && !(await save())) return;
      await api({
        action: retryJob ? "retry" : "queue",
        jobId: retryJob,
        id: clip.id,
        kind,
        length: target,
        ...(kind === "RENDER" ? { draft: latest.current } : {}),
        ...(selection ? { selection: latest.current } : {}),
      });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function choose(s: Suggestion) {
    change({
      start: s.start,
      end: s.end,
      hook: s.hooks[0] || "",
      suggestedStart: s.start,
      suggestedEnd: s.end,
    });
    player.current?.seekTo(0);
  }
  function seek(seconds: number, end: number | null = null) {
    setSourceEnd(end);
    if (source.current) {
      source.current.currentTime = seconds;
      void source.current.play().catch(() => {});
    }
    setSourceTime(seconds);
  }
  async function saveWords() {
    setBusy(true);
    setError("");
    try {
      if (!(await save())) return;
      const result = await api({
        action: "save",
        id: clip.id,
        version: version.current,
        words: editingWords,
      });
      version.current = result.version;
      setEditingWords(null);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      {(active || failed) && (
        <div
          role="status"
          className={`mx-5 mt-4 rounded border p-3 text-sm ${failed ? "border-amber-800 bg-amber-950/20 text-amber-200" : "border-blue-900 bg-blue-950/30 text-blue-200"}`}
        >
          <div className="flex flex-wrap items-center gap-3">
            {active && <Loader2 className="animate-spin" size={16} />}
            <strong>{active ? active.stage : failed?.stage}</strong>
            {active && (
              <span className="text-xs">
                You can close this window. Processing continues.
              </span>
            )}
            {failed && (
              <>
                <span>{failed.error}</span>
                <button
                  disabled={busy || !canEdit}
                  className={button}
                  onClick={() => void action(failed.kind, false, failed.id)}
                >
                  Retry {failed.kind.toLowerCase()}
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="mx-5 mt-4 rounded border border-amber-800 p-3 text-sm text-amber-200"
        >
          {error}{" "}
          <button
            className={button}
            onClick={() => {
              version.current = clip.version;
              saved.current = JSON.stringify(clip.draft);
              latest.current = clip.draft;
              setDraft(clip.draft);
              setError("");
              setSaveStatus("Saved");
            }}
          >
            Reload saved draft
          </button>
        </div>
      )}
      {!clip.ready ? (
        <div className="p-10 text-center text-zinc-400">
          The source video is being prepared. Downloads and editing appear here
          when it’s ready.
        </div>
      ) : (
        <>
          <div className="grid gap-0 xl:grid-cols-[minmax(260px,1fr)_minmax(300px,1.25fr)_minmax(260px,1fr)]">
            <aside className="space-y-4 border-b border-zinc-800 p-5 xl:border-b-0 xl:border-r">
              <div className="flex gap-2">
                <button
                  className={`${button} ${tab === "clips" ? "bg-zinc-800" : ""}`}
                  onClick={() => setTab("clips")}
                >
                  Suggested clips
                </button>
                <button
                  className={`${button} ${tab === "transcript" ? "bg-zinc-800" : ""}`}
                  onClick={() => setTab("transcript")}
                >
                  Transcript
                </button>
              </div>
              {canEdit && (
                <>
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <span>Preferred length</span>
                    <select
                      aria-label="Preferred clip length"
                      className={`${field} !w-auto`}
                      value={target}
                      onChange={(e) => setTarget(Number(e.target.value))}
                    >
                      <option value={30}>15–30 sec</option>
                      <option value={60}>30–60 sec</option>
                      <option value={90}>60–90 sec</option>
                    </select>
                  </div>
                  <button
                    disabled={busy || !!active}
                    className={`${primary} w-full`}
                    onClick={() =>
                      void action(clip.transcript ? "SUGGEST" : "ANALYZE")
                    }
                  >
                    {clip.transcript
                      ? "Find clips again"
                      : "Transcribe & find clips"}
                  </button>
                </>
              )}
              {tab === "clips" ? (
                <div className="max-h-[550px] space-y-3 overflow-y-auto">
                  {!clip.suggestions && (
                    <p className="text-sm leading-relaxed text-zinc-400">
                      AI will suggest exact sections and headline hooks from the
                      spoken content. You can also trim the video manually now.
                    </p>
                  )}
                  {clip.suggestions?.clips.map((s, i) => (
                    <div
                      key={i}
                      className={`rounded-lg border p-3 ${suggestion === s ? "border-blue-500 bg-blue-950/20" : "border-zinc-800"}`}
                    >
                      <p className="text-xs font-medium text-blue-300">
                        {timecode(s.start)} – {timecode(s.end)} ·{" "}
                        {(s.end - s.start).toFixed(1)} sec
                      </p>
                      <h4 className="mt-2 font-medium">{s.title}</h4>
                      <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                        {s.reason}
                      </p>
                      {s.context && (
                        <p className="mt-2 text-xs text-amber-200">
                          Context: {s.context}
                        </p>
                      )}
                      <blockquote className="mt-3 line-clamp-3 border-l border-zinc-600 pl-2 text-xs text-zinc-400">
                        {words
                          .filter((w) => w.start < s.end && w.end > s.start)
                          .map((w) => w.word)
                          .join(" ")}
                      </blockquote>
                      <div className="mt-3 flex gap-2">
                        <button
                          className={button}
                          onClick={() => {
                            seek(s.start, s.end);
                            setTab("transcript");
                          }}
                        >
                          Preview source
                        </button>
                        <button
                          className={primary}
                          disabled={!canEdit}
                          onClick={() => choose(s)}
                        >
                          Use clip
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <video
                    ref={source}
                    src={media(clip.id)}
                    controls
                    preload="metadata"
                    className="max-h-48 w-full rounded bg-black"
                    onLoadedMetadata={(e) => {
                      e.currentTarget.currentTime = sourceTime;
                    }}
                    onTimeUpdate={(e) => {
                      setSourceTime(e.currentTarget.currentTime);
                      if (
                        sourceEnd !== null &&
                        e.currentTarget.currentTime >= sourceEnd
                      )
                        e.currentTarget.pause();
                    }}
                  />
                  <div className="flex gap-2">
                    <button
                      disabled={!canEdit}
                      className={button}
                      onClick={() =>
                        change({ start: Math.min(sourceTime, draft.end - 1) })
                      }
                    >
                      Set start here
                    </button>
                    <button
                      disabled={!canEdit}
                      className={button}
                      onClick={() =>
                        change({ end: Math.max(sourceTime, draft.start + 1) })
                      }
                    >
                      Set end here
                    </button>
                  </div>
                  {words.length ? (
                    <>
                      <button
                        disabled={!canEdit || !!active}
                        className={button}
                        onClick={() =>
                          setEditingWords(
                            editingWords ? null : words.map((w) => ({ ...w })),
                          )
                        }
                      >
                        {editingWords
                          ? "Cancel corrections"
                          : "Correct transcript"}
                      </button>
                      {editingWords && (
                        <button
                          disabled={busy}
                          className={primary}
                          onClick={() => void saveWords()}
                        >
                          Save corrections
                        </button>
                      )}
                      <div className="max-h-80 overflow-y-auto">
                        {(editingWords || words).map((w, i) => (
                          <span key={i}>
                            {editingWords ? (
                              <label className="inline-flex items-center gap-1 p-1 text-[10px] text-zinc-500">
                                <button onClick={() => seek(w.start)}>
                                  {timecode(w.start)}
                                </button>
                                <input
                                  aria-label={`Transcript word at ${timecode(w.start)}`}
                                  className="w-24 rounded bg-zinc-900 px-1 py-1 text-sm text-zinc-200"
                                  value={w.word}
                                  maxLength={120}
                                  onChange={(e) =>
                                    setEditingWords((list) =>
                                      list!.map((v, n) =>
                                        n === i
                                          ? { ...v, word: e.target.value }
                                          : v,
                                      ),
                                    )
                                  }
                                />
                              </label>
                            ) : (
                              <button
                                title={`${timecode(w.start)} – ${timecode(w.end)}`}
                                className={`mr-1 rounded px-0.5 py-1 text-sm hover:bg-zinc-700 ${sourceTime >= w.start && sourceTime <= w.end ? "bg-blue-600" : w.start >= draft.start && w.end <= draft.end ? "text-blue-200" : "text-zinc-400"}`}
                                onClick={() => seek(w.start)}
                              >
                                {w.word}
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-zinc-400">
                      Transcribe the video to get clickable word timestamps.
                    </p>
                  )}
                </>
              )}
            </aside>
            <main className="space-y-4 border-b border-zinc-800 bg-black/20 p-5 xl:border-b-0">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Final video preview · 9:16</span>
                <span>
                  {(draft.end - draft.start).toFixed(1)}s clip
                  {draft.outro !== "none" ? " + 3s outro" : ""}
                </span>
              </div>
              <div className="mx-auto w-full max-w-[310px]">
                <Player
                  ref={player}
                  component={NewsClip}
                  inputProps={{
                    src: media(clip.id),
                    draft: previewDraft,
                    words,
                  }}
                  durationInFrames={framesFor(previewDraft)}
                  compositionWidth={720}
                  compositionHeight={1280}
                  fps={FPS}
                  controls
                  errorFallback={() => (
                    <div
                      role="alert"
                      className="flex h-full items-center bg-zinc-900 p-5 text-sm text-amber-200"
                    >
                      The video preview could not load. Reopen this video to
                      retry, or download the source.
                    </div>
                  )}
                  loop
                  style={{ width: "100%", aspectRatio: "9/16" }}
                />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-zinc-400">
                  <span>Trim source</span>
                  <span>{timecode(clip.duration || 0)} total</span>
                </div>
                <label className="block text-xs text-zinc-400">
                  Start
                  <input
                    aria-label="Trim start"
                    disabled={!canEdit}
                    type="range"
                    min={0}
                    max={Math.max(0, draft.end - 1)}
                    step={0.1}
                    value={draft.start}
                    className="w-full accent-blue-500"
                    onChange={(e) => change({ start: Number(e.target.value) })}
                  />
                </label>
                <label className="block text-xs text-zinc-400">
                  End
                  <input
                    aria-label="Trim end"
                    disabled={!canEdit}
                    type="range"
                    min={draft.start + 1}
                    max={Math.min(clip.duration || 1, draft.start + 180)}
                    step={0.1}
                    value={draft.end}
                    className="w-full accent-blue-500"
                    onChange={(e) => change({ end: Number(e.target.value) })}
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs text-zinc-400">
                    Start (seconds)
                    <input
                      aria-label="Start seconds"
                      disabled={!canEdit}
                      className={field}
                      type="number"
                      step="0.1"
                      min={0}
                      max={draft.end - 1}
                      value={draft.start}
                      onChange={(e) =>
                        change({ start: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label className="text-xs text-zinc-400">
                    End (seconds)
                    <input
                      aria-label="End seconds"
                      disabled={!canEdit}
                      className={field}
                      type="number"
                      step="0.1"
                      min={draft.start + 1}
                      max={clip.duration || 1}
                      value={draft.end}
                      onChange={(e) => change({ end: Number(e.target.value) })}
                    />
                  </label>
                </div>
                <div className="flex gap-2">
                  <button
                    disabled={!canEdit || !undoCount}
                    className={button}
                    onClick={() => {
                      const last = undo.current.pop();
                      setUndoCount(undo.current.length);
                      if (last) {
                        latest.current = last;
                        setDraft(last);
                        setSaveStatus("Unsaved");
                      }
                    }}
                  >
                    <Undo2 size={14} />
                    Undo
                  </button>
                  <button
                    disabled={!canEdit}
                    className={button}
                    onClick={() =>
                      change({
                        ...defaultDraft(draft.brand, draft.credit),
                        end: Math.min(30, clip.duration || 30),
                      })
                    }
                  >
                    Reset edit
                  </button>
                </div>
              </div>
            </main>
            <aside className="space-y-5 p-5 xl:border-l xl:border-zinc-800">
              <div>
                <label className="text-sm font-medium">
                  Text hook
                  <textarea
                    disabled={!canEdit}
                    value={draft.hook}
                    maxLength={140}
                    rows={3}
                    className={`${field} mt-2`}
                    placeholder="Choose a suggested headline or write your own"
                    onChange={(e) => change({ hook: e.target.value })}
                  />
                </label>
                <p className="mt-1 text-right text-xs text-zinc-500">
                  {draft.hook.length}/140
                </p>
                {staleHooks && (
                  <p className="mt-2 text-xs text-amber-300">
                    The trim changed. Check this hook or generate new ones for
                    the selection.
                  </p>
                )}
                <div className="mt-2 space-y-2">
                  {suggestion?.hooks.map((h) => (
                    <button
                      key={h}
                      disabled={!canEdit}
                      className={`w-full rounded border p-2 text-left text-sm ${draft.hook === h ? "border-blue-500 bg-blue-950/30" : "border-zinc-700 hover:bg-zinc-900"}`}
                      onClick={() =>
                        change({
                          hook: h,
                          suggestedStart: draft.start,
                          suggestedEnd: draft.end,
                        })
                      }
                    >
                      {h}
                    </button>
                  ))}
                </div>
                {canEdit && words.length > 0 && (
                  <button
                    disabled={busy || !!active}
                    className={`${button} mt-3 w-full`}
                    onClick={() => void action("SUGGEST", true)}
                  >
                    Suggest hooks for this trim
                  </button>
                )}
              </div>
              <label className="block text-sm">
                Overlay preset
                <select
                  disabled={!canEdit}
                  className={`${field} mt-2`}
                  value={draft.overlay}
                  onChange={(e) => change({ overlay: e.target.value })}
                >
                  {OVERLAYS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Outro preset
                <select
                  disabled={!canEdit}
                  className={`${field} mt-2`}
                  value={draft.outro}
                  onChange={(e) => change({ outro: e.target.value })}
                >
                  {OUTROS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                State / channel name
                <input
                  disabled={!canEdit}
                  className={`${field} mt-2`}
                  maxLength={60}
                  value={draft.brand}
                  onChange={(e) => change({ brand: e.target.value })}
                />
              </label>
              <label className="block text-sm">
                Channel logo (optional)
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={!canEdit}
                  className="mt-2 w-full text-xs text-zinc-400"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    if (
                      file.size > 120 * 1024 ||
                      !["image/png", "image/jpeg", "image/webp"].includes(
                        file.type,
                      )
                    ) {
                      setError(
                        "Use a PNG, JPEG, or WebP logo smaller than 120 KB.",
                      );
                      return;
                    }
                    try {
                      const bitmap = await createImageBitmap(file);
                      bitmap.close();
                      const reader = new FileReader();
                      reader.onload = () =>
                        change({ logo: String(reader.result) });
                      reader.readAsDataURL(file);
                    } catch {
                      setError(
                        "This logo image could not be opened. Choose another file.",
                      );
                    }
                  }}
                />
              </label>
              {draft.logo && (
                <button
                  className={button}
                  disabled={!canEdit}
                  onClick={() => change({ logo: "" })}
                >
                  Remove logo
                </button>
              )}
              <label className="block text-sm">
                Source credit
                <input
                  disabled={!canEdit}
                  className={`${field} mt-2`}
                  maxLength={100}
                  value={draft.credit}
                  onChange={(e) => change({ credit: e.target.value })}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={!canEdit || !words.length}
                  checked={draft.captions}
                  onChange={(e) => change({ captions: e.target.checked })}
                />{" "}
                Show captions
              </label>
              <details className="border-t border-zinc-800 pt-3">
                <summary className="cursor-pointer text-sm text-zinc-400">
                  Framing & audio
                </summary>
                <div className="mt-3 space-y-3">
                  <select
                    disabled={!canEdit}
                    aria-label="Video framing"
                    className={field}
                    value={draft.crop}
                    onChange={(e) =>
                      change({ crop: e.target.value as Draft["crop"] })
                    }
                  >
                    <option value="cover">Fill vertical frame</option>
                    <option value="contain">Show full source</option>
                  </select>
                  <label className="block text-xs text-zinc-400">
                    Horizontal framing
                    <input
                      disabled={!canEdit || draft.crop !== "cover"}
                      aria-label="Horizontal framing"
                      type="range"
                      min={0}
                      max={100}
                      value={draft.position}
                      className="w-full"
                      onChange={(e) =>
                        change({ position: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      disabled={!canEdit}
                      type="checkbox"
                      checked={draft.muted}
                      onChange={(e) => change({ muted: e.target.checked })}
                    />{" "}
                    Mute source audio
                  </label>
                </div>
              </details>
              {canEdit && (
                <button
                  className={`${button} w-full`}
                  onClick={async () => {
                    try {
                      await api({ action: "defaults", id: clip.id, draft });
                      setSaveStatus("Account defaults saved");
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Save branding as account default
                </button>
              )}
            </aside>
          </div>
          <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 bg-zinc-950 px-5 py-3">
            <div className="text-xs text-zinc-400">
              <span aria-live="polite">{saveStatus}</span>
              <p className="mt-1">
                Exporting does not mark this story as posted.
              </p>
            </div>
            {canEdit && (
              <div className="flex gap-2">
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => void save()}
                >
                  Save draft
                </button>
                <button
                  className={primary}
                  disabled={busy || !!active}
                  onClick={() => void action("RENDER")}
                >
                  Export video
                </button>
              </div>
            )}
          </div>
        </>
      )}
      {clip.jobs.some((j) => j.downloadable) && (
        <section className="border-t border-zinc-800 p-5">
          <h3 className="mb-3 font-medium">Ready to post</h3>
          <div className="space-y-2">
            {clip.jobs
              .filter((j) => j.downloadable)
              .map((j) => (
                <div
                  key={j.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded border border-zinc-800 p-3 text-sm"
                >
                  <div>
                    <p>{j.draft?.hook || "Exported video"}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {new Date(j.createdAt).toLocaleString()}
                      {j.draft &&
                        ` · ${timecode(j.draft.start)}–${timecode(j.draft.end)} · ${j.draft.overlay}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className={button}
                      onClick={() =>
                        setExportPreview(exportPreview === j.id ? "" : j.id)
                      }
                    >
                      Preview export
                    </button>
                    <a className={primary} href={media(clip.id, j.id, true)}>
                      Download MP4
                    </a>
                  </div>
                  {exportPreview === j.id && (
                    <video
                      controls
                      src={media(clip.id, j.id)}
                      className="mx-auto max-h-96 w-full"
                    />
                  )}
                </div>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}
