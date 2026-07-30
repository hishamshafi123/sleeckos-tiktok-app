// Pure, side-effect-free helpers for Bulk Link Sourcing.
// No imports — safe to unit-test standalone (see scratch/).

// ── Link parsing / normalization ─────────────────────────────────────────────

export interface ParsedLink {
  url: string;
  normalizedUrl: string;
  videoId: string | null;
  alreadyUsed: boolean;
}

export interface InvalidLink {
  url: string;
  reason: string;
}

export interface ParseLinksResult {
  valid: ParsedLink[];
  invalid: InvalidLink[];
  newCount: number;
  dupCount: number;
}

const SHORT_LINK_HOSTS = new Set(["vm.tiktok.com", "vt.tiktok.com"]);

/**
 * Normalizes a single TikTok video URL.
 * - Full URLs (tiktok.com/@user/video/<id>): scheme/host canonicalized to
 *   https://www.tiktok.com, query params stripped, videoId extracted.
 * - Short links (vm./vt.tiktok.com/<code>, tiktok.com/t/<code>): kept as-is,
 *   only scheme/host normalized and query stripped.
 * Returns { error } for anything that is not a supported TikTok video URL.
 */
export function normalizeTikTokUrl(
  raw: string
): { normalizedUrl: string; videoId: string | null } | { error: string } {
  const token = raw.trim();
  if (!token) return { error: "empty link" };

  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(token) ? token : `https://${token}`);
  } catch {
    return { error: "not a valid URL" };
  }

  const host = parsed.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
  const path = parsed.pathname.replace(/\/+$/, "");

  if (SHORT_LINK_HOSTS.has(host)) {
    const m = path.match(/^\/([A-Za-z0-9]+)$/);
    if (!m) return { error: "unsupported TikTok short-link format" };
    return { normalizedUrl: `https://${host}/${m[1]}`, videoId: null };
  }

  if (host === "tiktok.com") {
    const video = path.match(/^\/@([^/]+)\/video\/(\d+)$/i);
    if (video) {
      return {
        normalizedUrl: `https://www.tiktok.com/@${video[1].toLowerCase()}/video/${video[2]}`,
        videoId: video[2],
      };
    }
    const t = path.match(/^\/t\/([A-Za-z0-9]+)$/i);
    if (t) {
      return { normalizedUrl: `https://www.tiktok.com/t/${t[1]}`, videoId: null };
    }
    return { error: "not a TikTok video URL (expected /@user/video/<id> or a short link)" };
  }

  return { error: "not a TikTok URL" };
}

/**
 * Splits pasted text on whitespace/commas, normalizes each token, validates,
 * dedupes within the paste, and flags links already present in
 * `historyNormalizedUrls` (prior downloaded/assigned/uploaded videos).
 */
export function parseLinksPure(
  text: string,
  historyNormalizedUrls: Set<string>
): ParseLinksResult {
  const tokens = text.split(/[\s,]+/).filter(Boolean);
  const valid: ParsedLink[] = [];
  const invalid: InvalidLink[] = [];
  const seenInPaste = new Set<string>();
  let dupCount = 0;

  for (const token of tokens) {
    const result = normalizeTikTokUrl(token);
    if ("error" in result) {
      invalid.push({ url: token, reason: result.error });
      continue;
    }
    if (seenInPaste.has(result.normalizedUrl)) {
      dupCount++;
      continue;
    }
    seenInPaste.add(result.normalizedUrl);
    valid.push({
      url: token,
      normalizedUrl: result.normalizedUrl,
      videoId: result.videoId,
      alreadyUsed: historyNormalizedUrls.has(result.normalizedUrl),
    });
  }

  return {
    valid,
    invalid,
    newCount: valid.filter((v) => !v.alreadyUsed).length,
    dupCount,
  };
}

// ── yt-dlp error classification ──────────────────────────────────────────────

export type DownloadErrorCategory =
  | "private"
  | "unavailable"
  | "rate_limited"
  | "network/transient";

/**
 * Classifies a yt-dlp failure from its stderr text into a stable category:
 * private/login-required → "private", not-found → "unavailable",
 * rate-limit/429 → "rate_limited", everything else → "network/transient".
 * The returned message always carries the real stderr excerpt.
 */
export function classifyYtDlpError(
  stderr: string,
  timedOut = false
): { category: DownloadErrorCategory; message: string } {
  if (timedOut) {
    return {
      category: "network/transient",
      message: "network/transient: yt-dlp timed out after 180s",
    };
  }
  const text = (stderr || "").trim();
  const excerpt = text.split("\n").slice(-3).join(" | ").slice(0, 300) || "unknown yt-dlp error";

  let category: DownloadErrorCategory = "network/transient";
  if (/429|too many requests|rate.?limit/i.test(text)) {
    category = "rate_limited";
  } else if (/private|login.?required|log ?in|sign ?in|cookies|authentication/i.test(text)) {
    category = "private";
  } else if (/404|not found|does not exist|removed|deleted|no longer available|unavailable/i.test(text)) {
    category = "unavailable";
  }
  return { category, message: `${category}: ${excerpt}` };
}

// ── Distribution planning ────────────────────────────────────────────────────

export interface PlanAccount {
  accountId: string;
  driveFolderId: string;
  driveFolderName: string | null;
}

export interface PlanEntry {
  sourcedVideoId: string;
  accountId: string;
  driveFolderId: string;
  driveFolderName: string | null;
}

export interface DistributionPlanResult {
  plan: PlanEntry[];
  feasibility: {
    available: number;
    requested: number;
    shortfall: { accountId: string; missing: number }[];
    ok: boolean;
  };
}

function shuffle<T>(arr: T[], random: () => number): T[] {
  // Fisher-Yates
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Builds a distribution plan for downloaded videos across accounts.
 * Default (allowReuse=false): each video goes to exactly ONE account —
 * accounts are filled round-robin from a shuffled pool; any requested count
 * beyond the available pool is reported per-account in `shortfall` (never
 * silently under-filled). With allowReuse=true the pool is cycled so counts
 * are always satisfied (as long as at least one video is available).
 */
export function buildDistributionPlan(
  videoIds: string[],
  accountCounts: { accountId: string; count: number }[],
  accountById: Map<string, PlanAccount>,
  allowReuse = false,
  random: () => number = Math.random
): DistributionPlanResult {
  const available = videoIds.length;
  const requested = accountCounts.reduce((sum, a) => sum + Math.max(0, a.count), 0);
  const assignedByAccount = new Map<string, number>();
  const plan: PlanEntry[] = [];

  const pool = shuffle([...videoIds], random);

  // Round-robin slots so accounts fill up evenly rather than sequentially.
  const remaining = accountCounts.map((a) => ({
    accountId: a.accountId,
    left: Math.max(0, a.count),
  }));

  let slotsFilled = 0;
  let madeProgress = true;
  while (madeProgress) {
    madeProgress = false;
    for (const slot of remaining) {
      if (slot.left <= 0) continue;
      const account = accountById.get(slot.accountId);
      if (!account || !account.driveFolderId) continue; // unfillable — counted as shortfall below
      if (!allowReuse && slotsFilled >= available) continue;
      if (available === 0) break;

      const videoId = allowReuse ? pool[slotsFilled % available] : pool[slotsFilled];
      plan.push({
        sourcedVideoId: videoId,
        accountId: account.accountId,
        driveFolderId: account.driveFolderId,
        driveFolderName: account.driveFolderName,
      });
      assignedByAccount.set(slot.accountId, (assignedByAccount.get(slot.accountId) || 0) + 1);
      slot.left--;
      slotsFilled++;
      madeProgress = true;
    }
  }

  const shortfall = accountCounts
    .map((a) => ({
      accountId: a.accountId,
      missing: Math.max(0, a.count) - (assignedByAccount.get(a.accountId) || 0),
    }))
    .filter((s) => s.missing > 0);

  return {
    plan,
    feasibility: {
      available,
      requested,
      shortfall,
      ok: shortfall.length === 0,
    },
  };
}
