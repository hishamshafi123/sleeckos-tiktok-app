import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/lib/db";
import {
  deskData,
  mutateDesk,
  ensureDesk,
} from "../src/lib/services/content-desk/data";
import { processSource } from "../src/lib/services/content-desk/worker";
import { socialItems } from "../src/lib/services/content-desk/providers";

async function main() {
  assert.match(
    new URL(process.env.DATABASE_URL!).pathname,
    /state_accounts_verify$/,
  );
  await ensureDesk();
  const suffix = randomUUID().replaceAll("-", "");
  const handle = `aznews${suffix}`;
  const url = `https://www.instagram.com/${handle}/`;
  const actor = { userId: `profile-test-${suffix}`, role: "admin" };
  const originalFetch = globalThis.fetch;
  const oldToken = process.env.APIFY_TOKEN;
  const previousSettings = await prisma.appSetting.findUnique({
    where: { key: "content_desk_settings" },
  });
  await prisma.appSetting.upsert({
    where: { key: "content_desk_settings" },
    create: {
      key: "content_desk_settings",
      value: JSON.stringify({
        dailySocialRuns: 100,
        dailyAiBriefs: 100,
        dailyAiRankings: 20,
        shortlistHour: 9,
      }),
    },
    update: {
      value: JSON.stringify({
        dailySocialRuns: 100,
        dailyAiBriefs: 100,
        dailyAiRankings: 20,
        shortlistHour: 9,
      }),
    },
  });
  process.env.APIFY_TOKEN = "test-only";
  let sourceId = "";
  let socialStarts = 0;

  globalThis.fetch = async (input) => {
    const requestUrl = String(input);
    if (requestUrl.includes("/actors/")) {
      socialStarts++;
      return Response.json({ data: { id: `profile-run-${suffix}` } });
    }
    if (requestUrl.includes("/actor-runs/")) {
      return Response.json({
        data: {
          status: "SUCCEEDED",
          defaultDatasetId: `dataset-${suffix}`,
          usageTotalUsd: 0.01,
        },
      });
    }
    if (requestUrl.includes("/datasets/")) {
      return Response.json([
        {
          id: "reel-relevant",
          url: `https://www.instagram.com/reel/relevant-${suffix}/`,
          caption: "Arizona Phoenix water announcement affects residents",
          displayUrl: "https://cdn.example.com/relevant.jpg",
          timestamp: new Date().toISOString(),
          type: "Video",
          videoViewCount: 1200,
          likesCount: 80,
          commentsCount: 9,
          videoDuration: 18.5,
        },
        {
          id: "reel-monitored",
          url: `https://www.instagram.com/reel/monitored-${suffix}/`,
          caption: "A Brooklyn cooking video with no local reference",
          displayUrl: "https://cdn.example.com/monitored.jpg",
          timestamp: new Date().toISOString(),
          type: "Video",
          videoViewCount: 500,
          likesCount: 20,
        },
      ]);
    }
    throw new Error(`Unexpected provider call ${requestUrl}`);
  };

  try {
    await mutateDesk(
      {
        action: "source.save",
        stateCode: "AZ",
        name: "Arizona profile test",
        kind: "INSTAGRAM",
        url,
        category: "AUTO",
        intervalMinutes: 240,
        includeAllPosts: false,
      },
      actor,
    );
    let source = await prisma.contentSource.findFirstOrThrow({
      where: { kind: "INSTAGRAM", profileHandle: handle },
    });
    sourceId = source.id;
    assert.equal(source.profileHandle, handle);
    assert.equal(source.includeAllPosts, false);
    await assert.rejects(
      mutateDesk(
        {
          action: "source.save",
          stateCode: "AZ",
          name: "Duplicate",
          kind: "INSTAGRAM",
          url,
          category: "AUTO",
          intervalMinutes: 240,
        },
        actor,
      ),
      /already tracked/,
    );

    assert.equal((await processSource(source)).pending, true);
    source = await prisma.contentSource.findUniqueOrThrow({
      where: { id: sourceId },
    });
    assert.equal((await processSource(source)).items, 2);
    const posts = await prisma.contentTrackedPost.findMany({
      where: { sourceId },
      orderBy: { platformPostId: "asc" },
    });
    assert.equal(posts.length, 2);
    assert.equal(posts.filter((post) => post.storyId).length, 1);
    assert.equal(
      posts.find((post) => post.platformPostId === "reel-monitored")?.storyId,
      null,
    );
    const relevant = posts.find(
      (post) => post.platformPostId === "reel-relevant",
    )!;
    assert.ok(relevant.storyId);
    assert.equal(relevant.thumbnailUrl, "https://cdn.example.com/relevant.jpg");
    assert.equal(relevant.duration, 18.5);
    assert.equal(relevant.views, BigInt(1200));
    assert.equal(relevant.comments, BigInt(9));
    source = await prisma.contentSource.findUniqueOrThrow({
      where: { id: sourceId },
    });
    assert.equal(source.trackedPostCount, 2);
    assert.ok(source.lastPostAt);

    const profileData = await deskData(
      new URLSearchParams({ profile: sourceId }),
      actor,
    );
    assert.equal(profileData.profilePosts.length, 2);
    assert.ok(profileData.sources.some((item) => item.id === sourceId));

    assert.equal((await processSource(source)).pending, true);
    source = await prisma.contentSource.findUniqueOrThrow({
      where: { id: sourceId },
    });
    await processSource(source);
    assert.equal(
      await prisma.contentTrackedPost.count({ where: { sourceId } }),
      2,
    );
    assert.equal(socialStarts, 2);
    assert.equal(
      await prisma.contentItem.count({
        where: { storyId: relevant.storyId!, url: relevant.url },
      }),
      1,
      "Repeated profile checks update rather than duplicate editorial evidence",
    );

    const monitored = posts.find(
      (post) => post.platformPostId === "reel-monitored",
    )!;
    const promotion = await mutateDesk(
      { action: "profile.promote", id: monitored.id },
      actor,
    );
    assert.ok("storyId" in promotion && promotion.storyId);
    assert.ok(
      (
        await prisma.contentTrackedPost.findUniqueOrThrow({
          where: { id: monitored.id },
        })
      ).storyId,
    );

    await mutateDesk(
      {
        action: "source.save",
        id: sourceId,
        stateCode: "SC",
        name: "Moved profile",
        kind: "INSTAGRAM",
        url,
        category: "AUTO",
        intervalMinutes: 240,
        includeAllPosts: true,
      },
      actor,
    );
    source = await prisma.contentSource.findUniqueOrThrow({
      where: { id: sourceId },
    });
    assert.equal(source.stateCode, "SC");
    assert.equal(source.includeAllPosts, true);
    assert.equal(
      await prisma.contentTrackedPost.count({
        where: { sourceId, stateCode: "AZ" },
      }),
      2,
      "Moving a profile does not rewrite historical post state attribution",
    );

    await mutateDesk({ action: "source.remove", id: sourceId }, actor);
    source = await prisma.contentSource.findUniqueOrThrow({
      where: { id: sourceId },
    });
    assert.equal(source.enabled, false);
    assert.ok(source.archivedAt);
    const removedData = await deskData(
      new URLSearchParams({ profile: sourceId }),
      actor,
    );
    assert.equal(
      removedData.sources.some((item) => item.id === sourceId),
      false,
    );
    assert.equal(removedData.profilePosts.length, 0);
    assert.ok(
      await prisma.contentStory.count({ where: { id: relevant.storyId! } }),
    );

    await mutateDesk(
      {
        action: "source.save",
        stateCode: "SC",
        name: "Restored profile",
        kind: "INSTAGRAM",
        url,
        category: "AUTO",
        intervalMinutes: 240,
      },
      actor,
    );
    source = await prisma.contentSource.findUniqueOrThrow({
      where: { id: sourceId },
    });
    assert.equal(source.archivedAt, null);
    assert.equal(source.enabled, true);
    assert.equal(source.name, "Restored profile");

    const tiktok = socialItems(
      [
        {
          id: "tt-1",
          webVideoUrl: "https://www.tiktok.com/@news/video/123",
          text: "Arizona news update",
          createTimeISO: new Date().toISOString(),
          videoCoverUrl: "https://cdn.example.com/tiktok.jpg",
          playCount: "900",
          diggCount: "40",
        },
      ],
      { ...source, kind: "TIKTOK" },
    )[0];
    assert.equal(tiktok.platformPostId, "tt-1");
    assert.equal(tiktok.thumbnailUrl, "https://cdn.example.com/tiktok.jpg");
    assert.equal(tiktok.views, BigInt(900));

    console.log(
      "PASS: monitored social posts, metadata, deduplication, manual promotion, trusted profiles, state moves, history-preserving removal, restoration and TikTok/Instagram normalization",
    );
  } finally {
    const posts = sourceId
      ? await prisma.contentTrackedPost.findMany({
          where: { sourceId },
          select: { storyId: true },
        })
      : [];
    const storyIds = posts
      .map((post) => post.storyId)
      .filter((id): id is string => !!id);
    if (sourceId) {
      await prisma.contentTrackedPost.deleteMany({ where: { sourceId } });
      await prisma.contentRun.deleteMany({ where: { sourceId } });
      await prisma.contentSource.deleteMany({ where: { id: sourceId } });
    }
    if (storyIds.length)
      await prisma.contentStory.deleteMany({ where: { id: { in: storyIds } } });
    globalThis.fetch = originalFetch;
    if (oldToken === undefined) delete process.env.APIFY_TOKEN;
    else process.env.APIFY_TOKEN = oldToken;
    if (previousSettings) {
      await prisma.appSetting.update({
        where: { key: "content_desk_settings" },
        data: { value: previousSettings.value },
      });
    } else {
      await prisma.appSetting.deleteMany({
        where: { key: "content_desk_settings" },
      });
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
