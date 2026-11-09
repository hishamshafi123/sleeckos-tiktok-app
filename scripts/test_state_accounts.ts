/** Run only against a disposable migrated database:
 * DATABASE_URL=postgresql://localhost/sleeckos_state_accounts_verify npx tsx scripts/test_state_accounts.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/lib/db";
import {
  ensureStateDay,
  updateStateConfig,
  getStateDashboard,
  stateAccess,
  refreshActivityCounts,
} from "../src/lib/services/state-accounts/data";
import {
  syncStateAccounts,
  type StateProvider,
} from "../src/lib/services/state-accounts/sync";
import {
  nextMidnight,
  observedGain,
  runtimeMinutes,
  validTimezone,
  target,
} from "../src/lib/services/state-accounts/rules";
import { ingestGuardianCycle } from "../src/lib/services/multilogin-guardian";
import { apifyProvider } from "../src/lib/services/analytics/apify";
import { GET as cronGet } from "../src/app/api/cron/state-accounts/route";
import { getEffectiveAccess } from "../src/lib/services/permissions";

async function main() {
  assert.match(
    new URL(process.env.DATABASE_URL!).pathname,
    /state_accounts_verify$/,
    "Use the isolated verification database.",
  );
  assert.equal(
    nextMidnight(
      new Date("2026-03-29T00:00:00Z"),
      "Europe/London",
    ).toISOString(),
    "2026-03-29T23:00:00.000Z",
  );
  assert.equal(
    nextMidnight(
      new Date("2026-10-24T23:00:00Z"),
      "Europe/London",
    ).toISOString(),
    "2026-10-26T00:00:00.000Z",
  );
  assert.equal(validTimezone("Invalid/Timezone"), false);
  assert.throws(() => target(-1));
  assert.throws(() => target(2.5));
  assert.equal(target(null, true), null);
  assert.equal(observedGain(BigInt(1000), null, false), BigInt(0));
  assert.equal(observedGain(BigInt(20), BigInt(30), false), BigInt(0));
  assert.equal(
    runtimeMinutes(
      [
        { observedAt: new Date("2026-11-09T00:05:00Z"), runtimeSecs: 600 },
        { observedAt: new Date("2026-11-09T00:10:00Z"), runtimeSecs: 900 },
        { observedAt: new Date("2026-11-09T00:30:00Z"), runtimeSecs: 300 },
      ],
      new Date("2026-11-09T00:00:00Z"),
      new Date("2026-11-10T00:00:00Z"),
    ),
    15,
    "Clip midnight, merge repeat polls, count a restart separately",
  );

  // The database is dedicated to this suite; reset only feature test data.
  await prisma.stateAccount.deleteMany();
  await prisma.stateTeam.deleteMany();
  await prisma.stateReportingDay.deleteMany();
  await prisma.stateSyncLease.deleteMany();
  await prisma.guardianRuntimeSample.deleteMany();
  await prisma.guardianStopEvent.deleteMany();
  await prisma.guardianCycle.deleteMany();
  await prisma.guardianPhone.deleteMany();
  await prisma.appSetting.deleteMany({
    where: {
      key: { in: ["state_accounts_timezone", "guardian.inventoryWatermark"] },
    },
  });
  await prisma.managedAccount.deleteMany();
  await prisma.accountLabel.deleteMany();
  await prisma.accountSection.deleteMany();
  await prisma.user.deleteMany();
  // Exercise the actual provider decoder without network or paid scraper calls.
  const realFetch = globalThis.fetch;
  const realToken = process.env.APIFY_TOKEN;
  process.env.APIFY_TOKEN = "test-only";
  let items: Record<string, unknown>[] = [
    {
      id: "123",
      createTime: 1700000000,
      playCount: 12,
      diggCount: 3,
      authorMeta: { fans: 99, heart: 500 },
    },
  ];
  globalThis.fetch = async (url) => {
    const address = String(url);
    assert.ok(address.startsWith("https://api.apify.com/v2/"));
    return new Response(
      JSON.stringify(
        address.includes("/datasets/")
          ? items
          : {
              data: {
                id: "mock-run",
                defaultDatasetId: "mock-data",
                status: "SUCCEEDED",
              },
            },
      ),
      { headers: { "content-type": "application/json" } },
    );
  };
  try {
    const snapshot = await apifyProvider.fetchAccountSnapshot("test", 100, {
      source: "state_accounts",
    });
    assert.equal(snapshot.followers, BigInt(99));
    assert.equal(snapshot.likes, BigInt(500));
    assert.equal(snapshot.videos[0].createTime.getTime(), 1700000000000);
    items = [{ id: "123", createTime: 1700000000, authorMeta: { fans: 99 } }];
    await assert.rejects(
      apifyProvider.fetchAccountSnapshot("test", 100, {
        source: "state_accounts",
      }),
      /Incomplete video metrics/,
    );
    items = [];
    await assert.rejects(
      apifyProvider.fetchAccountSnapshot("test", 100, {
        source: "state_accounts",
      }),
      /No usable profile data/,
    );
  } finally {
    globalThis.fetch = realFetch;
    if (realToken === undefined) delete process.env.APIFY_TOKEN;
    else process.env.APIFY_TOKEN = realToken;
  }
  const secret = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  assert.equal(
    (await cronGet(new Request("http://localhost/api/cron/state-accounts")))
      .status,
    401,
  );
  process.env.CRON_SECRET = "test-secret";
  assert.equal(
    (
      await cronGet(
        new Request("http://localhost/api/cron/state-accounts", {
          headers: { "x-cron-secret": "wrong" },
        }),
      )
    ).status,
    401,
  );
  if (secret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = secret;

  const role = await prisma.role.upsert({
    where: { key: "state-test" },
    create: { key: "state-test", label: "Test" },
    update: {},
  });
  const member = await prisma.user.create({
    data: {
      email: "state-test@example.invalid",
      roleId: role.id,
      status: "ACTIVE",
      name: "Test member",
    },
  });
  const section = await prisma.accountSection.create({
    data: { name: "General", slug: "test-general" },
  });
  const label = await prisma.accountLabel.create({
    data: { name: "State", color: "blue" },
  });
  const account = await prisma.managedAccount.create({
    data: {
      sectionId: section.id,
      tiktokUsername: "state_test",
      tiktokDisplayName: "Kerala",
      labelAssignments: { create: { labelId: label.id } },
    },
  });
  const other = await prisma.managedAccount.create({
    data: { sectionId: section.id, tiktokUsername: "not_a_state" },
  });
  const now = new Date();
  const phone = await prisma.guardianPhone.create({
    data: {
      profileId: "state-phone",
      name: "Kerala",
      tags: ["state"],
      lastSeenAt: now,
    },
  });
  const today = await ensureStateDay();
  assert.equal(await prisma.stateAccount.count(), 1);
  assert.equal(
    (
      await prisma.stateAccount.findUniqueOrThrow({
        where: { accountId: account.id },
      })
    ).guardianProfileId,
    phone.profileId,
    "Exact phone name links automatically",
  );
  assert.equal(await stateAccess(member.id, "editor"), false);
  await updateStateConfig({
    action: "team",
    name: "South",
    postsTarget: 3,
    warmupTarget: 35,
    memberIds: [member.id],
  });
  const team = await prisma.stateTeam.findUniqueOrThrow({
    where: { name: "South" },
  });
  assert.equal(await stateAccess(member.id, "editor"), true);
  assert.equal(
    (await getEffectiveAccess(member.id)).has("state_accounts"),
    true,
  );
  await assert.rejects(
    updateStateConfig({
      action: "account",
      accountId: other.id,
      teamId: team.id,
      postsTarget: null,
      warmupTarget: null,
    }),
    /state account/,
  );
  await updateStateConfig({
    action: "account",
    accountId: account.id,
    teamId: team.id,
    guardianProfileId: phone.profileId,
    postsTarget: 2,
    warmupTarget: 20,
  });
  let row = await prisma.stateAccountDay.findUniqueOrThrow({
    where: { accountId_dayId: { accountId: account.id, dayId: today.id } },
  });
  assert.equal(row.postsTarget, 2);
  assert.equal(row.warmupTarget, 20);
  await updateStateConfig({
    action: "team",
    id: team.id,
    name: "South",
    postsTarget: 5,
    warmupTarget: 45,
    memberIds: [member.id],
  });
  await updateStateConfig({
    action: "account",
    accountId: account.id,
    teamId: team.id,
    guardianProfileId: phone.profileId,
    postsTarget: null,
    warmupTarget: null,
  });
  row = await prisma.stateAccountDay.findUniqueOrThrow({
    where: { id: row.id },
  });
  assert.equal(
    row.postsTarget,
    2,
    "Changing targets does not rewrite today's target",
  );

  const cycle = (id: string, at: Date, runtime: number) => ({
    cycleId: id,
    startedAt: new Date(at.getTime() - 1000).toISOString(),
    finishedAt: at.toISOString(),
    status: "success",
    inventoryComplete: true,
    runningCount: 1,
    stopRequested: 0,
    stopSucceeded: 0,
    stopFailed: 0,
    stopUnknown: 0,
    error: null,
    profiles: [
      {
        profileId: phone.profileId,
        name: "Kerala",
        tags: ["state"],
        status: 0,
        runningTimeSecs: runtime,
        matchedTag: "state",
        limitMinutes: 35,
        decision: "keep",
      },
    ],
    stops: [],
  });
  const first = cycle(randomUUID(), new Date(now.getTime() - 600000), 600);
  await ingestGuardianCycle(first);
  assert.equal((await ingestGuardianCycle(first)).duplicate, true);
  await ingestGuardianCycle(cycle(randomUUID(), now, 1200));
  await refreshActivityCounts();
  row = await prisma.stateAccountDay.findUniqueOrThrow({
    where: { id: row.id },
  });
  assert.equal(
    row.warmupMinutes,
    runtimeMinutes(
      [{ observedAt: now, runtimeSecs: 1200 }],
      today.startsAt,
      today.endsAt,
    ),
    "Guardian polls do not double-count",
  );

  let views = BigInt(100),
    followers = BigInt(50),
    omitOld = false,
    fail = false;
  const old = {
    videoId: "10001",
    url: "https://www.tiktok.com/@state_test/video/10001",
    createTime: new Date(today.startsAt.getTime() - 86400000),
    text: "Old",
    views: BigInt(1000),
    likes: BigInt(10),
    comments: BigInt(0),
    shares: BigInt(0),
  };
  const calls: string[] = [];
  const provider: StateProvider = {
    async fetchAccountSnapshot(username) {
      calls.push(username);
      if (fail) throw new Error("Simulated provider failure");
      return {
        followers,
        likes: BigInt(100),
        videos: [
          ...(omitOld ? [] : [old]),
          {
            ...old,
            videoId: "10002",
            url: "https://www.tiktok.com/@state_test/video/10002",
            createTime: now,
            views,
            likes: BigInt(5),
          },
        ],
      };
    },
    async fetchStatsForVideoUrls(urls) {
      assert.deepEqual(urls, [old.url]);
      return new Map([
        [
          old.videoId,
          {
            views: BigInt(1030),
            likes: BigInt(12),
            comments: BigInt(0),
            shares: BigInt(0),
          },
        ],
      ]);
    },
  };
  assert.equal((await syncStateAccounts(provider)).succeeded, 1);
  assert.deepEqual(
    calls,
    ["state_test"],
    "Only state accounts incur provider calls",
  );
  row = await prisma.stateAccountDay.findUniqueOrThrow({
    where: { id: row.id },
  });
  assert.equal(row.posts, 1);
  assert.equal(
    row.views,
    BigInt(100),
    "Old videos establish baselines, today's posts count",
  );
  assert.equal(row.followersObserved, false);
  await syncStateAccounts(provider);
  row = await prisma.stateAccountDay.findUniqueOrThrow({
    where: { id: row.id },
  });
  assert.equal(row.views, BigInt(100), "Repeated snapshots are idempotent");
  assert.equal(await prisma.stateVideo.count(), 2);
  views = BigInt(125);
  followers = BigInt(47);
  omitOld = true;
  await syncStateAccounts(provider);
  row = await prisma.stateAccountDay.findUniqueOrThrow({
    where: { id: row.id },
  });
  assert.equal(
    row.views,
    BigInt(155),
    "Refresh videos outside the newest profile window",
  );
  assert.equal(row.followerGrowth, BigInt(-3), "Follower losses are preserved");
  views = BigInt(110);
  await syncStateAccounts(provider);
  views = BigInt(125);
  await syncStateAccounts(provider);
  assert.equal(
    (await prisma.stateAccountDay.findUniqueOrThrow({ where: { id: row.id } }))
      .views,
    BigInt(155),
    "Counter corrections do not double-count recovery",
  );
  fail = true;
  assert.equal((await syncStateAccounts(provider)).failed, 1);
  assert.equal(
    (await prisma.stateAccountDay.findUniqueOrThrow({ where: { id: row.id } }))
      .views,
    BigInt(155),
  );
  assert.ok(
    (
      await prisma.stateAccount.findUniqueOrThrow({
        where: { accountId: account.id },
      })
    ).syncError,
  );
  await prisma.stateSyncLease.create({
    data: {
      id: "hourly",
      owner: "other-worker",
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  assert.equal((await syncStateAccounts(provider)).skipped, true);
  await prisma.stateSyncLease.deleteMany();
  const dashboard = await getStateDashboard(false);
  assert.equal(
    dashboard.users.length,
    0,
    "Member responses do not expose the user directory",
  );
  assert.equal(dashboard.teams.length, 1);
  const arizona = await prisma.managedAccount.create({
    data: {
      sectionId: section.id,
      tiktokUsername: "arizonaafterhourss",
      driveFolderName: "POL ACC Arizona",
    },
  });
  await prisma.guardianPhone.create({
    data: {
      profileId: "arizona-phone",
      name: "Arizona",
      tags: ["State"],
      lastSeenAt: now,
    },
  });
  const unrelated = await prisma.managedAccount.create({
    data: {
      sectionId: section.id,
      tiktokUsername: "globalstatecraft32",
      driveFolderName: "POL ACC 664",
    },
  });
  await ensureStateDay();
  assert.equal(
    (
      await prisma.stateAccount.findUniqueOrThrow({
        where: { accountId: arizona.id },
      })
    ).guardianProfileId,
    "arizona-phone",
    "Guardian State tags and POL ACC state folder names discover accounts without app labels",
  );
  assert.equal(
    await prisma.stateAccount.findUnique({
      where: { accountId: unrelated.id },
    }),
    null,
    "State-like usernames do not expand the scope",
  );
  assert.equal((await getStateDashboard(false)).accounts.length, 2);
  await updateStateConfig({ action: "timezone", timezone: "Asia/Qatar" });
  assert.equal((await ensureStateDay()).timezone, "Asia/Kolkata");
  const nextDay = await ensureStateDay(new Date(today.endsAt.getTime() + 1));
  assert.equal(nextDay.timezone, "Asia/Qatar");
  assert.equal(
    nextDay.startsAt.getTime(),
    today.endsAt.getTime(),
    "Timezone transitions have no gaps or overlap",
  );
  const nextRow = await prisma.stateAccountDay.findUniqueOrThrow({
    where: { accountId_dayId: { accountId: account.id, dayId: nextDay.id } },
  });
  assert.equal(nextRow.postsTarget, 5, "New day inherits changed defaults");
  assert.equal(nextRow.warmupTarget, 45);
  assert.equal(
    (await prisma.stateAccountDay.findUniqueOrThrow({ where: { id: row.id } }))
      .postsTarget,
    2,
  );
  console.log(
    "PASS: state scope, access, history, hourly sync, deduplication, failures, Guardian minutes and timezone/DST transitions",
  );
}
main()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
