import {
  clipEdit,
  musicStart,
  type MixerAssetInput,
  type MixerTextInput,
  type MixerLook,
  type MixerSelection,
  type MixerLayout,
  type MixerRecipeSnapshot,
} from "@/lib/campaign-mixer/schema";
import { hash, prepareLayouts } from "./media";

type Prior = {
  recipeKey: string;
  contentKey: string;
  snapshot: unknown;
  activeKey: string | null;
};
type PlanInput = {
  workspaceId: string;
  selection: MixerSelection;
  clips: MixerAssetInput[];
  music: MixerAssetInput[];
  texts: MixerTextInput[];
  looks: MixerLook[];
  prior: Prior[];
};
type Block = {
  clip: number;
  text: number;
  look: number;
  music: number[];
  offset: number;
  layout: MixerLayout;
  duration: number;
};
export type MixerPlan = {
  totalPossible: number;
  unused: number;
  previouslyUsed: number;
  baseCombinations: number;
  requested: number;
  recipes: MixerRecipeSnapshot[];
  planHash: string;
  exclusions: { name: string; reason: string }[];
  warnings: string[];
  represented: { clips: number; texts: number; music: number; looks: number };
  newContentCombinations: number;
  additionalTreatments: number;
};
const canonicalText = (s: string) =>
  s.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
export const textHash = (s: string) => hash(canonicalText(s));
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Counts blocks rather than materializing a Cartesian product. Only sampled
 * candidates and requested recipes are built; prior reservations map to ranks. */
export async function planMixer(input: PlanInput): Promise<MixerPlan> {
  const { workspaceId, selection, prior } = input;
  const unique = <T>(items: T[], key: (item: T) => string) => [
    ...new Map(items.map((item) => [key(item), item])).values(),
  ];
  const clips = unique(input.clips, (c) => hash([c.contentHash, c.settings]));
  const texts = unique(input.texts, (t) => textHash(t.text));
  const music = unique(input.music, (a) => hash([a.contentHash, a.settings]));
  const looks = unique(input.looks, (l) => hash(l.settings));
  const exclusions: MixerPlan["exclusions"] = [],
    warnings: string[] = [];
  const edits = clips.map((c) => {
    try {
      return clipEdit(c);
    } catch (e) {
      exclusions.push({ name: c.name, reason: (e as Error).message });
      return null;
    }
  });
  const starts = music.map((a) => {
    try {
      return musicStart(a);
    } catch (e) {
      exclusions.push({ name: a.name, reason: (e as Error).message });
      return null;
    }
  });
  const positions = [
    ...new Set([
      selection.settings.position,
      ...edits.flatMap((e) => (e?.position ? [e.position] : [])),
    ]),
  ];
  const layouts = await prepareLayouts(
    texts.flatMap((t) =>
      positions.map((position) => ({
        key: `${t.id}:${position}`,
        text: t.text,
        settings: { ...selection.settings, position },
      })),
    ),
  );
  const clipParts = clips.map((c, i) => hash([c.contentHash, edits[i]]));
  const textParts = texts.map((t) => textHash(t.text));
  const musicParts = music.map((a, i) => hash([a.contentHash, starts[i]]));
  const blocks: Block[] = [],
    blockMap = new Map<string, Block>();
  let totalPossible = 0,
    baseCombinations = 0;
  const baseSeen = new Set<string>();
  const lookParts = new Map<string, string>();
  for (let c = 0; c < clips.length; c++) {
    const edit = edits[c];
    if (!edit) continue;
    const duration = Math.floor((edit.end - edit.start) * 30 + 0.00001) / 30;
    const eligibleMusic = music.flatMap((a, i) => {
      if (starts[i] === null) return [];
      if (
        !selection.settings.loopMusic &&
        a.duration - starts[i]! + 0.02 < duration
      ) {
        exclusions.push({
          name: `${clips[c].name} / ${a.name}`,
          reason: `Music has ${(a.duration - starts[i]!).toFixed(1)}s remaining; the clip needs ${duration.toFixed(1)}s. Move its start earlier or enable looping.`,
        });
        return [];
      }
      return [i];
    });
    for (let t = 0; t < texts.length; t++) {
      if (
        texts[t].tags.length &&
        !texts[t].tags.some((tag) => clips[c].tags.includes(tag))
      )
        continue;
      const layout = layouts.get(
        `${texts[t].id}:${edit.position ?? selection.settings.position}`,
      );
      if (!layout || typeof layout === "string") {
        exclusions.push({
          name: texts[t].text.slice(0, 70),
          reason:
            typeof layout === "string"
              ? layout
              : "Caption layout could not be prepared.",
        });
        continue;
      }
      const baseKey = `${clipParts[c]}:${textParts[t]}`;
      if (!baseSeen.has(baseKey)) {
        baseSeen.add(baseKey);
        baseCombinations += eligibleMusic.length;
      }
      for (let l = 0; l < looks.length; l++) {
        const lookPart = hash([
          looks[l].settings,
          selection.settings,
          layout.fontHash,
        ]);
        lookParts.set(`${c}:${l}`, lookPart);
        const block = {
          clip: c,
          text: t,
          look: l,
          music: eligibleMusic,
          offset: totalPossible,
          layout,
          duration,
        };
        if (eligibleMusic.length) {
          blocks.push(block);
          blockMap.set(`${clipParts[c]}:${textParts[t]}:${lookPart}`, block);
          totalPossible += eligibleMusic.length;
        }
      }
    }
  }
  const blockedRanks = new Set<number>(),
    previousContent = new Set<string>();
  const musicIndexes = new Map(musicParts.map((p, i) => [p, i]));
  for (const p of prior) {
    if (!p.activeKey) continue;
    previousContent.add(p.contentKey);
    const snapshot = p.snapshot as Partial<MixerRecipeSnapshot> | null;
    const parts = snapshot?.parts;
    if (!Array.isArray(parts) || parts.length !== 4) continue;
    const block = blockMap.get(`${parts[0]}:${parts[1]}:${parts[3]}`),
      m = musicIndexes.get(parts[2]);
    if (!block || m === undefined) continue;
    const j = block.music.indexOf(m);
    if (j >= 0 && hash(parts) === p.recipeKey)
      blockedRanks.add(block.offset + j);
  }
  const unused = totalPossible - blockedRanks.size;
  const decode = (rank: number): MixerRecipeSnapshot => {
    let lo = 0,
      hi = blocks.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (blocks[mid].offset <= rank) lo = mid;
      else hi = mid - 1;
    }
    const b = blocks[lo],
      m = b.music[rank - b.offset],
      c = b.clip,
      t = b.text,
      l = b.look;
    const parts = [
      clipParts[c],
      textParts[t],
      musicParts[m],
      lookParts.get(`${c}:${l}`)!,
    ];
    return {
      version: 1,
      workspaceId,
      parts,
      recipeKey: hash(parts),
      contentKey: hash(parts.slice(0, 3)),
      clip: clips[c],
      edit: edits[c]!,
      music: music[m],
      musicStart: starts[m]!,
      text: texts[t],
      look: looks[l],
      settings: selection.settings,
      layout: b.layout,
      duration: b.duration,
    };
  };
  // A seeded coprime walk samples every rank at most once, including when the
  // supply is almost exhausted. Selection cannot get trapped in random retries.
  const seed = hash(selection.seed),
    offset = totalPossible
      ? Number.parseInt(seed.slice(0, 10), 16) % totalPossible
      : 0;
  let step = Math.max(
    1,
    totalPossible ? Number.parseInt(seed.slice(10, 20), 16) % totalPossible : 1,
  );
  while (gcd(step, Math.max(1, totalPossible)) !== 1) step++;
  const candidates: MixerRecipeSnapshot[] = [];
  const wantedCandidates = Math.min(
    unused,
    Math.max(500, selection.count * 12),
  );
  for (
    let i = 0;
    i < totalPossible && candidates.length < wantedCandidates;
    i++
  ) {
    const rank = (offset + i * step) % totalPossible;
    if (!blockedRanks.has(rank)) candidates.push(decode(rank));
  }
  const recipes: MixerRecipeSnapshot[] = [],
    uses = new Map<string, number>(),
    chosenContent = new Set<string>();
  const count = (key: string) => uses.get(key) || 0;
  while (
    recipes.length < Math.min(selection.count, unused) &&
    candidates.length
  ) {
    let best = 0,
      bestScore = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const r = candidates[i];
      const score =
        (previousContent.has(r.contentKey) || chosenContent.has(r.contentKey)
          ? 100000
          : 0) +
        count(r.clip.id) * 12 +
        count(r.text.id) * 3 +
        count(r.music.id) * 6 +
        count(r.look.id) * 6;
      if (score < bestScore) {
        best = i;
        bestScore = score;
      }
    }
    const r = candidates.splice(best, 1)[0];
    recipes.push(r);
    chosenContent.add(r.contentKey);
    for (const id of [r.clip.id, r.text.id, r.music.id, r.look.id])
      uses.set(id, count(id) + 1);
  }
  const represented = {
    clips: new Set(recipes.map((r) => r.clip.id)).size,
    texts: new Set(recipes.map((r) => r.text.id)).size,
    music: new Set(recipes.map((r) => r.music.id)).size,
    looks: new Set(recipes.map((r) => r.look.id)).size,
  };
  if (
    represented.clips < clips.length ||
    represented.texts < texts.length ||
    represented.music < music.length ||
    represented.looks < looks.length
  )
    warnings.push(
      "This batch does not use every selected item. Check the coverage counts, or increase the output count.",
    );
  if (selection.count > unused)
    warnings.push(
      `Requested ${selection.count}, but only ${unused} unused eligible variations are available. Reduce the count or add more materials.`,
    );
  if (
    clips.some(
      (c) =>
        (c.width || 0) < selection.settings.resolution ||
        (c.height || 0) < (selection.settings.resolution * 16) / 9,
    )
  )
    warnings.push(
      "Some clips are below the output resolution or need cropping. Review their framing; scaling cannot restore missing detail.",
    );
  if (
    input.clips.length !== clips.length ||
    input.texts.length !== texts.length ||
    input.music.length !== music.length ||
    input.looks.length !== looks.length
  )
    warnings.push("Identical selected inputs were counted once.");
  const uniqueExclusions = [
    ...new Map(exclusions.map((e) => [hash(e), e])).values(),
  ];
  const newContentCombinations = [
    ...new Set(recipes.map((r) => r.contentKey)),
  ].filter((key) => !previousContent.has(key)).length;
  return {
    totalPossible,
    unused,
    previouslyUsed: blockedRanks.size,
    baseCombinations,
    requested: selection.count,
    recipes,
    planHash: hash([
      workspaceId,
      selection.seed,
      selection.count,
      recipes.map((r) => r.recipeKey),
    ]),
    exclusions: uniqueExclusions.slice(0, 100),
    warnings,
    represented,
    newContentCombinations,
    additionalTreatments: recipes.length - newContentCombinations,
  };
}
