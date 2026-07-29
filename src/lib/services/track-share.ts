import crypto from "crypto";
import prisma from "@/lib/db";
import type { CampaignShare } from "@prisma/client";
import { getOrgTimezone, getZonedDateString, getZonedFutureStartOfDay } from "@/lib/services/timezone";

// ─── Share code generation ────────────────────────────────────────────────────
// The code IS the secret — stored in plain text so it can be shown/copied in
// the internal UI. 10 chars from an unambiguous base32-ish alphabet (~50 bits).
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

export function generateShareCode(length = 10): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  }
  return code;
}

// ─── Public share validation ──────────────────────────────────────────────────
// Returns the share row only when it exists, is not revoked and not expired.
export async function findValidShare(code: string): Promise<CampaignShare | null> {
  const normalized = code.trim().toUpperCase();
  if (!normalized || normalized.length > 64) return null;

  const share = await prisma.campaignShare.findUnique({ where: { code: normalized } });
  if (!share) return null;
  if (share.revokedAt) return null;
  if (share.expiresAt && share.expiresAt.getTime() < Date.now()) return null;
  return share;
}

// ─── Light in-memory rate limiter (per process) ──────────────────────────────
// 30 requests / minute / IP for the public lookup + csv endpoints.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

const globalForRateLimit = globalThis as unknown as {
  trackRateLimit?: Map<string, { count: number; resetAt: number }>;
};

export function checkTrackRateLimit(ip: string): boolean {
  const map = (globalForRateLimit.trackRateLimit ??= new Map());
  const now = Date.now();

  // Occasional sweep so the map cannot grow unbounded
  if (map.size > 5000) {
    for (const [key, entry] of map) {
      if (entry.resetAt < now) map.delete(key);
    }
  }

  const entry = map.get(ip);
  if (!entry || entry.resetAt < now) {
    map.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= RATE_LIMIT_MAX;
}

export function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

// ─── Public tracking payload ──────────────────────────────────────────────────
// Mirrors GET /api/campaigns/[id]/tracking minus internal ids and account
// usernames. Read straight from TrackedVideo / VideoStatSnapshot so the public
// endpoints stay independent of the admin tracking route.

export type PublicTrackedVideo = {
  url: string;
  publishedAt: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
};

export type PublicTrackingPayload = {
  campaign: { title: string };
  totals: { posted: number; captured: number; views: number; likes: number; avgViews: number };
  trend: { date: string; views: number; likes: number }[];
  videos: PublicTrackedVideo[];
};

const TREND_DAYS = 30;

export async function getPublicTrackingPayload(campaignId: string): Promise<PublicTrackingPayload | null> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, title: true, name: true, postedCount: true },
  });
  if (!campaign) return null;

  const videos = await prisma.trackedVideo.findMany({
    where: { campaignId },
    select: {
      id: true,
      tiktokVideoId: true,
      url: true,
      publishedAt: true,
      views: true,
      likes: true,
      comments: true,
      shares: true,
      status: true,
    },
    orderBy: { views: "desc" },
  });

  const captured = videos.filter((v) => v.status !== "unresolved");
  const totalViews = captured.reduce((sum, v) => sum + Number(v.views), 0);
  const totalLikes = captured.reduce((sum, v) => sum + Number(v.likes), 0);

  // ── Trend: cumulative views/likes per day (org tz), last 30 days ──
  const tz = await getOrgTimezone();
  const trendStart = getZonedFutureStartOfDay(tz, -(TREND_DAYS - 1));

  const videoIds = videos.map((v) => v.id);
  const snapshots = videoIds.length
    ? await prisma.videoStatSnapshot.findMany({
        where: { trackedVideoId: { in: videoIds } },
        select: { trackedVideoId: true, views: true, likes: true, recordedAt: true },
        orderBy: { recordedAt: "asc" },
      })
    : [];

  // Per-video point series; current counters act as a virtual "now" snapshot
  // so today's point reflects the latest refresh even without a snapshot row.
  const seriesByVideo = new Map<string, { at: number; views: number; likes: number }[]>();
  for (const v of videos) seriesByVideo.set(v.id, []);
  for (const s of snapshots) {
    seriesByVideo.get(s.trackedVideoId)?.push({
      at: s.recordedAt.getTime(),
      views: Number(s.views),
      likes: Number(s.likes),
    });
  }
  const now = Date.now();
  for (const v of videos) {
    seriesByVideo.get(v.id)?.push({ at: now, views: Number(v.views), likes: Number(v.likes) });
  }

  const trend: { date: string; views: number; likes: number }[] = [];
  for (let offset = TREND_DAYS - 1; offset >= 0; offset--) {
    const dayStart = getZonedFutureStartOfDay(tz, -offset);
    const dayEnd = dayStart.getTime() + 24 * 60 * 60 * 1000 - 1;
    let views = 0;
    let likes = 0;
    for (const series of seriesByVideo.values()) {
      // Latest point at or before end of day (series is ascending)
      let point: { views: number; likes: number } | null = null;
      for (const p of series) {
        if (p.at <= dayEnd) point = p;
        else break;
      }
      if (point) {
        views += point.views;
        likes += point.likes;
      }
    }
    trend.push({ date: getZonedDateString(dayStart, tz), views, likes });
  }

  return {
    campaign: { title: campaign.title || campaign.name || "Campaign" },
    totals: {
      posted: campaign.postedCount,
      captured: captured.length,
      views: totalViews,
      likes: totalLikes,
      avgViews: captured.length > 0 ? Math.round(totalViews / captured.length) : 0,
    },
    trend,
    videos: captured.map((v) => ({
      url: v.url,
      publishedAt: v.publishedAt.toISOString(),
      views: Number(v.views),
      likes: Number(v.likes),
      comments: Number(v.comments),
      shares: Number(v.shares),
    })),
  };
}

// ─── CSV (public, auth-by-code) ───────────────────────────────────────────────
function csvEscape(value: string | number): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function publicTrackingCsv(payload: PublicTrackingPayload): string {
  const header = "url,published_at,views,likes,comments,shares";
  const rows = payload.videos.map((v) =>
    [v.url, v.publishedAt, v.views, v.likes, v.comments, v.shares].map(csvEscape).join(",")
  );
  return [header, ...rows].join("\n") + "\n";
}
