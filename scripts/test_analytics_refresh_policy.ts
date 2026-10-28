import assert from "node:assert/strict";
import module from "node:module";

const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date("2026-01-10T00:00:00.000Z");

type DatabaseMock = (...args: never[]) => Promise<unknown>;
type RefreshModule = typeof import("../src/lib/services/analytics/refresh");
type PolicyVideo = Parameters<RefreshModule["isDueForRefresh"]>[0];

const unmocked = (name: string): DatabaseMock => async () => {
  throw new Error(`Unexpected unmocked database call: ${name}`);
};

const prismaMock: Record<string, Record<string, DatabaseMock>> = {
  trackedVideo: {
    findUnique: unmocked("trackedVideo.findUnique"),
    findMany: unmocked("trackedVideo.findMany"),
    update: unmocked("trackedVideo.update"),
    updateMany: unmocked("trackedVideo.updateMany"),
  },
  videoStatSnapshot: {
    findFirst: unmocked("videoStatSnapshot.findFirst"),
    findMany: unmocked("videoStatSnapshot.findMany"),
    create: unmocked("videoStatSnapshot.create"),
    update: unmocked("videoStatSnapshot.update"),
  },
  analyticsRun: {
    findUnique: unmocked("analyticsRun.findUnique"),
    findFirst: unmocked("analyticsRun.findFirst"),
    create: unmocked("analyticsRun.create"),
    update: unmocked("analyticsRun.update"),
  },
  campaign: {
    findMany: unmocked("campaign.findMany"),
  },
};

const throwingProvider = {
  fetchLatestVideosForAccount: async () => {
    throw new Error("Unexpected real-provider path: fetchLatestVideosForAccount");
  },
  fetchStatsForVideoUrls: async () => {
    throw new Error("Unexpected real-provider path: fetchStatsForVideoUrls");
  },
};

const testGlobal = globalThis as typeof globalThis & {
  __analyticsRefreshPolicyMocks: {
    prisma: typeof prismaMock;
    analyticsProvider: typeof throwingProvider;
    rollupAccountsToday: (accountIds: Set<string>) => Promise<number>;
  };
};
testGlobal.__analyticsRefreshPolicyMocks = {
  prisma: prismaMock,
  analyticsProvider: throwingProvider,
  rollupAccountsToday: async (accountIds) => accountIds.size,
};

const moduleSources: Record<string, string> = {
  "mock:analytics-refresh-db": `
    const prisma = globalThis.__analyticsRefreshPolicyMocks.prisma;
    export { prisma };
    export default prisma;
  `,
  "mock:analytics-refresh-resilient": `
    export const analyticsProvider = globalThis.__analyticsRefreshPolicyMocks.analyticsProvider;
  `,
  "mock:analytics-refresh-account-stats": `
    export const rollupAccountsToday = globalThis.__analyticsRefreshPolicyMocks.rollupAccountsToday;
  `,
  "mock:analytics-refresh-timezone": `
    export const getOrgTimezone = async () => "UTC";
    export const getZonedDateString = (value) => new Date(value).toISOString().slice(0, 10);
  `,
};

const mockedSpecifiers: Record<string, string> = {
  "@/lib/db": "mock:analytics-refresh-db",
  "@/lib/services/timezone": "mock:analytics-refresh-timezone",
  "./resilient": "mock:analytics-refresh-resilient",
  "./account-stats": "mock:analytics-refresh-account-stats",
};

type HookContext = { parentURL?: string };
type HookResult = { url?: string; format?: string; source?: string; shortCircuit?: boolean };
type NextHook = (value: string, context: HookContext) => HookResult;

const moduleWithHooks = module as unknown as {
  registerHooks: (hooks: {
    resolve: (specifier: string, context: HookContext, nextResolve: NextHook) => HookResult;
    load: (url: string, context: HookContext, nextLoad: NextHook) => HookResult;
  }) => void;
};

moduleWithHooks.registerHooks({
  resolve(specifier, context, nextResolve) {
    const mockedUrl = mockedSpecifiers[specifier];
    if (mockedUrl) return { url: mockedUrl, shortCircuit: true };
    if (specifier === "./provider" && context.parentURL?.endsWith("/analytics/refresh.ts")) {
      return nextResolve("./provider.ts", context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const source = moduleSources[url];
    if (source !== undefined) return { format: "module", source, shortCircuit: true };
    return nextLoad(url, context);
  },
});

let refresh: RefreshModule;

function hoursAgo(hours: number, from: Date = NOW): Date {
  return new Date(from.getTime() - hours * HOUR_MS);
}

function policyVideo(overrides: Partial<PolicyVideo> = {}): PolicyVideo {
  return {
    publishedAt: hoursAgo(24 * 400),
    capturedAt: hoursAgo(24 * 300),
    lastRefreshedAt: hoursAgo(13),
    lastViewsChangedAt: hoursAgo(1),
    ...overrides,
  };
}

function testDefaults(): void {
  assert.equal(refresh.AUTOMATIC_REFRESH_STALE_HOURS, 12);
  assert.equal(refresh.UNCHANGED_VIEWS_STOP_HOURS, 72);
  assert.equal(refresh.ZERO_VIEW_CONSEC_DAYS, 3);
}

function testTwelveHourBoundaries(): void {
  const active = { lastViewsChangedAt: NOW };
  assert.equal(
    refresh.isDueForRefresh(
      policyVideo({ ...active, lastRefreshedAt: new Date(NOW.getTime() - 12 * HOUR_MS + 1) }),
      NOW
    ),
    false,
    "Videos newer than 12h must not be due"
  );
  assert.equal(
    refresh.isDueForRefresh(policyVideo({ ...active, lastRefreshedAt: hoursAgo(12) }), NOW),
    true,
    "Videos exactly 12h old must be due"
  );
  assert.equal(
    refresh.isDueForRefresh(
      policyVideo({ ...active, lastRefreshedAt: new Date(NOW.getTime() - 12 * HOUR_MS - 1) }),
      NOW
    ),
    true,
    "Videos older than 12h must be due"
  );
  assert.equal(
    refresh.isDueForRefresh(
      policyVideo({
        publishedAt: hoursAgo(12),
        capturedAt: null,
        lastRefreshedAt: null,
        lastViewsChangedAt: NOW,
      }),
      NOW
    ),
    true,
    "publishedAt must be the staleness fallback when never refreshed"
  );
}

function testAllVideoAgesUseSameCadence(): void {
  for (const ageHours of [12, 24, 6 * 24, 7 * 24, 30 * 24, 365 * 24]) {
    const base = policyVideo({
      publishedAt: hoursAgo(ageHours),
      lastRefreshedAt: hoursAgo(12),
      lastViewsChangedAt: NOW,
    });
    assert.equal(refresh.isDueForRefresh(base, NOW), true, `Age ${ageHours}h should be due at 12h`);
    assert.equal(
      refresh.isDueForRefresh({ ...base, lastRefreshedAt: hoursAgo(11) }, NOW),
      false,
      `Age ${ageHours}h should not be due before 12h`
    );
  }
}

function testSeventyTwoHourStop(): void {
  for (const [elapsed, expected] of [[72 * HOUR_MS - 1, true], [72 * HOUR_MS, false], [72 * HOUR_MS + 1, false]] as const) {
    const video = policyVideo({
      lastViewsChangedAt: new Date(NOW.getTime() - elapsed),
      capturedAt: NOW,
      lastRefreshedAt: hoursAgo(100),
    });
    assert.equal(refresh.hasStoppedAutomaticRefresh(video, NOW), !expected);
    assert.equal(refresh.isDueForRefresh(video, NOW), expected);
  }

  assert.equal(
    refresh.isDueForRefresh(
      policyVideo({
        lastViewsChangedAt: NOW,
        capturedAt: hoursAgo(24 * 365),
        publishedAt: hoursAgo(24 * 730),
      }),
      NOW
    ),
    true,
    "A recent view change must reactivate an old video regardless of its old streak"
  );
}

function testStopBaselineFallbacks(): void {
  assert.equal(
    refresh.hasStoppedAutomaticRefresh(
      policyVideo({ lastViewsChangedAt: NOW, capturedAt: hoursAgo(100), publishedAt: hoursAgo(200) }),
      NOW
    ),
    false,
    "lastViewsChangedAt must take precedence"
  );
  assert.equal(
    refresh.hasStoppedAutomaticRefresh(
      policyVideo({ lastViewsChangedAt: hoursAgo(72), capturedAt: NOW, publishedAt: NOW }),
      NOW
    ),
    true,
    "An old lastViewsChangedAt must not be hidden by newer fallbacks"
  );
  assert.equal(
    refresh.hasStoppedAutomaticRefresh(
      policyVideo({ lastViewsChangedAt: null, capturedAt: NOW, publishedAt: hoursAgo(200) }),
      NOW
    ),
    false,
    "capturedAt must be the first fallback"
  );
  assert.equal(
    refresh.hasStoppedAutomaticRefresh(
      policyVideo({ lastViewsChangedAt: null, capturedAt: hoursAgo(72), publishedAt: NOW }),
      NOW
    ),
    true,
    "capturedAt must take precedence over publishedAt"
  );
  assert.equal(
    refresh.hasStoppedAutomaticRefresh(
      policyVideo({ lastViewsChangedAt: null, capturedAt: null, publishedAt: hoursAgo(71) }),
      NOW
    ),
    false,
    "publishedAt must be the final fallback"
  );
  assert.equal(
    refresh.hasStoppedAutomaticRefresh(
      policyVideo({ lastViewsChangedAt: null, capturedAt: null, publishedAt: hoursAgo(72) }),
      NOW
    ),
    true,
    "The publishedAt fallback must stop at exactly 72h"
  );
}

async function applyStatsWithPreviousViews(nextViews: bigint): Promise<{
  data: Record<string, unknown>;
  row: Record<string, unknown>;
  result: { unchangedViewsStreak: number };
}> {
  const previousChange = hoursAgo(10);
  const row: Record<string, unknown> = {
    views: BigInt(10),
    likes: BigInt(1),
    comments: BigInt(1),
    shares: BigInt(1),
    unchangedViewsStreak: 4,
    lastRefreshedAt: hoursAgo(24),
    lastViewsChangedAt: previousChange,
  };
  let data: Record<string, unknown> = {};

  prismaMock.trackedVideo.findUnique = async () => ({
    views: row.views,
    unchangedViewsStreak: row.unchangedViewsStreak,
  });
  prismaMock.trackedVideo.update = async (args: { data: Record<string, unknown> }) => {
    data = args.data;
    Object.assign(row, args.data);
    return row;
  };
  prismaMock.videoStatSnapshot.findFirst = async () => null;
  prismaMock.videoStatSnapshot.create = async (args: unknown) => args;

  const result = await refresh.applyStatsUpdate(
    "video-stats",
    { views: nextViews, likes: BigInt(99), comments: BigInt(2), shares: BigInt(3) },
    "UTC",
    NOW,
    "mock-provider"
  );
  return { data, row, result };
}

async function testApplyStatsTimestampBehavior(): Promise<void> {
  const unchanged = await applyStatsWithPreviousViews(BigInt(10));
  assert.equal(unchanged.result.unchangedViewsStreak, 5);
  assert.equal(unchanged.data.lastRefreshedAt, NOW);
  assert.equal(unchanged.data.statsProvider, "mock-provider");
  assert.equal(unchanged.data.likes, BigInt(99));
  assert.equal("lastViewsChangedAt" in unchanged.data, false);
  assert.equal((unchanged.row.lastViewsChangedAt as Date).getTime(), hoursAgo(10).getTime());

  const changed = await applyStatsWithPreviousViews(BigInt(11));
  assert.equal(changed.result.unchangedViewsStreak, 0);
  assert.equal(changed.data.lastViewsChangedAt, NOW);
  assert.equal(changed.row.lastViewsChangedAt, NOW);
  assert.equal(changed.data.lastRefreshedAt, NOW);
}

type RunVideo = {
  id: string;
  tiktokVideoId: string;
  url: string;
  accountId: string;
  campaignId: string;
  publishedAt: Date;
  capturedAt: Date;
  lastRefreshedAt: Date | null;
  lastViewsChangedAt: Date | null;
};

function selectionVideos(): RunVideo[] {
  const now = new Date();
  const old = hoursAgo(24 * 400, now);
  return [
    {
      id: "active-due",
      tiktokVideoId: "tiktok-active-due",
      url: "https://example.test/active-due",
      accountId: "account-1",
      campaignId: "campaign-1",
      publishedAt: old,
      capturedAt: old,
      lastRefreshedAt: hoursAgo(13, now),
      lastViewsChangedAt: hoursAgo(1, now),
    },
    {
      id: "active-fresh",
      tiktokVideoId: "tiktok-active-fresh",
      url: "https://example.test/active-fresh",
      accountId: "account-1",
      campaignId: "campaign-1",
      publishedAt: old,
      capturedAt: old,
      lastRefreshedAt: hoursAgo(1, now),
      lastViewsChangedAt: hoursAgo(1, now),
    },
    {
      id: "stopped",
      tiktokVideoId: "tiktok-stopped",
      url: "https://example.test/stopped",
      accountId: "account-1",
      campaignId: "campaign-1",
      publishedAt: old,
      capturedAt: old,
      lastRefreshedAt: hoursAgo(13, now),
      lastViewsChangedAt: hoursAgo(73, now),
    },
    {
      id: "captured-baseline-due",
      tiktokVideoId: "tiktok-captured-baseline-due",
      url: "https://example.test/captured-baseline-due",
      accountId: "account-1",
      campaignId: "campaign-1",
      publishedAt: old,
      capturedAt: hoursAgo(2, now),
      lastRefreshedAt: hoursAgo(12, now),
      lastViewsChangedAt: null,
    },
  ];
}

function mockRun(videos: RunVideo[], runId: string) {
  let selection: any;
  const requestedBatches: string[][] = [];

  prismaMock.campaign.findMany = async () => [];
  prismaMock.analyticsRun.findFirst = async () => null;
  prismaMock.analyticsRun.create = async () => ({
    id: runId,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    cursor: null,
  });
  prismaMock.analyticsRun.update = async () => ({});
  prismaMock.trackedVideo.findMany = async (args: unknown) => {
    selection = args;
    return videos;
  };
  prismaMock.trackedVideo.findUnique = async () => ({ views: BigInt(0), unchangedViewsStreak: 0 });
  prismaMock.trackedVideo.update = async () => ({});
  prismaMock.videoStatSnapshot.findFirst = async () => null;
  prismaMock.videoStatSnapshot.create = async () => ({});

  const provider = {
    fetchLatestVideosForAccount: throwingProvider.fetchLatestVideosForAccount,
    fetchStatsForVideoUrls: async (urls: string[]) => {
      requestedBatches.push([...urls]);
      return new Map(urls.map((url) => {
        const video = videos.find((candidate) => candidate.url === url);
        assert.ok(video, `Unexpected provider URL ${url}`);
        return [video.tiktokVideoId, {
          views: BigInt(100),
          likes: BigInt(1),
          comments: BigInt(1),
          shares: BigInt(1),
        }];
      }));
    },
  };

  return {
    provider,
    requestedBatches,
    getSelection: () => selection,
  };
}

async function captureLogs<T>(action: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  try {
    return { value: await action(), lines };
  } finally {
    console.log = originalLog;
  }
}

async function testAutomaticRunSelectionAndLogging(): Promise<void> {
  const videos = selectionVideos();
  const run = mockRun(videos, "run-daily");
  const { lines } = await captureLogs(() => refresh.runAnalyticsRefresh({ provider: run.provider }));

  assert.deepEqual(run.requestedBatches.flat(), [
    "https://example.test/active-due",
    "https://example.test/captured-baseline-due",
  ]);
  assert.equal(run.getSelection().select.capturedAt, true);
  assert.equal(run.getSelection().select.lastViewsChangedAt, true);
  assert.ok(lines.some((line) => line.includes("selection: stopped=1 due=2")));
  assert.ok(lines.every((line) => !line.includes("cadence:")));
}

async function testManualCampaignOverride(): Promise<void> {
  const videos = selectionVideos();
  const run = mockRun(videos, "run-manual");
  const { lines } = await captureLogs(() => refresh.refreshCampaignNow("campaign-1", run.provider));

  assert.deepEqual(
    new Set(run.requestedBatches.flat()),
    new Set(videos.map((video) => video.url)),
    "Manual campaign refresh must include both fresh and stopped videos"
  );
  assert.equal(run.getSelection().where.campaignId, "campaign-1");
  assert.ok(lines.some((line) => line.includes("selection: stopped=0 due=4")));
}

async function main(): Promise<void> {
  const envKeys = [
    "ANALYTICS_REFRESH_STALE_HOURS",
    "ANALYTICS_UNCHANGED_VIEWS_STOP_HOURS",
    "ZERO_VIEW_CONSEC_DAYS",
    "ANALYTICS_BATCH_SIZE",
    "ANALYTICS_SLEEP_MS",
  ];
  const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];

  try {
    refresh = await import("../src/lib/services/analytics/refresh");
    const tests: Array<[string, () => void | Promise<void>]> = [
      ["policy defaults", testDefaults],
      ["12h boundaries and publishedAt staleness fallback", testTwelveHourBoundaries],
      ["uniform cadence across all video ages", testAllVideoAgesUseSameCadence],
      ["72h automatic stop boundary", testSeventyTwoHourStop],
      ["stop baseline precedence and fallbacks", testStopBaselineFallbacks],
      ["applyStatsUpdate view-change timestamps", testApplyStatsTimestampBehavior],
      ["automatic run selection and stopped/due logging", testAutomaticRunSelectionAndLogging],
      ["manual campaign override", testManualCampaignOverride],
    ];

    for (const [name, test] of tests) {
      await test();
      console.log(`PASS ${name}`);
    }
    console.log(`All ${tests.length} analytics refresh policy tests passed (mocks only)`);
  } finally {
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
