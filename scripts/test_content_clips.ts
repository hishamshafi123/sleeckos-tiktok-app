/** DATABASE_URL must point at the disposable state_accounts_verify database. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import prisma from "../src/lib/db";
import {
  defaultDraft,
  validateDraft,
  validateSuggestions,
  validateWords,
  framesFor,
  type Word,
} from "../src/lib/content-clips/schema";
import {
  byteRange,
  mediaPath,
  videoSource,
  probe,
  command,
} from "../src/lib/services/content-clips/media";
import {
  clipData,
  createClip,
  saveClip,
  queueClip,
  retryClip,
} from "../src/lib/services/content-clips/data";
import {
  clipProcessors,
  runClipJobs,
} from "../src/lib/services/content-clips/worker";
import { renderClip } from "../src/lib/services/content-clips/render";
async function main() {
  assert.match(
    new URL(process.env.DATABASE_URL!).pathname,
    /state_accounts_verify$/,
  );
  const base = defaultDraft("Michigan", "QA source");
  assert.throws(() => validateDraft({ ...base, end: 181 }, 200));
  assert.throws(() => validateDraft({ ...base, start: 10, end: 9 }, 30));
  assert.throws(() => validateDraft({ ...base, end: Infinity }, 200));
  assert.throws(() => validateWords([{ word: "x", start: 4, end: 3 }], 10));
  assert.throws(() => validateSuggestions([{ start: 0, end: 1000 }], [], 10));
  assert.throws(() =>
    videoSource("https://youtube.com.evil.invalid/watch?v=abcdefghijk"),
  );
  assert.throws(() =>
    videoSource("https://www.youtube.com/playlist?list=test"),
  );
  assert.equal(
    videoSource("https://youtu.be/abcdefghijk?x=1").url,
    "https://www.youtube.com/watch?v=abcdefghijk",
  );
  assert.throws(() => mediaPath("../../.env"));
  assert.deepEqual(byteRange("bytes=2-5", 10), {
    start: 2,
    end: 5,
    partial: true,
  });
  assert.deepEqual(byteRange("bytes=-4", 10), {
    start: 6,
    end: 9,
    partial: true,
  });
  assert.equal(byteRange("bytes=10-", 10), null);
  assert.equal(byteRange("bytes=0-1,4-5", 10), null);
  const role = await prisma.role.upsert({
    where: { key: "clip-test" },
    update: {},
    create: { key: "clip-test", label: "Clip test" },
  });
  const user = await prisma.user.create({
    data: {
      email: `clip-${Date.now()}@example.invalid`,
      roleId: role.id,
      status: "ACTIVE",
    },
  });
  const team = await prisma.stateTeam.create({
    data: { name: `Clip QA ${Date.now()}` },
  });
  await prisma.contentState.upsert({
    where: { code: "MI" },
    update: {},
    create: { code: "MI", name: "Michigan", keywords: "Michigan" },
  });
  const story = await prisma.contentStory.create({
    data: { stateCode: "MI", title: "Clip QA fixture", teamId: team.id },
  });
  const actor = { userId: user.id, role: "admin" };
  const paths: string[] = [];
  try {
    await assert.rejects(
      createClip(story.id, "Blocked", null, {
        userId: user.id,
        role: "member",
      }),
      /another team/,
    );
    const clip = await createClip(story.id, "QA footage", null, actor);
    paths.push(mediaPath(clip.id));
    await fs.promises.mkdir(mediaPath(clip.id), { recursive: true });
    const input = path.resolve("scratch/content-clips/source.mp4");
    if (!fs.existsSync(input)) {
      await fs.promises.mkdir(path.dirname(input), { recursive: true });
      await command("ffmpeg", [
        "-y",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=640x360:rate=30",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=44100",
        "-t",
        "6",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        input,
      ]);
    }
    const uploadPath = `${clip.id}/upload.bin`;
    await fs.promises.copyFile(input, mediaPath(uploadPath));
    const imported = await queueClip(clip.id, "IMPORT", actor, { uploadPath });
    assert.equal(
      (await queueClip(clip.id, "IMPORT", actor, { uploadPath })).id,
      imported.id,
      "duplicate processing must reuse active job",
    );
    await runClipJobs();
    let current = await prisma.contentClip.findUniqueOrThrow({
      where: { id: clip.id },
    });
    assert.ok(current.sourcePath);
    assert.ok(Math.abs(current.duration! - 6) < 0.1);
    assert.equal(
      (
        await prisma.contentClipJob.findUniqueOrThrow({
          where: { id: imported.id },
        })
      ).status,
      "COMPLETED",
    );
    await prisma.contentClipJob.update({
      where: { id: imported.id },
      data: {
        status: "RUNNING",
        owner: "interrupted-after-source-save",
        leaseUntil: new Date(0),
        attempts: 1,
      },
    });
    await runClipJobs();
    assert.equal(
      (
        await prisma.contentClipJob.findUniqueOrThrow({
          where: { id: imported.id },
        })
      ).status,
      "COMPLETED",
      "recover imported source even after temporary upload was removed",
    );
    await command("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=green:size=64x64",
      "-frames:v",
      "1",
      "scratch/content-clips/logo.png",
    ]);
    const logo = `data:image/png;base64,${(await fs.promises.readFile("scratch/content-clips/logo.png")).toString("base64")}`;
    const draft = {
      ...base,
      logo,
      start: 1,
      end: 4,
      hook: "A local update worth understanding",
      captions: true,
    };
    await saveClip(clip.id, actor, { version: current.version, draft });
    await assert.rejects(
      saveClip(clip.id, actor, { version: current.version, draft }),
      /another tab/,
    );
    const words: Word[] = [
      { word: "Local", start: 1, end: 1.5 },
      { word: "news", start: 1.5, end: 2.5 },
      { word: "update", start: 2.5, end: 3.5 },
    ];
    const mocked = {
      ...clipProcessors,
      transcribe: async () => words,
      suggestClips: async () => [
        {
          start: 1,
          end: 4,
          title: "Local update",
          reason: "A complete statement",
          context: "",
          hooks: ["Local news update"],
        },
      ],
    };
    const analysis = await queueClip(clip.id, "ANALYZE", actor);
    const concurrent = await Promise.all([
      runClipJobs(1, mocked),
      runClipJobs(1, mocked),
    ]);
    assert.equal(
      concurrent.reduce((n, r) => n + r.processed, 0),
      1,
      "one database lease across workers",
    );
    current = await prisma.contentClip.findUniqueOrThrow({
      where: { id: clip.id },
    });
    assert.deepEqual(current.transcript, words);
    assert.ok(current.suggestions);
    assert.equal(
      (
        await prisma.contentClipJob.findUniqueOrThrow({
          where: { id: analysis.id },
        })
      ).status,
      "COMPLETED",
    );
    await saveClip(clip.id, actor, {
      version: current.version,
      words: words.map((w) => ({
        ...w,
        word: w.word === "Local" ? "Michigan" : w.word,
      })),
    });
    current = await prisma.contentClip.findUniqueOrThrow({
      where: { id: clip.id },
    });
    assert.equal(
      current.suggestions,
      null,
      "corrected transcript invalidates suggestions",
    );
    const failure = await queueClip(clip.id, "SUGGEST", actor);
    await runClipJobs(1, {
      ...mocked,
      suggestClips: async () => {
        throw new Error("Simulated AI outage; transcript preserved.");
      },
    });
    assert.equal(
      (
        await prisma.contentClipJob.findUniqueOrThrow({
          where: { id: failure.id },
        })
      ).status,
      "FAILED",
    );
    await retryClip(clip.id, failure.id, actor);
    await runClipJobs(1, mocked);
    const recovery = await queueClip(clip.id, "SUGGEST", actor);
    await prisma.contentClipJob.update({
      where: { id: recovery.id },
      data: {
        status: "RUNNING",
        owner: "old-worker",
        leaseUntil: new Date(0),
        attempts: 1,
      },
    });
    await runClipJobs(1, mocked);
    assert.equal(
      (
        await prisma.contentClipJob.findUniqueOrThrow({
          where: { id: recovery.id },
        })
      ).status,
      "COMPLETED",
    );
    const stale = await queueClip(clip.id, "SUGGEST", actor);
    await runClipJobs(1, {
      ...mocked,
      suggestClips: async () => {
        const newest = await prisma.contentClip.findUniqueOrThrow({
          where: { id: clip.id },
        });
        await saveClip(clip.id, actor, { version: newest.version, words });
        return mocked.suggestClips();
      },
    });
    assert.equal(
      (
        await prisma.contentClipJob.findUniqueOrThrow({
          where: { id: stale.id },
        })
      ).status,
      "FAILED",
      "do not persist suggestions for a superseded transcript",
    );
    const exported = await queueClip(clip.id, "RENDER", actor, { draft });
    current = await prisma.contentClip.findUniqueOrThrow({
      where: { id: clip.id },
    });
    await saveClip(clip.id, actor, {
      version: current.version,
      draft: { ...draft, hook: "Changed after export queued" },
    });
    const snapshot = (
      await prisma.contentClipJob.findUniqueOrThrow({
        where: { id: exported.id },
      })
    ).payload as { draft: typeof draft };
    assert.equal(
      snapshot.draft.hook,
      draft.hook,
      "export must use immutable draft snapshot",
    );
    await runClipJobs(1, { ...mocked, renderClip });
    const result = await prisma.contentClipJob.findUniqueOrThrow({
      where: { id: exported.id },
    });
    assert.equal(result.status, "COMPLETED", result.error || "render failed");
    const info = await probe(mediaPath(result.outputPath!));
    assert.ok(Math.abs(info.duration - framesFor(draft) / 30) < 0.1);
    await fs.promises.copyFile(
      mediaPath(result.outputPath!),
      "scratch/content-clips/qa-export.mp4",
    );
    const data = await clipData(story.id, actor);
    assert.ok(data.clips[0].jobs.some((j) => j.downloadable));
    assert.ok(!("sourcePath" in data.clips[0]));
    assert.ok(!JSON.stringify(data).includes("uploadPath"));
    assert.equal(
      (await prisma.contentStory.findUniqueOrThrow({ where: { id: story.id } }))
        .status,
      "NEW",
      "export must not mark story posted",
    );
    console.log(
      "PASS: permissions, validation, imports, duplicate jobs, cross-worker leases, draft conflicts, transcript corrections, AI failure/retry, restart recovery, immutable export and actual rendered MP4 duration",
    );
  } finally {
    await prisma.contentStory.delete({ where: { id: story.id } });
    await prisma.stateTeam.delete({ where: { id: team.id } });
    await prisma.user.delete({ where: { id: user.id } });
    for (const p of paths)
      await fs.promises.rm(p, { recursive: true, force: true });
  }
}
main()
  .finally(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
