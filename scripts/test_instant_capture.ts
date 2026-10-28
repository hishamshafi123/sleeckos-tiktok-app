import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import type { AnalyticsProvider, ProviderCallContext, ProviderVideo } from "../src/lib/services/analytics/provider";

type MockJob = {
  id: string;
  accountId: string;
  campaignId: string | null;
  publishedAt: Date;
  state: string;
  tiktokPublishId: string | null;
  driveFileId: string;
  tiktokPostId: string | null;
  tiktokPostUrl: string | null;
  account: { tiktokUsername: string };
};

type MockTrackedVideo = {
  id: string;
  tiktokVideoId: string;
  url: string;
  accountId: string;
  campaignId: string | null;
  postJobId: string | null;
  publishedAt: Date;
  capturedAt: Date;
  captureMethod: string;
  confidence: string;
  status: string;
  captureAttempts: number;
  views: bigint;
  likes: bigint;
  comments: bigint;
  shares: bigint;
  unchangedViewsStreak: number;
  lastRefreshedAt: Date | null;
  lastViewsChangedAt?: Date | null;
  statsProvider: string | null;
};

type MockScheduledPost = {
  id: string;
  accountId: string;
  driveFileId: string;
  tiktokPublishId: string | null;
  tiktokPostUrl: string | null;
};

const publishedAt = new Date("2026-01-02T03:04:05.000Z");
const zero = BigInt(0);

function makeJob(overrides: Partial<MockJob> = {}): MockJob {
  return {
    id: "job-1",
    accountId: "account-1",
    campaignId: "campaign-1",
    publishedAt,
    state: "PENDING_DELETION",
    tiktokPublishId: "publish-1",
    driveFileId: "drive-1",
    tiktokPostId: null,
    tiktokPostUrl: null,
    account: { tiktokUsername: "creator" },
    ...overrides,
  };
}

function makeTrackedVideo(
  job: MockJob,
  overrides: Partial<MockTrackedVideo> = {}
): MockTrackedVideo {
  return {
    id: "tracked-1",
    tiktokVideoId: `unresolved_${job.id}`,
    url: "",
    accountId: job.accountId,
    campaignId: job.campaignId,
    postJobId: job.id,
    publishedAt: job.publishedAt,
    capturedAt: new Date("2026-01-01T00:00:00.000Z"),
    captureMethod: "recent_match",
    confidence: "high",
    status: "unresolved",
    captureAttempts: 0,
    views: zero,
    likes: zero,
    comments: zero,
    shares: zero,
    unchangedViewsStreak: 0,
    lastRefreshedAt: null,
    lastViewsChangedAt: null,
    statsProvider: null,
    ...overrides,
  };
}

function makeScheduledPost(job: MockJob): MockScheduledPost {
  return {
    id: `scheduled-${job.id}`,
    accountId: job.accountId,
    driveFileId: job.driveFileId,
    tiktokPublishId: job.tiktokPublishId,
    tiktokPostUrl: null,
  };
}

type TrackedVideoWhere = {
  postJobId?: string;
  status?: { not: string };
  tiktokVideoId?: string | { not: string };
};

function createHarness(job: MockJob, initialRows: MockTrackedVideo[] = []) {
  const rows = [...initialRows];
  const scheduledPosts = [makeScheduledPost(job)];
  const snapshots: Array<Record<string, unknown>> = [];
  const rollups: Array<{ accountId: string; days: Set<string> }> = [];
  let nextRowId = 1;

  const applyUpdate = (row: MockTrackedVideo, data: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...row };
    for (const [key, value] of Object.entries(data)) {
      if (key === "captureAttempts" && value && typeof value === "object" && "increment" in value) {
        next.captureAttempts = Number(next.captureAttempts) + Number(value.increment);
      } else {
        next[key] = value;
      }
    }
    return next as unknown as MockTrackedVideo;
  };

  const prisma = {
    postJob: {
      findUnique: async ({ where }: { where: { id: string } }) => job.id === where.id ? job : null,
      update: async ({ where, data }: {
        where: { id: string };
        data: Partial<Pick<MockJob, "tiktokPostUrl">>;
      }) => {
        assert.equal(where.id, job.id);
        Object.assign(job, data);
        return job;
      },
    },
    trackedVideo: {
      findFirst: async ({ where }: { where: TrackedVideoWhere }) => {
        if (where.postJobId && where.status && typeof where.tiktokVideoId === "object") {
          return rows.find((row) =>
            row.postJobId === where.postJobId &&
            row.status !== where.status!.not &&
            row.tiktokVideoId !== (where.tiktokVideoId as { not: string }).not
          ) ?? null;
        }
        return rows.find((row) => row.tiktokVideoId === where.tiktokVideoId) ?? null;
      },
      findUnique: async ({ where }: { where: { tiktokVideoId: string } }) =>
        rows.find((row) => row.tiktokVideoId === where.tiktokVideoId) ?? null,
      upsert: async ({ where, create, update }: {
        where: { tiktokVideoId: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const index = rows.findIndex((row) => row.tiktokVideoId === where.tiktokVideoId);
        if (index < 0) {
          const conflict = rows.find((row) => row.tiktokVideoId === create.tiktokVideoId);
          if (conflict) throw new Error("Mock unique tiktokVideoId conflict");
          const row = {
            ...makeTrackedVideo(job),
            ...create,
            id: `tracked-new-${nextRowId++}`,
          } as unknown as MockTrackedVideo;
          rows.push(row);
          return row;
        }

        const nextId = update.tiktokVideoId;
        if (typeof nextId === "string" && rows.some((row, i) => i !== index && row.tiktokVideoId === nextId)) {
          throw new Error("Mock unique tiktokVideoId conflict");
        }
        rows[index] = applyUpdate(rows[index], update);
        return rows[index];
      },
    },
    scheduledPost: {
      updateMany: async ({ where, data }: {
        where: {
          accountId: string;
          OR: Array<{ driveFileId?: string; tiktokPublishId?: string }>;
        };
        data: { tiktokPostUrl: string };
      }) => {
        let count = 0;
        for (const post of scheduledPosts) {
          const matches = post.accountId === where.accountId && where.OR.some((condition) => {
            if ("driveFileId" in condition) return post.driveFileId === condition.driveFileId;
            if ("tiktokPublishId" in condition) {
              return condition.tiktokPublishId !== undefined &&
                post.tiktokPublishId === condition.tiktokPublishId;
            }
            return false;
          });
          if (matches) {
            Object.assign(post, data);
            count++;
          }
        }
        return { count };
      },
    },
    videoStatSnapshot: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        snapshots.push(data);
        return data;
      },
    },
  };

  return { prisma, job, rows, scheduledPosts, snapshots, rollups };
}

type Harness = ReturnType<typeof createHarness>;
let activeHarness: Harness;

const prismaProxy = new Proxy({}, {
  get(_target, key) {
    return Reflect.get(activeHarness.prisma, key);
  },
});

const moduleLoader = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = moduleLoader._load;
moduleLoader._load = function (request, parent, isMain) {
  if (request === "@/lib/db") {
    return { __esModule: true, default: prismaProxy, prisma: prismaProxy };
  }
  if (request === "./resilient") {
    return {
      analyticsProvider: {
        fetchLatestVideosForAccount: async () => {
          throw new Error("Unexpected real-provider path");
        },
      },
    };
  }
  if (request === "@/lib/services/timezone") {
    return { getOrgTimezone: async () => "UTC" };
  }
  if (request === "./account-stats") {
    return {
      zonedDayString: (date: Date) => date.toISOString().slice(0, 10),
      rollupAccountsForDays: async (accountIds: string[], days: Set<string>) => {
        activeHarness.rollups.push({ accountId: accountIds[0], days });
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const localRequire = createRequire(`${process.cwd()}/scripts/test_instant_capture.ts`);
const { captureVideoLink } = localRequire("../src/lib/services/analytics/capture") as typeof import("../src/lib/services/analytics/capture");

function makeProvider(videos: ProviderVideo[] = [], onLatest?: () => void) {
  const calls = { latest: 0, stats: 0 };
  const provider: AnalyticsProvider = {
    fetchLatestVideosForAccount: async (_username, _max, ctx?: ProviderCallContext) => {
      calls.latest++;
      if (ctx) ctx.usedProvider = "MockProvider";
      onLatest?.();
      return videos;
    },
    fetchStatsForVideoUrls: async () => {
      calls.stats++;
      throw new Error("Stats provider must not be called by link capture");
    },
  };
  return { calls, provider };
}

async function testDirectCaptureWithoutProvider() {
  const videoId = "7312345678901234567";
  const job = makeJob({
    tiktokPostId: videoId,
    tiktokPostUrl: "https://www.tiktok.com/@other/video/7000000000000000000",
  });
  const harness = createHarness(job);
  activeHarness = harness;
  const mock = makeProvider();

  const result = await captureVideoLink(job.id, mock.provider);
  const canonicalUrl = `https://www.tiktok.com/@creator/video/${videoId}`;
  assert.equal(result.status, "captured");
  assert.deepEqual(mock.calls, { latest: 0, stats: 0 });
  assert.equal(harness.rows.length, 1);
  assert.equal(harness.rows[0].tiktokVideoId, videoId);
  assert.equal(harness.rows[0].captureMethod, "postpeer_direct");
  assert.equal(harness.rows[0].confidence, "high");
  assert.equal(harness.rows[0].url, canonicalUrl);
  assert.equal(Number(harness.rows[0].views), 0);
  assert.equal(Number(harness.rows[0].likes), 0);
  assert.equal(Number(harness.rows[0].comments), 0);
  assert.equal(Number(harness.rows[0].shares), 0);
  assert.equal(harness.rows[0].lastRefreshedAt, null);
  assert.equal(harness.rows[0].lastViewsChangedAt, null);
  assert.equal(harness.rows[0].statsProvider, null);
  assert.equal(harness.snapshots.length, 0);
  assert.equal(job.tiktokPostUrl, canonicalUrl);
  assert.equal(harness.scheduledPosts[0].tiktokPostUrl, canonicalUrl);
}

async function testVideoUrlParsing() {
  const videoId = "7411111222233334444";
  const job = makeJob({
    tiktokPostUrl: `https://www.tiktok.com/@someone/video/${videoId}?lang=en`,
  });
  const harness = createHarness(job);
  activeHarness = harness;
  const mock = makeProvider();

  const result = await captureVideoLink(job.id, mock.provider);
  assert.equal(result.status, "captured");
  if (result.status === "captured") assert.equal(result.tiktokVideoId, videoId);
  assert.equal(harness.rows[0].url, `https://www.tiktok.com/@creator/video/${videoId}`);
  assert.deepEqual(mock.calls, { latest: 0, stats: 0 });
}

async function testPlaceholderUpgrade() {
  const videoId = "7511111222233334444";
  const job = makeJob({ tiktokPostId: videoId });
  const placeholder = makeTrackedVideo(job, {
    id: "existing-placeholder",
    captureAttempts: 2,
    views: BigInt(99),
    lastRefreshedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  const harness = createHarness(job, [placeholder]);
  activeHarness = harness;
  const mock = makeProvider();

  const result = await captureVideoLink(job.id, mock.provider);
  assert.equal(result.status, "captured");
  assert.equal(harness.rows.length, 1);
  assert.equal(harness.rows[0].id, "existing-placeholder");
  assert.equal(harness.rows[0].tiktokVideoId, videoId);
  assert.equal(harness.rows[0].status, "captured");
  assert.equal(harness.rows[0].captureMethod, "postpeer_direct");
  assert.equal(Number(harness.rows[0].views), 0);
  assert.equal(harness.rows[0].lastRefreshedAt, null);
  assert.equal(harness.snapshots.length, 0);
  assert.deepEqual(mock.calls, { latest: 0, stats: 0 });
}

async function testMissingIdUsesProviderFallback() {
  const videoId = "7611111222233334444";
  const job = makeJob();
  const harness = createHarness(job);
  activeHarness = harness;
  const video: ProviderVideo = {
    videoId,
    url: `https://www.tiktok.com/@creator/video/${videoId}`,
    createTime: new Date(publishedAt.getTime() - 1000),
    text: "fallback match",
    views: BigInt(42),
    likes: BigInt(7),
    comments: BigInt(3),
    shares: BigInt(2),
  };
  let placeholderExistedDuringFetch = false;
  const mock = makeProvider([video], () => {
    placeholderExistedDuringFetch = harness.rows.some(
      (row) => row.tiktokVideoId === `unresolved_${job.id}` && row.status === "unresolved"
    );
  });

  const result = await captureVideoLink(job.id, mock.provider);
  assert.equal(result.status, "captured");
  assert.equal(placeholderExistedDuringFetch, true);
  assert.deepEqual(mock.calls, { latest: 1, stats: 0 });
  assert.equal(harness.rows[0].captureMethod, "recent_match");
  assert.equal(harness.rows[0].views, BigInt(42));
  assert.ok(harness.rows[0].lastRefreshedAt instanceof Date);
  assert.equal(harness.snapshots.length, 1);
}

async function testVideoIdConflictDoesNotStealAttribution() {
  const videoId = "7711111222233334444";
  const job = makeJob({ tiktokPostId: videoId });
  const owner = makeTrackedVideo(job, {
    id: "original-owner",
    postJobId: "another-job",
    tiktokVideoId: videoId,
    url: `https://www.tiktok.com/@creator/video/${videoId}`,
    status: "captured",
    captureMethod: "recent_match",
  });
  const placeholder = makeTrackedVideo(job, { id: "job-placeholder" });
  const harness = createHarness(job, [owner, placeholder]);
  activeHarness = harness;
  const mock = makeProvider();
  const ownerBefore = { ...owner };

  const result = await captureVideoLink(job.id, mock.provider);
  assert.equal(result.status, "skipped");
  assert.match(result.status === "skipped" ? result.reason : "", /already attributed/);
  assert.deepEqual(harness.rows[0], ownerBefore);
  assert.equal(harness.rows[0].postJobId, "another-job");
  assert.equal(harness.rows[1].id, "job-placeholder");
  assert.equal(harness.rows[1].status, "unresolved");
  assert.equal(harness.rows.length, 2);
  assert.equal(harness.snapshots.length, 0);
  assert.deepEqual(mock.calls, { latest: 0, stats: 0 });
}

async function testRealRowsRemainIdempotent() {
  for (const status of ["captured", "dormant", "unavailable"]) {
    const job = makeJob({ id: `job-${status}`, tiktokPostId: "7811111222233334444" });
    const existing = makeTrackedVideo(job, {
      id: `tracked-${status}`,
      tiktokVideoId: "7911111222233334444",
      status,
    });
    const harness = createHarness(job, [existing]);
    activeHarness = harness;
    const mock = makeProvider();

    const result = await captureVideoLink(job.id, mock.provider);
    assert.equal(result.status, "captured");
    if (result.status === "captured") {
      assert.equal(result.trackedVideoId, existing.id);
      assert.equal(result.tiktokVideoId, existing.tiktokVideoId);
    }
    assert.equal(harness.rows.length, 1);
    assert.equal(harness.rows[0].status, status);
    assert.deepEqual(mock.calls, { latest: 0, stats: 0 });
  }
}

async function main() {
  const tests = [
    ["direct capture without provider", testDirectCaptureWithoutProvider],
    ["video URL parsing", testVideoUrlParsing],
    ["placeholder upgrade", testPlaceholderUpgrade],
    ["missing-ID provider fallback", testMissingIdUsesProviderFallback],
    ["video ID conflict safety", testVideoIdConflictDoesNotStealAttribution],
    ["real-row idempotency", testRealRowsRemainIdempotent],
  ] as const;

  for (const [name, test] of tests) {
    await test();
    console.log(`ok - ${name}`);
  }
  console.log(`${tests.length} instant-capture tests passed (mock DB and provider)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    moduleLoader._load = originalLoad;
  });
