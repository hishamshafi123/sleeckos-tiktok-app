import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  DEFAULT_MIXER_SETTINGS,
  MIXER_LOOKS,
  parseSelection,
  type MixerAssetInput,
  type MixerSelection,
} from "../src/lib/campaign-mixer/schema";

async function main() {
  const runId = crypto.randomUUID();
  process.env.MIXER_STORAGE_DIR = path.join(
    process.cwd(),
    "scratch/mixer-qa",
    runId,
  );
  const { planMixer, textHash } =
    await import("../src/lib/services/campaign-mixer/planner");
  const { mediaCommand, mixerPath, probe } =
    await import("../src/lib/services/campaign-mixer/media");
  const { renderMixerRecipe } =
    await import("../src/lib/services/campaign-mixer/render");
  await fs.promises.mkdir(mixerPath("assets"), { recursive: true });
  const clip = (id: string): MixerAssetInput => ({
    id,
    kind: "clip",
    name: id,
    contentHash: id,
    filePath: "assets/source.mp4",
    duration: 2,
    width: 1080,
    height: 1920,
    hasAudio: true,
    settings: {},
    tags: [],
  });
  const music = (id: string): MixerAssetInput => ({
    ...clip(id),
    kind: "music",
    filePath: "assets/music.wav",
    duration: 3,
  });
  const clips = Array.from({ length: 12 }, (_, i) => clip(`clip-${i}`)),
    tracks = Array.from({ length: 4 }, (_, i) => music(`music-${i}`));
  const texts = Array.from({ length: 20 }, (_, i) => ({
    id: `text-${i}`,
    text: `A new perspective ${i + 1}`,
    canonicalHash: textHash(`A new perspective ${i + 1}`),
    tags: [],
  }));
  const selection: MixerSelection = {
    clipIds: clips.map((c) => c.id),
    musicIds: tracks.map((a) => a.id),
    textIds: texts.map((t) => t.id),
    presetIds: MIXER_LOOKS.slice(0, 3).map((l) => l.id),
    settings: DEFAULT_MIXER_SETTINGS,
    count: 60,
    seed: "repeatable-plan",
  };
  const input = {
    workspaceId: "test",
    selection,
    clips,
    music: tracks,
    texts,
    looks: MIXER_LOOKS.slice(0, 3),
    prior: [],
  };
  const p = await planMixer(input);
  assert.equal(p.totalPossible, 2880);
  assert.equal(p.baseCombinations, 960);
  assert.equal(p.recipes.length, 60);
  assert.equal(new Set(p.recipes.map((r) => r.recipeKey)).size, 60);
  assert.equal(
    (await planMixer(input)).planHash,
    p.planHash,
    "Preview is deterministic",
  );
  assert.equal(p.represented.clips, 12);
  assert.equal(p.represented.music, 4);
  assert.equal(p.represented.looks, 3);
  const prior = p.recipes.map((r) => ({
    activeKey: r.recipeKey,
    recipeKey: r.recipeKey,
    contentKey: r.contentKey,
    snapshot: r,
  }));
  const next = await planMixer({ ...input, prior });
  assert.equal(next.unused, 2820);
  assert(
    next.recipes.every((r) => !prior.some((p) => p.recipeKey === r.recipeKey)),
  );
  const duplicate = await planMixer({
    ...input,
    clips: [...clips, { ...clips[0], id: "renamed-file", name: "renamed.mp4" }],
  });
  assert.equal(
    duplicate.totalPossible,
    2880,
    "Renamed identical input does not add capacity",
  );
  const excluded = await planMixer({
    ...input,
    music: tracks.map((t) => ({ ...t, duration: 1 })),
  });
  assert.equal(excluded.unused, 0);
  assert(excluded.exclusions.length > 0);
  const overflowing = await planMixer({
    ...input,
    texts: [
      {
        id: "long",
        text: "This is too much text. ".repeat(30),
        canonicalHash: "long",
        tags: [],
      },
    ],
  });
  assert.equal(overflowing.unused, 0, "Overflow is excluded, not truncated");
  const tiny = await planMixer({
    ...input,
    selection: { ...selection, count: 1 },
  });
  assert.equal(tiny.recipes.length, 1);
  assert(tiny.warnings.some((w) => w.includes("does not use every")));
  assert.throws(() => parseSelection({ ...selection, count: 1.5 }));
  console.log(
    "Planner: counts, deterministic selection, duplicates, history, audio eligibility, overflow and small batches passed.",
  );
  if (process.argv.includes("--render")) {
    await mediaCommand("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1080x1920:rate=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=330:sample_rate=48000",
      "-t",
      "2",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-threads",
      "2",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      mixerPath("assets/source.mp4"),
    ]);
    await mediaCommand("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:sample_rate=48000",
      "-t",
      "3",
      mixerPath("assets/music.wav"),
    ]);
    const recipe = tiny.recipes[0];
    const ref = await renderMixerRecipe(
      recipe,
      `qa_${runId}`,
      crypto.randomUUID(),
    );
    const output = path.join(process.cwd(), "public", ref);
    async function tone(file: string, frequency: number) {
      const pcm = mixerPath(`assets/${crypto.randomUUID()}.pcm`);
      await mediaCommand("ffmpeg", [
        "-y",
        "-v",
        "error",
        "-ss",
        "0.5",
        "-i",
        file,
        "-t",
        "0.5",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "48000",
        "-f",
        "s16le",
        pcm,
      ]);
      const bytes = await fs.promises.readFile(pcm);
      await fs.promises.unlink(pcm);
      let real = 0,
        imaginary = 0;
      for (let i = 0; i < bytes.length / 2; i++) {
        const value = bytes.readInt16LE(i * 2);
        real += value * Math.cos((2 * Math.PI * frequency * i) / 48000);
        imaginary += value * Math.sin((2 * Math.PI * frequency * i) / 48000);
      }
      return Math.hypot(real, imaginary) / (bytes.length / 2);
    }
    assert(
      (await tone(output, 330)) < (await tone(output, 880)) * 0.02,
      "Music-only mode removes the original sound",
    );
    const mixed = path.join(
      process.cwd(),
      "public",
      await renderMixerRecipe(
        {
          ...recipe,
          settings: {
            ...recipe.settings,
            keepSourceAudio: true,
            duckMusic: true,
          },
        },
        `qa_audio_${runId}`,
        crypto.randomUUID(),
      ),
    );
    assert(
      (await tone(mixed, 330)) > 100,
      "Optional original audio is audible",
    );
    assert((await tone(mixed, 880)) > 1, "Ducked music remains audible");
    await fs.promises.unlink(mixed);
    await mediaCommand("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:sample_rate=48000",
      "-t",
      "1",
      mixerPath("assets/short.wav"),
    ]);
    const looped = path.join(
      process.cwd(),
      "public",
      await renderMixerRecipe(
        {
          ...recipe,
          music: {
            ...recipe.music,
            filePath: "assets/short.wav",
            previewPath: null,
            duration: 1,
          },
          settings: { ...recipe.settings, loopMusic: true },
        },
        `qa_loop_${runId}`,
        crypto.randomUUID(),
      ),
    );
    assert(
      Math.abs((await probe(looped)).duration - 2) < 0.1,
      "Short music loops through the whole clip",
    );
    await fs.promises.unlink(looped);
    const info = await probe(output);
    assert.equal(info.width, 1080);
    assert.equal(info.height, 1920);
    assert(info.hasAudio);
    assert(Math.abs(info.duration - 2) < 0.1);
    assert(
      recipe.layout.box.x >= 130 &&
        recipe.layout.box.y >= 308 &&
        recipe.layout.box.x + recipe.layout.box.width <= 774 &&
        recipe.layout.box.y + recipe.layout.box.height <= 1150,
    );
    const evidence = path.join(process.cwd(), "scratch/mixer-qa");
    await fs.promises.copyFile(
      output,
      path.join(evidence, "latest-render.mp4"),
    );
    await mediaCommand("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-ss",
      "1",
      "-i",
      output,
      "-frames:v",
      "1",
      path.join(evidence, "latest-frame.png"),
    ]);
    await fs.promises.unlink(output);
    console.log(
      `Render: 1080p H.264/AAC, duration, safe text, and full decode passed. Evidence: ${evidence}`,
    );
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
