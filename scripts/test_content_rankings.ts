/** Run only against the isolated state_accounts_verify database. Paid AI calls are mocked. */
import assert from "node:assert/strict";
import prisma from "../src/lib/db";
import { ensureDesk, deskData } from "../src/lib/services/content-desk/data";
import {
  queueRanking,
  processRanking,
  resumeRankings,
  viewVelocity,
  rankingHours,
} from "../src/lib/services/content-desk/ranking";

async function main() {
  assert.match(
    new URL(process.env.DATABASE_URL!).pathname,
    /state_accounts_verify$/,
  );
  await ensureDesk();
  await prisma.contentRanking.deleteMany();
  await prisma.contentStory.deleteMany();
  const actor = { userId: "ranking-test", role: "admin" };
  const now = Date.now();
  const create = async (
    title: string,
    age: number | null,
    firstAge = 0,
    status = "NEW",
  ) =>
    prisma.contentStory.create({
      data: {
        stateCode: "SC",
        title,
        status,
        items: {
          create: {
            stateCode: "SC",
            title,
            excerpt: "A factual local report",
            url: `https://example.com/${encodeURIComponent(title)}`,
            publisher: "Test",
            platform: "ARTICLE",
            publishedAt: age === null ? null : new Date(now - age * 3600000),
            firstSeenAt: new Date(now - firstAge * 3600000),
          },
        },
      },
    });
  const recent = await create("Recent story", 2);
  const unknown = await create("Unknown publication date", null, 1);
  await create("Old publication newly found", 72);
  await create("Future publication", -2);
  await create("Old unknown date", null, 72);
  await create("Rejected story", 1, 0, "REJECTED");
  assert.throws(() => rankingHours(0));
  assert.throws(() => rankingHours(169));
  assert.throws(() => rankingHours(1.5));
  assert.equal(
    viewVelocity({
      views: BigInt(200),
      previousViews: BigInt(100),
      previousObservedAt: new Date(now - 3600000),
      lastSeenAt: new Date(now),
    }),
    100,
  );
  assert.equal(
    viewVelocity({
      views: BigInt(90),
      previousViews: BigInt(100),
      previousObservedAt: new Date(now - 3600000),
      lastSeenAt: new Date(now),
    }),
    null,
  );
  process.env.GEMINI_API_KEY = "test-key";
  const body = { hours: 24, state: "SC" };
  const [first, duplicate] = await Promise.all([
    queueRanking(body, actor),
    queueRanking(body, actor),
  ]);
  assert.equal(
    first.rankingId,
    duplicate.rankingId,
    "concurrent duplicate is coalesced",
  );
  assert.equal(
    (
      await prisma.contentRanking.findUniqueOrThrow({
        where: { id: first.rankingId },
      })
    ).total,
    2,
  );
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let invalid = false;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const prompt = JSON.parse(String(init?.body)).contents[0].parts[0]
      .text as string;
    const evidence = JSON.parse(prompt.split("Evidence: ")[1]) as {
      id: string;
    }[];
    const output = evidence.map((e, i) => ({
      id: invalid ? "invented" : e.id,
      score: i === 0 ? 75 : 90,
      confidence: "HIGH",
      reason: "Local reporting with limited data",
      hook: "A local development was reported",
      caveat: "No measured momentum",
    }));
    return new Response(
      JSON.stringify({
        candidates: [
          { content: { parts: [{ text: JSON.stringify(output) }] } },
        ],
      }),
    );
  };
  try {
    await Promise.all([
      processRanking(first.rankingId),
      processRanking(first.rankingId),
    ]);
    assert.equal(calls, 1, "single atomic worker claim");
    const job = await prisma.contentRanking.findUniqueOrThrow({
      where: { id: first.rankingId },
    });
    assert.equal(job.status, "SUCCESS");
    assert.equal(job.processed, 2);
    assert.ok(
      (job.results as { confidence: string }[]).every(
        (r) => r.confidence === "MEDIUM",
      ),
      "confidence capped without momentum",
    );
    const params = new URLSearchParams({
      state: "SC",
      hours: "24",
      sort: "viral",
    });
    const data = await deskData(params, actor);
    assert.equal(data.total, 2);
    const scores = new Map(
      (job.results as { id: string; score: number }[]).map((r) => [
        r.id,
        r.score,
      ]),
    );
    assert.equal(scores.get(data.stories[0].id), 80);
    assert.deepEqual(
      new Set(data.stories.map((s) => s.id)),
      new Set([recent.id, unknown.id]),
    );
    assert.equal(
      (
        await prisma.contentStory.findUniqueOrThrow({
          where: { id: recent.id },
        })
      ).version,
      0,
      "ranking leaves editorial versions untouched",
    );
    invalid = true;
    const second = await queueRanking(body, actor);
    await processRanking(second.rankingId);
    assert.equal(
      (
        await prisma.contentRanking.findUniqueOrThrow({
          where: { id: second.rankingId },
        })
      ).status,
      "ERROR",
    );
    assert.equal(
      (
        await prisma.contentRanking.findUniqueOrThrow({
          where: { id: first.rankingId },
        })
      ).processed,
      2,
      "previous snapshot preserved",
    );
    invalid = false;
    const interrupted = await queueRanking(body, actor);
    await prisma.contentRanking.update({
      where: { id: interrupted.rankingId },
      data: { status: "RUNNING", updatedAt: new Date(now - 10 * 60000) },
    });
    await resumeRankings();
    assert.equal(
      (
        await prisma.contentRanking.findUniqueOrThrow({
          where: { id: interrupted.rankingId },
        })
      ).status,
      "SUCCESS",
    );
    for (let i = 0; i < 49; i++) await create(`Batch story ${i}`, 1);
    const large = await queueRanking(body, actor);
    await processRanking(large.rankingId);
    let largeJob = await prisma.contentRanking.findUniqueOrThrow({
      where: { id: large.rankingId },
    });
    assert.equal(largeJob.processed, 50);
    assert.equal(
      largeJob.status,
      "QUEUED",
      "large run yields to the worker after 50 stories",
    );
    invalid = true;
    await processRanking(large.rankingId);
    largeJob = await prisma.contentRanking.findUniqueOrThrow({
      where: { id: large.rankingId },
    });
    assert.equal(largeJob.status, "ERROR");
    assert.equal(
      largeJob.processed,
      50,
      "later batch failure preserves completed results",
    );
    invalid = false;
    await prisma.contentRanking.update({
      where: { id: large.rankingId },
      data: { status: "QUEUED" },
    });
    await resumeRankings();
    assert.equal(
      (
        await prisma.contentRanking.findUniqueOrThrow({
          where: { id: large.rankingId },
        })
      ).processed,
      51,
    );
    const firstPage = await deskData(params, actor);
    params.set("page", "1");
    const secondPage = await deskData(params, actor);
    assert.equal(firstPage.stories.length, 50);
    assert.equal(secondPage.stories.length, 1);
    assert.equal(
      new Set([...firstPage.stories, ...secondPage.stories].map((s) => s.id))
        .size,
      51,
      "ranking spans pages without duplicate stories",
    );
    await prisma.appSetting.upsert({
      where: { key: "content_desk_settings" },
      create: { key: "content_desk_settings", value: '{"dailyAiRankings":0}' },
      update: { value: '{"dailyAiRankings":0}' },
    });
    await assert.rejects(
      () => queueRanking(body, actor),
      /Daily AI ranking limit/,
    );
    console.log(
      "PASS: time boundaries, unknown dates, atomic deduplication and worker claims, score validation, confidence, ordering, editorial preservation, recovery and budget",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await prisma.contentRanking.deleteMany();
    await prisma.appSetting.deleteMany({
      where: { key: "content_desk_settings" },
    });
    await prisma.$disconnect();
  }
}
main().catch(async (e) => {
  console.error(e);
  process.exitCode = 1;
  await prisma.$disconnect();
});
