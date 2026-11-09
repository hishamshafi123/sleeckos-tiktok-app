"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  ExternalLink,
  Loader2,
  Newspaper,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { deskData } from "@/lib/services/content-desk/data";
import type { Brief } from "@/lib/services/content-desk/worker";
import {
  CATEGORIES,
  SOURCE_KINDS,
  STATUSES,
} from "@/lib/services/content-desk/rules";

type Json<T> = T extends Date
  ? string
  : T extends bigint
    ? string
    : T extends (infer V)[]
      ? Json<V>[]
      : T extends object
        ? { [K in keyof T]: Json<T[K]> }
        : T;
type Data = Json<Awaited<ReturnType<typeof deskData>>>;
type Story = Data["stories"][number];
type Shortlist = {
  day: string;
  timezone: string;
  generatedAt: string;
  states: {
    stateCode: string;
    target: number;
    shortfall: number;
    stories: { id: string; title: string; category: string; status: string }[];
  }[];
};
const field =
  "w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-2 focus:ring-blue-400";
const button =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-40 disabled:cursor-not-allowed";
const primary = `${button} border-blue-500 bg-blue-600 text-white hover:bg-blue-500`;
const label = (value: string) =>
  value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
const num = (value: string | number | null) =>
  value == null ? "Not available" : Number(value).toLocaleString("en-US");
function When({ value, timezone }: { value: string | null; timezone: string }) {
  return (
    <span>
      {value
        ? new Date(value).toLocaleString("en-GB", {
            timeZone: timezone,
            dateStyle: "medium",
            timeStyle: "short",
          })
        : "Not yet"}
    </span>
  );
}
function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  return (
    <span
      className={`inline-flex rounded px-2 py-0.5 text-xs ${tone === "good" ? "bg-teal-950 text-teal-200" : tone === "bad" ? "bg-red-950 text-red-200" : tone === "warn" ? "bg-amber-950 text-amber-200" : "bg-zinc-800 text-zinc-300"}`}
    >
      {children}
    </span>
  );
}
function Field({ title, children }: { title: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm text-zinc-300">
      <span>{title}</span>
      {children}
    </label>
  );
}
const blankSource = {
  id: "",
  stateCode: "SC",
  name: "",
  kind: "RSS",
  url: "",
  category: "AUTO",
  intervalMinutes: 60,
};
export default function ClientPage() {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("stories"),
    [state, setState] = useState(""),
    [status, setStatus] = useState(""),
    [category, setCategory] = useState(""),
    [team, setTeam] = useState(""),
    [query, setQuery] = useState(""),
    [q, setQ] = useState(""),
    [page, setPage] = useState(0),
    [storyFilter, setStoryFilter] = useState("");
  const [selected, setSelected] = useState<string[]>([]),
    [detailId, setDetailId] = useState(""),
    [bulkTeam, setBulkTeam] = useState("");
  const [sourceForm, setSourceForm] = useState<typeof blankSource | null>(null),
    [manual, setManual] = useState(false),
    [formError, setFormError] = useState("");
  const [notes, setNotes] = useState(""),
    [assignment, setAssignment] = useState({
      teamId: "",
      accountId: "",
      publishedUrl: "",
    });
  const [editorVersion, setEditorVersion] = useState(0);
  const request = useRef<AbortController | null>(null),
    detailVersion = useRef("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(query);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const params = new URLSearchParams({
        state,
        status,
        category,
        team,
        q,
        page: String(page),
        story: storyFilter,
      });
      const res = await fetch(`/api/admin/content-desk?${params}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      const result = await res.json();
      if (!res.ok)
        throw new Error(result.error || "Content Desk could not load.");
      setData(result);
      setError("");
    } catch (e) {
      if ((e as Error).name !== "AbortError")
        setError(
          (e as Error).message ||
            "Network unavailable. Check your connection and retry.",
        );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [state, status, category, team, q, page, storyFilter]);
  useEffect(() => {
    const initial = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 60000);
    return () => {
      clearInterval(timer);
      clearTimeout(initial);
      request.current?.abort();
    };
  }, [load]);
  const detail = data?.stories.find((s) => s.id === detailId);
  useEffect(() => {
    // Preserve unsaved notes during background refreshes of the same story.
    if (detail && detailVersion.current !== detail.id) {
      setEditorVersion(detail.version);
      setNotes(detail.notes);
      setAssignment({
        teamId: detail.teamId || "",
        accountId: detail.accountId || "",
        publishedUrl: detail.publishedUrl || "",
      });
      detailVersion.current = detail.id;
    }
  }, [detail]);
  async function save(payload: Record<string, unknown>, modal = false) {
    setBusy(true);
    setFormError("");
    try {
      const res = await fetch("/api/admin/content-desk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (!res.ok)
        throw new Error(result.error || "Changes could not be saved.");
      toast.success(result.message || "Saved");
      detailVersion.current = "";
      await load();
      return true;
    } catch (e) {
      const message =
        (e as Error).message ||
        "Network unavailable. Your changes were not saved.";
      if (modal) setFormError(message);
      else setError(message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function filter(setter: (v: string) => void, value: string) {
    setter(value);
    setPage(0);
    setSelected([]);
    setDetailId("");
    setStoryFilter("");
  }
  async function storyAction(next: string, bulk = false) {
    if (!data) return;
    const stories = bulk
      ? data.stories.filter((s) => selected.includes(s.id))
      : detail
        ? [detail]
        : [];
    if (!stories.length) return;
    const payload = {
      action: "story.update",
      ids: stories.map((s) => s.id),
      versions: Object.fromEntries(
        stories.map((s) => [s.id, bulk ? s.version : editorVersion]),
      ),
      status: next,
      ...(bulk ? { teamId: bulkTeam || undefined } : { notes, ...assignment }),
    };
    if (await save(payload)) setSelected([]);
  }
  function openStory(id: string, code?: string) {
    setDetailId(id);
    detailVersion.current = "";
    if (!data?.stories.some((s) => s.id === id)) {
      setStoryFilter(id);
      setPage(0);
      setStatus("");
      setCategory("");
      setQ("");
      setQuery("");
      setTeam("");
      if (code) setState(code);
    }
    setTab("stories");
  }
  function copyBrief(story: Story) {
    const brief = story.brief as unknown as Brief | null;
    const content = [
      story.title,
      brief?.summary,
      brief?.whyItMatters,
      brief?.hook,
      ...(brief?.talkingPoints.map((p) => p.text) || []),
      "Sources:",
      ...story.items.map((i) => `${i.title}\n${i.url}`),
      "Team notes:",
      story.notes,
    ]
      .filter(Boolean)
      .join("\n\n");
    navigator.clipboard.writeText(content).then(
      () => toast.success("Brief and sources copied"),
      () =>
        setError(
          "Clipboard access was blocked. Select and copy the brief text manually.",
        ),
    );
  }
  const isAdmin = data?.user.role === "admin",
    timezone = data?.settings.timezone || "Asia/Kolkata";
  const myTeams =
    data?.teams.filter(
      (t) => isAdmin || t.members.some((m) => m.userId === data.user.userId),
    ) || [];
  const currentState = data?.states.find((s) => s.code === state);
  const sources =
    data?.sources.filter((s) => !state || s.stateCode === state) || [];
  const errors = sources.filter((s) => s.enabled && s.errorMessage);
  let heartbeat: { at: string; failed: number } | null = null;
  try {
    heartbeat = data?.heartbeat ? JSON.parse(data.heartbeat) : null;
  } catch {}
  const stale =
    !heartbeat ||
    new Date(data?.generatedAt || 0).getTime() -
      new Date(heartbeat.at).getTime() >
      20 * 60000;
  const shortlist = data?.shortlist as Shortlist | null;
  const editable =
    detail &&
    (isAdmin || !detail.teamId || myTeams.some((t) => t.id === detail.teamId));
  const brief = detail?.brief as unknown as Brief | null;
  return (
    <div className="space-y-6 text-zinc-100">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/admin/state-accounts"
            className="text-sm text-zinc-400 hover:text-white"
          >
            State Accounts
          </Link>
          <h1 className="mt-2 flex items-center gap-3 text-3xl font-semibold tracking-tight">
            <Newspaper className="text-blue-400" />
            Content Desk
          </h1>
          <p className="mt-2 max-w-xl text-sm text-zinc-400">
            Find a story. Check the evidence. Choose what your team makes next.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className={button}
            onClick={() => void load()}
            disabled={busy}
            aria-label="Refresh Content Desk"
          >
            <RefreshCw size={16} />
          </button>
          <button
            className={button}
            onClick={() => {
              setFormError("");
              setSourceForm({ ...blankSource, stateCode: state || "SC" });
            }}
          >
            <Plus size={16} />
            Track a source
          </button>
          <button
            className={primary}
            onClick={() => {
              setFormError("");
              setManual(true);
            }}
          >
            <Plus size={16} />
            Add content
          </button>
        </div>
      </header>
      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-red-900 bg-red-950/40 p-4 text-sm text-red-200"
        >
          <AlertCircle size={18} />
          <span className="flex-1">{error}</span>
          <button onClick={() => void load()} className="underline">
            Retry
          </button>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {loading && !data ? (
        <p role="status" className="flex gap-2 py-12">
          <Loader2 className="animate-spin" />
          Loading content and source health…
        </p>
      ) : (
        data && (
          <>
            <nav aria-label="State" className="flex flex-wrap gap-2">
              <button
                onClick={() => filter(setState, "")}
                className={`${button} ${!state ? "border-blue-500 bg-blue-500/15" : ""}`}
              >
                All states
              </button>
              {data.states.map((s) => (
                <button
                  key={s.code}
                  onClick={() => filter(setState, s.code)}
                  className={`${button} ${state === s.code ? "border-blue-500 bg-blue-500/15" : ""}`}
                >
                  {s.name}
                  {!s.enabled && (
                    <span className="text-xs text-amber-300">Paused</span>
                  )}
                </button>
              ))}
            </nav>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800">
              <nav
                aria-label="Content Desk sections"
                className="flex flex-wrap gap-5"
              >
                {[
                  "stories",
                  "shortlist",
                  "sources",
                  "activity",
                  ...(isAdmin ? ["settings"] : []),
                ].map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`border-b-2 py-3 text-sm ${tab === t ? "border-blue-400 text-blue-200" : "border-transparent text-zinc-400 hover:text-white"}`}
                  >
                    {label(t)}
                    {t === "sources" && errors.length > 0 && (
                      <span className="ml-2 text-amber-300">
                        {errors.length} issues
                      </span>
                    )}
                  </button>
                ))}
              </nav>
              <span
                className={`pb-2 text-xs ${stale ? "text-amber-300" : "text-zinc-500"}`}
              >
                {stale ? "Collection needs attention" : "Last collection"}
                {heartbeat && (
                  <>
                    {" "}
                    · <When value={heartbeat.at} timezone={timezone} />
                  </>
                )}
              </span>
            </div>
            {stale && (
              <div
                role="status"
                className="rounded-lg border border-amber-900 bg-amber-950/20 p-3 text-sm text-amber-200"
              >
                {heartbeat
                  ? "No completed collection in the last 20 minutes. Existing stories are still available. Ask an admin to check the Content Desk cron job."
                  : "Waiting for the first collection. The scheduled worker checks sources every five minutes; results will appear here automatically."}
              </div>
            )}
            {tab === "stories" && (
              <>
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="relative">
                    <Search
                      className="absolute left-3 top-2.5 text-zinc-500"
                      size={17}
                    />
                    <input
                      aria-label="Search stories"
                      className={`${field} pl-9`}
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setStoryFilter("");
                      }}
                      placeholder="Search stories or notes"
                    />
                  </div>
                  <select
                    aria-label="Story status"
                    className={field}
                    value={status}
                    onChange={(e) => filter(setStatus, e.target.value)}
                  >
                    <option value="">Active stories</option>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {label(s)}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Category"
                    className={field}
                    value={category}
                    onChange={(e) => filter(setCategory, e.target.value)}
                  >
                    <option value="">All categories</option>
                    {CATEGORIES.filter((c) => c !== "AUTO").map((c) => (
                      <option key={c} value={c}>
                        {label(c)}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Assigned team"
                    className={field}
                    value={team}
                    onChange={(e) => filter(setTeam, e.target.value)}
                  >
                    <option value="">All teams</option>
                    {data.teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
                {storyFilter && (
                  <button
                    className={button}
                    onClick={() => {
                      setStoryFilter("");
                      setDetailId("");
                    }}
                  >
                    Show all stories
                  </button>
                )}
                {selected.length > 0 && (
                  <div className="flex flex-wrap items-center gap-3 rounded-lg border border-blue-800 bg-blue-950/30 p-3">
                    <CheckSquare size={18} />
                    <span className="text-sm">{selected.length} selected</span>
                    <select
                      aria-label="Team for selected stories"
                      className={`${field} max-w-48`}
                      value={bulkTeam}
                      onChange={(e) => setBulkTeam(e.target.value)}
                    >
                      <option value="">Choose a team</option>
                      {myTeams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <button
                      className={primary}
                      disabled={busy || !bulkTeam}
                      onClick={() => void storyAction("SELECTED", true)}
                    >
                      Select for team
                    </button>
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() => void storyAction("REJECTED", true)}
                    >
                      Reject
                    </button>
                    <button className={button} onClick={() => setSelected([])}>
                      Clear
                    </button>
                  </div>
                )}
                <div
                  className={`grid items-start gap-5 ${detail ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]" : ""}`}
                >
                  <section
                    aria-label="Story queue"
                    className="min-w-0 overflow-hidden rounded-xl border border-zinc-800"
                  >
                    <div className="flex items-center justify-between bg-zinc-900/60 px-4 py-3 text-xs text-zinc-400">
                      <span>
                        {num(data.total)} stories · recent relevance first
                      </span>
                      <span>Page {page + 1}</span>
                    </div>
                    {!data.stories.length && (
                      <div className="space-y-3 p-8">
                        <h2 className="font-medium">
                          No stories match this view
                        </h2>
                        <p className="text-sm text-zinc-400">
                          Try another filter, add a link, or check Sources for
                          collection errors and missing location keywords.
                        </p>
                        <button
                          className={button}
                          onClick={() => setTab("sources")}
                        >
                          Check sources
                        </button>
                      </div>
                    )}
                    <div className="divide-y divide-zinc-800">
                      {data.stories.map((story) => (
                        <article
                          key={story.id}
                          className={`flex gap-3 p-4 ${detailId === story.id ? "bg-blue-950/30" : "hover:bg-zinc-900/40"}`}
                        >
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 accent-blue-500"
                            aria-label={`Select ${story.title}`}
                            checked={selected.includes(story.id)}
                            onChange={(e) =>
                              setSelected((old) =>
                                e.target.checked
                                  ? old.length < 20
                                    ? [...old, story.id]
                                    : old
                                  : old.filter((id) => id !== story.id),
                              )
                            }
                          />
                          <button
                            className="min-w-0 flex-1 text-left focus-visible:outline-blue-400"
                            onClick={() => openStory(story.id)}
                          >
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <span className="text-xs font-medium text-blue-300">
                                {story.stateCode}
                              </span>
                              <Badge>{label(story.category)}</Badge>
                              <Badge
                                tone={
                                  story.status === "APPROVED" ||
                                  story.status === "POSTED"
                                    ? "good"
                                    : story.status === "NEEDS_REVIEW"
                                      ? "warn"
                                      : "neutral"
                                }
                              >
                                {label(story.status)}
                              </Badge>
                              {story.needsReview && (
                                <Badge tone="warn">Evidence updated</Badge>
                              )}
                            </div>
                            <h2 className="text-base font-medium leading-snug">
                              {story.title}
                            </h2>
                            <p className="mt-2 line-clamp-2 text-sm text-zinc-400">
                              {(story.brief as unknown as Brief | null)
                                ?.summary ||
                                story.items[0]?.excerpt ||
                                "Open the source and add your notes."}
                            </p>
                            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
                              <span>
                                {story.items.length} reference
                                {story.items.length === 1 ? "" : "s"}
                              </span>
                              <span>
                                {story.items[0]?.publishedAt ? (
                                  <When
                                    value={story.items[0].publishedAt}
                                    timezone={timezone}
                                  />
                                ) : (
                                  "Publication date unknown"
                                )}
                              </span>
                              {story.teamId && (
                                <span className="text-teal-300">
                                  {
                                    data.teams.find(
                                      (t) => t.id === story.teamId,
                                    )?.name
                                  }
                                </span>
                              )}
                              {story.briefError && (
                                <span className="text-amber-300">
                                  Brief needs attention
                                </span>
                              )}
                            </div>
                          </button>
                        </article>
                      ))}
                    </div>
                    <div className="flex justify-between border-t border-zinc-800 p-3">
                      <button
                        className={button}
                        disabled={page === 0}
                        onClick={() => {
                          setPage((p) => p - 1);
                          setSelected([]);
                          setDetailId("");
                        }}
                      >
                        <ChevronLeft size={16} />
                        Previous
                      </button>
                      <button
                        className={button}
                        disabled={(page + 1) * 50 >= data.total}
                        onClick={() => {
                          setPage((p) => p + 1);
                          setSelected([]);
                          setDetailId("");
                        }}
                      >
                        Next
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </section>
                  {detail && (
                    <aside
                      aria-label="Content brief"
                      className="min-w-0 space-y-5 rounded-xl border border-zinc-700 bg-zinc-900/40 p-5 xl:sticky xl:top-4 xl:max-h-[90vh] xl:overflow-y-auto"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm text-blue-300">
                            {
                              data.states.find(
                                (s) => s.code === detail.stateCode,
                              )?.name
                            }{" "}
                            · {label(detail.category)}
                          </p>
                          <h2 className="mt-2 text-xl font-semibold leading-snug">
                            {detail.title}
                          </h2>
                        </div>
                        <button
                          className={button}
                          onClick={() => setDetailId("")}
                          aria-label="Close brief"
                        >
                          <X size={16} />
                        </button>
                      </div>
                      {detail.needsReview && (
                        <p
                          role="status"
                          className="rounded-lg bg-amber-950/30 p-3 text-sm text-amber-200"
                        >
                          The source material changed or another reference was
                          added. Review the current evidence before approving.
                        </p>
                      )}
                      {detail.briefError && (
                        <div
                          role="alert"
                          className="rounded-lg border border-amber-900 p-3 text-sm text-amber-200"
                        >
                          {detail.briefError}
                          <button
                            className="mt-2 block underline"
                            disabled={busy}
                            onClick={() =>
                              void save({
                                action: "brief.retry",
                                id: detail.id,
                              })
                            }
                          >
                            Retry brief
                          </button>
                        </div>
                      )}
                      {brief ? (
                        <div className="space-y-4 text-sm">
                          <Badge tone="warn">
                            Draft · team verification required
                          </Badge>
                          <p className="leading-relaxed text-zinc-200">
                            {brief.summary}
                          </p>
                          <div>
                            <h3 className="font-medium">
                              Why it matters locally
                            </h3>
                            <p className="mt-1 text-zinc-400">
                              {brief.whyItMatters}
                            </p>
                          </div>
                          <div className="border-l-2 border-blue-400 pl-3">
                            <h3 className="font-medium">Suggested opening</h3>
                            <p className="mt-1 text-zinc-300">{brief.hook}</p>
                          </div>
                          <div>
                            <h3 className="font-medium">Talking points</h3>
                            <ul className="mt-2 space-y-2">
                              {brief.talkingPoints.map((p, i) => (
                                <li key={i} className="text-zinc-300">
                                  {p.text}
                                  <span className="ml-1 text-xs text-blue-300">
                                    {p.sourceIds
                                      .map(
                                        (id) =>
                                          `[${detail.items.findIndex((item) => item.id === id) + 1}]`,
                                      )
                                      .join(" ")}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <h3 className="font-medium">
                              Check before approval
                            </h3>
                            <ul className="mt-1 list-disc space-y-1 pl-5 text-zinc-400">
                              {brief.questions.map((question, i) => (
                                <li key={i}>{question}</li>
                              ))}
                            </ul>
                          </div>
                          <p className="text-xs text-zinc-500">
                            Event date: {brief.eventDate}. Brief created{" "}
                            <When
                              value={brief.generatedAt}
                              timezone={timezone}
                            />
                            .<br />
                            {brief.researchNote}
                          </p>
                          <button
                            className={button}
                            onClick={() => copyBrief(detail)}
                          >
                            <Clipboard size={15} />
                            Copy brief with sources
                          </button>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-dashed border-zinc-700 p-4 text-sm text-zinc-400">
                          <p>
                            The source material is available below. Briefs are
                            drafted automatically within each state’s daily
                            target and the shared usage limit.
                          </p>
                          <button
                            className="mt-2 text-blue-300 underline"
                            disabled={busy}
                            onClick={() =>
                              void save({
                                action: "brief.retry",
                                id: detail.id,
                              })
                            }
                          >
                            Queue brief
                          </button>
                        </div>
                      )}
                      <section className="space-y-3">
                        <h3 className="font-medium">
                          Evidence & original content
                        </h3>
                        <p className="text-xs text-zinc-500">
                          Excerpts and metadata only. Open originals to verify.
                          Multiple links may repeat the same report. Media reuse
                          rights have not been verified.
                        </p>
                        {detail.items.map((item, i) => (
                          <div
                            key={item.id}
                            className="rounded-lg border border-zinc-800 p-3"
                          >
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-start gap-2 text-sm text-blue-300 hover:underline"
                            >
                              <span>
                                [{i + 1}] {item.title}
                              </span>
                              <ExternalLink className="shrink-0" size={14} />
                            </a>
                            <p className="mt-1 text-xs text-zinc-500">
                              {item.publisher} · {label(item.platform)} ·{" "}
                              {label(item.coverage)}
                            </p>
                            <p className="mt-2 line-clamp-4 text-xs leading-relaxed text-zinc-400">
                              {item.excerpt ||
                                "No excerpt available. Open the original."}
                            </p>
                            <div className="mt-2 text-xs text-zinc-500">
                              Published:{" "}
                              <When
                                value={item.publishedAt}
                                timezone={timezone}
                              />
                              {item.views !== null && (
                                <span> · {num(item.views)} views</span>
                              )}
                              {item.likes !== null && (
                                <span> · {num(item.likes)} likes</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </section>
                      <div className="flex flex-wrap gap-3 text-xs">
                        <a
                          className="text-blue-300 hover:underline"
                          href={`https://www.youtube.com/results?search_query=${encodeURIComponent(detail.title)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Find related YouTube videos{" "}
                          <ArrowUpRight className="inline" size={12} />
                        </a>
                        <a
                          className="text-blue-300 hover:underline"
                          href={`https://www.tiktok.com/search?q=${encodeURIComponent(detail.title)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Find related TikToks{" "}
                          <ArrowUpRight className="inline" size={12} />
                        </a>
                      </div>
                      <section className="space-y-3 border-t border-zinc-700 pt-4">
                        <h3 className="font-medium">Team selection</h3>
                        {detail.selectedBy && (
                          <p className="text-xs text-zinc-400">
                            Selected by{" "}
                            {detail.selectedBy.name || detail.selectedBy.email}
                          </p>
                        )}
                        {!editable && (
                          <p className="text-sm text-amber-200">
                            This content belongs to another team. An admin can
                            reassign it.
                          </p>
                        )}
                        <Field title="Team">
                          <select
                            disabled={!editable}
                            className={field}
                            value={assignment.teamId}
                            onChange={(e) =>
                              setAssignment((a) => ({
                                ...a,
                                teamId: e.target.value,
                                accountId: "",
                              }))
                            }
                          >
                            <option value="">Choose a team</option>
                            {myTeams.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field title="Account (optional)">
                          <select
                            disabled={!editable}
                            className={field}
                            value={assignment.accountId}
                            onChange={(e) =>
                              setAssignment((a) => ({
                                ...a,
                                accountId: e.target.value,
                              }))
                            }
                          >
                            <option value="">Choose at production time</option>
                            {data.accounts
                              .filter(
                                (a) =>
                                  a.teamId === assignment.teamId &&
                                  a.stateName?.toLowerCase() ===
                                    data.states
                                      .find((s) => s.code === detail.stateCode)
                                      ?.name.toLowerCase(),
                              )
                              .map((a) => (
                                <option key={a.accountId} value={a.accountId}>
                                  @{a.account.tiktokUsername}
                                </option>
                              ))}
                          </select>
                        </Field>
                        <Field title="Team notes">
                          <textarea
                            disabled={!editable}
                            className={field}
                            rows={4}
                            maxLength={8000}
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Angle, facts to check, production instructions…"
                          />
                        </Field>
                        <Field title="Published post URL">
                          <input
                            disabled={!editable}
                            className={field}
                            value={assignment.publishedUrl}
                            onChange={(e) =>
                              setAssignment((a) => ({
                                ...a,
                                publishedUrl: e.target.value,
                              }))
                            }
                            placeholder="https://…"
                          />
                        </Field>
                        <div className="flex flex-wrap gap-2">
                          <button
                            className={primary}
                            disabled={busy || !editable || !assignment.teamId}
                            onClick={() => void storyAction("SELECTED")}
                          >
                            <CheckSquare size={15} />
                            Select for team
                          </button>
                          <button
                            className={button}
                            disabled={busy || !editable || !assignment.teamId}
                            onClick={() => void storyAction("APPROVED")}
                          >
                            <Check size={15} />
                            Approve
                          </button>
                          <button
                            className={button}
                            disabled={
                              busy || !editable || !assignment.publishedUrl
                            }
                            onClick={() => void storyAction("POSTED")}
                          >
                            Mark posted
                          </button>
                          <button
                            className={button}
                            disabled={busy || !editable}
                            onClick={() => void storyAction(detail.status)}
                          >
                            Save notes
                          </button>
                          <select
                            aria-label="Other story action"
                            className={`${field} max-w-40`}
                            value=""
                            disabled={busy || !editable}
                            onChange={(e) =>
                              e.target.value && void storyAction(e.target.value)
                            }
                          >
                            <option value="">More actions</option>
                            <option value="NEEDS_REVIEW">Needs review</option>
                            <option value="REJECTED">Reject</option>
                            <option value="OUTDATED">Mark outdated</option>
                            <option value="NEW">Release selection</option>
                          </select>
                        </div>
                        {!myTeams.length && (
                          <p className="text-sm text-amber-200">
                            Create a team in State Accounts before assigning
                            content.
                          </p>
                        )}
                      </section>
                      <details className="border-t border-zinc-800 pt-3 text-xs text-zinc-400">
                        <summary className="cursor-pointer">
                          Selection history
                        </summary>
                        <ul className="mt-3 space-y-2">
                          {detail.events.map((event) => (
                            <li key={event.id}>
                              {event.actorName}: {event.detail}
                              <br />
                              <When
                                value={event.createdAt}
                                timezone={timezone}
                              />
                            </li>
                          ))}
                        </ul>
                      </details>
                    </aside>
                  )}
                </div>
              </>
            )}
            {tab === "shortlist" && (
              <section className="space-y-5">
                <div>
                  <h2 className="text-xl font-semibold">
                    Today’s editorial shortlist
                  </h2>
                  <p className="mt-1 text-sm text-zinc-400">
                    A mix of local news, politics, and culture, refreshed after{" "}
                    {String(data.settings.shortlistHour).padStart(2, "0")}:00{" "}
                    {timezone}. Targets are editable per state.
                  </p>
                </div>
                {!shortlist ? (
                  <p className="rounded-xl border border-zinc-800 p-6 text-zinc-400">
                    The first shortlist appears after the configured briefing
                    time. Browse Stories for content already collected.
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-zinc-500">
                      Briefing day: {shortlist.day} · Updated{" "}
                      <When value={shortlist.generatedAt} timezone={timezone} />
                    </p>
                    <div className="grid gap-4 lg:grid-cols-2">
                      {shortlist.states
                        .filter((s) => !state || state === s.stateCode)
                        .map((list) => (
                          <div
                            className="rounded-xl border border-zinc-800 p-5"
                            key={list.stateCode}
                          >
                            <div className="mb-3 flex items-center justify-between">
                              <h3 className="font-medium">
                                {
                                  data.states.find(
                                    (s) => s.code === list.stateCode,
                                  )?.name
                                }
                              </h3>
                              <Badge>
                                {list.stories.length}/{list.target} stories
                              </Badge>
                            </div>
                            {list.shortfall > 0 && (
                              <p className="mb-3 text-xs text-amber-300">
                                {list.shortfall} more qualified stories needed.
                                Add sources or adjust location keywords.
                              </p>
                            )}
                            <ul className="divide-y divide-zinc-800">
                              {list.stories.map((story) => (
                                <li key={story.id}>
                                  <button
                                    className="w-full py-3 text-left text-sm hover:text-blue-300"
                                    onClick={() =>
                                      openStory(story.id, list.stateCode)
                                    }
                                  >
                                    <span className="mb-1 block text-xs text-zinc-500">
                                      {label(story.category)}
                                    </span>
                                    {story.title}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                    </div>
                  </>
                )}
              </section>
            )}
            {tab === "sources" && (
              <section className="space-y-4">
                <div>
                  <h2 className="text-xl font-semibold">
                    Sources & tracked accounts
                  </h2>
                  <p className="mt-1 text-sm text-zinc-400">
                    Add public profiles, channels, RSS feeds, or individual web
                    pages. Web pages track changes to that URL; RSS discovers
                    new articles.
                  </p>
                </div>
                {sources.map((source) => {
                  const canEdit =
                    isAdmin || source.createdBy === data.user.userId;
                  return (
                    <article
                      key={source.id}
                      className="rounded-xl border border-zinc-800 p-4"
                    >
                      <div className="flex flex-wrap justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-medium">{source.name}</h3>
                            <Badge>
                              {source.stateCode} · {label(source.kind)}
                            </Badge>
                            <Badge
                              tone={
                                !source.enabled
                                  ? "neutral"
                                  : source.errorMessage
                                    ? "bad"
                                    : source.pendingRunId
                                      ? "warn"
                                      : source.lastSuccessAt
                                        ? "good"
                                        : "neutral"
                              }
                            >
                              {!source.enabled
                                ? "Paused"
                                : source.errorMessage
                                  ? "Needs attention"
                                  : source.pendingRunId
                                    ? "Collecting"
                                    : source.lastSuccessAt
                                      ? "Connected"
                                      : "Queued"}
                            </Badge>
                          </div>
                          <a
                            className="mt-1 block max-w-lg truncate text-xs text-zinc-500 hover:text-blue-300"
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {source.url}
                          </a>
                          <p className="mt-2 text-xs text-zinc-500">
                            Every{" "}
                            {source.intervalMinutes < 60
                              ? `${source.intervalMinutes} minutes`
                              : `${source.intervalMinutes / 60} hours`}{" "}
                            · Last success:{" "}
                            <When
                              value={source.lastSuccessAt}
                              timezone={timezone}
                            />
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            Next check:{" "}
                            <When
                              value={source.nextRunAt}
                              timezone={timezone}
                            />
                          </p>
                        </div>
                        <div className="flex items-start gap-2">
                          <button
                            disabled={busy || !canEdit || !!source.pendingRunId}
                            className={button}
                            onClick={() => {
                              setFormError("");
                              setSourceForm({
                                id: source.id,
                                name: source.name,
                                stateCode: source.stateCode,
                                kind: source.kind,
                                url: source.url,
                                category: source.category,
                                intervalMinutes: source.intervalMinutes,
                              });
                            }}
                          >
                            Edit
                          </button>
                          <button
                            disabled={busy || !canEdit}
                            className={button}
                            onClick={() =>
                              void save({
                                action: "source.toggle",
                                id: source.id,
                                enabled: !source.enabled,
                              })
                            }
                          >
                            {source.enabled ? "Pause" : "Resume"}
                          </button>
                          <button
                            disabled={busy || !canEdit || !source.enabled}
                            className={button}
                            onClick={() =>
                              void save({
                                action: "source.retry",
                                id: source.id,
                              })
                            }
                          >
                            Retry
                          </button>
                        </div>
                      </div>
                      {source.errorMessage && (
                        <div
                          role="status"
                          className="mt-3 flex gap-2 rounded-lg bg-red-950/30 p-3 text-sm text-red-200"
                        >
                          <AlertCircle size={16} className="mt-0.5 shrink-0" />
                          <div>
                            {source.errorMessage}
                            <p className="mt-1 text-xs text-red-300/70">
                              {source.errorCode} · Last attempt:{" "}
                              <When
                                value={source.lastAttemptAt}
                                timezone={timezone}
                              />
                            </p>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
                {!sources.length && (
                  <p className="text-zinc-400">
                    No sources yet. Add a public account or feed to start
                    tracking.
                  </p>
                )}
              </section>
            )}
            {tab === "activity" && (
              <section className="space-y-5">
                <div>
                  <h2 className="text-xl font-semibold">Collection health</h2>
                  <p className="mt-1 text-sm text-zinc-400">
                    Recent jobs, errors, and provider availability. One failing
                    source does not stop other states.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  {Object.entries(data.providers).map(([name, available]) => (
                    <Badge key={name} tone={available ? "good" : "warn"}>
                      {label(name)}:{" "}
                      {available ? "Key configured" : "Key missing"}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-zinc-500">
                  A configured key is not proof of available quota. Individual
                  run results below show whether requests succeeded.
                </p>
                <div className="overflow-x-auto rounded-xl border border-zinc-800">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-zinc-900 text-xs text-zinc-400">
                      <tr>
                        {["Time", "Source / task", "Result", "Details"].map(
                          (t) => (
                            <th key={t} className="p-3 font-medium">
                              {t}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {data.runs
                        .filter(
                          (r) =>
                            !state ||
                            r.source?.stateCode === state ||
                            !r.sourceId,
                        )
                        .map((run) => (
                          <tr key={run.id}>
                            <td className="whitespace-nowrap p-3 text-xs text-zinc-500">
                              <When value={run.startedAt} timezone={timezone} />
                            </td>
                            <td className="p-3">
                              {run.source?.name || label(run.kind)}
                              <span className="mt-1 block text-xs text-zinc-500">
                                {run.source?.stateCode} {label(run.kind)}
                              </span>
                            </td>
                            <td className="p-3">
                              <Badge
                                tone={
                                  ["ERROR", "INTERRUPTED"].includes(run.status)
                                    ? "bad"
                                    : run.status === "SUCCESS"
                                      ? "good"
                                      : "neutral"
                                }
                              >
                                {label(run.status)}
                              </Badge>
                            </td>
                            <td className="max-w-md p-3 text-xs text-zinc-400">
                              {run.message || "Collection in progress"}
                              {run.costUsd != null && (
                                <span className="mt-1 block">
                                  Provider-reported cost: $
                                  {run.costUsd.toFixed(4)}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {!data.runs.length && (
                    <p className="p-6 text-zinc-400">
                      No collection jobs have run yet.
                    </p>
                  )}
                </div>
              </section>
            )}
            {tab === "settings" && isAdmin && (
              <section className="grid gap-6 lg:grid-cols-2">
                <form
                  key={JSON.stringify(data.settings)}
                  className="space-y-4 rounded-xl border border-zinc-800 p-5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void save({
                      action: "settings.save",
                      dailySocialRuns: Number(f.get("dailySocialRuns")),
                      dailyAiBriefs: Number(f.get("dailyAiBriefs")),
                      shortlistHour: Number(f.get("shortlistHour")),
                    });
                  }}
                >
                  <h2 className="text-lg font-semibold">
                    Automation & usage limits
                  </h2>
                  <p className="text-sm text-zinc-400">
                    Limits reset at midnight in {timezone}. Change the business
                    timezone in State Accounts.
                  </p>
                  <Field title="Maximum social collection starts per day">
                    <input
                      name="dailySocialRuns"
                      type="number"
                      min={0}
                      max={500}
                      defaultValue={data.settings.dailySocialRuns}
                      className={field}
                      required
                    />
                  </Field>
                  <Field title="Maximum AI brief attempts per day">
                    <input
                      name="dailyAiBriefs"
                      type="number"
                      min={0}
                      max={1000}
                      defaultValue={data.settings.dailyAiBriefs}
                      className={field}
                      required
                    />
                  </Field>
                  <Field title="Daily shortlist starts at (hour, 0–23)">
                    <input
                      name="shortlistHour"
                      type="number"
                      min={0}
                      max={23}
                      defaultValue={data.settings.shortlistHour}
                      className={field}
                      required
                    />
                  </Field>
                  <p className="text-xs text-zinc-500">
                    Social runs request up to 20 posts with a $0.50 provider
                    charge ceiling per run. Daily run caps limit usage, not your
                    entire Apify account bill. AI charges depend on the
                    configured model. Set a limit to zero to pause that work.
                  </p>
                  <ul className="space-y-1 text-sm text-zinc-400">
                    {data.usage.map((u) => (
                      <li key={u.kind}>
                        {label(u.kind)} today: {u._count}
                        {u._sum.costUsd != null
                          ? ` · $${u._sum.costUsd.toFixed(3)} reported`
                          : ""}
                      </li>
                    ))}
                  </ul>
                  <button className={primary} disabled={busy}>
                    Save automation limits
                  </button>
                </form>
                <div className="space-y-4">
                  <h2 className="text-lg font-semibold">State preferences</h2>
                  {!currentState ? (
                    <p className="text-sm text-zinc-400">
                      Choose a state above to edit its locations, exclusions,
                      and shortlist target.
                    </p>
                  ) : (
                    <form
                      key={currentState.code}
                      className="space-y-4 rounded-xl border border-zinc-800 p-5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void save({
                          action: "state.save",
                          code: currentState.code,
                          keywords: f.get("keywords"),
                          excludedKeywords: f.get("excludedKeywords"),
                          dailyTarget: Number(f.get("dailyTarget")),
                          enabled: f.get("enabled") === "on",
                        });
                      }}
                    >
                      <h3 className="font-medium">{currentState.name}</h3>
                      <Field title="Location keywords (comma-separated)">
                        <textarea
                          className={field}
                          name="keywords"
                          defaultValue={currentState.keywords}
                          rows={4}
                          required
                          maxLength={3000}
                        />
                      </Field>
                      <Field title="Exclude phrases (comma-separated)">
                        <textarea
                          className={field}
                          name="excludedKeywords"
                          defaultValue={currentState.excludedKeywords}
                          rows={2}
                          maxLength={2000}
                        />
                      </Field>
                      <Field title="Daily shortlist and new-brief target">
                        <input
                          className={field}
                          name="dailyTarget"
                          type="number"
                          min={1}
                          max={50}
                          defaultValue={currentState.dailyTarget}
                          required
                        />
                      </Field>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="enabled"
                          defaultChecked={currentState.enabled}
                        />
                        Collect content for this state
                      </label>
                      <button className={primary} disabled={busy}>
                        Save state preferences
                      </button>
                    </form>
                  )}
                </div>
              </section>
            )}
            <p className="text-xs text-zinc-600">
              Times shown in {timezone}. Posting remains manual; approving a
              brief does not publish it.
            </p>
          </>
        )
      )}
      <Dialog
        open={!!sourceForm}
        onOpenChange={(open) => {
          if (!open && !busy) setSourceForm(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto border-zinc-700 bg-zinc-900 text-zinc-100">
          <DialogHeader>
            <DialogTitle>
              {sourceForm?.id
                ? "Edit tracked source"
                : "Track a source or account"}
            </DialogTitle>
          </DialogHeader>
          {sourceForm && (
            <form
              className="space-y-4"
              onSubmit={async (e: FormEvent) => {
                e.preventDefault();
                if (await save({ action: "source.save", ...sourceForm }, true))
                  setSourceForm(null);
              }}
            >
              {formError && (
                <p role="alert" className="text-sm text-red-300">
                  {formError}
                </p>
              )}
              <Field title="State">
                <select
                  className={field}
                  value={sourceForm.stateCode}
                  onChange={(e) =>
                    setSourceForm({ ...sourceForm, stateCode: e.target.value })
                  }
                >
                  {data?.states.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field title="Source type">
                <select
                  className={field}
                  value={sourceForm.kind}
                  onChange={(e) =>
                    setSourceForm({
                      ...sourceForm,
                      kind: e.target.value,
                      intervalMinutes: ["TIKTOK", "INSTAGRAM"].includes(
                        e.target.value,
                      )
                        ? 240
                        : 60,
                    })
                  }
                >
                  {SOURCE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k === "WEBPAGE" ? "Web page (watch changes)" : label(k)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field title="Display name">
                <input
                  className={field}
                  value={sourceForm.name}
                  onChange={(e) =>
                    setSourceForm({ ...sourceForm, name: e.target.value })
                  }
                  maxLength={120}
                  required
                  placeholder="Local news channel or creator"
                />
              </Field>
              <Field
                title={
                  sourceForm.kind === "TIKTOK" ||
                  sourceForm.kind === "INSTAGRAM"
                    ? "Public profile URL or @username"
                    : "Feed, channel, playlist, or page URL"
                }
              >
                <input
                  className={field}
                  value={sourceForm.url}
                  onChange={(e) =>
                    setSourceForm({ ...sourceForm, url: e.target.value })
                  }
                  maxLength={2000}
                  required
                  placeholder="https://…"
                />
              </Field>
              <Field title="Category">
                <select
                  className={field}
                  value={sourceForm.category}
                  onChange={(e) =>
                    setSourceForm({ ...sourceForm, category: e.target.value })
                  }
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c === "AUTO" ? "Detect from content" : label(c)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field title="Check every (minutes)">
                <input
                  className={field}
                  type="number"
                  min={
                    ["TIKTOK", "INSTAGRAM"].includes(sourceForm.kind) ? 240 : 30
                  }
                  max={10080}
                  value={sourceForm.intervalMinutes}
                  onChange={(e) =>
                    setSourceForm({
                      ...sourceForm,
                      intervalMinutes: Number(e.target.value),
                    })
                  }
                  required
                />
              </Field>
              <p className="text-xs text-zinc-400">
                Only public content is collected. Posts must match the state’s
                location keywords. Social tracking uses your Apify account and
                respects the daily run limit.
              </p>
              <button className={primary} disabled={busy}>
                {busy ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Plus size={16} />
                )}
                Save source
              </button>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={manual}
        onOpenChange={(open) => {
          if (!busy) setManual(open);
        }}
      >
        <DialogContent className="border-zinc-700 bg-zinc-900 text-zinc-100">
          <DialogHeader>
            <DialogTitle>Add content for your team</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (
                await save(
                  {
                    action: "manual.add",
                    stateCode: f.get("stateCode"),
                    url: f.get("url"),
                    title: f.get("title"),
                    notes: f.get("notes"),
                  },
                  true,
                )
              )
                setManual(false);
            }}
          >
            {formError && (
              <p role="alert" className="text-sm text-red-300">
                {formError}
              </p>
            )}
            <Field title="State">
              <select
                className={field}
                name="stateCode"
                defaultValue={state || "SC"}
              >
                {data?.states.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field title="Article, video, or social post URL">
              <input
                className={field}
                name="url"
                type="url"
                required
                placeholder="https://…"
                maxLength={2000}
              />
            </Field>
            <Field title="Story title">
              <input className={field} name="title" required maxLength={500} />
            </Field>
            <Field title="What should the team know?">
              <textarea
                className={field}
                name="notes"
                rows={4}
                maxLength={4000}
                placeholder="What happened, why it matters, and any facts that need checking."
              />
            </Field>
            <p className="text-xs text-zinc-400">
              The link and your notes enter the review queue. To keep checking
              an account or website, use Track a source.
            </p>
            <button className={primary} disabled={busy}>
              Add to review queue
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
