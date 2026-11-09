/** DATABASE_URL=postgresql://hishamshafi@localhost:5432/sleeckos_state_accounts_verify npx tsx scripts/test_content_desk.ts */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/lib/db";
import {
  ensureDesk,
  mutateDesk,
  deskData,
} from "../src/lib/services/content-desk/data";
import { ingest } from "../src/lib/services/content-desk/ingest";
import {
  processSource,
  generateBrief,
  runDesk,
  validateBrief,
} from "../src/lib/services/content-desk/worker";
import {
  parseFeed,
  socialItems,
  type Candidate,
} from "../src/lib/services/content-desk/providers";
import {
  safeText,
  isPublicIPv4,
} from "../src/lib/services/content-desk/network";
import {
  date,
  sourceUrl,
  relevant,
  similar,
  accountStateName,
} from "../src/lib/services/content-desk/rules";
import { GET as cron } from "../src/app/api/cron/content-desk/route";

async function main() {
  assert.match(
    new URL(process.env.DATABASE_URL!).pathname,
    /state_accounts_verify$/,
    "Use only the isolated verification database",
  );
  await prisma.contentRun.deleteMany();
  await prisma.contentStory.deleteMany();
  await prisma.contentSource.deleteMany();
  await prisma.contentState.deleteMany();
  await prisma.appSetting.deleteMany({
    where: { key: { startsWith: "content_desk_" } },
  });
  await ensureDesk();
  await ensureDesk();
  assert.equal(await prisma.contentState.count(), 10);
  assert.equal(await prisma.contentSource.count(), 40);
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "172.31.1.1",
    "192.168.1.1",
    "100.64.1.1",
    "::1",
    "0.0.0.0",
  ])
    assert.equal(isPublicIPv4(ip), false);
  assert.equal(isPublicIPv4("8.8.8.8"), true);
  await assert.rejects(
    () => safeText("https://127.0.0.1/test"),
    /public website/,
  );
  assert.throws(() => sourceUrl("TIKTOK", "https://evil.example/@news"));
  assert.throws(() =>
    sourceUrl("INSTAGRAM", "https://www.instagram.com/p/abc"),
  );
  assert.throws(() => sourceUrl("RSS", "https://user:pass@example.com/feed"));
  assert.equal(sourceUrl("TIKTOK", "@news"), "https://www.tiktok.com/@news");
  assert.equal(date(1700000000000)?.getTime(), 1700000000000);
  assert.equal(
    accountStateName({ stateName: null, guardianPhone: { name: "Arizona" } }),
    "Arizona",
  );
  assert.equal(
    relevant("Tbilisi Georgia election", "", "Georgia,Atlanta", "Tbilisi"),
    false,
  );
  assert.equal(
    relevant("Virginia bridge opens", "", "Virginia,Richmond", "West Virginia"),
    true,
  );
  assert.equal(
    similar(
      "Arizona approves new Phoenix water conservation plan",
      "Arizona approves Phoenix water conservation plan",
    ),
    true,
  );
  assert.equal(similar("Arizona water plan", "Arizona music festival"), false);
  const rss = parseFeed(
    "<rss><channel><item><title>Arizona &amp; Phoenix news</title><link>https://example.com/a?utm_source=test</link><description><![CDATA[<p>A water report</p>]]></description><pubDate>Mon, 09 Nov 2026 08:00:00 GMT</pubDate></item></channel></rss>",
    "https://example.com/feed",
    "Example",
  );
  assert.equal(rss[0].title, "Arizona & Phoenix news");
  assert.equal(rss[0].url, "https://example.com/a");
  const atom = parseFeed(
    '<feed><entry><title>Arizona event</title><link href="https://example.com/atom"/><summary>Festival</summary></entry></feed>',
    "https://example.com/feed",
    "Example",
  );
  assert.equal(atom.length, 1);
  assert.throws(() =>
    parseFeed(
      '<!DOCTYPE rss [<!ENTITY x "hello">]><rss/>',
      "https://example.com",
      "x",
    ),
  );
  assert.throws(() =>
    parseFeed(
      "<html><title>No feed</title></html>",
      "https://example.com",
      "x",
    ),
  );
  const role = await prisma.role.upsert({
    where: { key: "desk-test" },
    create: { key: "desk-test", label: "Desk test" },
    update: {},
  });
  const uid = randomUUID(),
    uid2 = randomUUID();
  await prisma.user.createMany({
    data: [
      {
        id: uid,
        email: `${uid}@example.test`,
        roleId: role.id,
        status: "ACTIVE",
      },
      {
        id: uid2,
        email: `${uid2}@example.test`,
        roleId: role.id,
        status: "ACTIVE",
      },
    ],
  });
  const team = await prisma.stateTeam.create({
      data: { name: `Desk ${uid}`, members: { create: { userId: uid } } },
    }),
    other = await prisma.stateTeam.create({
      data: { name: `Other ${uid}`, members: { create: { userId: uid2 } } },
    });
  const member = { userId: uid, role: "editor" },
    outsider = { userId: uid2, role: "editor" },
    admin = { userId: uid, role: "admin" };
  const state = await prisma.contentState.findUniqueOrThrow({
    where: { code: "AZ" },
  });
  const candidate: Candidate = {
    url: "https://example.com/water",
    title: "Arizona approves new Phoenix water conservation plan",
    excerpt:
      "Arizona officials announced a water conservation plan in Phoenix.",
    publisher: "Example",
    platform: "ARTICLE",
    publishedAt: new Date(),
    coverage: "FEED_EXCERPT",
    views: BigInt(100),
  };
  const id = (await ingest(candidate, state, null))!;
  assert.ok(id);
  await ingest({ ...candidate, views: BigInt(150) }, state, null);
  assert.equal(await prisma.contentItem.count({ where: { storyId: id } }), 1);
  const item = await prisma.contentItem.findFirstOrThrow({
    where: { storyId: id },
  });
  assert.equal(item.previousViews, BigInt(100));
  await ingest(
    {
      ...candidate,
      url: "https://other.example.com/water",
      title: "Arizona approves Phoenix water conservation plan",
    },
    state,
    null,
  );
  assert.equal(await prisma.contentItem.count({ where: { storyId: id } }), 2);
  assert.equal(
    await ingest(
      {
        ...candidate,
        url: "https://example.com/old",
        publishedAt: new Date(Date.now() - 10 * 86400000),
      },
      state,
      null,
    ),
    null,
  );
  assert.equal(
    await ingest(
      {
        ...candidate,
        url: "https://example.com/unrelated",
        title: "Ohio schools expand",
        excerpt: "Columbus news",
      },
      state,
      null,
    ),
    null,
  );
  await assert.rejects(
    () =>
      mutateDesk(
        {
          action: "settings.save",
          dailySocialRuns: 1,
          dailyAiBriefs: 2,
          shortlistHour: 9,
        },
        member,
      ),
    /Only admins/,
  );
  await mutateDesk(
    {
      action: "source.save",
      stateCode: "AZ",
      name: "My TikTok",
      kind: "TIKTOK",
      url: "@phoenixnews",
      category: "AUTO",
      intervalMinutes: 240,
    },
    member,
  );
  const source = await prisma.contentSource.findFirstOrThrow({
    where: { kind: "TIKTOK" },
  });
  await assert.rejects(
    () =>
      mutateDesk(
        { action: "source.toggle", id: source.id, enabled: false },
        outsider,
      ),
    /owner or an admin/,
  );
  await mutateDesk(
    { action: "source.toggle", id: source.id, enabled: false },
    member,
  );
  let story = await prisma.contentStory.findUniqueOrThrow({ where: { id } });
  await mutateDesk(
    {
      action: "story.update",
      id,
      versions: { [id]: story.version },
      status: "SELECTED",
      teamId: team.id,
    },
    member,
  );
  await assert.rejects(
    () =>
      mutateDesk(
        {
          action: "story.update",
          id,
          versions: { [id]: story.version },
          status: "SELECTED",
          teamId: other.id,
        },
        outsider,
      ),
    /updated this story/,
  );
  story = await prisma.contentStory.findUniqueOrThrow({ where: { id } });
  await assert.rejects(
    () =>
      mutateDesk(
        {
          action: "story.update",
          id,
          versions: { [id]: story.version },
          status: "REJECTED",
        },
        outsider,
      ),
    /another team/,
  );
  await assert.rejects(
    () =>
      mutateDesk(
        {
          action: "story.update",
          id,
          versions: { [id]: story.version },
          status: "POSTED",
        },
        member,
      ),
    /published post URL/,
  );
  await mutateDesk(
    {
      action: "story.update",
      id,
      versions: { [id]: story.version },
      status: "APPROVED",
      notes: "Checked original sources",
    },
    member,
  );
  await ingest(
    {
      ...candidate,
      excerpt: "Arizona officials updated the water plan in Phoenix.",
    },
    state,
    null,
  );
  assert.equal(
    (await prisma.contentStory.findUniqueOrThrow({ where: { id } }))
      .needsReview,
    true,
  );
  await mutateDesk(
    {
      action: "manual.add",
      stateCode: "AZ",
      url: "https://example.com/manual",
      title: "My community event",
      notes: "I have a lead to check.",
    },
    member,
  );
  assert.equal(
    await prisma.contentStory.count({
      where: { title: "My community event", status: "NEEDS_REVIEW" },
    }),
    1,
  );
  const payload = await deskData(new URLSearchParams({ state: "AZ" }), member);
  assert.ok(payload.stories.length >= 2);
  assert.equal(payload.states.length, 10);
  assert.throws(
    () =>
      validateBrief(
        {
          summary: "x",
          whyItMatters: "x",
          hook: "x",
          talkingPoints: [{ text: "x", sourceIds: ["unknown"] }],
          questions: [],
        },
        new Set([item.id]),
      ),
    /missing evidence/,
  );
  const originalFetch = globalThis.fetch;
  const oldApi = process.env.APIFY_TOKEN,
    oldAI = process.env.GEMINI_API_KEY;
  process.env.APIFY_TOKEN = "test-only";
  process.env.GEMINI_API_KEY = "test-only";
  try {
    let socialStarts = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("generativelanguage")) {
        const body = JSON.parse(String(init?.body));
        const prompt = body.contents[0].parts[0].text;
        const evidence = JSON.parse(prompt.split("Evidence JSON: ")[1]);
        return Response.json({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      summary: "Officials announced an Arizona water plan.",
                      whyItMatters: "The announcement concerns Phoenix.",
                      hook: "Here is the announced plan.",
                      talkingPoints: [
                        {
                          text: "Officials announced a plan.",
                          sourceIds: [evidence[0].id],
                        },
                      ],
                      questions: ["Check the original announcement."],
                      eventDate: "Unknown",
                    }),
                  },
                ],
              },
            },
          ],
        });
      }
      if (url.includes("/actors/")) {
        socialStarts++;
        return Response.json({ data: { id: "test-run" } });
      }
      if (url.includes("/actor-runs/"))
        return Response.json({
          data: {
            status: "SUCCEEDED",
            defaultDatasetId: "test-dataset",
            usageTotalUsd: 0.01,
          },
        });
      if (url.includes("/datasets/"))
        return Response.json([
          {
            webVideoUrl: "https://www.tiktok.com/@phoenixnews/video/1234",
            text: "Arizona Phoenix music festival announced today",
            createTime: Math.floor(Date.now() / 1000),
            playCount: 1000,
            diggCount: 50,
          },
        ]);
      throw new Error(`Unexpected provider call ${new URL(url).hostname}`);
    };
    await mutateDesk(
      {
        action: "settings.save",
        dailySocialRuns: 1,
        dailyAiBriefs: 10,
        shortlistHour: 0,
      },
      admin,
    );
    const start = await processSource(source);
    assert.equal(start.pending, true);
    assert.equal(socialStarts, 1);
    const pending = await prisma.contentSource.findUniqueOrThrow({
      where: { id: source.id },
    });
    assert.equal((await processSource(pending)).items, 1);
    assert.equal(socialStarts, 1);
    assert.equal(
      (
        await prisma.contentSource.findUniqueOrThrow({
          where: { id: source.id },
        })
      ).pendingRunId,
      null,
    );
    const next = await processSource(
      await prisma.contentSource.findUniqueOrThrow({
        where: { id: source.id },
      }),
    );
    assert.equal(next.failed, true);
    assert.equal(socialStarts, 1);
    assert.equal(
      (
        await prisma.contentSource.findUniqueOrThrow({
          where: { id: source.id },
        })
      ).errorCode,
      "BUDGET",
    );
    await generateBrief(id, false);
    story = await prisma.contentStory.findUniqueOrThrow({ where: { id } });
    assert.ok(story.brief);
    assert.equal(story.briefError, null);
    await mutateDesk({ action: "brief.retry", id }, member);
    assert.equal(
      (await prisma.contentStory.findUniqueOrThrow({ where: { id } }))
        .evidenceHash,
      "",
    );
    globalThis.fetch = async () => new Response("denied", { status: 403 });
    await generateBrief(id, false);
    assert.match(
      (await prisma.contentStory.findUniqueOrThrow({ where: { id } }))
        .briefError || "",
      /access was denied/,
    );
    assert.ok(
      (await prisma.contentStory.findUniqueOrThrow({ where: { id } })).brief,
      "Previous brief retained on failure",
    );
    assert.throws(() => socialItems([{ error: "private" }], source), /public/);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldApi === undefined) delete process.env.APIFY_TOKEN;
    else process.env.APIFY_TOKEN = oldApi;
    if (oldAI === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldAI;
  }
  await prisma.stateSyncLease.upsert({
    where: { id: "content-desk-worker" },
    create: {
      id: "content-desk-worker",
      owner: "test",
      expiresAt: new Date(Date.now() + 60000),
    },
    update: { owner: "test", expiresAt: new Date(Date.now() + 60000) },
  });
  assert.equal((await runDesk()).skipped, true);
  await prisma.stateSyncLease.delete({ where: { id: "content-desk-worker" } });
  assert.equal(
    (await cron(new Request("https://example.com/api/cron/content-desk")))
      .status,
    401,
  );
  await prisma.contentStory.deleteMany();
  await prisma.stateTeam.deleteMany({
    where: { id: { in: [team.id, other.id] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [uid, uid2] } } });
  console.log(
    "Content Desk integration checks passed: seeding, feeds, SSRF, location filters, deduplication, team permissions, conflicts, social budgets/polling, grounded briefs, failure retention, and cron authorization.",
  );
  if (process.argv.includes("--live-feed")) {
    const result = await safeText(
      "https://www.wltx.com/feeds/syndication/rss/news",
    );
    assert.ok(parseFeed(result.body, result.url, "WLTX").length);
    console.log("Live public RSS smoke check passed.");
  }
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
