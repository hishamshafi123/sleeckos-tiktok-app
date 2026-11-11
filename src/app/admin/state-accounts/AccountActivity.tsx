"use client";
import { useEffect, useState } from "react";
import type { statePosts } from "@/lib/services/state-accounts/posts";
import type { stateWarmup } from "@/lib/services/state-accounts/warmup";
type Posts = NonNullable<Awaited<ReturnType<typeof statePosts>>>;
type Warmup = NonNullable<Awaited<ReturnType<typeof stateWarmup>>>;
const button =
  "rounded border border-zinc-700 px-3 py-1 text-xs hover:bg-zinc-800 disabled:opacity-40";
export default function AccountActivity({
  account,
  day,
  kind,
  refreshKey,
}: {
  account: string;
  day: string;
  kind: "posts" | "warmup";
  refreshKey: string;
}) {
  const [result, setResult] = useState<Posts | Warmup | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  // Keep pagination on the same rolling window even while the clock advances.
  const [asOf] = useState(() => new Date().toISOString());
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({
        account,
        day,
        window: "24h",
        page: String(page),
        asOf,
      });
      fetch(`/api/admin/state-accounts/${kind}?${params}`, {
        signal: controller.signal,
        cache: "no-store",
      })
        .then(async (response) => {
          const body = await response.json();
          if (!response.ok)
            throw new Error(body.error || "Could not load account activity.");
          return body;
        })
        .then((body) => {
          if (!controller.signal.aborted) setResult(body);
        })
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
  }, [account, day, kind, page, retry, refreshKey, asOf]);
  const time = (value: string, timezone: string) =>
    new Date(value).toLocaleString("en-GB", {
      timeZone: timezone,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZoneName: "shortOffset",
    });
  const duration = (seconds: number) =>
    `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return (
    <div className="space-y-3 p-5" aria-live="polite">
      <h3 className="font-medium">
        {kind === "posts"
          ? "Posts · last 24 hours"
          : "Warm-up · today’s observed sessions"}
      </h3>
      {loading ? (
        <p className="text-zinc-400">Loading activity…</p>
      ) : error ? (
        <div role="alert" className="text-amber-300">
          {error}{" "}
          <button className={button} onClick={() => setRetry((v) => v + 1)}>
            Retry
          </button>
        </div>
      ) : (
        result &&
        ("posts" in result ? (
          <>
            <p className="text-xs text-zinc-400">
              {result.total} posts ·{" "}
              {time(result.day.startsAt, result.day.timezone)} –{" "}
              {time(result.day.endsAt, result.day.timezone)} ·{" "}
              {result.day.timezone}
            </p>
            <p className="text-xs text-zinc-500">
              Publication times from the platform; checked hourly. The row’s KPI
              counts today only, so it can differ from this 24-hour window.
            </p>
            {!result.posts.length ? (
              <p className="text-zinc-400">No posts recorded in this window.</p>
            ) : (
              <ul className="divide-y divide-zinc-800">
                {result.posts.map((p) => (
                  <li
                    key={p.videoId}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div>
                      <p>{time(p.publishedAt, result.day.timezone)}</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {Number(p.views).toLocaleString()} views ·{" "}
                        {Number(p.likes).toLocaleString()} likes
                        {p.unavailable ? " · Currently unavailable" : ""}
                      </p>
                    </div>
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-300 hover:underline"
                    >
                      View post ↗
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {result.total > 50 && (
              <div className="flex items-center gap-3">
                <button
                  className={button}
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </button>
                <span>
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
        ) : (
          <>
            <p className="text-xs text-zinc-400">
              {result.label} · {result.timezone}
            </p>
            <div className="flex flex-wrap gap-6">
              <p>
                <strong>{duration(result.totalSeconds)}</strong> observed open
                time
              </p>
              <p>
                <strong>{result.opens}</strong> observed opens today
              </p>
              <p>
                <strong>{result.sessions.length}</strong> observed sessions
              </p>
            </div>
            <p className="max-w-3xl text-xs text-zinc-500">
              Estimated from Guardian runtime checks. Overlapping observations
              are combined; short sessions between checks may be missed.
              Durations count only time within this reporting day. “Last
              observed” is not an exact closing time.
            </p>
            {result.lastSeenAt && (
              <p className="text-xs text-zinc-400">
                Last phone check: {time(result.lastSeenAt, result.timezone)} ·{" "}
                {result.runningAtLastCheck
                  ? "Running at that check"
                  : "Not running at that check"}
              </p>
            )}
            {!result.sessions.length ? (
              <p className="text-zinc-400">
                {result.linked
                  ? "No warm-up sessions recorded for this day yet."
                  : "No Guardian phone was linked for this reporting day."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-zinc-400">
                    <tr>
                      <th className="py-2 pr-4">Estimated opened</th>
                      <th className="py-2 pr-4">Last observed</th>
                      <th className="py-2">Duration today</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.sessions.map((s, i) => (
                      <tr key={i} className="border-t border-zinc-800">
                        <td className="py-3 pr-4">
                          {time(s.openedAt, result.timezone)}
                          {s.carriedOver && (
                            <span className="block text-zinc-500">
                              Continued from previous day
                            </span>
                          )}
                        </td>
                        <td className="py-3 pr-4">
                          {time(s.lastObservedAt, result.timezone)}
                        </td>
                        <td className="py-3 tabular-nums">
                          {duration(s.seconds)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ))
      )}
    </div>
  );
}
