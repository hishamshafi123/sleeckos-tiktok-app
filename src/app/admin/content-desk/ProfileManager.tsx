"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronRight,
  ExternalLink,
  Film,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";

export type TrackedProfile = {
  id: string;
  name: string;
  stateCode: string;
  kind: string;
  url: string;
  createdBy: string | null;
  enabled: boolean;
  errorMessage: string | null;
  pendingRunId: string | null;
  lastSuccessAt: string | null;
  nextRunAt: string;
  intervalMinutes: number;
  trackedPostCount: number;
  lastPostAt: string | null;
  includeAllPosts: boolean;
  profileHandle: string | null;
  category: string;
};

type TrackedPost = {
  id: string;
  url: string;
  caption: string;
  thumbnailUrl: string | null;
  mediaType: string;
  duration: number | null;
  publishedAt: string | null;
  views: string | null;
  likes: string | null;
  story: { id: string; title: string; status: string } | null;
};

const button =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40";
const primary = `${button} border-blue-500 bg-blue-600 text-white hover:bg-blue-500`;
const full = (value: string | null) =>
  value === null ? "—" : Number(value).toLocaleString("en-US");

export default function ProfileManager({
  profiles,
  states,
  generatedAt,
  timezone,
  userId,
  isAdmin,
  busy,
  onSave,
  onAdd,
  onEdit,
  onOpenStory,
}: {
  profiles: TrackedProfile[];
  states: { code: string; name: string }[];
  generatedAt: string;
  timezone: string;
  userId: string;
  isAdmin: boolean;
  busy: boolean;
  onSave: (
    payload: Record<string, unknown>,
    modal?: boolean,
  ) => Promise<boolean>;
  onAdd: () => void;
  onEdit: (profile: TrackedProfile) => void;
  onOpenStory: (storyId: string, stateCode?: string) => void;
}) {
  const [platform, setPlatform] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [posts, setPosts] = useState<TrackedPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsError, setPostsError] = useState("");
  const [removeId, setRemoveId] = useState("");
  const [actionId, setActionId] = useState("");
  const selected = profiles.find((profile) => profile.id === selectedId);
  const visible = profiles.filter(
    (profile) => !platform || profile.kind === platform,
  );

  const loadPosts = useCallback(async (profileId: string) => {
    try {
      const response = await fetch(
        `/api/admin/content-desk?profile=${profileId}`,
        {
          cache: "no-store",
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Latest posts could not load.");
      setPosts(result.profilePosts || []);
      setPostsError("");
    } catch (error) {
      setPostsError(
        error instanceof Error ? error.message : "Latest posts could not load.",
      );
    } finally {
      setPostsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const timer = setTimeout(() => void loadPosts(selectedId), 0);
    return () => clearTimeout(timer);
  }, [selectedId, loadPosts]);

  function selectProfile(id: string) {
    setSelectedId(id);
    setPosts([]);
    setPostsError("");
    setPostsLoading(true);
  }

  async function action(id: string, payload: Record<string, unknown>) {
    setActionId(id);
    const saved = await onSave(payload);
    if (saved && payload.action === "profile.promote" && selectedId) {
      await loadPosts(selectedId);
    }
    if (saved && payload.action === "source.remove") {
      setRemoveId("");
      if (selectedId === id) setSelectedId("");
    }
    setActionId("");
  }

  const date = (value: string | null) =>
    value
      ? new Date(value).toLocaleString("en-GB", {
          timeZone: timezone,
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "Not yet";

  return (
    <section className="space-y-4" aria-labelledby="tracked-profiles-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="tracked-profiles-heading" className="text-xl font-semibold">
            Tracked profiles
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">
            Paste a public TikTok or Instagram profile. Its latest posts stay
            here, even when they are not promoted into editorial stories.
          </p>
        </div>
        <button className={primary} onClick={onAdd}>
          <Plus size={16} /> Add profile
        </button>
      </div>

      <div
        className="flex flex-wrap gap-2"
        aria-label="Profile platform filter"
      >
        {[
          ["", "All platforms"],
          ["TIKTOK", "TikTok"],
          ["INSTAGRAM", "Instagram"],
        ].map(([value, text]) => (
          <button
            key={value}
            className={`${button} ${platform === value ? "border-blue-500 bg-blue-500/15" : ""}`}
            onClick={() => setPlatform(value)}
          >
            {text}
          </button>
        ))}
      </div>

      {removeId && (
        <div
          role="alert"
          className="rounded-lg border border-red-900 bg-red-950/20 p-4"
        >
          <p className="font-medium text-red-200">
            Remove this profile from tracking?
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            No new posts will be collected. Existing videos and editorial
            stories remain available.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              className={`${button} border-red-700 text-red-200`}
              disabled={busy}
              onClick={() =>
                void action(removeId, { action: "source.remove", id: removeId })
              }
            >
              <Trash2 size={15} /> Remove tracking
            </button>
            <button className={button} onClick={() => setRemoveId("")}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {visible.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {visible.map((profile) => {
            const canEdit = isAdmin || profile.createdBy === userId;
            const delayed =
              profile.enabled &&
              !profile.errorMessage &&
              !profile.pendingRunId &&
              new Date(profile.nextRunAt).getTime() <
                new Date(generatedAt).getTime() - 10 * 60000;
            const status = !profile.enabled
              ? "Paused"
              : profile.errorMessage
                ? "Needs attention"
                : profile.pendingRunId
                  ? "Collecting"
                  : delayed
                    ? "Delayed"
                    : profile.lastSuccessAt
                      ? "Healthy"
                      : "Queued";
            return (
              <article
                key={profile.id}
                className="rounded-xl border border-zinc-800 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                        {profile.kind === "TIKTOK" ? "TikTok" : "Instagram"}
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${
                          status === "Healthy"
                            ? "bg-teal-950 text-teal-200"
                            : ["Needs attention", "Delayed"].includes(status)
                              ? "bg-amber-950 text-amber-200"
                              : "bg-zinc-800 text-zinc-300"
                        }`}
                      >
                        {status}
                      </span>
                    </div>
                    <h3 className="mt-2 truncate font-medium">
                      {profile.name}
                    </h3>
                    <a
                      href={profile.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-blue-300 hover:underline"
                    >
                      {profile.profileHandle
                        ? `@${profile.profileHandle}`
                        : profile.url}
                    </a>
                  </div>
                  <span className="text-xs text-zinc-500">
                    {states.find((item) => item.code === profile.stateCode)
                      ?.name || profile.stateCode}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-400">
                  <p>
                    <span className="text-zinc-200">
                      {profile.trackedPostCount}
                    </span>{" "}
                    saved {profile.trackedPostCount === 1 ? "post" : "posts"}
                  </p>
                  <p>
                    {profile.includeAllPosts
                      ? "All posts promoted"
                      : "Keyword filtered"}
                  </p>
                  <p>Latest post: {date(profile.lastPostAt)}</p>
                  <p>Last check: {date(profile.lastSuccessAt)}</p>
                </div>
                {profile.errorMessage && (
                  <p
                    role="status"
                    className="mt-3 flex gap-2 rounded bg-red-950/30 p-3 text-sm text-red-200"
                  >
                    <AlertCircle size={16} className="shrink-0" />{" "}
                    {profile.errorMessage}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    className={primary}
                    onClick={() => selectProfile(profile.id)}
                  >
                    <Film size={15} /> Latest videos <ChevronRight size={14} />
                  </button>
                  <button
                    className={button}
                    disabled={!canEdit || busy || !!profile.pendingRunId}
                    onClick={() => onEdit(profile)}
                  >
                    Edit
                  </button>
                  <button
                    className={button}
                    disabled={!canEdit || busy || !profile.enabled}
                    onClick={() =>
                      void action(profile.id, {
                        action: "source.retry",
                        id: profile.id,
                      })
                    }
                  >
                    {actionId === profile.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    Check now
                  </button>
                  <button
                    className={button}
                    disabled={!canEdit || busy}
                    onClick={() =>
                      void action(profile.id, {
                        action: "source.toggle",
                        id: profile.id,
                        enabled: !profile.enabled,
                      })
                    }
                  >
                    {profile.enabled ? <Pause size={14} /> : <Play size={14} />}
                    {profile.enabled ? "Pause" : "Resume"}
                  </button>
                  <button
                    className={`${button} text-red-300`}
                    disabled={!canEdit || busy}
                    onClick={() => setRemoveId(profile.id)}
                  >
                    <Trash2 size={14} /> Remove
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-zinc-700 p-8 text-center">
          <Film className="mx-auto text-blue-400" />
          <h3 className="mt-3 font-medium">No tracked profiles here yet</h3>
          <p className="mt-1 text-sm text-zinc-400">
            Add a public TikTok or Instagram profile for this state.
          </p>
          <button className={`${primary} mt-4`} onClick={onAdd}>
            <Plus size={15} /> Add your first profile
          </button>
        </div>
      )}

      {selected && (
        <section
          className="rounded-xl border border-blue-900/60 bg-zinc-950/60 p-4"
          aria-label={`Latest posts from ${selected.name}`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs text-blue-300">
                {selected.kind === "TIKTOK" ? "TikTok" : "Instagram"} ·{" "}
                {selected.stateCode}
              </p>
              <h3 className="mt-1 text-lg font-semibold">
                Latest videos & posts from {selected.name}
              </h3>
              <p className="mt-1 text-xs text-zinc-500">
                Only metadata is stored until you choose footage for Clip
                Studio.
              </p>
            </div>
            <button
              className={button}
              onClick={() => setSelectedId("")}
              aria-label="Close latest posts"
            >
              <X size={16} />
            </button>
          </div>
          {postsLoading ? (
            <p className="flex gap-2 py-8 text-sm text-zinc-400">
              <Loader2 size={16} className="animate-spin" /> Loading latest
              posts…
            </p>
          ) : postsError ? (
            <div
              role="alert"
              className="mt-4 rounded bg-red-950/30 p-3 text-sm text-red-200"
            >
              {postsError}
              <button
                className="ml-2 underline"
                onClick={() => {
                  setPostsLoading(true);
                  void loadPosts(selected.id);
                }}
              >
                Retry
              </button>
            </div>
          ) : posts.length ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {posts.map((post) => (
                <article
                  key={post.id}
                  className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/50"
                >
                  <a
                    href={post.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block"
                  >
                    {post.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={post.thumbnailUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="aspect-video w-full object-cover"
                      />
                    ) : (
                      <div className="flex aspect-video items-center justify-center bg-zinc-800 text-zinc-500">
                        <Film size={28} />
                      </div>
                    )}
                  </a>
                  <div className="p-3">
                    <div className="flex justify-between gap-2 text-[11px] text-zinc-500">
                      <span>{post.mediaType}</span>
                      <span>{date(post.publishedAt)}</span>
                    </div>
                    <p className="mt-2 line-clamp-3 text-sm text-zinc-200">
                      {post.caption || "No caption supplied"}
                    </p>
                    <p className="mt-2 text-xs text-zinc-500">
                      {full(post.views)} views · {full(post.likes)} likes
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <a
                        href={post.url}
                        target="_blank"
                        rel="noreferrer"
                        className={button}
                      >
                        Original <ExternalLink size={13} />
                      </a>
                      {post.story ? (
                        <button
                          className={primary}
                          onClick={() =>
                            onOpenStory(post.story!.id, selected.stateCode)
                          }
                        >
                          Open story <Check size={13} />
                        </button>
                      ) : (
                        <button
                          className={primary}
                          disabled={busy}
                          onClick={() =>
                            void action(post.id, {
                              action: "profile.promote",
                              id: post.id,
                            })
                          }
                        >
                          {actionId === post.id ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Plus size={13} />
                          )}
                          Create story
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-dashed border-zinc-700 p-6 text-sm text-zinc-400">
              No posts have been collected yet. Use Check now on the profile and
              review any connection message above.
            </div>
          )}
        </section>
      )}
    </section>
  );
}
