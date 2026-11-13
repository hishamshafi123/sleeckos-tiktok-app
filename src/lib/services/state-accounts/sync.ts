import { randomUUID } from "crypto";
import prisma from "@/lib/db";
import { analyticsProvider } from "@/lib/services/analytics/resilient";
import { ProviderError } from "@/lib/services/analytics/provider";
import type { ProviderVideo } from "@/lib/services/analytics/provider";
import { ensureStateDay, refreshActivityCounts, STATE_WHERE } from "./data";
import { observedGain, discoveryLimit } from "./rules";

export interface StateProvider {
  fetchAccountSnapshot: typeof analyticsProvider.fetchAccountSnapshot;
  fetchStatsForVideoUrls: typeof analyticsProvider.fetchStatsForVideoUrls;
}

export function stateSyncError(error: unknown): string {
  const retained = " Previous data is retained.";
  if (error instanceof ProviderError) {
    if (error.kind === "auth")
      return (
        "Analytics provider authentication failed. An admin must check the TikLiveAPI credentials; hourly retries cannot fix an invalid key." +
        retained
      );
    if (error.kind === "rate_limited")
      return (
        "Analytics provider rate or quota limit reached. Check the provider balance or quota; the next hourly run will retry." +
        retained
      );
    if (error.kind === "not_found")
      return (
        "TikTok account is private, unavailable, or renamed. Check its username and visibility." +
        retained
      );
  }
  if (error instanceof Error && /publication timestamp/.test(error.message))
    return "The provider returned an invalid posting time. Previous records are retained; the next hourly sync will retry.";
  if (
    error instanceof Error &&
    /incomplete|not returned|No usable|no videos/i.test(error.message)
  )
    return (
      "The provider returned incomplete account or video data. The next hourly run will retry." +
      retained
    );
  return (
    "Analytics provider request failed or timed out. The next hourly run will retry." +
    retained
  );
}

export async function syncStateAccounts(
  provider: StateProvider = analyticsProvider,
) {
  const owner = randomUUID();
  const now = new Date();
  const expiry = () => new Date(Date.now() + 2 * 60 * 60 * 1000);
  await prisma.stateSyncLease.createMany({
    data: [{ id: "hourly", owner: "", expiresAt: new Date(0) }],
    skipDuplicates: true,
  });
  const claimed = await prisma.stateSyncLease.updateMany({
    where: { id: "hourly", expiresAt: { lte: now } },
    data: { owner, expiresAt: expiry() },
  });
  if (!claimed.count) return { skipped: true, succeeded: 0, failed: 0 };
  let succeeded = 0,
    failed = 0;
  try {
    await ensureStateDay();
    const accounts = await prisma.stateAccount.findMany({
      where: { account: STATE_WHERE },
      include: { account: { select: { tiktokUsername: true } } },
    });
    for (const account of accounts) {
      await prisma.stateSyncLease.updateMany({
        where: { id: "hourly", owner },
        data: { expiresAt: expiry() },
      });
      await prisma.stateAccount.update({
        where: { accountId: account.accountId },
        data: { lastAttemptAt: new Date() },
      });
      try {
        const max = discoveryLimit();
        const snapshot = await provider.fetchAccountSnapshot(
          account.account.tiktokUsername,
          max,
          { source: "state_accounts" },
        );
        const previous = await prisma.stateVideo.findMany({
          where: { accountId: account.accountId },
        });
        const byId = new Map(previous.map((v) => [v.videoId, v]));
        const latestIds = new Set(snapshot.videos.map((v) => v.videoId));
        const updates: ProviderVideo[] = [
          ...new Map(snapshot.videos.map((v) => [v.videoId, v])).values(),
        ];
        const unavailable: string[] = [];
        // Refresh ALL previously discovered public videos, not just the latest
        // profile window; otherwise older posts' new views would disappear.
        const older = previous.filter(
          (v) => !latestIds.has(v.videoId) && !v.unavailable,
        );
        for (let offset = 0; offset < older.length; offset += 50) {
          await prisma.stateSyncLease.updateMany({
            where: { id: "hourly", owner },
            data: { expiresAt: expiry() },
          });
          const batch = older.slice(offset, offset + 50);
          const stats = await provider.fetchStatsForVideoUrls(
            batch.map((v) => v.url),
            { source: "state_accounts" },
          );
          for (const video of batch) {
            const stat = stats.get(video.videoId);
            if (!stat)
              throw new Error(
                "Some video statistics were not returned; retrying next hour.",
              );
            if ("unavailable" in stat) {
              unavailable.push(video.videoId);
              continue;
            }
            updates.push({
              ...stat,
              videoId: video.videoId,
              url: video.url,
              createTime: stat.createTime ?? video.publishedAt,
              text: "",
            });
          }
        }
        const observedAt = new Date();
        const day = await ensureStateDay(observedAt);
        await prisma.$transaction(
          async (tx) => {
            // Serialize timestamp writes with exact daily post recounts.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(893281)`;
            const lease = await tx.stateSyncLease.findUnique({
              where: { id: "hourly" },
            });
            if (lease?.owner !== owner || lease.expiresAt <= observedAt)
              throw new Error(
                "Sync lease expired; another worker owns this run.",
              );
            let views = BigInt(0),
              likes = BigInt(0),
              hasBaseline = false;
            for (const video of updates) {
              if (
                !(video.createTime instanceof Date) ||
                !Number.isFinite(video.createTime.getTime()) ||
                video.createTime.getTime() < Date.UTC(2010, 0, 1) ||
                video.createTime > observedAt
              ) {
                throw new Error(
                  "Invalid publication timestamp returned by provider",
                );
              }
              const old = byId.get(video.videoId);
              const newToday =
                video.createTime >= day.startsAt &&
                video.createTime < day.endsAt;
              views += observedGain(video.views, old?.views ?? null, newToday);
              likes += observedGain(video.likes, old?.likes ?? null, newToday);
              hasBaseline ||= !!old || newToday;
              const existing = await tx.stateVideo.findUnique({
                where: { videoId: video.videoId },
                select: { accountId: true },
              });
              if (existing && existing.accountId !== account.accountId)
                throw new Error("A returned video belongs to another account.");
              // Keep high-water counters so a temporary provider correction does
              // not get counted again when the count recovers.
              const counters = {
                views: old && old.views > video.views ? old.views : video.views,
                likes: old && old.likes > video.likes ? old.likes : video.likes,
                lastObservedAt: observedAt,
                unavailable: false,
              };
              await tx.stateVideo.upsert({
                where: { videoId: video.videoId },
                create: {
                  videoId: video.videoId,
                  accountId: account.accountId,
                  url: video.url,
                  publishedAt: video.createTime,
                  ...counters,
                },
                update: {
                  ...counters,
                  publishedAt: video.createTime,
                  url: video.url,
                },
              });
            }
            await tx.stateVideo.updateMany({
              where: {
                accountId: account.accountId,
                videoId: { in: unavailable },
              },
              data: { unavailable: true },
            });
            const followersObserved =
              snapshot.followers !== null && account.followers !== null;
            await tx.stateAccountDay.update({
              where: {
                accountId_dayId: {
                  accountId: account.accountId,
                  dayId: day.id,
                },
              },
              data: {
                views: { increment: views },
                likes: { increment: likes },
                followerGrowth: {
                  increment: followersObserved
                    ? snapshot.followers! - account.followers!
                    : BigInt(0),
                },
                ...(followersObserved ? { followersObserved: true } : {}),
                ...(hasBaseline ? { metricsObserved: true } : {}),
                lastSyncAt: observedAt,
              },
            });
            await tx.stateAccount.update({
              where: { accountId: account.accountId },
              data: {
                ...(snapshot.followers !== null
                  ? { followers: snapshot.followers }
                  : {}),
                ...(snapshot.likes !== null
                  ? { profileLikes: snapshot.likes }
                  : {}),
                lastSyncAt: observedAt,
                syncError: null,
              },
            });
          },
          { timeout: 60000 },
        );
        succeeded++;
      } catch (error) {
        failed++;
        console.error(
          `[State accounts] Sync failed for ${account.accountId}`,
          error,
        );
        await prisma.stateAccount.update({
          where: { accountId: account.accountId },
          data: {
            syncError: stateSyncError(error),
          },
        });
      }
    }
    await refreshActivityCounts(35);
    return { skipped: false, succeeded, failed };
  } finally {
    await prisma.stateSyncLease.deleteMany({ where: { id: "hourly", owner } });
  }
}
