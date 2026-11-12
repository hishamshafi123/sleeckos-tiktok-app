/** Run only against the isolated state_accounts_verify database. */
import assert from "node:assert/strict";
import prisma from "../src/lib/db";
import { TikLiveProvider } from "../src/lib/services/analytics/tiklive";
import { FallbackProvider } from "../src/lib/services/analytics/resilient";
import {
  ProviderError,
  type ProviderCallContext,
} from "../src/lib/services/analytics/provider";
import { stateSyncError } from "../src/lib/services/state-accounts/sync";

async function main() {
  assert.match(
    new URL(process.env.DATABASE_URL!).pathname,
    /state_accounts_verify$/,
  );
  const previousFetch = globalThis.fetch;
  const key = process.env.TIKLIVE_API_KEY;
  process.env.TIKLIVE_API_KEY = "test-key";
  let followers: unknown = 100;
  let timestamp: unknown = 1700000000;
  let views: unknown = 25;
  let name = "state_qa";
  let privateAccount = false;
  let profileRequests = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "api.tikliveapi.com");
    if (url.pathname.includes("userinfo")) {
      profileRequests++;
      return Response.json({
        user: { id: "qa-user", uniqueId: name, privateAccount },
        stats: { followerCount: followers, heartCount: 500, videoCount: 1 },
      });
    }
    if (url.pathname.includes("user-posts"))
      return Response.json({
        videos: [
          {
            video_id: "123",
            create_time: timestamp,
            play_count: views,
            digg_count: 2,
          },
        ],
        hasMore: false,
      });
    return Response.json({
      id: "123",
      create_time: timestamp,
      play_count: views,
      digg_count: 2,
    });
  };
  try {
    const tik = new TikLiveProvider();
    const ctx: ProviderCallContext = { source: "state_accounts" };
    let snapshot = await tik.fetchAccountSnapshot("state_qa", 50, ctx);
    assert.equal(snapshot.followers, BigInt(100));
    assert.equal(snapshot.videos[0].views, BigInt(25));
    followers = 107;
    timestamp = 1700000000000;
    snapshot = await tik.fetchAccountSnapshot("state_qa", 50, ctx);
    assert.equal(
      snapshot.followers,
      BigInt(107),
      "followers are freshly fetched each time",
    );
    assert.equal(
      profileRequests,
      2,
      "snapshot does not perform another user lookup",
    );
    assert.equal(
      snapshot.videos[0].createTime.toISOString(),
      "2023-11-14T22:13:20.000Z",
    );
    timestamp = Date.now() + 86400000;
    await assert.rejects(
      tik.fetchAccountSnapshot("state_qa", 50, ctx),
      /publication timestamp/,
    );
    timestamp = 1700000000;
    views = undefined;
    await assert.rejects(
      tik.fetchAccountSnapshot("state_qa", 50, ctx),
      /incomplete video metrics/,
    );
    await assert.rejects(
      tik.fetchStatsForVideoUrls(
        ["https://www.tiktok.com/@state_qa/video/123"],
        ctx,
      ),
      /incomplete video metrics/,
    );
    views = 25;
    followers = undefined;
    await assert.rejects(
      tik.fetchAccountSnapshot("state_qa", 50, ctx),
      /profile counters/,
    );
    followers = 107;
    name = "another_account";
    await assert.rejects(
      tik.fetchAccountSnapshot("state_qa", 50, ctx),
      /mismatched/,
    );
    name = "state_qa";
    privateAccount = true;
    await assert.rejects(
      tik.fetchAccountSnapshot("state_qa", 50, ctx),
      /private/,
    );
    privateAccount = false;
    let fallbackCalls = 0;
    const fallback = {
      fetchAccountSnapshot: async () => {
        fallbackCalls++;
        return snapshot;
      },
      fetchLatestVideosForAccount: async () => [],
      fetchStatsForVideoUrls: async () => new Map(),
    };
    const provider = new FallbackProvider(tik, fallback);
    await provider.fetchAccountSnapshot("state_qa", 50, ctx);
    assert.equal(
      fallbackCalls,
      0,
      "healthy primary bypasses invalid Apify credentials",
    );
    assert.equal(ctx.usedProvider, "TikLiveAPI");
    const failing = {
      ...fallback,
      fetchAccountSnapshot: async () => {
        throw new ProviderError("auth", "invalid primary key");
      },
    };
    await new FallbackProvider(failing, fallback).fetchAccountSnapshot(
      "state_qa",
      50,
      ctx,
    );
    assert.equal(fallbackCalls, 1);
    assert.equal(ctx.usedProvider, "Apify");
    await assert.rejects(
      new FallbackProvider(
        {
          ...failing,
          fetchAccountSnapshot: async () => {
            throw new ProviderError("not_found", "private");
          },
        },
        fallback,
      ).fetchAccountSnapshot("state_qa", 50, ctx),
      /private/,
    );
    assert.equal(
      fallbackCalls,
      1,
      "private profiles should not trigger another paid scrape",
    );
    assert.match(
      stateSyncError(new ProviderError("auth", "secret-token")),
      /credentials/,
    );
    assert.ok(
      !stateSyncError(new ProviderError("auth", "secret-token")).includes(
        "secret-token",
      ),
    );
    assert.match(
      stateSyncError(new ProviderError("rate_limited", "quota")),
      /quota/,
    );
    assert.match(
      stateSyncError(new ProviderError("not_found", "private")),
      /username/,
    );
    console.log(
      "PASS: fresh followers, profile identity, strict timestamps/metrics, primary/fallback snapshots and actionable sanitized errors",
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (key === undefined) delete process.env.TIKLIVE_API_KEY;
    else process.env.TIKLIVE_API_KEY = key;
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
