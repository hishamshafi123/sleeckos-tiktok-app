import assert from "node:assert/strict";
import type {
  DynamicAdmissionController as AdmissionController,
  resolveMultiplierPerformanceSettings as resolveSettings,
} from "../src/lib/services/multiplier-performance";

type ControllerConstructor = new (poolLimit: number, initialLimit: number) => AdmissionController;

type Deferred = { promise: Promise<void>; resolve: () => void };

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function within<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 2000);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function testProfiles(resolve: typeof resolveSettings): void {
  assert.deepEqual(resolve(null, {}), {
    mode: "balanced",
    limits: { render: 4, export: 8 },
  });
  assert.deepEqual(resolve(undefined, {
    RENDER_CONCURRENCY: "6",
    EXPORT_WORKER_CONCURRENCY: "9",
  }), {
    mode: "balanced",
    limits: { render: 6, export: 9 },
  });
  assert.deepEqual(resolve(null, {
    RENDER_CONCURRENCY: "99",
    EXPORT_WORKER_CONCURRENCY: "99",
  }).limits, { render: 16, export: 16 });
  assert.deepEqual(resolve(null, {
    RENDER_CONCURRENCY: "invalid",
    EXPORT_WORKER_CONCURRENCY: "invalid",
  }).limits, { render: 4, export: 8 });

  assert.deepEqual(resolve("balanced", {}).limits, { render: 4, export: 8 });
  assert.deepEqual(resolve("render_boost", {}).limits, { render: 5, export: 2 });
  assert.deepEqual(resolve("export_boost", {}).limits, { render: 1, export: 12 });
  assert.deepEqual(resolve("not-a-mode", {
    RENDER_CONCURRENCY: "16",
    EXPORT_WORKER_CONCURRENCY: "16",
  }), {
    mode: "balanced",
    limits: { render: 4, export: 8 },
  });
  console.log("PASS profiles, env fallback/caps, and invalid stored values");
}

async function testSynchronousReservation(Controller: ControllerConstructor): Promise<void> {
  const controller = new Controller(5, 2);
  const first = controller.acquire();
  const second = controller.acquire();
  const third = controller.acquire();

  assert.deepEqual(controller.getMetrics(), {
    limit: 2,
    poolLimit: 5,
    active: 2,
    waiting: 1,
  });

  const releaseFirst = await first;
  const releaseSecond = await second;
  releaseFirst();
  assert.equal(controller.getMetrics().active, 2);
  assert.equal(controller.getMetrics().waiting, 0);

  const releaseThird = await third;
  releaseFirst();
  assert.equal(controller.getMetrics().active, 2);
  releaseSecond();
  releaseThird();
  assert.equal(controller.getMetrics().active, 0);
  assert.equal(controller.getMetrics().waiting, 0);
  console.log("PASS synchronous reservation, FIFO wakeup, and idempotent release");
}

async function testMaxActive(Controller: ControllerConstructor): Promise<void> {
  const controller = new Controller(4, 3);
  const gates = Array.from({ length: 9 }, deferred);
  let running = 0;
  let maxRunning = 0;
  const tasks = gates.map((gate) => controller.run(async () => {
    running++;
    maxRunning = Math.max(maxRunning, running);
    await gate.promise;
    running--;
  }));

  await flush();
  assert.equal(running, 3);
  assert.equal(controller.getMetrics().active, 3);
  assert.equal(controller.getMetrics().waiting, 6);
  gates.forEach((gate) => gate.resolve());
  await within(Promise.all(tasks), "max-active tasks");

  assert.equal(maxRunning, 3);
  assert.equal(running, 0);
  assert.equal(controller.getMetrics().active, 0);
  assert.equal(controller.getMetrics().waiting, 0);
  console.log("PASS maximum active work and full waiter drain");
}

async function testScaleDown(Controller: ControllerConstructor): Promise<void> {
  const controller = new Controller(4, 3);
  const gates = Array.from({ length: 4 }, deferred);
  const started: number[] = [];
  const completed: number[] = [];
  const run = (index: number) => controller.run(async () => {
    started.push(index);
    await gates[index].promise;
    completed.push(index);
  });

  const tasks = [run(0), run(1), run(2)];
  await flush();
  controller.setLimit(1);
  tasks.push(run(3));
  assert.equal(controller.getMetrics().active, 3);
  assert.equal(controller.getMetrics().waiting, 1);
  assert.deepEqual(completed, []);

  gates[0].resolve();
  await flush();
  assert.equal(controller.getMetrics().active, 2);
  assert.equal(controller.getMetrics().waiting, 1);
  assert.equal(started.includes(3), false);

  gates[1].resolve();
  await flush();
  assert.equal(controller.getMetrics().active, 1);
  assert.equal(controller.getMetrics().waiting, 1);
  assert.equal(started.includes(3), false);

  gates[2].resolve();
  await flush();
  assert.equal(controller.getMetrics().active, 1);
  assert.equal(controller.getMetrics().waiting, 0);
  assert.equal(started.includes(3), true);

  gates[3].resolve();
  await within(Promise.all(tasks), "scale-down tasks");
  assert.deepEqual(completed.sort(), [0, 1, 2, 3]);
  assert.equal(controller.getMetrics().active, 0);
  console.log("PASS scale-down without cancellation or over-admission");
}

async function testScaleUp(Controller: ControllerConstructor): Promise<void> {
  const controller = new Controller(4, 1);
  const gates = Array.from({ length: 4 }, deferred);
  let running = 0;
  let maxRunning = 0;
  const tasks = gates.map((gate) => controller.run(async () => {
    running++;
    maxRunning = Math.max(maxRunning, running);
    await gate.promise;
    running--;
  }));

  await flush();
  assert.equal(controller.getMetrics().active, 1);
  assert.equal(controller.getMetrics().waiting, 3);
  controller.setLimit(4);
  assert.equal(controller.getMetrics().active, 4);
  assert.equal(controller.getMetrics().waiting, 0);
  await flush();
  assert.equal(running, 4);

  gates.forEach((gate) => gate.resolve());
  await within(Promise.all(tasks), "scale-up tasks");
  assert.equal(maxRunning, 4);
  assert.equal(controller.getMetrics().active, 0);
  console.log("PASS synchronous scale-up wakeups");
}

async function testRapidChanges(Controller: ControllerConstructor): Promise<void> {
  const controller = new Controller(6, 1);
  const gates = Array.from({ length: 12 }, deferred);
  let running = 0;
  let maxRunning = 0;
  const tasks = gates.map((gate) => controller.run(async () => {
    running++;
    maxRunning = Math.max(maxRunning, running);
    await gate.promise;
    running--;
  }));

  controller.setLimit(5);
  assert.equal(controller.getMetrics().active, 5);
  controller.setLimit(2);
  assert.equal(controller.getMetrics().active, 5);
  controller.setLimit(6);
  assert.equal(controller.getMetrics().active, 6);
  controller.setLimit(1);
  assert.equal(controller.getMetrics().active, 6);

  for (let index = 0; index < gates.length; index++) {
    gates[index].resolve();
    if (index === 4) controller.setLimit(4);
    if (index === 7) controller.setLimit(2);
    if (index === 9) controller.setLimit(6);
    await flush();
    assert.ok(controller.getMetrics().active >= 0);
    assert.ok(controller.getMetrics().waiting >= 0);
  }

  await within(Promise.all(tasks), "rapid-change tasks");
  assert.ok(maxRunning <= 6);
  assert.equal(running, 0);
  assert.equal(controller.getMetrics().active, 0);
  assert.equal(controller.getMetrics().waiting, 0);
  console.log("PASS rapid limit changes without lost wakeups or negative counts");
}

async function testEmptyAndErrorRelease(Controller: ControllerConstructor): Promise<void> {
  const controller = new Controller(2, 1);
  assert.equal(await controller.run(() => "done"), "done");
  assert.equal(controller.getMetrics().active, 0);

  await assert.rejects(controller.run(() => {
    throw new Error("sync failure");
  }), /sync failure/);
  assert.equal(controller.getMetrics().active, 0);

  await assert.rejects(controller.run(async () => {
    await Promise.resolve();
    throw new Error("async failure");
  }), /async failure/);
  assert.equal(controller.getMetrics().active, 0);
  assert.equal(controller.getMetrics().waiting, 0);

  const release = await controller.acquire();
  release();
  release();
  assert.equal(controller.getMetrics().active, 0);
  console.log("PASS empty, synchronous-error, async-error, and double-release paths");
}

async function testWorkerPoolPattern(Controller: ControllerConstructor): Promise<void> {
  const controller = new Controller(5, 1);
  const pending = [0, 1, 2, 3, 4];
  const gates = pending.map(() => deferred());
  const claimed: number[] = [];
  let active = 0;
  let maxActive = 0;

  // Mirror the production worker boundary: admission precedes async candidate
  // lookup, and every empty/claimed path releases in finally.
  const worker = async () => {
    while (true) {
      const release = await controller.acquire();
      try {
        await flush();
        const item = pending.shift();
        if (item === undefined) break;
        claimed.push(item);
        active++;
        maxActive = Math.max(maxActive, active);
        await gates[item].promise;
        active--;
      } finally {
        release();
      }
    }
  };

  const workers = Array.from({ length: 5 }, () => worker());
  await flush();
  await flush();
  assert.equal(claimed.length, 1);
  controller.setLimit(3);
  await flush();
  await flush();
  assert.equal(claimed.length, 3);
  gates.forEach((gate) => gate.resolve());
  await within(Promise.all(workers), "worker-pool empty drain");

  assert.deepEqual(claimed.sort(), [0, 1, 2, 3, 4]);
  assert.equal(maxActive, 3);
  assert.equal(controller.getMetrics().active, 0);
  assert.equal(controller.getMetrics().waiting, 0);
  console.log("PASS worker-pool scale-up, claim coverage, and empty-queue drain");
}

async function main(): Promise<void> {
  process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:65432/test";
  const {
    DynamicAdmissionController,
    resolveMultiplierPerformanceSettings,
  } = await import("../src/lib/services/multiplier-performance");

  testProfiles(resolveMultiplierPerformanceSettings);
  await testSynchronousReservation(DynamicAdmissionController);
  await testMaxActive(DynamicAdmissionController);
  await testScaleDown(DynamicAdmissionController);
  await testScaleUp(DynamicAdmissionController);
  await testRapidChanges(DynamicAdmissionController);
  await testEmptyAndErrorRelease(DynamicAdmissionController);
  await testWorkerPoolPattern(DynamicAdmissionController);
  console.log("All multiplier performance tests passed");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Multiplier performance tests failed:", error);
    process.exit(1);
  });
