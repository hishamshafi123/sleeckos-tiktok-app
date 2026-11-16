import crypto from "node:crypto";
import fs from "node:fs";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/db";
import { getOrgTimezone } from "@/lib/services/timezone";
import { formatInTimeZone } from "date-fns-tz";
import {
  DEFAULT_MIXER_SETTINGS,
  MIXER_LOOKS,
  MixerError,
  clipEdit,
  musicStart,
  parseLook,
  parseMixerSettings,
  parseSelection,
  record,
  type MixerLook,
} from "@/lib/campaign-mixer/schema";
import { checkSpace, fileHash, mixerPath, prepareAsset } from "./media";
import { planMixer, textHash } from "./planner";
import { renderMixerRecipe } from "./render";

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export async function workspaceAccess(id: string) {
  const workspace = await prisma.mixerWorkspace.findUnique({
    where: { id },
    include: { campaign: { select: { id: true, title: true } } },
  });
  if (!workspace || workspace.archived)
    throw new MixerError(
      "This campaign library was not found.",
      "NOT_FOUND",
      404,
    );
  return workspace;
}
export async function listWorkspaces() {
  const [workspaces, campaigns] = await Promise.all([
    prisma.mixerWorkspace.findMany({
      where: { archived: false },
      orderBy: { updatedAt: "desc" },
      include: {
        campaign: { select: { title: true } },
        _count: { select: { assets: true, texts: true, batches: true } },
      },
    }),
    prisma.campaign.findMany({
      orderBy: { title: "asc" },
      select: { id: true, title: true },
      take: 1000,
    }),
  ]);
  return { workspaces, campaigns };
}
export async function createWorkspace(campaignId: string, userId: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
  });
  if (!campaign) throw new MixerError("Choose an existing campaign.");
  return prisma.mixerWorkspace.upsert({
    where: { campaignId },
    create: {
      campaignId,
      name: campaign.title,
      createdBy: userId,
      defaults: json(DEFAULT_MIXER_SETTINGS),
    },
    update: { archived: false },
  });
}
export async function workspaceDetails(id: string) {
  const workspace = await workspaceAccess(id);
  const [assets, texts, presets, batches, usage] = await Promise.all([
    prisma.mixerAsset.findMany({
      where: { workspaceId: id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.mixerText.findMany({
      where: { workspaceId: id },
      orderBy: { createdAt: "asc" },
    }),
    prisma.mixerPreset.findMany({
      where: { workspaceId: id, archived: false },
      orderBy: { createdAt: "asc" },
    }),
    prisma.mixerBatch.findMany({
      where: { workspaceId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        recipes: { select: { clipId: true, musicId: true, status: true } },
      },
    }),
    prisma.mixerRecipe.groupBy({
      by: ["clipId", "musicId"],
      where: { workspaceId: id, completedAt: { not: null } },
      _count: true,
      _max: { completedAt: true },
    }),
  ]);
  const counts = new Map<string, { count: number; lastUsed: Date | null }>();
  for (const u of usage)
    for (const assetId of [u.clipId, u.musicId]) {
      const current = counts.get(assetId) || { count: 0, lastUsed: null };
      current.count += u._count;
      if (
        u._max.completedAt &&
        (!current.lastUsed || u._max.completedAt > current.lastUsed)
      )
        current.lastUsed = u._max.completedAt;
      counts.set(assetId, current);
    }
  return {
    workspace,
    assets: assets.map((a) => ({
      ...a,
      usage: counts.get(a.id) || { count: 0, lastUsed: null },
    })),
    texts,
    looks: [
      ...MIXER_LOOKS,
      ...presets.map((p) => ({
        id: p.id,
        name: p.name,
        settings: parseLook(p.settings),
      })),
    ],
    batches: batches.map((b) => {
      const counts: Record<string, number> = {};
      for (const r of b.recipes) counts[r.status] = (counts[r.status] || 0) + 1;
      return { ...b, recipes: undefined, counts };
    }),
  };
}
export async function saveWorkspace(id: string, body: Record<string, unknown>) {
  await workspaceAccess(id);
  if (!Number.isInteger(body.revision))
    throw new MixerError(
      "Refresh this campaign before saving.",
      "REVISION_REQUIRED",
      409,
    );
  const draft = record(body.draft);
  if (JSON.stringify(draft).length > 100_000)
    throw new MixerError("The saved selection is too large.");
  const updated = await prisma.mixerWorkspace.updateMany({
    where: { id, revision: Number(body.revision) },
    data: {
      ...(body.defaults !== undefined
        ? { defaults: json(parseMixerSettings(body.defaults)) }
        : {}),
      ...(body.draft !== undefined ? { draft: json(draft) } : {}),
      revision: { increment: 1 },
    },
  });
  if (!updated.count)
    throw new MixerError(
      "This campaign was changed in another window. Reload it before saving your changes.",
      "EDIT_CONFLICT",
      409,
    );
  return workspaceAccess(id);
}
async function touch(tx: Prisma.TransactionClient, id: string) {
  await tx.mixerWorkspace.update({
    where: { id },
    data: { revision: { increment: 1 } },
  });
}
export async function addAsset(
  id: string,
  file: string,
  kind: "clip" | "music",
  name: string,
  bytes: number,
) {
  await workspaceAccess(id);
  const contentHash = await fileHash(file);
  const existing = await prisma.mixerAsset.findUnique({
    where: {
      workspaceId_kind_contentHash: { workspaceId: id, kind, contentHash },
    },
  });
  if (existing) {
    await fs.promises.unlink(file).catch(() => {});
    await prisma.$transaction(async (tx) => {
      await tx.mixerAsset.update({
        where: { id: existing.id },
        data: { archived: false },
      });
      await touch(tx, id);
    });
    return { assetId: existing.id, duplicate: true };
  }
  const assetId = crypto.randomUUID();
  const { renderAdmissionController } =
    await import("../multiplier-performance");
  const prepared = await renderAdmissionController.run(() =>
    prepareAsset(file, assetId, kind),
  );
  try {
    await prisma.$transaction(async (tx) => {
      await tx.mixerAsset.create({
        data: {
          id: assetId,
          workspaceId: id,
          kind,
          name: name.slice(0, 180) || kind,
          contentHash,
          sizeBytes: bytes,
          ...prepared,
        },
      });
      await touch(tx, id);
    });
  } catch (error) {
    await fs.promises.rm(mixerPath(`assets/${assetId}`), {
      recursive: true,
      force: true,
    });
    // Two uploads of identical bytes may finish concurrently.
    const winner = await prisma.mixerAsset.findUnique({
      where: {
        workspaceId_kind_contentHash: { workspaceId: id, kind, contentHash },
      },
    });
    if (winner) return { assetId: winner.id, duplicate: true };
    throw error;
  }
  return { assetId, duplicate: false };
}
function tags(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    value.some((t) => typeof t !== "string" || t.length > 60)
  )
    throw new MixerError("Use at most 20 short tags.");
  return [
    ...new Set(
      value.map((t) => String(t).trim().toLowerCase()).filter(Boolean),
    ),
  ];
}
export async function editAsset(
  id: string,
  assetId: string,
  body: Record<string, unknown>,
) {
  await workspaceAccess(id);
  const asset = await prisma.mixerAsset.findFirst({
    where: { id: assetId, workspaceId: id },
  });
  if (!asset) throw new MixerError("Asset not found.", "NOT_FOUND", 404);
  const settings =
    body.settings === undefined ? asset.settings : record(body.settings);
  if (asset.kind === "clip") clipEdit({ ...asset, settings });
  else musicStart({ ...asset, settings });
  if (
    body.name !== undefined &&
    (typeof body.name !== "string" || !body.name.trim())
  )
    throw new MixerError("Enter a name for this asset.");
  await prisma.$transaction(async (tx) => {
    await tx.mixerAsset.update({
      where: { id: assetId },
      data: {
        settings: json(settings),
        ...(body.name !== undefined
          ? { name: String(body.name).trim().slice(0, 180) }
          : {}),
        ...(body.tags !== undefined ? { tags: tags(body.tags) } : {}),
        ...(typeof body.archived === "boolean"
          ? { archived: body.archived }
          : {}),
      },
    });
    await touch(tx, id);
  });
}
export async function addTexts(id: string, values: unknown) {
  await workspaceAccess(id);
  if (
    !Array.isArray(values) ||
    values.length < 1 ||
    values.length > 500 ||
    values.some(
      (t) => typeof t !== "string" || t.trim().length < 1 || t.length > 600,
    )
  )
    throw new MixerError(
      "Add up to 500 texts, each between 1 and 600 characters.",
    );
  const normalized = [
    ...new Map(
      (values as string[]).map((t) => [textHash(t), t.trim()]),
    ).entries(),
  ];
  await prisma.$transaction(
    async (tx) => {
      for (const [canonicalHash, text] of normalized)
        await tx.mixerText.upsert({
          where: {
            workspaceId_canonicalHash: { workspaceId: id, canonicalHash },
          },
          create: { workspaceId: id, canonicalHash, text },
          update: { archived: false },
        });
      await touch(tx, id);
    },
    { timeout: 30_000 },
  );
  return { submitted: values.length, distinct: normalized.length };
}
export async function editText(
  id: string,
  textId: string,
  body: Record<string, unknown>,
) {
  await workspaceAccess(id);
  const entry = await prisma.mixerText.findFirst({
    where: { id: textId, workspaceId: id },
  });
  if (!entry) throw new MixerError("Text not found.", "NOT_FOUND", 404);
  const text =
    body.text === undefined
      ? entry.text
      : typeof body.text === "string"
        ? body.text.trim()
        : "";
  if (!text || text.length > 600)
    throw new MixerError("Text must contain between 1 and 600 characters.");
  const duplicate = await prisma.mixerText.findFirst({
    where: {
      workspaceId: id,
      canonicalHash: textHash(text),
      id: { not: textId },
    },
  });
  if (duplicate)
    throw new MixerError(
      "That text already exists in this campaign. Select the existing entry.",
    );
  await prisma.$transaction(async (tx) => {
    await tx.mixerText.update({
      where: { id: textId },
      data: {
        text,
        canonicalHash: textHash(text),
        ...(body.tags !== undefined ? { tags: tags(body.tags) } : {}),
        ...(typeof body.archived === "boolean"
          ? { archived: body.archived }
          : {}),
      },
    });
    await touch(tx, id);
  });
}
export async function savePreset(id: string, body: Record<string, unknown>) {
  await workspaceAccess(id);
  if (typeof body.name !== "string" || !body.name.trim())
    throw new MixerError("Name this look.");
  return prisma.$transaction(async (tx) => {
    const p = await tx.mixerPreset.create({
      data: {
        workspaceId: id,
        name: String(body.name).trim().slice(0, 80),
        settings: json(parseLook(body.settings)),
      },
    });
    await touch(tx, id);
    return p;
  });
}
export async function preparePlan(id: string, input: unknown) {
  const workspace = await workspaceAccess(id),
    selection = parseSelection(input);
  const [assets, texts, custom, prior] = await Promise.all([
    prisma.mixerAsset.findMany({
      where: {
        workspaceId: id,
        archived: false,
        id: { in: [...selection.clipIds, ...selection.musicIds] },
      },
    }),
    prisma.mixerText.findMany({
      where: {
        workspaceId: id,
        archived: false,
        id: { in: selection.textIds },
      },
    }),
    prisma.mixerPreset.findMany({
      where: {
        workspaceId: id,
        archived: false,
        id: { in: selection.presetIds },
      },
    }),
    prisma.mixerRecipe.findMany({
      where: { workspaceId: id, activeKey: { not: null } },
      select: {
        recipeKey: true,
        contentKey: true,
        activeKey: true,
        snapshot: true,
      },
    }),
  ]);
  const ordered = <T extends { id: string }>(
    ids: string[],
    items: T[],
    label: string,
  ) =>
    ids.map((key) => {
      const item = items.find((a) => a.id === key);
      if (!item)
        throw new MixerError(
          `A selected ${label} is missing or archived. Refresh the campaign and select it again.`,
          "SELECTION_CHANGED",
          409,
        );
      return item;
    });
  const clips = ordered(
      selection.clipIds,
      assets.filter((a) => a.kind === "clip"),
      "clip",
    ),
    music = ordered(
      selection.musicIds,
      assets.filter((a) => a.kind === "music"),
      "track",
    );
  const looks: MixerLook[] = [
    ...MIXER_LOOKS,
    ...custom.map((p) => ({
      id: p.id,
      name: p.name,
      settings: parseLook(p.settings),
    })),
  ];
  const plan = await planMixer({
    workspaceId: id,
    selection,
    clips,
    music,
    texts: ordered(selection.textIds, texts, "text"),
    looks: ordered(selection.presetIds, looks, "look"),
    prior,
  });
  return { workspace, selection, plan };
}
export async function confirmBatch(
  id: string,
  body: Record<string, unknown>,
  userId: string,
) {
  if (
    typeof body.idempotencyKey !== "string" ||
    !body.idempotencyKey ||
    body.idempotencyKey.length > 100 ||
    typeof body.planHash !== "string"
  )
    throw new MixerError("Preview this batch before rendering.");
  const existing = await prisma.mixerBatch.findUnique({
    where: { idempotencyKey: body.idempotencyKey },
  });
  if (existing) {
    if (existing.workspaceId !== id || existing.planHash !== body.planHash)
      throw new MixerError(
        "This confirmation was already used for another plan.",
        "REQUEST_CONFLICT",
        409,
      );
    const { triggerQueueWorker } = await import("../multiplier");
    void triggerQueueWorker().catch((error) =>
      console.error("[Mixer] Queue wake failed:", error),
    );
    return { batchId: existing.id, groupId: existing.groupId, replay: true };
  }
  const { workspace, selection, plan } = await preparePlan(id, body.selection);
  if (!workspace.campaignId)
    throw new MixerError(
      "The campaign was removed. Attach this library to an existing campaign before rendering.",
    );
  if (plan.recipes.length !== selection.count || plan.unused < selection.count)
    throw new MixerError(
      `Only ${plan.unused} unused variations are available. Reduce the count or add materials.`,
      "INSUFFICIENT_VARIATIONS",
    );
  if (plan.planHash !== body.planHash)
    throw new MixerError(
      "The library or available combinations changed. Review a fresh preview before confirming.",
      "PLAN_CHANGED",
      409,
    );
  await checkSpace(
    plan.recipes.reduce((sum, r) => sum + r.duration * 1_100_000, 0),
  );
  const timezone = await getOrgTimezone(),
    businessDay = formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, 160)
      : `${workspace.name} · ${businessDay}`;
  const batchId = crypto.randomUUID(),
    groupId = crypto.randomUUID();
  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`mixer:${id}`}, 0))`;
      const replay = await tx.mixerBatch.findUnique({
        where: { idempotencyKey: String(body.idempotencyKey) },
      });
      if (replay) {
        if (replay.planHash !== body.planHash || replay.workspaceId !== id)
          throw new MixerError(
            "This request was already used.",
            "REQUEST_CONFLICT",
            409,
          );
        return { batchId: replay.id, groupId: replay.groupId, replay: true };
      }
      const current = await tx.mixerWorkspace.findUnique({ where: { id } });
      if (!current || current.revision !== workspace.revision)
        throw new MixerError(
          "The library changed while preparing this batch. Preview it again.",
          "PLAN_CHANGED",
          409,
        );
      const reservations = await tx.mixerRecipe.count({
        where: {
          workspaceId: id,
          activeKey: { in: plan.recipes.map((r) => r.recipeKey) },
        },
      });
      if (reservations)
        throw new MixerError(
          "Another batch reserved some of these variations. Preview again to select the remaining ones.",
          "PLAN_CHANGED",
          409,
        );
      await tx.multiplierGroup.create({
        data: {
          id: groupId,
          name,
          campaignId: workspace.campaignId,
          sourceKind: "mixer",
          styleId: "campaign-mixer",
          status: "QUEUED",
          transcriptStatus: "TRANSCRIBED",
          mappingMode: "distribute",
          settings: { mixerBatchId: batchId },
          createdBy: userId,
        },
      });
      await tx.mixerBatch.create({
        data: {
          id: batchId,
          workspaceId: id,
          groupId,
          name,
          timezone,
          businessDay,
          requestedCount: selection.count,
          plan: json({
            selection,
            summary: {
              totalPossible: plan.totalPossible,
              unused: plan.unused,
              represented: plan.represented,
              warnings: plan.warnings,
            },
          }),
          planHash: plan.planHash,
          idempotencyKey: String(body.idempotencyKey),
          createdBy: userId,
        },
      });
      const variations = new Map<string, string>(),
        hooks = new Map<string, string>();
      for (const r of plan.recipes) {
        if (!variations.has(r.clip.id))
          variations.set(r.clip.id, crypto.randomUUID());
        if (!hooks.has(r.text.id)) hooks.set(r.text.id, crypto.randomUUID());
      }
      await tx.multiplierGroupVariation.createMany({
        data: [...variations].map(([assetId, variationId], order) => ({
          id: variationId,
          groupId,
          order,
          videoRef: `/api/multiplier/mixer/media/${assetId}`,
        })),
      });
      await tx.multiplierHook.createMany({
        data: [...hooks].map(([textId, hookId], order) => ({
          id: hookId,
          groupId,
          order,
          text: plan.recipes.find((r) => r.text.id === textId)!.text.text,
          source: "manual",
        })),
      });
      const entries = plan.recipes.map((recipe) => ({
        recipe,
        outputId: crypto.randomUUID(),
      }));
      await tx.multiplierOutput.createMany({
        data: entries.map(({ recipe, outputId }) => ({
          id: outputId,
          groupId,
          variationId: variations.get(recipe.clip.id)!,
          hookId: hooks.get(recipe.text.id)!,
          status: "PENDING",
        })),
      });
      await tx.mixerRecipe.createMany({
        data: entries.map(({ recipe: r, outputId }) => ({
          workspaceId: id,
          batchId,
          outputId,
          recipeKey: r.recipeKey,
          activeKey: r.recipeKey,
          contentKey: r.contentKey,
          clipId: r.clip.id,
          musicId: r.music.id,
          textId: r.text.id,
          presetId: r.look.id,
          snapshot: json(r),
        })),
      });
      return { batchId, groupId, replay: false };
    },
    { timeout: 30_000 },
  );
  const { triggerQueueWorker } = await import("../multiplier");
  void triggerQueueWorker().catch((error) =>
    console.error("[Mixer] Queue wake failed:", error),
  );
  return result;
}
export async function batchDetails(batchId: string) {
  const batch = await prisma.mixerBatch.findUnique({
    where: { id: batchId },
    include: {
      recipes: {
        orderBy: { createdAt: "asc" },
        include: {
          output: {
            select: {
              status: true,
              outputRef: true,
              errorMessage: true,
              exportStatus: true,
            },
          },
        },
      },
    },
  });
  if (!batch) throw new MixerError("Batch not found.", "NOT_FOUND", 404);
  await workspaceAccess(batch.workspaceId);
  return batch;
}
export async function controlBatch(batchId: string, action: unknown) {
  if (!["pause", "resume", "cancel", "retry"].includes(String(action)))
    throw new MixerError("Choose pause, resume, cancel, or retry.");
  const batch = await batchDetails(batchId);
  if (!batch.groupId)
    throw new MixerError(
      "This batch's output group was removed. Its usage history is retained.",
      "GROUP_REMOVED",
      409,
    );
  if (batch.status === "CANCELED")
    throw new MixerError(
      "This batch was canceled. Create a new batch to use released combinations.",
      "BATCH_CANCELED",
      409,
    );
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`mixer:${batch.workspaceId}`}, 0))`;
    const fresh = await tx.mixerBatch.findUnique({ where: { id: batchId } });
    if (!fresh?.groupId || ["CANCELED", "CLEARED"].includes(fresh.status))
      throw new MixerError(
        "This batch was canceled or cleared. Create a new batch to continue.",
        "BATCH_CANCELED",
        409,
      );
    if (action === "retry" && fresh.status === "PAUSED")
      throw new MixerError(
        "Resume this batch before retrying failed outputs.",
        "BATCH_PAUSED",
        409,
      );
    const statuses =
      action === "pause"
        ? ["PENDING"]
        : action === "resume"
          ? ["PAUSED"]
          : action === "retry"
            ? ["FAILED"]
            : ["PENDING", "PAUSED", "FAILED", "RENDERING"];
    const target =
      action === "pause"
        ? "PAUSED"
        : action === "cancel"
          ? "CANCELED"
          : "PENDING";
    const affected = await tx.multiplierOutput.findMany({
      where: { groupId: batch.groupId!, status: { in: statuses } },
      select: { id: true },
    });
    const ids = affected.map((o) => o.id);
    await tx.multiplierOutput.updateMany({
      where: { id: { in: ids }, status: { in: statuses } },
      data: {
        status: target,
        errorMessage: null,
        renderLeaseId: null,
        renderHeartbeatAt: null,
      },
    });
    await tx.mixerRecipe.updateMany({
      where: { batchId, outputId: { in: ids }, completedAt: null },
      data: {
        status: target,
        ...(action === "cancel" ? { activeKey: null } : {}),
      },
    });
    const status =
      action === "pause"
        ? "PAUSED"
        : action === "cancel"
          ? "CANCELED"
          : "QUEUED";
    await tx.mixerBatch.update({ where: { id: batchId }, data: { status } });
    await tx.multiplierGroup.update({
      where: { id: batch.groupId! },
      data: { status },
    });
  });
  if (action === "resume" || action === "retry") {
    const { triggerQueueWorker } = await import("../multiplier");
    void triggerQueueWorker();
  }
}

// Limit explicit samples to one active render per process; real batches share
// the established admission controller. Samples never reserve a combination.
let sampleBusy = false;
export async function renderSample(id: string, body: Record<string, unknown>) {
  if (sampleBusy)
    throw new MixerError(
      "A sample is rendering. Try again when it finishes.",
      "SAMPLE_BUSY",
      429,
    );
  sampleBusy = true;
  try {
    const { plan } = await preparePlan(id, body.selection);
    if (plan.planHash !== body.planHash)
      throw new MixerError(
        "Refresh the batch preview before rendering a sample.",
        "PLAN_CHANGED",
        409,
      );
    const index = Number(body.index ?? 0);
    if (!Number.isInteger(index) || index < 0 || index >= plan.recipes.length)
      throw new MixerError("Choose an output from the preview.");
    const { renderAdmissionController } =
      await import("../multiplier-performance");
    return await renderAdmissionController.run(async () => ({
      outputRef: await renderMixerRecipe(
        plan.recipes[index],
        `sample_${crypto.randomUUID()}`,
        crypto.randomUUID(),
      ),
    }));
  } finally {
    sampleBusy = false;
  }
}
