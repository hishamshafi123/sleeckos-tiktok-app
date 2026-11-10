"use client";
import { useEffect, useState } from "react";
import type { statePosts } from "@/lib/services/state-accounts/posts";
type History = NonNullable<Awaited<ReturnType<typeof statePosts>>>;
const field =
  "rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:ring-2 focus:ring-blue-400";
const button = `${field} hover:bg-zinc-800 disabled:opacity-40`;
export default function PostHistory({
  days,
  todayId,
  team,
  accounts,
  refreshKey,
}: {
  days: { id: string; label: string; timezone: string }[];
  todayId: string;
  team: string;
  accounts: { accountId: string; stateName: string }[];
  refreshKey: string;
}) {
  const [chosenDay, setDay] = useState("");
  const [account, setAccount] = useState("");
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<History | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const day = chosenDay || todayId;
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({
        day,
        team,
        account,
        page: String(page),
      });
      fetch(`/api/admin/state-accounts/posts?${params}`, {
        signal: controller.signal,
        cache: "no-store",
      })
        .then(async (res) => {
          const body = await res.json();
          if (!res.ok)
            throw new Error(body.error || "Posting history could not load.");
          return body as History;
        })
        .then(setResult)
        .catch((e) => {
          if (!controller.signal.aborted)
            setError(
              e instanceof Error ? e.message : "Could not connect. Retry.",
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [day, team, account, page, retry, refreshKey]);
  const timestamp = (value: string, timezone: string) =>
    new Date(value).toLocaleString("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZoneName: "shortOffset",
    });
  return (
    <section
      aria-labelledby="post-history-heading"
      className="rounded-lg border border-zinc-800 p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="post-history-heading" className="font-medium">
            Posting history
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-zinc-400">
            Actual platform publication times, grouped by the reporting day—not
            when the sync discovered the post. The View team filter applies here
            too.
          </p>
        </div>
        <button
          className={button}
          disabled={loading}
          onClick={() => setRetry((n) => n + 1)}
        >
          Refresh history
        </button>
      </div>
      <div className="my-4 flex flex-wrap gap-3">
        <label className="grid gap-1 text-xs text-zinc-400">
          Reporting day
          <select
            className={field}
            value={day}
            onChange={(e) => {
              setDay(e.target.value);
              setPage(0);
            }}
          >
            {[...days].reverse().map((d) => (
              <option key={d.id} value={d.id}>
                {d.label} · {d.timezone}
                {d.id === todayId ? " · Today" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-zinc-400">
          Account
          <select
            className={field}
            value={account}
            onChange={(e) => {
              setAccount(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.accountId} value={a.accountId}>
                {a.stateName}
              </option>
            ))}
          </select>
        </label>
      </div>
      {loading ? (
        <p role="status" className="text-sm text-zinc-400">
          Loading posting times…
        </p>
      ) : error ? (
        <p role="alert" className="text-sm text-red-300">
          {error}{" "}
          <button className={button} onClick={() => setRetry((n) => n + 1)}>
            Retry
          </button>
        </p>
      ) : (
        result && (
          <>
            <p className="mb-3 text-sm text-zinc-300">
              {result.total} recorded post{result.total === 1 ? "" : "s"} ·{" "}
              {result.day.timezone}
            </p>
            <p className="mb-3 text-xs text-zinc-500">
              Reporting window:{" "}
              {timestamp(result.day.startsAt, result.day.timezone)} →{" "}
              {timestamp(result.day.endsAt, result.day.timezone)} (end
              excluded).
            </p>
            {!result.posts.length ? (
              <p className="text-sm text-zinc-400">
                No posts recorded for this day and selection. Discovery runs
                hourly; check Last sync and account errors before treating this
                as a confirmed zero.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-zinc-800 text-xs text-zinc-400">
                    <tr>
                      {[
                        "State / account",
                        "Team on reporting day",
                        "Published at",
                        "Post",
                        "Last checked",
                      ].map((h) => (
                        <th
                          key={h}
                          className="whitespace-nowrap px-3 py-3 font-medium"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {result.posts.map((p) => (
                      <tr key={p.videoId}>
                        <td className="px-3 py-3">
                          {p.accountName}
                          <div className="text-xs text-zinc-500">
                            @{p.username}
                          </div>
                        </td>
                        <td className="px-3 py-3">{p.teamName}</td>
                        <td className="whitespace-nowrap px-3 py-3 tabular-nums">
                          <time
                            dateTime={p.publishedAt}
                            title={`UTC: ${p.publishedAt}`}
                          >
                            {timestamp(p.publishedAt, result.day.timezone)}
                          </time>
                        </td>
                        <td className="px-3 py-3">
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-300 underline"
                          >
                            Open post ↗
                          </a>
                          <div className="text-xs text-zinc-500">
                            {p.videoId}
                          </div>
                          {p.unavailable && (
                            <div className="text-xs text-amber-300">
                              Unavailable now · remains in posting history
                            </div>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-xs text-zinc-400">
                          {timestamp(p.lastObservedAt, result.day.timezone)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {result.total > 50 && (
              <div className="mt-4 flex items-center gap-3">
                <button
                  className={button}
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </button>
                <span className="text-xs text-zinc-400">
                  Page {page + 1} of {Math.ceil(result.total / 50)}
                </span>
                <button
                  className={button}
                  disabled={(page + 1) * 50 >= result.total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )
      )}
      <p className="mt-4 text-xs leading-relaxed text-zinc-500">
        Each unique post counts once. Late discoveries and verified timestamp
        corrections update the original reporting day. Historical days keep
        their timezone and team assignment; posts before state tracking began
        are not credited to a later day. Deleted/private posts remain evidence
        of past posting.
      </p>
    </section>
  );
}
