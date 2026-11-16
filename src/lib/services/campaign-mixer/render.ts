import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  MixerError,
  type MixerRecipeSnapshot,
} from "@/lib/campaign-mixer/schema";
import {
  checkSpace,
  mediaCommand,
  mixerPath,
  prepareLayouts,
  probe,
} from "./media";

/** The production renderer is also used for explicit pre-confirmation samples. */
export async function renderMixerRecipe(
  recipe: MixerRecipeSnapshot,
  outputId: string,
  leaseId: string,
): Promise<string> {
  if (
    recipe.version !== 1 ||
    !/^[a-zA-Z0-9_-]+$/.test(outputId) ||
    !/^[a-zA-Z0-9_-]+$/.test(leaseId)
  )
    throw new MixerError("Unsupported render recipe.", "RECIPE_VERSION");
  await checkSpace(Math.ceil(recipe.duration * 1_100_000));
  const source = mixerPath(recipe.clip.filePath),
    music = mixerPath(recipe.music.previewPath || recipe.music.filePath);
  for (const p of [source, music])
    if (!fs.existsSync(p))
      throw new MixerError(
        "A saved source file is missing. Restore the library asset and retry this output.",
        "ASSET_MISSING",
      );
  // Regenerate cached text if necessary, using the snapshot rather than today's settings.
  const layout = (
    await prepareLayouts([
      {
        key: "caption",
        text: recipe.text.text,
        settings: {
          ...recipe.settings,
          position: recipe.edit.position ?? recipe.settings.position,
        },
      },
    ])
  ).get("caption");
  if (!layout || typeof layout === "string")
    throw new MixerError(
      String(layout || "Caption preparation failed."),
      "TEXT_LAYOUT",
    );
  if (layout.fontHash !== recipe.layout.fontHash)
    throw new MixerError(
      "The selected font changed after this batch was approved. Restore the original font or create a new batch.",
      "FONT_CHANGED",
    );
  const look = recipe.look.settings,
    s = recipe.settings,
    d = recipe.duration;
  const width = s.resolution,
    height = Math.round((width * 16) / 9),
    fade = Math.min(look.fade, d / 4);
  const canvas = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}:(iw-ow)*${recipe.edit.cropX}:(ih-oh)*${recipe.edit.cropY},setsar=1,fps=30,setpts=PTS-STARTPTS`;
  const grade = `eq=contrast=${look.contrast}:brightness=${look.brightness}:saturation=${look.saturation},colorbalance=rs=${look.warmth}:bs=${-look.warmth}`;
  const vignette =
    look.vignette > 0
      ? `,vignette=angle=${(Math.PI / 4) * look.vignette}:eval=init`
      : "";
  const videoFade = fade > 0 ? `,fade=t=in:st=0:d=${fade}` : "";
  const textFade = fade > 0 ? `,fade=t=in:st=0:d=${fade}:alpha=1` : "";
  const filters = [
    `[0:v]${canvas},${grade}${vignette}${videoFade}[bg]`,
    `[2:v]scale=${width}:${height},format=rgba${textFade}[text]`,
    `[bg][text]overlay=0:0:shortest=0:format=auto,format=yuv420p[v]`,
  ];
  const available = Math.max(0.5, recipe.music.duration - recipe.musicStart);
  const loop =
    s.loopMusic && available < d
      ? `,afade=t=in:d=0.03,afade=t=out:st=${Math.max(0, available - 0.03)}:d=0.03,aloop=loop=-1:size=${Math.floor(available * 48000)}`
      : "";
  filters.push(
    `[1:a]aresample=48000,asetpts=PTS-STARTPTS${loop},atrim=duration=${d},volume=${s.musicVolume},afade=t=in:d=0.12,afade=t=out:st=${Math.max(0, d - 0.35)}:d=0.35[music]`,
  );
  if (s.keepSourceAudio && recipe.clip.hasAudio) {
    filters.push(
      `[0:a]aresample=48000,asetpts=PTS-STARTPTS,atrim=duration=${d},volume=${s.sourceVolume},apad[voice]`,
    );
    if (s.duckMusic) {
      filters.push(
        "[voice]asplit=2[mainvoice][side]",
        "[music][side]sidechaincompress=threshold=0.025:ratio=6:attack=20:release=250[ducked]",
        "[mainvoice][ducked]amix=inputs=2:duration=shortest:normalize=0,alimiter=limit=0.95[a]",
      );
    } else
      filters.push(
        "[voice][music]amix=inputs=2:duration=shortest:normalize=0,alimiter=limit=0.95[a]",
      );
  } else filters.push("[music]alimiter=limit=0.95[a]");
  const outputDir = path.join(
    process.cwd(),
    "public/uploads/multiplier/outputs",
  );
  await fs.promises.mkdir(outputDir, { recursive: true });
  // Lease-specific output names keep a stale worker from overwriting the winner.
  const name = `mix_${outputId}_${leaseId}.mp4`,
    final = path.join(outputDir, name);
  const temporary = path.join(outputDir, `${crypto.randomUUID()}.tmp.mp4`);
  try {
    await mediaCommand(
      "ffmpeg",
      [
        "-y",
        "-v",
        "error",
        "-ss",
        String(recipe.edit.start),
        "-i",
        source,
        "-ss",
        String(recipe.musicStart),
        "-i",
        music,
        "-loop",
        "1",
        "-framerate",
        "30",
        "-i",
        mixerPath(layout.path),
        "-filter_complex_threads",
        "1",
        "-filter_complex",
        filters.join(";"),
        "-map",
        "[v]",
        "-map",
        "[a]",
        "-t",
        String(d),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "21",
        "-threads",
        "2",
        "-maxrate",
        "10M",
        "-bufsize",
        "20M",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-ar",
        "48000",
        "-movflags",
        "+faststart",
        temporary,
      ],
      undefined,
      900_000,
    );
    const info = await probe(temporary);
    if (
      info.width !== width ||
      info.height !== height ||
      !info.hasAudio ||
      Math.abs(info.duration - d) > 0.15 ||
      info.bytes < 1000
    )
      throw new MixerError(
        "Output validation failed: dimensions, duration, or audio did not match the approved recipe.",
        "OUTPUT_INVALID",
        422,
      );
    await mediaCommand(
      "ffmpeg",
      ["-v", "error", "-i", temporary, "-f", "null", "-"],
      undefined,
      120_000,
    );
    await fs.promises.rename(temporary, final);
    return `/uploads/multiplier/outputs/${name}`;
  } finally {
    await fs.promises.unlink(temporary).catch(() => {});
  }
}
