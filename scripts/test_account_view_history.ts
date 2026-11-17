import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fromZonedTime } from "date-fns-tz";
import prisma from "../src/lib/db";
import {
  getAccountViewHistory,
  preserveAccountPerformance,
} from "../src/lib/services/analytics/account-view-history";
import {
  upsertAccountDailyStat,
  zonedDayString,
} from "../src/lib/services/analytics/account-stats";
import { ForbiddenError } from "../src/lib/services/analytics/account-performance";

const timezone = "Asia/Kolkata";

function shiftMonth(month: string, amount: number) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 7);
}

async function main() {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /state_accounts_verify$/);
  const suffix = randomUUID();
  const previousSetting = await prisma.appSetting.findUnique({ where: { key: "timezone" } });
  await prisma.appSetting.upsert({
    where: { key: "timezone" },
    create: { key: "timezone", value: timezone },
    update: { value: timezone },
  });
  const existingRole = await prisma.role.findUnique({ where: { key: "admin" } });
  const role = existingRole ?? (await prisma.role.create({
    data: { key: "admin", label: "Administrator" },
  }));
  const user = await prisma.user.create({
    data: {
      email: `view-history-${suffix}@example.invalid`,
      name: "View history verification",
      status: "ACTIVE",
      roleId: role.id,
    },
  });
  const section = await prisma.accountSection.create({
    data: { name: `History ${suffix}`, slug: `history-${suffix}` },
  });
  const accountIds: string[] = [];
  const videoIds: string[] = [];
  const createAccount = async (username: string) => {
    const account = await prisma.managedAccount.create({
      data: { sectionId: section.id, tiktokUsername: `${username}-${suffix}` },
    });
    accountIds.push(account.id);
    return account;
  };

  try {
    await assert.rejects(getAccountViewHistory(randomUUID()), ForbiddenError);
    const before = await getAccountViewHistory(user.id);
    const today = zonedDayString(new Date(), timezone);
    const currentMonth = today.slice(0, 7);
    const previousMonth = shiftMonth(currentMonth, -1);
    const threeMonthsAgo = shiftMonth(currentMonth, -3);
    const previousLastDay = new Date(Date.parse(`${currentMonth}-01T00:00:00Z`) - 86400000)
      .toISOString()
      .slice(0, 10);
    const a = await createAccount("history-a");
    const b = await createAccount("history-b");

    const video = await prisma.trackedVideo.create({
      data: {
        tiktokVideoId: `history-${suffix}`,
        url: `https://www.tiktok.com/@history/video/${suffix}`,
        accountId: a.id,
        publishedAt: fromZonedTime(`${today}T12:00:00`, timezone),
        captureMethod: "view_history_test",
      },
    });
    videoIds.push(video.id);
    await prisma.videoStatSnapshot.createMany({
      data: [
        {
          trackedVideoId: video.id,
          views: 100,
          likes: 10,
          comments: 0,
          shares: 0,
          recordedAt: fromZonedTime(`${today}T12:01:00`, timezone),
        },
        {
          trackedVideoId: video.id,
          views: 300,
          likes: 20,
          comments: 0,
          shares: 0,
          recordedAt: fromZonedTime(`${today}T12:02:00`, timezone),
        },
      ],
    });
    await upsertAccountDailyStat(a.id, today, timezone);
    await upsertAccountDailyStat(a.id, today, timezone);
    assert.equal(
      (await prisma.accountDailyStat.findUniqueOrThrow({
        where: { accountId_date: { accountId: a.id, date: fromZonedTime(`${today}T00:00:00`, timezone) } },
      })).viewsGained,
      300,
      "first snapshot plus its later delta is counted once across repeated rollups",
    );

    await prisma.accountDailyStat.createMany({
      data: [
        {
          accountId: a.id,
          date: fromZonedTime(`${previousLastDay}T00:00:00`, timezone),
          viewsGained: 300,
        },
        {
          accountId: b.id,
          date: fromZonedTime(`${today}T00:00:00`, timezone),
          viewsGained: 50,
        },
        {
          accountId: b.id,
          date: fromZonedTime(`${previousLastDay}T00:00:00`, timezone),
          viewsGained: 25,
        },
        {
          accountId: b.id,
          date: fromZonedTime(`${threeMonthsAgo}-01T00:00:00`, timezone),
          viewsGained: 10,
        },
      ],
    });

    const after = await getAccountViewHistory(user.id);
    assert.equal(after.lifetimeViews - before.lifetimeViews, 685);
    assert.equal(after.thisMonthViews - before.thisMonthViews, 350);
    assert.equal(after.previousMonthViews - before.previousMonthViews, 325);
    assert.equal(after.activeAccounts - before.activeAccounts, 2);
    const current = after.months.find((month) => month.month === currentMonth)!;
    assert.equal(current.partial, true);
    assert.equal(current.accounts.find((account) => account.accountId === a.id)?.views, 300);
    assert.equal(current.accounts.find((account) => account.accountId === b.id)?.views, 50);
    assert.equal(
      after.months.find((month) => month.month === previousMonth)?.accounts
        .find((account) => account.accountId === a.id)?.views,
      300,
      "month-end views stay in the previous month",
    );
    const gapMonth = shiftMonth(threeMonthsAgo, 1);
    const previousGap = before.months.find((month) => month.month === gapMonth);
    if (!previousGap || previousGap.noData) {
      assert.equal(after.months.find((month) => month.month === gapMonth)?.noData, true);
    }

    const beforeDeletion = await getAccountViewHistory(user.id);
    await prisma.$transaction(async (tx) => {
      await preserveAccountPerformance(tx, b);
      await tx.managedAccount.delete({ where: { id: b.id } });
    });
    assert.equal(await prisma.accountDailyStat.count({ where: { accountId: b.id } }), 0);
    assert.equal(await prisma.accountPerformanceArchiveDay.count({ where: { accountId: b.id } }), 3);
    const afterDeletion = await getAccountViewHistory(user.id);
    assert.equal(afterDeletion.lifetimeViews, beforeDeletion.lifetimeViews);
    assert.equal(afterDeletion.thisMonthViews, beforeDeletion.thisMonthViews);
    assert.equal(afterDeletion.activeAccounts, beforeDeletion.activeAccounts - 1);
    assert.equal(afterDeletion.archivedAccounts, beforeDeletion.archivedAccounts + 1);
    assert.equal(
      afterDeletion.months.find((month) => month.month === currentMonth)?.accounts
        .find((account) => account.accountId === b.id)?.archived,
      true,
    );

    const replacement = await prisma.managedAccount.create({
      data: { sectionId: section.id, tiktokUsername: b.tiktokUsername },
    });
    accountIds.push(replacement.id);
    await prisma.accountDailyStat.create({
      data: {
        accountId: replacement.id,
        date: fromZonedTime(`${today}T00:00:00`, timezone),
        viewsGained: 75,
      },
    });
    const afterReplacement = await getAccountViewHistory(user.id);
    assert.equal(afterReplacement.lifetimeViews, afterDeletion.lifetimeViews + 75);
    const replacementContributions = afterReplacement.months
      .find((month) => month.month === currentMonth)!
      .accounts.filter((account) => account.accountName === b.tiktokUsername);
    assert.equal(replacementContributions.length, 2);
    assert.equal(replacementContributions.find((account) => account.accountId === b.id)?.archived, true);
    assert.equal(replacementContributions.find((account) => account.accountId === replacement.id)?.archived, false);

    const repeated = await getAccountViewHistory(user.id);
    assert.equal(repeated.lifetimeViews, afterReplacement.lifetimeViews);
    assert.deepEqual(repeated.months, afterReplacement.months);
    console.log("PASS: lifetime/monthly totals, account contributions, access control, month boundaries, missing months, repeated rollups, deleted-account archives and replacements");
  } finally {
    await prisma.videoStatSnapshot.deleteMany({ where: { trackedVideoId: { in: videoIds } } });
    await prisma.trackedVideo.deleteMany({ where: { id: { in: videoIds } } });
    await prisma.accountDailyStat.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.accountPerformanceArchive.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.managedAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.accountSection.delete({ where: { id: section.id } });
    if (!existingRole) await prisma.role.delete({ where: { id: role.id } });
    if (previousSetting) {
      await prisma.appSetting.update({
        where: { key: "timezone" },
        data: { value: previousSetting.value },
      });
    } else {
      await prisma.appSetting.deleteMany({ where: { key: "timezone" } });
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
