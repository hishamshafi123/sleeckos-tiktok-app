import assert from "node:assert/strict";
import {
  DriveRequestPacer,
  type DriveRateLimit,
  type DriveRequestPacerClock,
} from "../src/lib/services/drive-request-pacer";

interface FakeTimer {
  at: number;
  callback: () => void;
}

interface RequestStart {
  lane: string;
  at: number;
}

class FakeClock implements DriveRequestPacerClock {
  private time = 0;
  private nextTimerId = 1;
  private readonly timers = new Map<number, FakeTimer>();

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, delayMs: number): unknown {
    assert.ok(Number.isFinite(delayMs), "Timer delay must be finite");
    assert.ok(delayMs >= 0, "Timer delay must not be negative");
    const id = this.nextTimerId++;
    this.timers.set(id, { at: this.time + delayMs, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    assert.equal(typeof handle, "number");
    this.timers.delete(handle as number);
  }

  get pendingTimerCount(): number {
    return this.timers.size;
  }

  async flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  async advanceBy(delayMs: number): Promise<void> {
    assert.ok(Number.isFinite(delayMs) && delayMs >= 0);
    const target = this.time + delayMs;
    let callbacks = 0;

    for (;;) {
      let nextId: number | null = null;
      let nextTimer: FakeTimer | null = null;
      for (const [id, timer] of this.timers) {
        if (timer.at <= target && (!nextTimer || timer.at < nextTimer.at)) {
          nextId = id;
          nextTimer = timer;
        }
      }
      if (nextId === null || !nextTimer) break;
      assert.ok(++callbacks <= 1000, "Fake clock detected a hot timer loop");

      this.time = nextTimer.at;
      this.timers.delete(nextId);
      nextTimer.callback();
      await this.flush();
    }

    this.time = target;
    await this.flush();
  }
}

function request(
  clock: FakeClock,
  pacer: DriveRequestPacer,
  lane: string,
  starts: RequestStart[]
): Promise<void> {
  return pacer.beforeRequest().then(() => {
    starts.push({ lane, at: clock.now() });
  });
}

function startTimes(starts: RequestStart[]): number[] {
  return starts.map((start) => start.at);
}

async function testConcurrentSpacing(): Promise<void> {
  const clock = new FakeClock();
  const pacer = new DriveRequestPacer({ minIntervalMs: 90, clock });
  const starts: RequestStart[] = [];
  const pending = ["list", "create", "list-retry", "create-retry", "list-2", "create-2"]
    .map((lane) => request(clock, pacer, lane, starts));

  await clock.flush();
  assert.deepEqual(startTimes(starts), [0]);
  assert.equal(clock.pendingTimerCount, 1);

  await clock.advanceBy(450);
  await Promise.all(pending);
  assert.deepEqual(startTimes(starts), [0, 90, 180, 270, 360, 450]);
  assert.deepEqual(starts.map((start) => start.lane), [
    "list",
    "create",
    "list-retry",
    "create-retry",
    "list-2",
    "create-2",
  ]);
  assert.equal(clock.pendingTimerCount, 0);
}

async function testCooldownAcrossLanes(): Promise<void> {
  const clock = new FakeClock();
  const pacer = new DriveRequestPacer({ minIntervalMs: 90, clock });
  const starts: RequestStart[] = [];
  const first = request(clock, pacer, "lane-a", starts);
  await clock.flush();

  const queued = [
    request(clock, pacer, "lane-b", starts),
    request(clock, pacer, "lane-c", starts),
  ];
  await clock.advanceBy(25);
  pacer.noteRateLimit({ delayMs: 200 });
  queued.push(request(clock, pacer, "lane-d", starts));

  await clock.advanceBy(180);
  assert.deepEqual(startTimes(starts), [0], "No lane may enter during the cooldown");
  await clock.advanceBy(20);
  assert.deepEqual(startTimes(starts), [0, 225]);
  await clock.advanceBy(180);
  await Promise.all([first, ...queued]);
  assert.deepEqual(startTimes(starts), [0, 225, 315, 405]);
  assert.equal(clock.pendingTimerCount, 0);
}

async function testRetryAfterStyleDelay(): Promise<void> {
  const clock = new FakeClock();
  const pacer = new DriveRequestPacer({ minIntervalMs: 90, clock });
  const starts: RequestStart[] = [];
  await clock.advanceBy(100);
  pacer.noteRateLimit(250);

  const pending = [
    request(clock, pacer, "retry-list", starts),
    request(clock, pacer, "retry-create", starts),
  ];
  await clock.advanceBy(249);
  assert.deepEqual(startTimes(starts), []);
  await clock.advanceBy(1);
  assert.deepEqual(startTimes(starts), [350]);
  await clock.advanceBy(90);
  await Promise.all(pending);
  assert.deepEqual(startTimes(starts), [350, 440]);
}

async function testCooldownNeverShortens(): Promise<void> {
  const clock = new FakeClock();
  const pacer = new DriveRequestPacer({ minIntervalMs: 90, clock });
  const starts: RequestStart[] = [];
  await clock.advanceBy(50);

  pacer.noteRateLimit({ notBefore: 600 });
  pacer.noteRateLimit(100);
  pacer.noteRateLimit({ delayMs: 200 });
  pacer.noteRateLimit({ notBefore: 300 });

  const pending = [
    request(clock, pacer, "lane-a", starts),
    request(clock, pacer, "lane-b", starts),
  ];
  await clock.advanceBy(549);
  assert.deepEqual(startTimes(starts), []);
  await clock.advanceBy(1);
  assert.deepEqual(startTimes(starts), [600]);
  await clock.advanceBy(90);
  await Promise.all(pending);
  assert.deepEqual(startTimes(starts), [600, 690]);
}

async function testStaggeredReleaseAfterCooldown(): Promise<void> {
  const clock = new FakeClock();
  const pacer = new DriveRequestPacer({ minIntervalMs: 90, clock });
  const starts: RequestStart[] = [];
  pacer.noteRateLimit({ notBefore: 500 });
  const pending = ["a", "b", "c", "d"].map((lane) =>
    request(clock, pacer, lane, starts)
  );

  await clock.advanceBy(499);
  assert.deepEqual(startTimes(starts), []);
  await clock.advanceBy(1);
  assert.deepEqual(startTimes(starts), [500]);
  await clock.advanceBy(270);
  await Promise.all(pending);
  assert.deepEqual(startTimes(starts), [500, 590, 680, 770]);
  assert.equal(clock.pendingTimerCount, 0);
}

async function testInvalidDelaysAndHealthyState(): Promise<void> {
  const clock = new FakeClock();
  const pacer = new DriveRequestPacer({ minIntervalMs: 90, clock });
  const starts: RequestStart[] = [];
  await clock.advanceBy(1000);

  const invalid: DriveRateLimit[] = [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    0,
    -100,
    { delayMs: Number.NaN },
    { delayMs: Number.POSITIVE_INFINITY },
    { delayMs: -1 },
    { notBefore: Number.NaN },
    { notBefore: Number.POSITIVE_INFINITY },
    { notBefore: -1 },
  ];
  for (const rateLimit of invalid) pacer.noteRateLimit(rateLimit);
  pacer.noteRateLimit({ notBefore: 999 });
  assert.equal(clock.pendingTimerCount, 0);

  const pending = [
    request(clock, pacer, "valid-a", starts),
    request(clock, pacer, "valid-b", starts),
  ];
  await clock.flush();
  assert.deepEqual(startTimes(starts), [1000]);
  await clock.advanceBy(90);
  await Promise.all(pending);
  assert.deepEqual(startTimes(starts), [1000, 1090]);
  assert.equal(clock.pendingTimerCount, 0);

  for (const invalidInterval of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => new DriveRequestPacer({ minIntervalMs: invalidInterval, clock }),
      RangeError
    );
  }
}

async function main(): Promise<void> {
  const tests: Array<[string, () => Promise<void>]> = [
    ["concurrent request-start spacing", testConcurrentSpacing],
    ["cooldown extension across lanes", testCooldownAcrossLanes],
    ["Retry-After-style delay", testRetryAfterStyleDelay],
    ["non-shortening cooldown", testCooldownNeverShortens],
    ["staggered release after cooldown", testStaggeredReleaseAfterCooldown],
    ["invalid delays and non-negative state", testInvalidDelaysAndHealthyState],
  ];

  for (const [name, test] of tests) {
    await test();
    console.log(`PASS ${name}`);
  }
  console.log(`All ${tests.length} Drive request pacer tests passed`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
