import assert from "node:assert/strict";
import {
  allocatePriorityTargets,
  computePriorityWeights,
  type PriorityWeightEntry,
} from "../src/lib/utils/priority-targets";

type CampaignRow = {
  id: string;
  title: string;
  status: string;
  priorityRank: number | null;
  priorityQuota: number | null;
  priorityUsed: number;
};

type PostJobRow = {
  campaignId: string | null;
  state: string;
  publishedAt: Date | null;
};

function entry(id: string, priorityRank: number, status = "ACTIVE"): PriorityWeightEntry {
  return { id, priorityRank, status };
}

function allocations(entries: PriorityWeightEntry[], totalPosts: number): number[] {
  const targets = allocatePriorityTargets(entries, totalPosts);
  return entries.map((item) => targets.get(item.id) ?? 0);
}

function testExactWeightedSplit(): void {
  const entries = [entry("a", 1), entry("b", 2), entry("c", 3)];
  assert.deepEqual(allocations(entries, 100), [50, 33, 17]);
  assert.equal(
    allocations(entries, Number.MAX_SAFE_INTEGER).reduce((sum, value) => sum + value, 0),
    Number.MAX_SAFE_INTEGER
  );
}

function testPausedInterleaving(): void {
  const entries = [entry("a", 1), entry("paused", 2, "PAUSED"), entry("b", 3), entry("c", 4)];
  assert.deepEqual(
    [...computePriorityWeights(entries).values()],
    [3, 0, 2, 1]
  );
  assert.deepEqual(allocations(entries, 100), [50, 0, 33, 17]);
}

function testRemaindersAndDeterministicTies(): void {
  const entries = ["c", "b", "a"].map((id) => entry(id, 1));
  assert.deepEqual(allocations(entries, 3), [0, 1, 2]);
  assert.deepEqual(allocations([...entries].reverse(), 3), [2, 1, 0]);
}

function testTotalBelowActiveCount(): void {
  const entries = [entry("a", 1), entry("b", 2), entry("c", 3)];
  assert.deepEqual(allocations(entries, 2), [1, 1, 0]);
}

function testInvalidInputs(): void {
  const entries = [entry("a", 1)];
  const invalidTotals: unknown[] = [
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    "100",
    null,
    undefined,
  ];
  for (const total of invalidTotals) {
    assert.throws(() => allocatePriorityTargets(entries, total as number), RangeError);
  }
  assert.throws(() => allocatePriorityTargets([], 100), RangeError);
  assert.throws(() => allocatePriorityTargets([entry("paused", 1, "PAUSED")], 100), RangeError);
}

type CampaignWhere = {
  id?: string;
  priorityRank?: { not: null };
  status?: string;
};

type CampaignFindArgs = {
  where?: CampaignWhere;
  orderBy?: { priorityRank: "asc" | "desc" };
};

type CampaignUpdateArgs = {
  where: { id: string };
  data: Partial<CampaignRow>;
};

type AppSettingKeyArgs = { where: { key: string } };
type AppSettingUpsertArgs = AppSettingKeyArgs & {
  create: { key: string; value: string };
  update: { value: string };
};
type PostJobGroupArgs = {
  where: {
    campaignId: { in: string[] };
    state: { in: string[] };
    publishedAt: { gte: Date };
  };
};

type MockPrisma = {
  $transaction(callback: (tx: MockPrisma) => Promise<unknown>): Promise<unknown>;
  campaign: {
    findMany(args?: CampaignFindArgs): Promise<CampaignRow[]>;
    findUnique(args: { where: { id: string } }): Promise<CampaignRow | null>;
    findFirst(args?: CampaignFindArgs): Promise<CampaignRow | null>;
    update(args: CampaignUpdateArgs): Promise<CampaignRow>;
    updateMany(args: CampaignUpdateArgs): Promise<{ count: number }>;
  };
  appSetting: {
    findUnique(args: AppSettingKeyArgs): Promise<{ key: string; value: string } | null>;
    upsert(args: AppSettingUpsertArgs): Promise<{ key: string; value: string }>;
  };
  postJob: {
    groupBy(args: PostJobGroupArgs): Promise<Array<{
      campaignId: string;
      _count: { _all: number };
    }>>;
  };
};

function matchesCampaign(campaign: CampaignRow, where: CampaignWhere = {}): boolean {
  if (where.id && campaign.id !== where.id) return false;
  if (where.priorityRank?.not === null && campaign.priorityRank === null) return false;
  if (where.status && campaign.status !== where.status) return false;
  return true;
}

async function testPersistentDailyServices(): Promise<void> {
  process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/kvm8_test_priority";
  const { prisma } = await import("../src/lib/db");
  const {
    getCampaignPostsToday,
    getPriorityDailyTargetTotal,
    getPriorityOrder,
    NoActivePriorityPoolError,
    setCampaignPriority,
    splitPriorityTargets,
  } = await import("../src/lib/services/campaign-priority");
  const client = prisma as unknown as MockPrisma;

  const campaigns = new Map<string, CampaignRow>(
    [
      { id: "a", status: "ACTIVE", priorityRank: 1, priorityQuota: 90, priorityUsed: 500 },
      { id: "paused", status: "PAUSED", priorityRank: 2, priorityQuota: 80, priorityUsed: 12 },
      { id: "b", status: "ACTIVE", priorityRank: 3, priorityQuota: 70, priorityUsed: 600 },
      { id: "c", status: "ACTIVE", priorityRank: 4, priorityQuota: 60, priorityUsed: 700 },
      { id: "outside", status: "ACTIVE", priorityRank: null, priorityQuota: 7, priorityUsed: 8 },
    ].map((campaign) => [
      campaign.id,
      { ...campaign, title: campaign.id },
    ])
  );
  const settings = new Map<string, string>([["timezone", "Asia/Kolkata"]]);
  const now = new Date();
  const yesterday = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const postJobs: PostJobRow[] = [
    ...Array.from({ length: 50 }, () => ({ campaignId: "a", state: "PUBLISHED", publishedAt: now })),
    ...Array.from({ length: 33 }, () => ({ campaignId: "b", state: "PENDING_DELETION", publishedAt: now })),
    ...Array.from({ length: 16 }, () => ({ campaignId: "c", state: "DELETED", publishedAt: now })),
    ...Array.from({ length: 7 }, () => ({ campaignId: "paused", state: "PUBLISHED", publishedAt: now })),
    { campaignId: "a", state: "FAILED", publishedAt: now },
    { campaignId: "a", state: "PUBLISHED", publishedAt: yesterday },
  ];

  client.$transaction = async (callback: (tx: MockPrisma) => Promise<unknown>) => {
    const campaignSnapshot = new Map(
      [...campaigns].map(([id, campaign]) => [id, { ...campaign }])
    );
    const settingSnapshot = new Map(settings);
    try {
      return await callback(client);
    } catch (error) {
      campaigns.clear();
      for (const [id, campaign] of campaignSnapshot) campaigns.set(id, campaign);
      settings.clear();
      for (const [key, value] of settingSnapshot) settings.set(key, value);
      throw error;
    }
  };
  client.campaign.findMany = async ({ where, orderBy }: CampaignFindArgs = {}) => {
    const rows = [...campaigns.values()].filter((campaign) => matchesCampaign(campaign, where));
    if (orderBy?.priorityRank === "asc") {
      rows.sort((a, b) => (a.priorityRank ?? 0) - (b.priorityRank ?? 0));
    }
    return rows.map((campaign) => ({ ...campaign }));
  };
  client.campaign.findUnique = async ({ where }: { where: { id: string } }) => {
    const campaign = campaigns.get(where.id);
    return campaign ? { ...campaign } : null;
  };
  client.campaign.findFirst = async ({ where, orderBy }: CampaignFindArgs = {}) => {
    const rows = [...campaigns.values()].filter((campaign) => matchesCampaign(campaign, where));
    if (orderBy?.priorityRank === "desc") {
      rows.sort((a, b) => (b.priorityRank ?? 0) - (a.priorityRank ?? 0));
    }
    return rows[0] ? { ...rows[0] } : null;
  };
  client.campaign.update = async ({ where, data }: CampaignUpdateArgs) => {
    const campaign = campaigns.get(where.id);
    if (!campaign) throw new Error("Campaign not found");
    Object.assign(campaign, data);
    return { ...campaign };
  };
  client.campaign.updateMany = async ({ where, data }: CampaignUpdateArgs) => {
    const rows = [...campaigns.values()].filter((campaign) => matchesCampaign(campaign, where));
    for (const campaign of rows) Object.assign(campaign, data);
    return { count: rows.length };
  };
  client.appSetting.findUnique = async ({ where }: AppSettingKeyArgs) => {
    const value = settings.get(where.key);
    return value === undefined ? null : { key: where.key, value };
  };
  client.appSetting.upsert = async ({ where, create }: AppSettingUpsertArgs) => {
    settings.set(where.key, create.value);
    return { key: where.key, value: create.value };
  };
  client.postJob.groupBy = async ({ where }: PostJobGroupArgs) => {
    const ids = new Set<string>(where.campaignId.in);
    const countedStates = new Set<string>(where.state.in);
    const startOfToday: Date = where.publishedAt.gte;
    const counts = new Map<string, number>();
    for (const job of postJobs) {
      if (
        job.campaignId &&
        ids.has(job.campaignId) &&
        countedStates.has(job.state) &&
        job.publishedAt &&
        job.publishedAt >= startOfToday
      ) {
        counts.set(job.campaignId, (counts.get(job.campaignId) ?? 0) + 1);
      }
    }
    return [...counts].map(([campaignId, count]) => ({
      campaignId,
      _count: { _all: count },
    }));
  };

  await splitPriorityTargets(100);
  assert.equal(campaigns.get("a")?.priorityQuota, 50);
  assert.equal(campaigns.get("b")?.priorityQuota, 33);
  assert.equal(campaigns.get("c")?.priorityQuota, 17);
  assert.equal(campaigns.get("paused")?.priorityQuota, null);
  assert.equal(campaigns.get("outside")?.priorityQuota, 7);
  assert.deepEqual(
    [...campaigns.values()].map((campaign) => campaign.priorityUsed),
    [500, 12, 600, 700, 8]
  );
  assert.equal(await getPriorityDailyTargetTotal(), 100);

  const pool = await getPriorityOrder();
  assert.deepEqual(pool.map((campaign) => campaign.postsToday), [50, 7, 33, 16]);
  assert.equal(pool[0].postsToday >= (pool[0].priorityQuota ?? 0), true);
  assert.equal(pool[2].postsToday >= (pool[2].priorityQuota ?? 0), true);
  assert.equal(pool[3].postsToday >= (pool[3].priorityQuota ?? 0), false);
  assert.equal((await getCampaignPostsToday(["a"])).get("a"), 50);

  for (const job of postJobs) job.publishedAt = yesterday;
  const nextDayPool = await getPriorityOrder();
  assert.deepEqual(nextDayPool.map((campaign) => campaign.postsToday), [0, 0, 0, 0]);
  assert.deepEqual(nextDayPool.map((campaign) => campaign.priorityQuota), [50, null, 33, 17]);
  assert.deepEqual(
    [...campaigns.values()].map((campaign) => campaign.priorityUsed),
    [500, 12, 600, 700, 8]
  );

  const appended = await setCampaignPriority("outside", 25);
  assert.equal(appended.priorityRank, 5);
  assert.equal(appended.priorityUsed, 8);
  const cleared = await setCampaignPriority("outside", null);
  assert.equal(cleared.priorityQuota, null);
  assert.equal(cleared.priorityRank, 5);
  assert.equal(cleared.priorityUsed, 8);

  for (const campaign of campaigns.values()) {
    if (campaign.priorityRank !== null) campaign.status = "PAUSED";
  }
  const beforeRejectedSplit = JSON.stringify([...campaigns.values()]);
  await assert.rejects(splitPriorityTargets(100), NoActivePriorityPoolError);
  assert.equal(JSON.stringify([...campaigns.values()]), beforeRejectedSplit);
  await assert.rejects(splitPriorityTargets(0), RangeError);

  await prisma.$disconnect();
}

async function main(): Promise<void> {
  const tests: Array<[string, () => void | Promise<void>]> = [
    ["exact 100-post weighted split", testExactWeightedSplit],
    ["paused interleaving and compact weights", testPausedInterleaving],
    ["largest remainders and deterministic rank/id ties", testRemaindersAndDeterministicTies],
    ["total below active campaign count", testTotalBelowActiveCount],
    ["invalid allocation inputs", testInvalidInputs],
    ["persistent targets and natural org-tz daily progress", testPersistentDailyServices],
  ];
  for (const [name, test] of tests) {
    await test();
    console.log(`PASS ${name}`);
  }
  console.log(`All ${tests.length} campaign priority target tests passed`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
