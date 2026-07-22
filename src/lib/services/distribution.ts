import prisma from "@/lib/db";
import { getOrgTimezone, getZonedDateString } from "./timezone";

// Distribution Tracker service — Track D owns this file and implements the
// full tracker (tick-off, bulk actions, filters, KPI hooks) on top of it.
// The `createDelivery` contract below is consumed by the Video Factory
// (Track C) — do not change its signature or status-mapping behavior.

export interface CreateDeliveryInput {
  accountId: string;
  campaignId?: string | null;
  batchId?: string | null;
  videoCount: number;
  fileList?: { name: string; driveFileId?: string }[];
  outputFolderId?: string | null;
  postingMode?: "manual" | "auto_schedule" | "auto_post";
}

// Records that videos were delivered into an account's Output Drive folder.
// Auto-posting accounts skip the manual tick-off: their status starts
// "scheduled" (auto_schedule) or "posted" (auto_post); manual accounts start
// "delivered" and are ticked off in the Distribution tracker.
export async function createDelivery(input: CreateDeliveryInput) {
  const postingMode = input.postingMode ?? "manual";
  const status =
    postingMode === "auto_post" ? "posted" : postingMode === "auto_schedule" ? "scheduled" : "delivered";

  return prisma.delivery.create({
    data: {
      accountId: input.accountId,
      campaignId: input.campaignId ?? null,
      batchId: input.batchId ?? null,
      videoCount: input.videoCount,
      fileList: (input.fileList ?? []) as any,
      outputFolderId: input.outputFolderId ?? null,
      status,
      postingMode,
    },
  });
}

// ── Tracker ──────────────────────────────────────────────────────────────────
// NOTE: Delivery has no Prisma relations to ManagedAccount / Campaign (plain
// string ids), so lookups are attached in a second query by the helpers below.

export interface DistributionFilters {
  campaignId?: string;
  accountId?: string;
  status?: "delivered" | "scheduled" | "posted";
  from?: Date;
  to?: Date;
}

function buildWhere(filters: DistributionFilters) {
  const where: any = {};
  if (filters.campaignId) where.campaignId = filters.campaignId;
  if (filters.accountId) where.accountId = filters.accountId;
  if (filters.status) where.status = filters.status;
  if (filters.from || filters.to) {
    where.deliveredAt = {};
    if (filters.from) where.deliveredAt.gte = filters.from;
    if (filters.to) where.deliveredAt.lte = filters.to;
  }
  return where;
}

// Attaches account (username/color), campaign (title) and the names of the
// users who scheduled/posted each delivery.
async function attachLookups<T extends { accountId: string; campaignId: string | null; confirmation?: any }>(
  deliveries: T[]
) {
  const accountIds = [...new Set(deliveries.map((d) => d.accountId))];
  const campaignIds = [...new Set(deliveries.map((d) => d.campaignId).filter(Boolean))] as string[];
  const userIds = [
    ...new Set(
      deliveries
        .flatMap((d) => [d.confirmation?.scheduledBy, d.confirmation?.postedBy])
        .filter(Boolean)
    ),
  ] as string[];

  const [accounts, campaigns, users] = await Promise.all([
    accountIds.length
      ? prisma.managedAccount.findMany({
          where: { id: { in: accountIds } },
          select: { id: true, tiktokUsername: true, color: true, driveFolderName: true },
        })
      : [],
    campaignIds.length
      ? prisma.campaign.findMany({
          where: { id: { in: campaignIds } },
          select: { id: true, title: true },
        })
      : [],
    userIds.length
      ? prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [],
  ]);

  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const campaignMap = new Map(campaigns.map((c) => [c.id, c]));
  const userMap = new Map(users.map((u) => [u.id, u]));

  return deliveries.map((d) => ({
    ...d,
    account: accountMap.get(d.accountId) ?? null,
    campaign: d.campaignId ? campaignMap.get(d.campaignId) ?? null : null,
    scheduledByUser: d.confirmation?.scheduledBy
      ? userMap.get(d.confirmation.scheduledBy) ?? null
      : null,
    postedByUser: d.confirmation?.postedBy ? userMap.get(d.confirmation.postedBy) ?? null : null,
  }));
}

/**
 * Ticks deliveries off as "scheduled in the account's planner".
 * Already-posted deliveries are left untouched (no status regression).
 */
export async function markScheduled(deliveryIds: string[], userId: string) {
  if (!deliveryIds.length) return { updated: 0 };
  const now = new Date();

  const eligible = await prisma.delivery.findMany({
    where: { id: { in: deliveryIds }, status: { not: "posted" } },
    select: { id: true },
  });
  const ids = eligible.map((d) => d.id);
  if (!ids.length) return { updated: 0 };

  await prisma.$transaction([
    prisma.delivery.updateMany({
      where: { id: { in: ids } },
      data: { status: "scheduled" },
    }),
    ...ids.map((id) =>
      prisma.deliveryConfirmation.upsert({
        where: { deliveryId: id },
        create: { deliveryId: id, scheduledAt: now, scheduledBy: userId },
        update: { scheduledAt: now, scheduledBy: userId },
      })
    ),
  ]);

  return { updated: ids.length };
}

export interface MarkPostedOptions {
  postedCount?: number;
  postedAt?: Date;
  note?: string;
}

/**
 * Ticks deliveries off as "posted to TikTok".
 * Defaults: postedCount = delivery.videoCount, postedAt = now.
 * Also logs a scheduler-function ActivityEvent per delivery for KPI:
 * count = postedCount, meta.accountsPostedTo = 1, occurredAt = postedAt
 * (so the event lands on the IST day the videos were posted), credited to
 * the ticking user. Re-marking an already-posted delivery (correction of
 * count/note) updates the confirmation but does NOT double-log KPI.
 */
export async function markPosted(deliveryIds: string[], userId: string, options: MarkPostedOptions = {}) {
  if (!deliveryIds.length) return { updated: 0 };
  const now = new Date();

  const deliveries = await prisma.delivery.findMany({
    where: { id: { in: deliveryIds } },
    include: { confirmation: true },
  });
  if (!deliveries.length) return { updated: 0 };

  const ops: any[] = [];
  for (const d of deliveries) {
    const postedCount = options.postedCount ?? d.confirmation?.postedCount ?? d.videoCount;
    const postedAt = options.postedAt ?? d.confirmation?.postedAt ?? now;
    const note = options.note !== undefined ? options.note : d.confirmation?.note ?? null;
    const alreadyPosted = d.status === "posted" && d.confirmation?.postedAt;

    ops.push(
      prisma.delivery.update({ where: { id: d.id }, data: { status: "posted" } }),
      prisma.deliveryConfirmation.upsert({
        where: { deliveryId: d.id },
        create: { deliveryId: d.id, postedCount, postedAt, postedBy: userId, note },
        update: { postedCount, postedAt, postedBy: userId, note },
      })
    );

    if (!alreadyPosted) {
      // Scheduler KPI — matches the manual scheduler log shape
      // (logManualActivity in kpi_system.ts): functionType "scheduler",
      // count = posts done, meta.accountsPostedTo, source "manual".
      ops.push(
        prisma.activityEvent.create({
          data: {
            userId,
            functionType: "scheduler",
            count: postedCount,
            occurredAt: postedAt,
            campaignId: d.campaignId ?? null,
            source: "manual",
            meta: {
              deliveryId: d.id,
              accountId: d.accountId,
              accountsPostedTo: 1,
            },
            createdBy: userId,
            approved: true,
          },
        })
      );
    }
  }

  await prisma.$transaction(ops);
  return { updated: deliveries.length };
}

/**
 * Deliveries (newest first) with account, campaign and confirmation attached.
 */
export async function getDistribution(filters: DistributionFilters = {}) {
  const deliveries = await prisma.delivery.findMany({
    where: buildWhere(filters),
    include: { confirmation: true },
    orderBy: { deliveredAt: "desc" },
  });
  return attachLookups(deliveries);
}

/**
 * Totals for the summary cards.
 * - delivered: sum of videoCount across matching deliveries
 * - accountsDelivered: distinct accounts that received a delivery
 * - scheduledCount: deliveries ticked as scheduled (confirmation.scheduledAt set)
 * - postedCount: sum of confirmation.postedCount (actual posted videos)
 * - pendingCount: deliveries still awaiting the scheduled tick
 *   (status "delivered" and never scheduled)
 */
export async function getDistributionSummary(filters: Pick<DistributionFilters, "campaignId" | "from" | "to"> = {}) {
  const deliveries = await prisma.delivery.findMany({
    where: buildWhere(filters),
    select: {
      accountId: true,
      videoCount: true,
      status: true,
      confirmation: { select: { scheduledAt: true, postedCount: true } },
    },
  });

  let delivered = 0;
  let postedCount = 0;
  let scheduledCount = 0;
  let pendingCount = 0;
  const accounts = new Set<string>();

  for (const d of deliveries) {
    delivered += d.videoCount;
    accounts.add(d.accountId);
    if (d.confirmation?.scheduledAt) scheduledCount += 1;
    if (d.confirmation?.postedCount) postedCount += d.confirmation.postedCount;
    if (d.status === "delivered" && !d.confirmation?.scheduledAt) pendingCount += 1;
  }

  return {
    delivered,
    accountsDelivered: accounts.size,
    scheduledCount,
    postedCount,
    pendingCount,
  };
}

/**
 * The daily worklist: manual deliveries still waiting to be ticked off,
 * oldest first.
 */
export async function getPendingDeliveries() {
  const deliveries = await prisma.delivery.findMany({
    where: { status: "delivered", postingMode: "manual" },
    include: { confirmation: true },
    orderBy: { deliveredAt: "asc" },
  });
  return attachLookups(deliveries);
}

/**
 * Groups a delivery list by org-timezone date + campaign for the tracker
 * page. Groups are sorted by date desc, then campaign title.
 */
export async function groupDeliveriesByDayAndCampaign<
  T extends { deliveredAt: Date; campaignId?: string | null; campaign?: { title: string } | null; videoCount: number },
>(deliveries: T[]) {
  const timezone = await getOrgTimezone();

  const groups = new Map<string, { date: string; campaignId: string | null; campaignTitle: string; deliveries: T[]; totalVideos: number }>();

  for (const d of deliveries) {
    const date = getZonedDateString(d.deliveredAt, timezone);
    const campaignId = d.campaignId ?? null;
    const key = `${date}::${campaignId ?? "none"}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        date,
        campaignId,
        campaignTitle: d.campaign?.title ?? "No campaign",
        deliveries: [],
        totalVideos: 0,
      };
      groups.set(key, group);
    }
    group.deliveries.push(d);
    group.totalVideos += d.videoCount;
  }

  return [...groups.values()].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.campaignTitle.localeCompare(b.campaignTitle);
  });
}
