/** Merge observed runtime windows. These are inferred sessions, not an open-event log. */
export function observedSessions(
  samples: { observedAt: Date; runtimeSecs: number }[],
  start: Date,
  end: Date,
) {
  const windows = samples
    .filter((s) => Number.isFinite(s.runtimeSecs) && s.runtimeSecs > 0)
    .map((s) => ({
      start: s.observedAt.getTime() - s.runtimeSecs * 1000,
      end: s.observedAt.getTime(),
    }))
    .filter((s) => s.end > start.getTime() && s.start < end.getTime())
    .sort((a, b) => a.start - b.start);
  const merged: typeof windows = [];
  for (const window of windows) {
    const last = merged.at(-1);
    if (last && window.start <= last.end)
      last.end = Math.max(last.end, window.end);
    else merged.push({ ...window });
  }
  return merged
    .map((s) => ({
      openedAt: new Date(s.start).toISOString(),
      lastObservedAt: new Date(Math.min(s.end, end.getTime())).toISOString(),
      seconds: Math.floor(
        (Math.min(s.end, end.getTime()) - Math.max(s.start, start.getTime())) /
          1000,
      ),
      carriedOver: s.start < start.getTime(),
    }))
    .reverse();
}
