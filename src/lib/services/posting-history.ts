import { fromZonedTime } from "date-fns-tz";
import prisma from "@/lib/db";
import { getOrgTimezone } from "@/lib/services/timezone";
import { naturalCompare } from "@/lib/utils/sorting";

const PUBLISHED_STATES = ["PUBLISHED", "PENDING_DELETION", "DELETED"];
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type PostingHistoryQuery = {
  from: string; // YYYY-MM-DD (org timezone)
  to: string; // YYYY-MM-DD (org timezone)
  accountIds?: string[];
  campaignIds?: string[];
};

export type PostingHistoryAccount = {
  id: string;
  username: string;
  driveFolderName: string | null;
};

export type PostingHistoryCampaign = {
  id: string;
  title: string;
};

export type PostingHistoryResult = {
  range: { from: string; to: string; timezone: string };
  accounts: PostingHistoryAccount[];
  campaigns: PostingHistoryCampaign[];
  // "<accountId>::<campaignId|null>" → count
  cells: Record<string, number>;
  rowTotals: Record<string, number>;
  colTotals: Record<string, number>;
  grandTotal: number;
  postCount: number;
};

function assertValidRange(from: string, to: string) {
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    throw new Error("from and to are required as YYYY-MM-DD");
  }
  if (from > to) {
    throw new Error("from must be on or before to");
  }
}

/** Next calendar day as YYYY-MM-DD (date-string arithmetic, DST-safe) */
function nextDay(dateStr: string): string {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

/**
 * Spreadsheet-style posting history: accounts × campaigns grid of post counts.
 * Range is [from, to] inclusive, bucketed on org-timezone day boundaries.
 * Read-only reporting over PostJob — server-side groupBy aggregation only.
 */
export async function getPostingHistory(query: PostingHistoryQuery): Promise<PostingHistoryResult> {
  const { from, to, accountIds, campaignIds } = query;
  assertValidRange(from, to);

  const tz = await getOrgTimezone();
  const gte = fromZonedTime(`${from}T00:00:00`, tz);
  const lt = fromZonedTime(`${nextDay(to)}T00:00:00`, tz);

  const groups = await prisma.postJob.groupBy({
    by: ["accountId", "campaignId"],
    where: {
      state: { in: PUBLISHED_STATES },
      publishedAt: { gte, lt },
      ...(accountIds?.length ? { accountId: { in: accountIds } } : {}),
      ...(campaignIds?.length ? { campaignId: { in: campaignIds } } : {}),
    },
    _count: { _all: true },
  });

  // ── Cells + totals ─────────────────────────────────────────────────────────
  const cells: Record<string, number> = {};
  const rowTotals: Record<string, number> = {};
  const colTotals: Record<string, number> = {};
  let grandTotal = 0;

  const postedAccountIds = new Set<string>();
  const postedCampaignIds = new Set<string>();

  for (const g of groups) {
    const count = g._count._all;
    if (count === 0) continue;
    const campaignKey = g.campaignId ?? "null";
    cells[`${g.accountId}::${campaignKey}`] = count;
    rowTotals[g.accountId] = (rowTotals[g.accountId] || 0) + count;
    colTotals[campaignKey] = (colTotals[campaignKey] || 0) + count;
    grandTotal += count;
    postedAccountIds.add(g.accountId);
    if (g.campaignId) postedCampaignIds.add(g.campaignId);
  }

  // ── Accounts ───────────────────────────────────────────────────────────────
  // Always include accounts that have posts. With no account filter, also
  // include zero-post active accounts (the UI's hide-zero toggle hides them).
  const accountIdSet = new Set<string>(postedAccountIds);
  if (accountIds?.length) {
    for (const id of accountIds) accountIdSet.add(id);
  }
  const accountRows = await prisma.managedAccount.findMany({
    where: accountIds?.length
      ? { id: { in: [...accountIdSet] } }
      : { OR: [{ id: { in: [...accountIdSet] } }, { isActive: true }] },
    select: { id: true, tiktokUsername: true, driveFolderName: true },
  });
  const accounts: PostingHistoryAccount[] = accountRows
    .map((a) => ({ id: a.id, username: a.tiktokUsername, driveFolderName: a.driveFolderName }))
    .sort((a, b) =>
      naturalCompare(a.driveFolderName || "", b.driveFolderName || "") ||
      naturalCompare(a.username, b.username)
    );

  // ── Campaigns ──────────────────────────────────────────────────────────────
  // Union of campaigns present in the cells and any explicitly filtered ones.
  const campaignIdSet = new Set<string>(postedCampaignIds);
  if (campaignIds?.length) {
    for (const id of campaignIds) campaignIdSet.add(id);
  }
  const campaignRows = campaignIdSet.size
    ? await prisma.campaign.findMany({
        where: { id: { in: [...campaignIdSet] } },
        select: { id: true, title: true },
      })
    : [];
  const titleById = new Map(campaignRows.map((c) => [c.id, c.title]));
  const campaigns: PostingHistoryCampaign[] = [...campaignIdSet]
    .map((id) => ({ id, title: titleById.get(id) || id }))
    .sort((a, b) => naturalCompare(a.title, b.title));

  return {
    range: { from, to, timezone: tz },
    accounts,
    campaigns,
    cells,
    rowTotals,
    colTotals,
    grandTotal,
    postCount: grandTotal,
  };
}

// ── CSV export ────────────────────────────────────────────────────────────────

/** RFC-4180 field escaping */
function csvField(value: string | number): string {
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * CSV grid: first column "Account / Drive Folder", one column per campaign +
 * "No Campaign" + "Total", one row per account, totals row at the bottom.
 */
export async function exportPostingHistoryCsv(query: PostingHistoryQuery): Promise<string> {
  const data = await getPostingHistory(query);

  const header = [
    "Account / Drive Folder",
    ...data.campaigns.map((c) => c.title),
    "No Campaign",
    "Total",
  ];

  const lines: string[] = [header.map(csvField).join(",")];

  for (const account of data.accounts) {
    const identity = account.driveFolderName
      ? `@${account.username} (${account.driveFolderName})`
      : `@${account.username}`;
    const cellsForRow = data.campaigns.map(
      (c) => data.cells[`${account.id}::${c.id}`] || 0
    );
    const noCampaign = data.cells[`${account.id}::null`] || 0;
    const total = data.rowTotals[account.id] || 0;
    lines.push(
      [identity, ...cellsForRow, noCampaign, total].map(csvField).join(",")
    );
  }

  const totalsRow = [
    "Total",
    ...data.campaigns.map((c) => data.colTotals[c.id] || 0),
    data.colTotals["null"] || 0,
    data.grandTotal,
  ];
  lines.push(totalsRow.map(csvField).join(","));

  return lines.join("\r\n") + "\r\n";
}
