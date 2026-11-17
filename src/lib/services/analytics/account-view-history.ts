import prisma from "@/lib/db";
import { Prisma } from "@prisma/client";
import { can } from "@/lib/services/permissions";
import { getOrgTimezone } from "@/lib/services/timezone";
import { zonedDayString } from "./account-stats";
import { ForbiddenError } from "./account-performance";

export type AccountMonthContribution = {
  accountId: string;
  accountName: string;
  driveFolderName: string | null;
  views: number;
  archived: boolean;
};

export type AccountViewMonth = {
  month: string;
  views: number;
  partial: boolean;
  noData: boolean;
  accounts: AccountMonthContribution[];
};

export type AccountViewHistory = {
  lifetimeViews: number;
  thisMonthViews: number;
  previousMonthViews: number;
  monthOverMonth: number | null;
  currentMonth: string;
  trackingSince: string | null;
  timezone: string;
  activeAccounts: number;
  archivedAccounts: number;
  months: AccountViewMonth[];
};

function shiftMonth(month: string, amount: number) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 7);
}

function monthRange(first: string, last: string) {
  const months: string[] = [];
  for (
    let month = first;
    month <= last && months.length < 1200;
    month = shiftMonth(month, 1)
  ) {
    months.push(month);
  }
  return months;
}

function viewNumber(value: bigint) {
  const number = Number(value);
  if (!Number.isSafeInteger(number))
    throw new Error("View total exceeds the supported display range.");
  return number;
}

export async function preserveAccountPerformance(
  tx: Prisma.TransactionClient,
  account: {
    id: string;
    tiktokUsername: string;
    driveFolderName: string | null;
  },
) {
  const stats = await tx.accountDailyStat.findMany({
    where: { accountId: account.id },
    orderBy: { date: "asc" },
  });
  await tx.accountPerformanceArchive.upsert({
    where: { accountId: account.id },
    create: {
      accountId: account.id,
      username: account.tiktokUsername,
      driveFolderName: account.driveFolderName,
    },
    update: {
      username: account.tiktokUsername,
      driveFolderName: account.driveFolderName,
      archivedAt: new Date(),
    },
  });
  await tx.accountPerformanceArchiveDay.deleteMany({
    where: { accountId: account.id },
  });
  if (stats.length) {
    await tx.accountPerformanceArchiveDay.createMany({
      data: stats.map((stat) => ({
        accountId: stat.accountId,
        date: stat.date,
        postsCount: stat.postsCount,
        viewsGained: stat.viewsGained,
        likesGained: stat.likesGained,
        createdAt: stat.createdAt,
      })),
    });
  }
}

export async function getAccountViewHistory(
  userId: string,
): Promise<AccountViewHistory> {
  if (!(await can(userId, "analytics"))) throw new ForbiddenError();
  const timezone = await getOrgTimezone();
  const currentMonth = zonedDayString(new Date(), timezone).slice(0, 7);
  const previousMonth = shiftMonth(currentMonth, -1);

  const [monthlyRows, accounts, archivedAccounts, activeFirst, archivedFirst] =
    await Promise.all([
      prisma.$queryRaw<{ accountId: string; month: string; views: bigint }[]>`
      WITH daily AS (
        SELECT "accountId", "date", "viewsGained" FROM "AccountDailyStat"
        UNION ALL
        SELECT "accountId", "date", "viewsGained" FROM "AccountPerformanceArchiveDay"
      )
      SELECT "accountId",
        TO_CHAR((("date" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}), 'YYYY-MM') AS "month",
        SUM("viewsGained")::bigint AS "views"
      FROM daily
      GROUP BY "accountId", "month"
      ORDER BY "month", "accountId"
    `,
      prisma.managedAccount.findMany({
        select: { id: true, tiktokUsername: true, driveFolderName: true },
      }),
      prisma.accountPerformanceArchive.findMany({
        select: { accountId: true, username: true, driveFolderName: true },
      }),
      prisma.accountDailyStat.aggregate({ _min: { createdAt: true } }),
      prisma.accountPerformanceArchiveDay.aggregate({
        _min: { createdAt: true },
      }),
    ]);

  const metadata = new Map<string, AccountMonthContribution>();
  for (const account of archivedAccounts) {
    metadata.set(account.accountId, {
      accountId: account.accountId,
      accountName: account.username,
      driveFolderName: account.driveFolderName,
      views: 0,
      archived: true,
    });
  }
  for (const account of accounts) {
    metadata.set(account.id, {
      accountId: account.id,
      accountName: account.tiktokUsername,
      driveFolderName: account.driveFolderName,
      views: 0,
      archived: false,
    });
  }

  const byMonth = new Map<string, Map<string, number>>();
  for (const row of monthlyRows) {
    const contributions = byMonth.get(row.month) ?? new Map<string, number>();
    contributions.set(row.accountId, viewNumber(row.views));
    byMonth.set(row.month, contributions);
  }

  const firstMonth = monthlyRows[0]?.month;
  const months = firstMonth ? monthRange(firstMonth, currentMonth) : [];
  const history = months.map((month) => {
    const contributions = byMonth.get(month);
    const monthAccounts = [...(contributions?.entries() ?? [])]
      .filter(([, views]) => views > 0)
      .map(([accountId, views]) => ({
        ...(metadata.get(accountId) ?? {
          accountId,
          accountName: "Former account",
          driveFolderName: null,
          archived: true,
        }),
        views,
      }))
      .sort((a, b) => b.views - a.views);
    return {
      month,
      views: monthAccounts.reduce((sum, account) => sum + account.views, 0),
      partial: month === currentMonth,
      noData: !contributions,
      accounts: monthAccounts,
    };
  });

  const thisMonthViews = byMonth.get(currentMonth)
    ? [...byMonth.get(currentMonth)!.values()].reduce(
        (sum, views) => sum + views,
        0,
      )
    : 0;
  const previousMonthViews = byMonth.get(previousMonth)
    ? [...byMonth.get(previousMonth)!.values()].reduce(
        (sum, views) => sum + views,
        0,
      )
    : 0;
  const firstDates = [
    activeFirst._min.createdAt,
    archivedFirst._min.createdAt,
  ].filter((date): date is Date => !!date);

  return {
    lifetimeViews: monthlyRows.reduce(
      (sum, row) => sum + viewNumber(row.views),
      0,
    ),
    thisMonthViews,
    previousMonthViews,
    monthOverMonth:
      previousMonthViews > 0 ? thisMonthViews / previousMonthViews - 1 : null,
    currentMonth,
    trackingSince: firstDates.length
      ? new Date(
          Math.min(...firstDates.map((date) => date.getTime())),
        ).toISOString()
      : null,
    timezone,
    activeAccounts: accounts.length,
    archivedAccounts: archivedAccounts.length,
    months: history,
  };
}
