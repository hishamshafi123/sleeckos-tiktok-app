import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type Prisma = (typeof import("../src/lib/db"))["prisma"];
type ExportPlan = Parameters<
  (typeof import("../src/lib/services/multiplier-export"))["runSmartExport"]
>[2];

function validateDatabaseUrl() {
  const value = process.env.DATABASE_URL;
  if (!value) {
    throw new Error("DATABASE_URL must be supplied by the caller");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }

  const databaseName = url.pathname.slice(1);
  const validProtocol = url.protocol === "postgresql:" || url.protocol === "postgres:";
  const validHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (!validProtocol || !validHost || !databaseName.includes("kvm8_test") || databaseName.includes("/")) {
    throw new Error(
      "Refusing to run: DATABASE_URL must use localhost/127.0.0.1 and a database name containing kvm8_test"
    );
  }
}

async function main() {
  validateDatabaseUrl();

  const ids = {
    group: randomUUID(),
    variation: randomUUID(),
    hook: randomUUID(),
    outputs: {
      idempotency: randomUUID(),
      raceA: randomUUID(),
      raceB: randomUUID(),
      smartDownload: randomUUID(),
    },
    folders: {
      idempotency: randomUUID(),
      activeReservation: randomUUID(),
      race: randomUUID(),
      excluded: randomUUID(),
      included: randomUUID(),
    },
    keys: {
      idempotency: `smart-export-idempotency-${randomUUID()}`,
      activeReservation: `smart-export-active-${randomUUID()}`,
      raceA: `smart-export-race-a-${randomUUID()}`,
      raceB: `smart-export-race-b-${randomUUID()}`,
      excluded: `smart-export-excluded-${randomUUID()}`,
      included: `smart-export-included-${randomUUID()}`,
    },
  };
  const allKeys = Object.values(ids.keys);
  const originalCwd = process.cwd();
  const isolatedCwd = fs.mkdtempSync(path.join(os.tmpdir(), "smart-export-idempotency-"));
  let prisma: Prisma | null = null;

  try {
    process.chdir(isolatedCwd);
    ({ prisma } = await import("../src/lib/db"));
    const {
      createSmartExportRequestHash,
      runSmartExport,
      SmartExportRequestConflictError,
      SmartExportReservationError,
    } = await import("../src/lib/services/multiplier-export");
    process.chdir(originalCwd);

    const client = prisma;
    const groupIds = [ids.group];
    const makePlan = (driveFolderId: string, videoIds: string[]): ExportPlan => [{
      driveFolderId,
      driveFolderName: `Smart Export test ${driveFolderId}`,
      videoIds,
    }];
    const optionsFor = (idempotencyKey: string, plan: ExportPlan, includeExported = false) => ({
      idempotencyKey,
      requestHash: createSmartExportRequestHash({
        groupIds,
        plan,
        days: 1,
        includeExported,
      }),
      includeExported,
      startWorker: false,
    });

    await client.multiplierGroup.create({
      data: {
        id: ids.group,
        name: `Smart Export idempotency test ${ids.group}`,
        styleId: "smart-export-idempotency-test",
      },
    });
    await client.multiplierGroupVariation.create({
      data: {
        id: ids.variation,
        groupId: ids.group,
        videoRef: `uploads/smart-export-idempotency/${ids.variation}.mp4`,
      },
    });
    await client.multiplierHook.create({
      data: {
        id: ids.hook,
        groupId: ids.group,
        text: "Smart Export idempotency integration test",
      },
    });

    const smartDownloadedAt = new Date("2026-01-02T03:04:05.000Z");
    const completedOutput = (id: string) => ({
      id,
      groupId: ids.group,
      variationId: ids.variation,
      hookId: ids.hook,
      status: "COMPLETED",
      outputRef: `uploads/smart-export-idempotency/${id}.mp4`,
    });
    await client.multiplierOutput.createMany({
      data: [
        completedOutput(ids.outputs.idempotency),
        completedOutput(ids.outputs.raceA),
        completedOutput(ids.outputs.raceB),
        {
          ...completedOutput(ids.outputs.smartDownload),
          exportedAt: smartDownloadedAt,
          exportStatus: "not_exported",
        },
      ],
    });

    const idempotencyPlan = makePlan(ids.folders.idempotency, [ids.outputs.idempotency]);
    const idempotencyResults = await Promise.all(
      Array.from({ length: 10 }, () => runSmartExport(
        null,
        groupIds,
        idempotencyPlan,
        1,
        optionsFor(ids.keys.idempotency, idempotencyPlan)
      ))
    );
    assert.equal(new Set(idempotencyResults.map((result) => result.job.id)).size, 1);
    assert.equal(idempotencyResults.filter((result) => !result.replayed).length, 1);

    const idempotencyJobs = await client.smartExportJob.findMany({
      where: { idempotencyKey: ids.keys.idempotency },
      include: { assignments: true },
    });
    assert.equal(idempotencyJobs.length, 1);
    assert.equal(idempotencyJobs[0].status, "pending");
    assert.equal(idempotencyJobs[0].assignments.length, 1);
    assert.equal(idempotencyJobs[0].assignments[0].status, "pending");
    assert.equal(idempotencyJobs[0].assignments[0].videoId, ids.outputs.idempotency);

    let output = await client.multiplierOutput.findUniqueOrThrow({
      where: { id: ids.outputs.idempotency },
    });
    assert.equal(output.exportStatus, "exporting");
    assert.equal(output.exportDestinationFolderId, ids.folders.idempotency);

    const mismatchedHash = createSmartExportRequestHash({
      groupIds,
      plan: idempotencyPlan,
      days: 2,
      includeExported: false,
    });
    await assert.rejects(
      runSmartExport(null, groupIds, idempotencyPlan, 2, {
        ...optionsFor(ids.keys.idempotency, idempotencyPlan),
        requestHash: mismatchedHash,
      }),
      SmartExportRequestConflictError
    );
    assert.equal(await client.smartExportJob.count({
      where: { idempotencyKey: ids.keys.idempotency },
    }), 1);
    assert.equal(await client.smartExportAssignment.count({
      where: { jobId: idempotencyJobs[0].id },
    }), 1);

    const activeReservationPlan = makePlan(
      ids.folders.activeReservation,
      [ids.outputs.idempotency]
    );
    await assert.rejects(
      runSmartExport(
        null,
        groupIds,
        activeReservationPlan,
        1,
        optionsFor(ids.keys.activeReservation, activeReservationPlan)
      ),
      SmartExportReservationError
    );
    assert.equal(await client.smartExportJob.count({
      where: { idempotencyKey: ids.keys.activeReservation },
    }), 0, "A failed reservation must not leave an empty job");
    assert.equal(await client.smartExportAssignment.count({
      where: { videoId: ids.outputs.idempotency },
    }), 1);
    output = await client.multiplierOutput.findUniqueOrThrow({
      where: { id: ids.outputs.idempotency },
    });
    assert.equal(output.exportStatus, "exporting");
    assert.equal(output.exportDestinationFolderId, ids.folders.idempotency);

    const racePlanA = makePlan(ids.folders.race, [ids.outputs.raceA]);
    const racePlanB = makePlan(ids.folders.race, [ids.outputs.raceB]);
    const raceResults = await Promise.allSettled([
      runSmartExport(null, groupIds, racePlanA, 1, optionsFor(ids.keys.raceA, racePlanA)),
      runSmartExport(null, groupIds, racePlanB, 1, optionsFor(ids.keys.raceB, racePlanB)),
    ]);
    const rejected = raceResults.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    assert.equal(raceResults.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0].reason instanceof SmartExportReservationError);

    const raceJobs = await client.smartExportJob.findMany({
      where: { idempotencyKey: { in: [ids.keys.raceA, ids.keys.raceB] } },
      include: { assignments: true },
    });
    assert.equal(raceJobs.length, 1, "The losing reservation must roll back its job");
    assert.equal(raceJobs[0].status, "pending");
    assert.equal(raceJobs[0].assignments.length, 1);
    assert.equal(raceJobs[0].assignments[0].status, "pending");

    const raceAssignments = await client.smartExportAssignment.findMany({
      where: { sourceGroupId: ids.group, driveFolderId: ids.folders.race },
    });
    assert.equal(raceAssignments.length, 1);
    const raceOutputs = await client.multiplierOutput.findMany({
      where: { id: { in: [ids.outputs.raceA, ids.outputs.raceB] } },
    });
    const exportingRaceOutputs = raceOutputs.filter((item) => item.exportStatus === "exporting");
    const unreservedRaceOutputs = raceOutputs.filter((item) => item.exportStatus === "not_exported");
    assert.equal(exportingRaceOutputs.length, 1);
    assert.equal(unreservedRaceOutputs.length, 1);
    assert.equal(raceAssignments[0].videoId, exportingRaceOutputs[0].id);
    assert.equal(unreservedRaceOutputs[0].exportDestinationFolderId, null);

    const excludedPlan = makePlan(ids.folders.excluded, [ids.outputs.smartDownload]);
    await assert.rejects(
      runSmartExport(
        null,
        groupIds,
        excludedPlan,
        1,
        optionsFor(ids.keys.excluded, excludedPlan, false)
      ),
      SmartExportReservationError
    );
    assert.equal(await client.smartExportJob.count({
      where: { idempotencyKey: ids.keys.excluded },
    }), 0, "An includeExported:false rejection must not leave an empty job");
    output = await client.multiplierOutput.findUniqueOrThrow({
      where: { id: ids.outputs.smartDownload },
    });
    assert.equal(output.exportStatus, "not_exported");
    assert.equal(output.exportedAt?.getTime(), smartDownloadedAt.getTime());
    assert.equal(output.exportDestinationFolderId, null);

    const includedPlan = makePlan(ids.folders.included, [ids.outputs.smartDownload]);
    await runSmartExport(
      null,
      groupIds,
      includedPlan,
      1,
      optionsFor(ids.keys.included, includedPlan, true)
    );
    const includedJob = await client.smartExportJob.findUniqueOrThrow({
      where: { idempotencyKey: ids.keys.included },
      include: { assignments: true },
    });
    assert.equal(includedJob.status, "pending");
    assert.equal(includedJob.assignments.length, 1);
    assert.equal(includedJob.assignments[0].status, "pending");
    assert.equal(includedJob.assignments[0].driveFolderId, ids.folders.included);
    output = await client.multiplierOutput.findUniqueOrThrow({
      where: { id: ids.outputs.smartDownload },
    });
    assert.equal(output.exportStatus, "exporting");
    assert.equal(output.exportedAt?.getTime(), smartDownloadedAt.getTime());
    assert.equal(output.exportDestinationFolderId, ids.folders.included);

    const finalJobs = await client.smartExportJob.findMany({
      where: { idempotencyKey: { in: allKeys } },
      include: { assignments: true },
    });
    assert.equal(finalJobs.length, 3);
    assert.ok(finalJobs.every((job) =>
      job.status === "pending" &&
      job.assignments.length === 1 &&
      job.assignments[0].status === "pending"
    ));
    assert.equal(await client.smartExportAssignment.count({
      where: { jobId: { in: finalJobs.map((job) => job.id) } },
    }), 3);

    console.log("Smart Export idempotency integration tests passed");
  } finally {
    process.chdir(originalCwd);
    try {
      if (prisma) {
        try {
          await prisma.smartExportJob.deleteMany({
            where: { idempotencyKey: { in: allKeys } },
          });
        } finally {
          try {
            await prisma.multiplierGroup.deleteMany({ where: { id: ids.group } });
          } finally {
            await prisma.$disconnect();
          }
        }
      }
    } finally {
      fs.rmSync(isolatedCwd, { recursive: true, force: true });
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Smart Export idempotency integration test failed: ${message}`);
  process.exitCode = 1;
});
