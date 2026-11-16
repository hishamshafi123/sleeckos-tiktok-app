/** Disposable local database only. No Drive uploads or posting calls. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_MIXER_SETTINGS } from "../src/lib/campaign-mixer/schema";

async function main() {
  const url = new URL(process.env.DATABASE_URL || "");
  assert(
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
      /state_accounts_verify$/.test(url.pathname),
    "Use the disposable local state_accounts_verify database.",
  );
  const marker = crypto.randomUUID(),
    actor = `mixer-qa-${marker}`;
  process.env.MIXER_STORAGE_DIR = path.join(
    process.cwd(),
    "scratch/mixer-integration",
    marker,
  );
  const { default: db } = await import("../src/lib/db");
  const service = await import("../src/lib/services/campaign-mixer/data");
  const media = await import("../src/lib/services/campaign-mixer/media");
  const queue = await import("../src/lib/services/multiplier");
  const exp = await import("../src/lib/services/multiplier-export");
  await queue.pauseRenderQueue();
  const campaign = await db.campaign.create({
    data: {
      title: `Mixer QA ${marker}`,
      slug: `mixer-qa-${marker}`,
      description: "Disposable QA",
      brief: "QA",
      requiredHashtags: [],
      requiredMentions: [],
      payoutPerPostCents: 0,
      totalBudgetCents: 0,
      maxCreators: 1,
      applicationDeadline: new Date(),
      deliveryDeadline: new Date(),
      nicheTags: [],
      exampleVideos: [],
      fixedTexts: ["Keep this posting caption"],
    },
  });
  let workspaceId = "";
  const exportJobs: string[] = [],
    groupIds: string[] = [];
  try {
    const workspace = await service.createWorkspace(campaign.id, actor);
    workspaceId = workspace.id;
    assert.equal(
      (await service.createWorkspace(campaign.id, actor)).id,
      workspaceId,
    );
    await fs.promises.mkdir(media.mixerPath("incoming"), { recursive: true });
    const source = media.mixerPath("incoming/source.mp4"),
      duplicate = media.mixerPath("incoming/duplicate.mp4"),
      musicFile = media.mixerPath("incoming/music.wav");
    await media.mediaCommand("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=navy:size=1080x1920:rate=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=330:sample_rate=48000",
      "-t",
      "1.2",
      "-c:v",
      "libx264",
      "-threads",
      "2",
      "-preset",
      "ultrafast",
      "-c:a",
      "aac",
      source,
    ]);
    await fs.promises.copyFile(source, duplicate);
    const a = await service.addAsset(
      workspaceId,
      source,
      "clip",
      "first.mp4",
      (await fs.promises.stat(source)).size,
    );
    const dupe = await service.addAsset(
      workspaceId,
      duplicate,
      "clip",
      "renamed.mp4",
      (await fs.promises.stat(duplicate)).size,
    );
    assert.equal(dupe.assetId, a.assetId);
    assert(dupe.duplicate);
    await media.mediaCommand("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:sample_rate=48000",
      "-t",
      "2",
      musicFile,
    ]);
    const track = await service.addAsset(
      workspaceId,
      musicFile,
      "music",
      "music.wav",
      (await fs.promises.stat(musicFile)).size,
    );
    await service.addTexts(
      workspaceId,
      Array.from({ length: 10 }, (_, i) => `A clear viewpoint ${i + 1}`),
    );
    const reopened = await service.workspaceDetails(workspaceId);
    assert.equal(reopened.assets.length, 2);
    assert.equal(reopened.texts.length, 10);
    assert.deepEqual(
      (await db.campaign.findUniqueOrThrow({ where: { id: campaign.id } }))
        .fixedTexts,
      ["Keep this posting caption"],
    );
    const rev = reopened.workspace.revision;
    await service.saveWorkspace(workspaceId, {
      revision: rev,
      defaults: DEFAULT_MIXER_SETTINGS,
      draft: { clipIds: [a.assetId] },
    });
    await assert.rejects(
      () =>
        service.saveWorkspace(workspaceId, {
          revision: rev,
          defaults: DEFAULT_MIXER_SETTINGS,
        }),
      /another window/,
    );
    const selection = {
      clipIds: [a.assetId],
      musicIds: [track.assetId],
      textIds: reopened.texts.map((t) => t.id),
      presetIds: ["reference-dark", "soft-fade"],
      settings: DEFAULT_MIXER_SETTINGS,
      count: 4,
      seed: "integration",
    };
    const { plan } = await service.preparePlan(workspaceId, selection);
    const confirmation = {
      selection,
      planHash: plan.planHash,
      idempotencyKey: crypto.randomUUID(),
    };
    const double = await Promise.all([
      service.confirmBatch(workspaceId, confirmation, actor),
      service.confirmBatch(workspaceId, confirmation, actor),
    ]);
    assert.equal(double[0].batchId, double[1].batchId);
    groupIds.push(double[0].groupId!);
    let batch = await service.batchDetails(double[0].batchId);
    assert.equal(batch.recipes.length, 4);
    const snapshotText = (
      batch.recipes[0].snapshot as { text: { id: string; text: string } }
    ).text;
    await service.editText(workspaceId, snapshotText.id, {
      text: "A changed text for tomorrow",
    });
    assert.equal(
      (
        (await service.batchDetails(batch.id)).recipes[0].snapshot as {
          text: { text: string };
        }
      ).text.text,
      snapshotText.text,
      "Approved recipe stays immutable",
    );
    await service.controlBatch(batch.id, "pause");
    assert(
      (await service.batchDetails(batch.id)).recipes.every(
        (r) => r.output?.status === "PAUSED",
      ),
    );
    await service.controlBatch(batch.id, "resume");
    assert(
      (await service.batchDetails(batch.id)).recipes.every(
        (r) => r.output?.status === "PENDING",
      ),
    );
    const firstOutput = batch.recipes[0].outputId!;
    await db.multiplierOutput.update({
      where: { id: firstOutput },
      data: {
        status: "RENDERING",
        renderLeaseId: "stale",
        renderHeartbeatAt: new Date(Date.now() - 600000),
      },
    });
    assert((await queue.recoverStaleRenderingOutputs()) >= 1);
    assert.equal(
      (
        await db.multiplierOutput.findUniqueOrThrow({
          where: { id: firstOutput },
        })
      ).status,
      "PENDING",
    );
    await db.multiplierOutput.update({
      where: { id: firstOutput },
      data: {
        status: "RENDERING",
        renderLeaseId: "paused-crash",
        renderHeartbeatAt: new Date(Date.now() - 600000),
      },
    });
    await service.controlBatch(batch.id, "pause");
    await queue.recoverStaleRenderingOutputs();
    assert.equal(
      (
        await db.multiplierOutput.findUniqueOrThrow({
          where: { id: firstOutput },
        })
      ).status,
      "PAUSED",
      "Restart preserves a saved pause",
    );
    await service.controlBatch(batch.id, "resume");
    await service.controlBatch(batch.id, "cancel");
    batch = await service.batchDetails(batch.id);
    assert(batch.recipes.every((r) => r.activeKey === null));
    await assert.rejects(
      () => service.controlBatch(batch.id, "retry"),
      /canceled/,
    );
    console.log(
      "Library: upload dedup, reopen, caption separation, revision conflict, immutable batch, double-click, pause/resume/cancel and stale recovery passed.",
    );

    // Build 120 independent fixture clip/text pairs to verify one-batch export.
    const firstAsset = await db.mixerAsset.findUniqueOrThrow({
      where: { id: a.assetId },
    });
    const clipIds = [a.assetId];
    for (let i = 1; i < 12; i++) {
      const id = crypto.randomUUID();
      clipIds.push(id);
      await db.mixerAsset.create({
        data: {
          workspaceId,
          id,
          name: `Fixture ${i}`,
          kind: "clip",
          filePath: firstAsset.filePath,
          previewPath: firstAsset.previewPath,
          contentHash: `fixture-${marker}-${i}`,
          duration: firstAsset.duration,
          sizeBytes: firstAsset.sizeBytes,
          width: 1080,
          height: 1920,
          hasAudio: true,
        },
      });
    }
    const exportSelection = {
      ...selection,
      clipIds,
      presetIds: ["reference-dark"],
      count: 120,
      seed: "export",
    };
    const exportPlan = (await service.preparePlan(workspaceId, exportSelection))
      .plan;
    assert.equal(exportPlan.recipes.length, 120);
    const run = await service.confirmBatch(
      workspaceId,
      {
        selection: exportSelection,
        planHash: exportPlan.planHash,
        idempotencyKey: crypto.randomUUID(),
      },
      actor,
    );
    groupIds.push(run.groupId!);
    await db.multiplierOutput.updateMany({
      where: { groupId: run.groupId! },
      data: { status: "COMPLETED", outputRef: "/uploads/mixer-fixture.mp4" },
    });
    await db.mixerRecipe.updateMany({
      where: { batchId: run.batchId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await db.multiplierGroup.update({
      where: { id: run.groupId! },
      data: { status: "COMPLETED" },
    });
    const folders = Array.from({ length: 10 }, (_, i) => ({
      id: `fixture-folder-${marker}-${i}`,
      name: `Account ${i + 1}`,
      count: 12,
    }));
    const preview = await exp.previewSmartExport([run.groupId!], folders);
    assert.equal(preview.videoBudget.assigned, 120);
    assert.equal(preview.unfulfillable.length, 0);
    assert(preview.assignments.every((a) => a.videoIds.length === 12));
    const hash = exp.createSmartExportRequestHash({
      groupIds: [run.groupId!],
      plan: preview.assignments,
      days: 1,
      includeExported: false,
    });
    const result = await exp.runSmartExport(
      actor,
      [run.groupId!],
      preview.assignments,
      1,
      { idempotencyKey: `qa-${marker}`, requestHash: hash, startWorker: false },
    );
    exportJobs.push(result.job.id);
    assert.equal(
      await db.smartExportAssignment.count({ where: { jobId: result.job.id } }),
      120,
    );
    assert.equal(
      (
        await exp.runSmartExport(
          actor,
          [run.groupId!],
          preview.assignments,
          1,
          {
            idempotencyKey: `qa-${marker}`,
            requestHash: hash,
            startWorker: false,
          },
        )
      ).job.id,
      result.job.id,
    );
    await assert.rejects(
      () =>
        exp.runSmartExport(actor, [run.groupId!], preview.assignments, 1, {
          startWorker: false,
        }),
      /already exporting/,
    );
    const r = await db.mixerRecipe.findFirstOrThrow({
      where: { batchId: run.batchId },
    });
    await db.mixerDelivery.create({
      data: {
        workspaceId,
        recipeKey: r.recipeKey,
        driveFolderId: folders[0].id,
        outputId: r.outputId!,
        assignmentId: "fixture-delivered",
      },
    });
    await db.multiplierOutput.updateMany({
      where: { groupId: run.groupId! },
      data: { exportStatus: "not_exported" },
    });
    const afterDelivery = await exp.previewSmartExport(
      [run.groupId!],
      folders,
      true,
    );
    assert(
      !afterDelivery.assignments[0].videoIds.includes(r.outputId!),
      "Already delivered recipe is excluded from its destination",
    );
    await assert.rejects(
      () =>
        exp.runSmartExport(
          actor,
          [run.groupId!],
          [
            {
              driveFolderId: folders[0].id,
              driveFolderName: "duplicate",
              videoIds: [r.outputId!],
            },
          ],
          1,
          { includeExported: true, startWorker: false },
        ),
      /already received/,
    );
    await queue.clearGroupOutputs([run.groupId!]);
    assert.equal(
      await db.mixerRecipe.count({
        where: {
          batchId: run.batchId,
          completedAt: { not: null },
          outputId: null,
        },
      }),
      120,
    );
    assert.equal(await db.mixerDelivery.count({ where: { workspaceId } }), 1);
    assert(
      await fs.promises.stat(media.mixerPath(firstAsset.filePath)),
      "Clearing outputs preserves source library",
    );
    assert.equal(
      (await service.preparePlan(workspaceId, exportSelection)).plan.unused,
      0,
      "Cleanup cannot erase repeat prevention",
    );
    console.log(
      "Export: one batch fills 10 × 12 quotas; reservation replay, duplicate delivery, durable history and source preservation passed. No uploads sent.",
    );
  } finally {
    await queue.pauseRenderQueue();
    await db.smartExportJob.deleteMany({ where: { id: { in: exportJobs } } });
    await db.multiplierGroup.deleteMany({ where: { id: { in: groupIds } } });
    if (workspaceId) {
      await db.mixerDelivery.deleteMany({ where: { workspaceId } });
      await db.mixerWorkspace.deleteMany({ where: { id: workspaceId } });
    }
    await db.campaign.delete({ where: { id: campaign.id } });
    await db.$disconnect();
    await fs.promises.rm(process.env.MIXER_STORAGE_DIR!, {
      recursive: true,
      force: true,
    });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
