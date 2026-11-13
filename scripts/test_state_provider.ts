/** Run only against the isolated state_accounts_verify database. */
import assert from "node:assert/strict";
import prisma from "../src/lib/db";
import { TikLiveProvider } from "../src/lib/services/analytics/tiklive";
import { TikLiveOnlyProvider } from "../src/lib/services/analytics/resilient";
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
    const notices: { title: string; body: string }[] = [];
    const notify = async (notice: { title: string; body: string }) => {
      notices.push(notice);
    };
    const provider = new TikLiveOnlyProvider(tik, notify);
    await provider.fetchAccountSnapshot("state_qa", 50, ctx);
    assert.equal(ctx.usedProvider, "TikLiveAPI");
    await provider.fetchLatestVideosForAccount("state_qa", 1, ctx);
    assert.equal(ctx.usedProvider, "TikLiveAPI");
    await provider.fetchStatsForVideoUrls(
      ["https://www.tiktok.com/@state_qa/video/123"],
      ctx,
    );
    assert.equal(ctx.usedProvider, "TikLiveAPI");
    let calls = 0;
    let failure: ProviderError | null = new ProviderError(
      "auth",
      "secret-token",
    );
    const response = async () => {
      calls++;
      if (failure) throw failure;
      return snapshot;
    };
    const failing = new TikLiveOnlyProvider(
      {
        fetchAccountSnapshot: response,
        fetchLatestVideosForAccount: async () => (await response()).videos,
        fetchStatsForVideoUrls: async () => {
          await response();
          return new Map();
        },
      },
      notify,
    );
    for (const operation of [
      () => failing.fetchAccountSnapshot("state_qa", 50, ctx),
      () => failing.fetchLatestVideosForAccount("state_qa", 50, ctx),
      () => failing.fetchStatsForVideoUrls([], ctx),
    ]) {
      const before = calls;
      ctx.usedProvider = "Apify"; // An old attribution must never survive a failed call.
      await assert.rejects(operation(), /secret-token/);
      assert.equal(
        calls,
        before + 1,
        "only the configured TikLive provider is called",
      );
      assert.equal(ctx.usedProvider, undefined);
    }
    assert.ok(notices.every((n) => !n.body.includes("secret-token")));
    assert.ok(notices.some((n) => n.body.includes("TIKLIVE_API_KEY")));
    failure = null;
    await failing.fetchAccountSnapshot("state_qa", 50, ctx);
    assert.equal(ctx.usedProvider, "TikLiveAPI");
    assert.equal(notices.at(-1)?.title, "TikLiveAPI responding again");
    const noticeCount = notices.length;
    failure = new ProviderError("not_found", "private");
    await assert.rejects(
      failing.fetchAccountSnapshot("state_qa", 50, ctx),
      /private/,
    );
    assert.equal(
      notices.length,
      noticeCount,
      "private accounts do not trigger outage alerts",
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
      "PASS: fresh followers, profile identity, strict timestamps/metrics, TikLive-only calls, failure propagation and actionable sanitized errors",
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
