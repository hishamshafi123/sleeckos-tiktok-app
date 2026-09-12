/**
 * Manual link add — operator pastes TikTok video URLs into a campaign; the
 * system creates TrackedVideo rows and immediately pulls current stats from
 * the provider (one batched actor call per run), so views/likes land right
 * away and the links join the normal refresh rotation from then on.
 *
 * Rules:
 *  - Canonical URLs (tiktok.com/@user/video/<id>) parse directly; short links
 *    (vm./vt./tiktok.com/t/) are resolved through their redirect first.
 *  - A video already tracked ANYWHERE (any campaign) is reported a duplicate —
 *    tiktokVideoId is globally unique, never re-attributed.
 *  - The video's account must be a Managed Account (matched by @username,
 *    case-insensitive) — TrackedVideo.accountId is required, and unmanaged
 *    accounts are out of scope for campaign tracking.
 *  - Videos the provider reports deleted/private are stored as "unavailable".
 */

import prisma from "@/lib/db";
import type { AnalyticsProvider, ProviderCallContext } from "./provider";
import { analyticsProvider } from "./resilient";
import { applyStatsUpdate } from "./refresh";
import { getOrgTimezone } from "@/lib/services/timezone";

const MAX_LINKS_PER_RUN = 50;
const SHORT_LINK_TIMEOUT_MS = 10_000;

const CANONICAL_RE = /tiktok\.com\/@([A-Za-z0-9_.-]+)\/video\/(\d{6,})/;
const SHORT_RE = /(?:vm|vt)\.tiktok\.com\/[A-Za-z0-9]+|tiktok\.com\/t\/[A-Za-z0-9]+/;

export interface ManualLinkResult {
  input: string;
  status: "added" | "duplicate" | "unavailable" | "failed";
  url?: string;
  views?: number;
  reason?: string;
}

export interface ManualLinkSummary {
  added: number;
  duplicates: number;
  unavailable: number;
  failed: number;
  results: ManualLinkResult[];
}

interface ParsedLink {
  input: string;
  username: string;
  videoId: string;
  canonicalUrl: string;
}

/** Extract every plausible TikTok URL/token from pasted free text. */
function extractCandidates(rawText: string): string[] {
  const tokens = rawText
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return tokens.filter((t) => CANONICAL_RE.test(t) || SHORT_RE.test(t));
}

/** Follow a short link to its canonical @user/video/<id> URL (server-side). */
async function resolveShortLink(url: string): Promise<string | null> {
  const full = url.startsWith("http") ? url : `https://${url}`;
  try {
    const res = await fetch(full, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(SHORT_LINK_TIMEOUT_MS),
      headers: { "user-agent": "Mozilla/5.0 (compatible; SleeckOS link resolver)" },
    });
    return res.url;
  } catch {
    return null;
  }
}

export async function addManualLinks(
  campaignId: string,
  rawText: string,
  provider: AnalyticsProvider = analyticsProvider
): Promise<ManualLinkSummary> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true },
  });
  if (!campaign) throw new Error("Campaign not found");

  const candidates = extractCandidates(rawText);
  if (candidates.length === 0) throw new Error("No TikTok video links found in the input");
  if (candidates.length > MAX_LINKS_PER_RUN) {
    throw new Error(`Too many links — ${candidates.length} found, max ${MAX_LINKS_PER_RUN} per run`);
  }

  const results: ManualLinkResult[] = [];

  // ── 1. Parse + resolve (short links follow their redirect) ──────────────
  const parsed: ParsedLink[] = [];
  const seenIds = new Set<string>();
  for (const input of candidates) {
    let match = input.match(CANONICAL_RE);
    if (!match && SHORT_RE.test(input)) {
      const resolved = await resolveShortLink(input);
      if (resolved) match = resolved.match(CANONICAL_RE);
    }
    if (!match) {
      results.push({ input, status: "failed", reason: "Could not resolve to a TikTok video URL" });
      continue;
    }
    const [, username, videoId] = match;
    if (seenIds.has(videoId)) {
      results.push({ input, status: "duplicate", reason: "Listed twice in this paste" });
      continue;
    }
    seenIds.add(videoId);
    parsed.push({
      input,
      username,
      videoId,
      canonicalUrl: `https://www.tiktok.com/@${username}/video/${videoId}`,
    });
  }

  // ── 2. Skip videos already tracked (any campaign) ────────────────────────
  const existing = parsed.length
    ? await prisma.trackedVideo.findMany({
        where: { tiktokVideoId: { in: parsed.map((p) => p.videoId) } },
        select: { tiktokVideoId: true },
      })
    : [];
  const existingIds = new Set(existing.map((e) => e.tiktokVideoId));
  const fresh: ParsedLink[] = [];
  for (const p of parsed) {
    if (existingIds.has(p.videoId)) {
      results.push({
        input: p.input,
        status: "duplicate",
        url: p.canonicalUrl,
        reason: "Already tracked",
      });
    } else {
      fresh.push(p);
    }
  }

  // ── 3. Resolve managed accounts (username → ManagedAccount) ─────────────
  const accounts = fresh.length
    ? await prisma.managedAccount.findMany({
        where: { tiktokUsername: { in: [...new Set(fresh.map((p) => p.username))], mode: "insensitive" } },
        select: { id: true, tiktokUsername: true },
      })
    : [];
  const accountByUsername = new Map(accounts.map((a) => [a.tiktokUsername.toLowerCase(), a.id]));

  const creatable: (ParsedLink & { accountId: string })[] = [];
  for (const p of fresh) {
    const accountId = accountByUsername.get(p.username.toLowerCase());
    if (!accountId) {
      results.push({
        input: p.input,
        status: "failed",
        url: p.canonicalUrl,
        reason: `@${p.username} is not a managed account`,
      });
    } else {
      creatable.push({ ...p, accountId });
    }
  }

  // ── 4. Create rows, then pull stats in ONE batched provider call ─────────
  const now = new Date();
  const timezone = await getOrgTimezone();

  const raceLost = new Set<string>();
  for (const p of creatable) {
    try {
      await prisma.trackedVideo.create({
        data: {
          tiktokVideoId: p.videoId,
          url: p.canonicalUrl,
          accountId: p.accountId,
          campaignId,
          postJobId: null,
          publishedAt: now, // replaced by the video's real createTime below when returned
          captureMethod: "manual",
          confidence: "high",
          status: "captured",
        },
      });
    } catch {
      // Lost a race with the automatic capture path — it created the row first.
      raceLost.add(p.videoId);
      results.push({
        input: p.input,
        status: "duplicate",
        url: p.canonicalUrl,
        reason: "Already tracked (captured just now)",
      });
    }
  }

  const createdLinks = creatable.filter((p) => !raceLost.has(p.videoId));

  if (createdLinks.length > 0) {
    const manualCtx: ProviderCallContext = { source: "manual_add", refId: campaignId };
    const stats = await provider.fetchStatsForVideoUrls(
      createdLinks.map((p) => p.canonicalUrl),
      manualCtx
    );

    for (const p of createdLinks) {
      const row = await prisma.trackedVideo.findUnique({
        where: { tiktokVideoId: p.videoId },
        select: { id: true },
      });
      if (!row) continue;

      const s = stats.get(p.videoId);
      if (!s) {
        // Provider said nothing (transient) — row stays at 0 views and joins
        // the normal refresh rotation, which will fill stats on the next pass.
        results.push({
          input: p.input,
          status: "added",
          url: p.canonicalUrl,
          views: 0,
          reason: "Added — stats pending (provider miss, will refresh automatically)",
        });
        continue;
      }
      if ("unavailable" in s) {
        await prisma.trackedVideo.update({
          where: { id: row.id },
          data: { status: "unavailable" },
        });
        results.push({
          input: p.input,
          status: "unavailable",
          url: p.canonicalUrl,
          reason: "Video is deleted or private on TikTok",
        });
        continue;
      }

      await applyStatsUpdate(row.id, s, timezone, now, manualCtx.usedProvider);
      if (s.createTime) {
        await prisma.trackedVideo.update({
          where: { id: row.id },
          data: { publishedAt: s.createTime },
        });
      }
      results.push({
        input: p.input,
        status: "added",
        url: p.canonicalUrl,
        views: Number(s.views),
      });
    }
  }

  const summary: ManualLinkSummary = {
    added: results.filter((r) => r.status === "added").length,
    duplicates: results.filter((r) => r.status === "duplicate").length,
    unavailable: results.filter((r) => r.status === "unavailable").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  };
  console.log(
    `[ManualLinks] Campaign ${campaignId}: added=${summary.added} dupes=${summary.duplicates} unavailable=${summary.unavailable} failed=${summary.failed}`
  );
  return summary;
}
