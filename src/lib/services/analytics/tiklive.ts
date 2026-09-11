/**
 * TikLiveAPI analytics provider — https://api.tikliveapi.com
 * Primary analytics provider; Apify is the automatic fallback (resilient.ts).
 * Raw fetch, no npm deps.
 *
 * Endpoints used:
 *   GET /userinfo-by-username/?username=X  resolve numeric user id (cached in
 *                                          AppSetting, key tiklive:uid:<username>)
 *   GET /user-posts/?userid=<id>&count=N   latest videos + stats (max 35/call)
 *   GET /post-detail/?url=<video URL>      single video stats (1 credit/URL)
 *
 * Error shape for missing entities is HTTP 200 + {"status":"error","message":
 * "Not found post"} — mapped to not_found so deleted/private videos retire as
 * unavailable instead of being retried forever.
 *
 * Every provider-method call is written to the call ledger (fire-and-forget,
 * actorId "tikliveapi") with an estimated usageUsd from the published price
 * ($9.90 / 100k requests), so the spend analytics stay comparable to Apify.
 *
 * Env:
 *   TIKLIVE_API_KEY      (required)
 *   TIKLIVE_TIMEOUT_MS   per-HTTP-call timeout, default 30000
 *   TIKLIVE_MIN_INTERVAL_MS  min spacing between HTTP calls, default 350
 *                            (keeps the process under the 200 req/min plan cap)
 *   TIKLIVE_COST_PER_CALL estimated USD per request, default 0.000099
 */

import prisma from "@/lib/db";
import { ProviderError } from "./provider";
import type {
  AnalyticsProvider,
  ProviderCallContext,
  ProviderVideo,
  ProviderVideoStats,
} from "./provider";
import { logApifyCall } from "./apify-log";
import { extractVideoIdFromUrl } from "./apify";

const BASE_URL = "https://api.tikliveapi.com";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_COST_PER_CALL = 0.000099; // $9.90 / 100k requests
const MAX_POSTS_PER_CALL = 35; // user-posts page size cap (docs)
const STATS_CONCURRENCY = 5; // parallel post-detail calls (limit: 200 req/min)

function getApiKey(): string {
  const key = process.env.TIKLIVE_API_KEY;
  if (!key) {
    throw new ProviderError(
      "auth",
      "TIKLIVE_API_KEY not set — TikLiveAPI provider is disabled until it is configured"
    );
  }
  return key;
}

function costPerCall(): number {
  const n = Number(process.env.TIKLIVE_COST_PER_CALL);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_COST_PER_CALL;
}

function classifyHttpStatus(status: number): ProviderError["kind"] {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limited";
  return "transient";
}

function toBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
  if (typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v);
  return BigInt(0);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Global request pacer — every TikLiveAPI HTTP call starts at least
 * TIKLIVE_MIN_INTERVAL_MS (default 350ms) after the previous one, keeping the
 * whole process under ~170 requests/min against the plan's 200 req/min cap.
 * Without this, a 25-URL stats batch at concurrency 5 bursts ~300 req/min
 * and gets rate-limited mid-batch.
 */
let nextSlotAt = 0;
async function pace(): Promise<void> {
  const interval = Number(process.env.TIKLIVE_MIN_INTERVAL_MS) || 350;
  const now = Date.now();
  const wait = Math.max(0, nextSlotAt - now);
  nextSlotAt = Math.max(now, nextSlotAt) + interval;
  if (wait > 0) await sleep(wait);
}

/** GET a TikLiveAPI endpoint, returning parsed JSON. Throws ProviderError. */
async function tikliveGet(path: string): Promise<any> {
  const apiKey = getApiKey();
  const timeoutMs = Number(process.env.TIKLIVE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  await pace();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: { "X-Api-Key": apiKey },
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new ProviderError("transient", `TikLiveAPI call timed out after ${timeoutMs}ms`);
    }
    throw new ProviderError("transient", `TikLiveAPI fetch failed: ${err?.message || String(err)}`);
  } finally {
    clearTimeout(timer);
  }
  const raw = await res.text();
  if (!res.ok) {
    const kind = classifyHttpStatus(res.status);
    console.error(`[TikLive] HTTP ${res.status} (classified ${kind}). Body: ${raw.slice(0, 500)}`);
    throw new ProviderError(kind, `TikLiveAPI HTTP ${res.status}: ${raw.slice(0, 200)}`);
  }
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error(`[TikLive] JSON parse failed. Body: ${raw.slice(0, 500)}`);
    throw new ProviderError("transient", "TikLiveAPI returned invalid JSON");
  }
  // Auth/quota failures come back as HTTP 200 + a bare {"message": "..."}
  // (e.g. "Api-Key is not available", "Please sign up to tikliveapi.com") —
  // NOT the {"status":"error"} envelope missing entities use. Catch them
  // here so a dead key escalates to the fallback instead of passing as an
  // empty success.
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const keys = Object.keys(data);
    if (keys.length === 1 && typeof data.message === "string") {
      const msg = data.message.toLowerCase();
      const kind: ProviderError["kind"] = /api.?key|sign up|unauthor/i.test(msg)
        ? "auth"
        : /credit|balance|quota|limit/i.test(msg)
          ? "rate_limited"
          : /not found|private/i.test(msg)
            ? "not_found"
            : "transient";
      console.error(`[TikLive] API error (classified ${kind}): ${data.message}`);
      throw new ProviderError(kind, `TikLiveAPI: ${data.message}`);
    }
  }
  return data;
}

/** True when the response is the {"status":"error",...} envelope. */
function isErrorEnvelope(data: any): boolean {
  return data && typeof data === "object" && data.status === "error";
}

function envelopeKind(data: any): ProviderError["kind"] {
  const msg = String(data?.message ?? "").toLowerCase();
  if (msg.includes("not found") || msg.includes("private")) return "not_found";
  return "transient";
}

/**
 * Resolve a TikTok username to TikLive's numeric user id, cached in
 * AppSetting so each account costs this lookup only once.
 */
async function resolveUserId(username: string): Promise<string> {
  const clean = username.replace(/^@/, "");
  const cacheKey = `tiklive:uid:${clean.toLowerCase()}`;
  try {
    const cached = await prisma.appSetting.findUnique({ where: { key: cacheKey } });
    if (cached?.value) return cached.value;
  } catch (err: any) {
    console.warn(`[TikLive] uid cache read failed for @${clean}: ${err?.message || err}`);
  }

  const data = await tikliveGet(`/userinfo-by-username/?username=${encodeURIComponent(clean)}`);
  if (isErrorEnvelope(data)) {
    throw new ProviderError(envelopeKind(data), `TikLiveAPI userinfo @${clean}: ${data.message}`);
  }
  const id = data?.user?.id != null ? String(data.user.id) : null;
  if (!id) {
    throw new ProviderError("transient", `TikLiveAPI userinfo @${clean} had no user.id`);
  }

  try {
    await prisma.appSetting.upsert({
      where: { key: cacheKey },
      create: { key: cacheKey, value: id },
      update: { value: id },
    });
  } catch (err: any) {
    console.warn(`[TikLive] uid cache write failed for @${clean}: ${err?.message || err}`);
  }
  return id;
}

interface LedgerContext {
  source: string;
  inputType: "account" | "urls";
  inputSummary: string;
  inputCount: number;
}

/** Fire-and-forget ledger write with an estimated per-call cost. */
function logTikliveCall(
  log: LedgerContext,
  opts: { resultCount: number; apiCalls: number; durationMs: number; status: "ok" | "error"; errorKind: string | null }
): void {
  void logApifyCall({
    source: log.source,
    inputType: log.inputType,
    inputSummary: log.inputSummary,
    inputCount: log.inputCount,
    resultCount: opts.resultCount,
    apifyRunId: null,
    actorId: "tikliveapi",
    durationMs: opts.durationMs,
    usageUsd: opts.apiCalls * costPerCall(),
    chargedEventCounts: { requests: opts.apiCalls },
    status: opts.status,
    errorKind: opts.errorKind,
  });
}

export class TikLiveProvider implements AnalyticsProvider {
  /** Latest videos for a TikTok profile, newest first. */
  async fetchLatestVideosForAccount(
    username: string,
    max: number,
    ctx?: ProviderCallContext
  ): Promise<ProviderVideo[]> {
    const clean = username.replace(/^@/, "");
    const startedAt = Date.now();
    let apiCalls = 0;
    let resultCount = 0;
    let status: "ok" | "error" = "ok";
    let errorKind: string | null = null;
    try {
      apiCalls++; // userinfo-by-username (served from local cache when warm)
      const userId = await resolveUserId(clean);

      apiCalls++; // user-posts
      const count = Math.min(Math.max(1, Math.floor(max)), MAX_POSTS_PER_CALL);
      const data = await tikliveGet(
        `/user-posts/?userid=${encodeURIComponent(userId)}&count=${count}`
      );
      if (isErrorEnvelope(data)) {
        throw new ProviderError(envelopeKind(data), `TikLiveAPI user-posts @${clean}: ${data.message}`);
      }
      const items: any[] = Array.isArray(data?.videos) ? data.videos : [];

      const videos: ProviderVideo[] = [];
      for (const item of items) {
        const videoId = item?.video_id != null ? String(item.video_id) : item?.id != null ? String(item.id) : null;
        const ts = Number(item?.create_time);
        const createTime = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : null;
        if (!videoId || !createTime) continue;
        videos.push({
          videoId,
          url: `https://www.tiktok.com/@${clean}/video/${videoId}`,
          createTime,
          text: item?.title != null ? String(item.title) : "",
          views: toBigInt(item.play_count),
          likes: toBigInt(item.digg_count),
          comments: toBigInt(item.comment_count),
          shares: toBigInt(item.share_count),
        });
      }
      videos.sort((a, b) => b.createTime.getTime() - a.createTime.getTime());
      const sliced = videos.slice(0, max);
      resultCount = sliced.length;
      return sliced;
    } catch (err) {
      status = "error";
      errorKind = err instanceof ProviderError ? err.kind : "transient";
      throw err;
    } finally {
      logTikliveCall(
        {
          source: ctx?.source ?? "unknown",
          inputType: "account",
          inputSummary: `@${clean}`,
          inputCount: 1,
        },
        { resultCount, apiCalls, durationMs: Date.now() - startedAt, status, errorKind }
      );
    }
  }

  /**
   * Current stats for specific video URLs, keyed by video id. One
   * post-detail call per URL (small concurrency pool; 200 req/min cap).
   */
  async fetchStatsForVideoUrls(
    urls: string[],
    ctx?: ProviderCallContext
  ): Promise<Map<string, ProviderVideoStats>> {
    const result = new Map<string, ProviderVideoStats>();
    if (urls.length === 0) return result;

    // Same guard as the Apify provider: malformed URLs retire as unavailable
    // instead of burning credits and being misclassified as transient.
    const VALID_URL = /^https?:\/\/(www\.)?tiktok\.com\/@[A-Za-z0-9_.-]+\/video\/\d+/;
    const validUrls = urls.filter((u) => {
      if (VALID_URL.test(u)) return true;
      const id = extractVideoIdFromUrl(u);
      if (id) result.set(id, { unavailable: true });
      return false;
    });
    if (validUrls.length === 0) return result;

    const startedAt = Date.now();
    let apiCalls = 0;
    let status: "ok" | "error" = "ok";
    let errorKind: string | null = null;
    let firstError: unknown = null;

    const fetchOne = async (url: string): Promise<void> => {
      const videoId = extractVideoIdFromUrl(url);
      if (!videoId) return;
      try {
        apiCalls++;
        const data = await tikliveGet(`/post-detail/?url=${encodeURIComponent(url)}`);
        if (isErrorEnvelope(data)) {
          if (envelopeKind(data) === "not_found") {
            result.set(videoId, { unavailable: true });
            return;
          }
          throw new ProviderError(envelopeKind(data), `TikLiveAPI post-detail ${videoId}: ${data.message}`);
        }
        if (data?.id == null && data?.play_count == null) {
          // Ambiguous empty response — omit so the caller counts it as a failed
          // refresh rather than retiring the video as unavailable.
          console.warn(`[TikLive] Empty post-detail response for video ${videoId}`);
          return;
        }
        const ts = Number(data?.create_time);
        const createTime = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : undefined;
        result.set(videoId, {
          views: toBigInt(data.play_count),
          likes: toBigInt(data.digg_count),
          comments: toBigInt(data.comment_count),
          shares: toBigInt(data.share_count),
          ...(createTime ? { createTime } : {}),
          ...(data?.title != null ? { text: String(data.title) } : {}),
        });
      } catch (err) {
        // Per-URL failure must not nuke the whole batch — record it and move
        // on. Only if NOTHING succeeds do we escalate to the fallback.
        if (!firstError) firstError = err;
        console.warn(
          `[TikLive] post-detail failed for ${videoId}: ${err instanceof Error ? err.message : err}`
        );
      }
    };

    try {
      // Simple concurrency pool.
      let next = 0;
      const worker = async () => {
        while (next < validUrls.length) {
          const url = validUrls[next++];
          await fetchOne(url);
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(STATS_CONCURRENCY, validUrls.length) }, worker)
      );
      if (result.size === 0 && firstError) {
        throw firstError instanceof Error ? firstError : new ProviderError("transient", String(firstError));
      }
      return result;
    } catch (err) {
      status = "error";
      errorKind = err instanceof ProviderError ? err.kind : "transient";
      throw err;
    } finally {
      logTikliveCall(
        {
          source: ctx?.source ?? "unknown",
          inputType: "urls",
          inputSummary: validUrls[0] ?? "",
          inputCount: validUrls.length,
        },
        { resultCount: result.size, apiCalls, durationMs: Date.now() - startedAt, status, errorKind }
      );
    }
  }
}

export const tikliveProvider = new TikLiveProvider();
