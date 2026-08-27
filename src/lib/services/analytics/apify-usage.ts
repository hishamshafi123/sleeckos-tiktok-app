/**
 * Read-side services for the Apify Usage page + the org-level estimated-cost
 * rates stored in AppSetting. All functions are permission-checked (tool key
 * "analytics" for reads; rates are org config and mutate under "users_access",
 * the de-facto admin key). All amounts are USD; "est" figures are
 * calls×costPerCall + results×costPerResult, clearly separate from the
 * actual usageUsd sums reported by Apify run metadata.
 */

import prisma from "@/lib/db";
import { can } from "@/lib/services/permissions";
import { ForbiddenError } from "@/lib/services/analytics/account-performance";
import { getOrgTimezone } from "@/lib/services/timezone";
import { zonedDayBounds, zonedDayString } from "@/lib/services/analytics/account-stats";

const DAY_MS = 24 * 60 * 60 * 1000;

const RATE_PER_CALL_KEY = "apifyCostPerCall";
const RATE_PER_RESULT_KEY = "apifyCostPerResult";
const DEFAULT_COST_PER_CALL = 0.02;
const DEFAULT_COST_PER_RESULT = 0;

async function assertAccess(userId: string): Promise<void> {
  if (!(await can(userId, "analytics"))) throw new ForbiddenError();
}

// ── Rates ───────────────────────────────────────────────────────────────────

export interface ApifyRates {
  costPerCall: number;
  costPerResult: number;
}

async function readRates(): Promise<ApifyRates> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: [RATE_PER_CALL_KEY, RATE_PER_RESULT_KEY] } },
  });
  const byKey = new Map(rows.map((r) => [r.key, Number(r.value)]));
  const perCall = byKey.get(RATE_PER_CALL_KEY);
  const perResult = byKey.get(RATE_PER_RESULT_KEY);
  return {
    costPerCall: perCall != null && Number.isFinite(perCall) ? perCall : DEFAULT_COST_PER_CALL,
    costPerResult:
      perResult != null && Number.isFinite(perResult) ? perResult : DEFAULT_COST_PER_RESULT,
  };
}

export async function getApifyRates(userId: string): Promise<ApifyRates> {
  await assertAccess(userId);
  return readRates();
}

export async function setApifyRates(userId: string, rates: ApifyRates): Promise<ApifyRates> {
  // Org-level config — admin-only, same key that guards user management.
  if (!(await can(userId, "users_access"))) throw new ForbiddenError();
  for (const v of [rates.costPerCall, rates.costPerResult]) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      throw new Error("Rates must be finite numbers ≥ 0.");
    }
  }
  await prisma.$transaction([
    prisma.appSetting.upsert({
      where: { key: RATE_PER_CALL_KEY },
      update: { value: String(rates.costPerCall) },
      create: { key: RATE_PER_CALL_KEY, value: String(rates.costPerCall) },
    }),
    prisma.appSetting.upsert({
      where: { key: RATE_PER_RESULT_KEY },
      update: { value: String(rates.costPerResult) },
      create: { key: RATE_PER_RESULT_KEY, value: String(rates.costPerResult) },
    }),
  ]);
  return { costPerCall: rates.costPerCall, costPerResult: rates.costPerResult };
}

const estCost = (calls: number, results: number, rates: ApifyRates) =>
  calls * rates.costPerCall + results * rates.costPerResult;

// ── Overview (today / 7d / 30d) ─────────────────────────────────────────────

export interface ApifyUsageWindow {
  calls: number;
  results: number;
  estCostUsd: number;
  actualUsd: number; // sum of usageUsd over rows that have it
  actualRows: number; // how many rows carry actual cost data
}

export async function getApifyUsageOverview(
  userId: string
): Promise<{ rates: ApifyRates; today: ApifyUsageWindow; last7d: ApifyUsageWindow; last30d: ApifyUsageWindow }> {
  await assertAccess(userId);
  const tz = await getOrgTimezone();
  const today = zonedDayString(new Date(), tz);
  const dayStart = (daysAgo: number) =>
    zonedDayBounds(new Date(Date.parse(`${today}T00:00:00Z`) - daysAgo * DAY_MS).toISOString().slice(0, 10), tz).start;

  const window_ = async (gte: Date, rates: ApifyRates): Promise<ApifyUsageWindow> => {
    const [agg, actualRows] = await Promise.all([
      prisma.apifyCallLog.aggregate({
        where: { createdAt: { gte } },
        _count: { _all: true },
        _sum: { resultCount: true, usageUsd: true },
      }),
      prisma.apifyCallLog.count({ where: { createdAt: { gte }, usageUsd: { not: null } } }),
    ]);
    const calls = agg._count._all;
    const results = agg._sum.resultCount ?? 0;
    return {
      calls,
      results,
      estCostUsd: estCost(calls, results, rates),
      actualUsd: agg._sum.usageUsd ?? 0,
      actualRows,
    };
  };

  const rates = await readRates();
  const [todayW, last7d, last30d] = await Promise.all([
    window_(dayStart(0), rates),
    window_(dayStart(6), rates),
    window_(dayStart(29), rates),
  ]);
  return { rates, today: todayW, last7d, last30d };
}

// ── By source ───────────────────────────────────────────────────────────────

export interface ApifyUsageSourceRow {
  source: string;
  calls: number;
  results: number;
  estCostUsd: number;
  actualUsd: number;
  sharePct: number; // share of total est cost across sources
}

export async function getApifyUsageBySource(
  userId: string,
  days = 30
): Promise<{ days: number; totalEstCostUsd: number; rows: ApifyUsageSourceRow[] }> {
  await assertAccess(userId);
  const tz = await getOrgTimezone();
  const today = zonedDayString(new Date(), tz);
  const { start } = zonedDayBounds(
    new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * DAY_MS).toISOString().slice(0, 10),
    tz
  );
  const rates = await readRates();

  const grouped = await prisma.apifyCallLog.groupBy({
    by: ["source"],
    where: { createdAt: { gte: start } },
    _count: { _all: true },
    _sum: { resultCount: true, usageUsd: true },
  });

  const rows: ApifyUsageSourceRow[] = grouped.map((g) => {
    const est = estCost(g._count._all, g._sum.resultCount ?? 0, rates);
    return {
      source: g.source,
      calls: g._count._all,
      results: g._sum.resultCount ?? 0,
      estCostUsd: est,
      actualUsd: g._sum.usageUsd ?? 0,
      sharePct: 0,
    };
  });
  const totalEst = rows.reduce((a, r) => a + r.estCostUsd, 0);
  for (const r of rows) r.sharePct = totalEst > 0 ? (r.estCostUsd / totalEst) * 100 : 0;
  rows.sort((a, b) => b.estCostUsd - a.estCostUsd || a.source.localeCompare(b.source));
  return { days, totalEstCostUsd: totalEst, rows };
}

// ── Daily series (stacked by source) ────────────────────────────────────────

export interface ApifyUsageDay {
  day: string; // YYYY-MM-DD in org tz
  calls: number;
  results: number;
  estCostUsd: number;
  actualUsd: number;
  bySource: Record<string, number>; // source → calls (for the stacked bar)
}

export async function getApifyUsageDaily(
  userId: string,
  days = 30
): Promise<{ days: ApifyUsageDay[] }> {
  await assertAccess(userId);
  const tz = await getOrgTimezone();
  const today = zonedDayString(new Date(), tz);
  const dayList = Array.from({ length: days }, (_, i) =>
    new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10)
  );
  const { start } = zonedDayBounds(dayList[0], tz);
  const rates = await readRates();

  const rows = await prisma.apifyCallLog.findMany({
    where: { createdAt: { gte: start } },
    select: { createdAt: true, source: true, resultCount: true, usageUsd: true },
  });

  const byDay = new Map<string, ApifyUsageDay>();
  for (const r of rows) {
    const day = zonedDayString(r.createdAt, tz);
    const d =
      byDay.get(day) ??
      (() => {
        const fresh: ApifyUsageDay = {
          day,
          calls: 0,
          results: 0,
          estCostUsd: 0,
          actualUsd: 0,
          bySource: {},
        };
        byDay.set(day, fresh);
        return fresh;
      })();
    d.calls++;
    d.results += r.resultCount;
    d.actualUsd += r.usageUsd ?? 0;
    d.bySource[r.source] = (d.bySource[r.source] ?? 0) + 1;
  }
  for (const d of byDay.values()) {
    d.estCostUsd = estCost(d.calls, d.results, rates);
  }

  return {
    days: dayList.map(
      (day) =>
        byDay.get(day) ?? { day, calls: 0, results: 0, estCostUsd: 0, actualUsd: 0, bySource: {} }
    ),
  };
}

// ── Top fetched accounts ────────────────────────────────────────────────────

export interface ApifyTopAccountRow {
  handle: string; // without @
  calls: number;
  results: number;
  estCostUsd: number;
}

export async function getTopFetchedAccounts(
  userId: string,
  days = 7
): Promise<{ days: number; rows: ApifyTopAccountRow[] }> {
  await assertAccess(userId);
  const tz = await getOrgTimezone();
  const today = zonedDayString(new Date(), tz);
  const { start } = zonedDayBounds(
    new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * DAY_MS).toISOString().slice(0, 10),
    tz
  );
  const rates = await readRates();

  const grouped = await prisma.apifyCallLog.groupBy({
    by: ["inputSummary"],
    where: { createdAt: { gte: start }, inputType: "account" },
    _count: { _all: true },
    _sum: { resultCount: true },
    orderBy: { _count: { inputSummary: "desc" } },
    take: 20,
  });

  return {
    days,
    rows: grouped.map((g) => ({
      handle: g.inputSummary.replace(/^@/, ""),
      calls: g._count._all,
      results: g._sum.resultCount ?? 0,
      estCostUsd: estCost(g._count._all, g._sum.resultCount ?? 0, rates),
    })),
  };
}

// ── Recent raw calls ────────────────────────────────────────────────────────

export interface ApifyRecentCall {
  id: string;
  createdAt: string; // ISO
  source: string;
  inputType: string;
  inputSummary: string;
  inputCount: number;
  resultCount: number;
  apifyRunId: string | null;
  durationMs: number | null;
  usageUsd: number | null;
  status: string;
  errorKind: string | null;
}

export async function getRecentApifyCalls(
  userId: string,
  limit = 50
): Promise<{ rows: ApifyRecentCall[] }> {
  await assertAccess(userId);
  const take = Math.min(Math.max(1, Math.trunc(limit)), 200);
  const rows = await prisma.apifyCallLog.findMany({
    orderBy: { createdAt: "desc" },
    take,
  });
  return {
    rows: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      source: r.source,
      inputType: r.inputType,
      inputSummary: r.inputSummary,
      inputCount: r.inputCount,
      resultCount: r.resultCount,
      apifyRunId: r.apifyRunId,
      durationMs: r.durationMs,
      usageUsd: r.usageUsd,
      status: r.status,
      errorKind: r.errorKind,
    })),
  };
}
