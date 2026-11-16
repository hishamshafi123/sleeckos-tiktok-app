/** Shared, browser-safe Campaign Mixer contracts. */
export const MIXER_VERSION = 1;
export const MIXER_MAX_BATCH = 500;
export const MIXER_FONTS = [
  "Inter",
  "Public Sans",
  "Libre Franklin",
  "Archivo",
] as const;
export type MixerSettings = {
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  position: "upper" | "middle";
  align: "left" | "center";
  keepSourceAudio: boolean;
  musicVolume: number;
  sourceVolume: number;
  loopMusic: boolean;
  duckMusic: boolean;
  resolution: 1080 | 720;
};
export const DEFAULT_MIXER_SETTINGS: MixerSettings = {
  fontFamily: "Inter",
  fontWeight: 600,
  fontSize: 52,
  position: "middle",
  align: "left",
  keepSourceAudio: false,
  musicVolume: 0.8,
  sourceVolume: 1,
  loopMusic: false,
  duckMusic: true,
  resolution: 1080,
};
export type LookSettings = {
  contrast: number;
  brightness: number;
  saturation: number;
  vignette: number;
  warmth: number;
  fade: number;
};
export type MixerLook = { id: string; name: string; settings: LookSettings };
export const MIXER_LOOKS: MixerLook[] = [
  {
    id: "reference-dark",
    name: "Reference Dark",
    settings: {
      contrast: 1.1,
      brightness: -0.08,
      saturation: 0.72,
      vignette: 0.8,
      warmth: 0.025,
      fade: 0.3,
    },
  },
  {
    id: "soft-fade",
    name: "Soft Fade",
    settings: {
      contrast: 0.92,
      brightness: -0.015,
      saturation: 0.82,
      vignette: 0.35,
      warmth: 0,
      fade: 0.55,
    },
  },
  {
    id: "clean-contrast",
    name: "Clean Contrast",
    settings: {
      contrast: 1.12,
      brightness: 0,
      saturation: 1.02,
      vignette: 0.15,
      warmth: 0,
      fade: 0.2,
    },
  },
  {
    id: "warm-film",
    name: "Warm Film",
    settings: {
      contrast: 1.04,
      brightness: -0.025,
      saturation: 0.86,
      vignette: 0.4,
      warmth: 0.08,
      fade: 0.3,
    },
  },
  {
    id: "cool-muted",
    name: "Cool Muted",
    settings: {
      contrast: 1.05,
      brightness: -0.025,
      saturation: 0.68,
      vignette: 0.4,
      warmth: -0.06,
      fade: 0.3,
    },
  },
  {
    id: "monochrome",
    name: "Monochrome",
    settings: {
      contrast: 1.16,
      brightness: -0.03,
      saturation: 0,
      vignette: 0.55,
      warmth: 0,
      fade: 0.3,
    },
  },
];
export class MixerError extends Error {
  constructor(
    message: string,
    public code = "INVALID_INPUT",
    public status = 400,
  ) {
    super(message);
    this.name = "MixerError";
  }
}
export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function numberIn(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  label: string,
) {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new MixerError(`${label} must be between ${min} and ${max}.`);
  return value;
}
export function parseMixerSettings(input: unknown): MixerSettings {
  const v = record(input),
    d = DEFAULT_MIXER_SETTINGS;
  if (
    v.fontFamily !== undefined &&
    !MIXER_FONTS.includes(v.fontFamily as (typeof MIXER_FONTS)[number])
  )
    throw new MixerError("Choose an installed Mixer font.");
  if (
    v.position !== undefined &&
    !["upper", "middle"].includes(String(v.position))
  )
    throw new MixerError("Choose Upper or Middle placement.");
  if (v.align !== undefined && !["left", "center"].includes(String(v.align)))
    throw new MixerError("Choose left or center alignment.");
  if (
    v.resolution !== undefined &&
    v.resolution !== 1080 &&
    v.resolution !== 720
  )
    throw new MixerError("Choose 1080p or 720p output.");
  for (const k of ["keepSourceAudio", "loopMusic", "duckMusic"])
    if (v[k] !== undefined && typeof v[k] !== "boolean")
      throw new MixerError(`Invalid ${k} setting.`);
  const weight = numberIn(v.fontWeight, d.fontWeight, 400, 700, "Font weight");
  if (![400, 600, 700].includes(weight))
    throw new MixerError("Choose regular, semibold, or bold text.");
  return {
    fontFamily: String(v.fontFamily ?? d.fontFamily),
    fontWeight: weight,
    fontSize: numberIn(v.fontSize, d.fontSize, 40, 76, "Font size"),
    position: (v.position ?? d.position) as MixerSettings["position"],
    align: (v.align ?? d.align) as MixerSettings["align"],
    keepSourceAudio: (v.keepSourceAudio ?? d.keepSourceAudio) as boolean,
    loopMusic: (v.loopMusic ?? d.loopMusic) as boolean,
    duckMusic: (v.duckMusic ?? d.duckMusic) as boolean,
    musicVolume: numberIn(
      v.musicVolume,
      d.musicVolume,
      0.05,
      1.5,
      "Music volume",
    ),
    sourceVolume: numberIn(
      v.sourceVolume,
      d.sourceVolume,
      0,
      1.5,
      "Original sound volume",
    ),
    resolution: (v.resolution ?? d.resolution) as 720 | 1080,
  };
}
export function parseLook(input: unknown): LookSettings {
  const v = record(input),
    d = MIXER_LOOKS[0].settings;
  return {
    contrast: numberIn(v.contrast, d.contrast, 0.7, 1.5, "Contrast"),
    brightness: numberIn(v.brightness, d.brightness, -0.2, 0.15, "Brightness"),
    saturation: numberIn(v.saturation, d.saturation, 0, 1.5, "Saturation"),
    vignette: numberIn(v.vignette, d.vignette, 0, 1, "Vignette"),
    warmth: numberIn(v.warmth, d.warmth, -0.15, 0.15, "Warmth"),
    fade: numberIn(v.fade, d.fade, 0, 1, "Fade"),
  };
}
export type MixerAssetInput = {
  id: string;
  kind: string;
  name: string;
  contentHash: string;
  filePath: string;
  previewPath?: string | null;
  thumbnailPath?: string | null;
  duration: number;
  width?: number | null;
  height?: number | null;
  hasAudio: boolean;
  settings: unknown;
  tags: string[];
};
export type MixerTextInput = {
  id: string;
  text: string;
  canonicalHash: string;
  tags: string[];
};
export type ClipEdit = {
  start: number;
  end: number;
  cropX: number;
  cropY: number;
  position?: "upper" | "middle";
};
export function clipEdit(asset: MixerAssetInput): ClipEdit {
  const v = record(asset.settings);
  const start = numberIn(v.start, 0, 0, asset.duration, "Clip start");
  const end = numberIn(v.end, asset.duration, 0, asset.duration, "Clip end");
  if (end - start < 1 || end - start > 180)
    throw new MixerError(
      `“${asset.name}” needs a trim between 1 and 180 seconds.`,
    );
  return {
    start,
    end,
    cropX: numberIn(v.cropX, 0.5, 0, 1, "Horizontal crop"),
    cropY: numberIn(v.cropY, 0.5, 0, 1, "Vertical crop"),
    ...(v.position === "upper" || v.position === "middle"
      ? { position: v.position }
      : {}),
  };
}
export function musicStart(asset: MixerAssetInput): number {
  return numberIn(
    record(asset.settings).start,
    0,
    0,
    Math.max(0, asset.duration - 0.5),
    "Music start",
  );
}
export type MixerSelection = {
  clipIds: string[];
  textIds: string[];
  musicIds: string[];
  presetIds: string[];
  count: number;
  seed: string;
  settings: MixerSettings;
};
export function parseSelection(input: unknown): MixerSelection {
  const v = record(input);
  const ids = (key: string, max: number) => {
    const a = v[key];
    if (
      !Array.isArray(a) ||
      !a.length ||
      a.length > max ||
      a.some((id) => typeof id !== "string" || !id || id.length > 100)
    )
      throw new MixerError(
        `Select between 1 and ${max} ${key.replace("Ids", "s")}.`,
      );
    return [...new Set(a as string[])];
  };
  const count = numberIn(v.count, 1, 1, MIXER_MAX_BATCH, "Output count");
  if (!Number.isInteger(count))
    throw new MixerError("Output count must be a whole number.");
  if (typeof v.seed !== "string" || !v.seed || v.seed.length > 100)
    throw new MixerError("The batch seed is missing. Refresh the preview.");
  return {
    clipIds: ids("clipIds", 100),
    textIds: ids("textIds", 250),
    musicIds: ids("musicIds", 30),
    presetIds: ids("presetIds", 12),
    count,
    seed: v.seed,
    settings: parseMixerSettings(v.settings),
  };
}
export type MixerLayout = {
  path: string;
  fontHash: string;
  fontSize: number;
  lines: string[];
  box: { x: number; y: number; width: number; height: number };
};
export type MixerRecipeSnapshot = {
  version: 1;
  workspaceId: string;
  parts: string[];
  recipeKey: string;
  contentKey: string;
  clip: MixerAssetInput;
  edit: ClipEdit;
  music: MixerAssetInput;
  musicStart: number;
  text: MixerTextInput;
  look: MixerLook;
  settings: MixerSettings;
  layout: MixerLayout;
  duration: number;
};
