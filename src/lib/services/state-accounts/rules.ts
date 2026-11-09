import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export function validTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function nextMidnight(after: Date, timezone: string): Date {
  const date = formatInTimeZone(after, timezone, "yyyy-MM-dd");
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return fromZonedTime(`${next.toISOString().slice(0, 10)}T00:00:00`, timezone);
}

export function target(value: unknown, nullable = false): number | null {
  if (nullable && (value === null || value === "")) return null;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 1440
  ) {
    throw new Error("Targets must be whole numbers between 0 and 1440.");
  }
  return value;
}

// Initial discovery of an old video establishes a baseline, never a spike.
export function observedGain(
  current: bigint,
  previous: bigint | null,
  isNewToday: boolean,
): bigint {
  if (previous === null) return isNewToday ? current : BigInt(0);
  return current > previous ? current - previous : BigInt(0);
}

export function meetsTargets(row: {
  posts: number;
  postsTarget: number;
  warmupMinutes: number;
  warmupTarget: number;
}): boolean {
  return row.posts >= row.postsTarget && row.warmupMinutes >= row.warmupTarget;
}

/** Union observed runtime intervals: repeated polls and stop events count once. */
export function runtimeMinutes(
  samples: { observedAt: Date; runtimeSecs: number }[],
  start: Date,
  end: Date,
): number {
  const intervals = samples
    .map((s) => [
      Math.max(start.getTime(), s.observedAt.getTime() - s.runtimeSecs * 1000),
      Math.min(end.getTime(), s.observedAt.getTime()),
    ])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  let total = 0,
    left = 0,
    right = 0;
  for (const [a, b] of intervals) {
    if (a > right) {
      total += right - left;
      left = a;
      right = b;
    } else right = Math.max(right, b);
  }
  return Math.floor((total + right - left) / 60000);
}

export function discoveryLimit(
  raw = process.env.STATE_SYNC_MAX_VIDEOS,
): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0
    ? Math.min(1000, Math.max(20, Math.floor(value)))
    : 100;
}
