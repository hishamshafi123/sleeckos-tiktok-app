export const SMART_EXPORT_DRIVE_MIN_INTERVAL_MS = 90;

export interface DriveRequestPacerClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface DriveRequestPacerOptions {
  minIntervalMs?: number;
  clock?: DriveRequestPacerClock;
}

export type DriveRateLimit =
  | number
  | { delayMs: number }
  | { notBefore: number };

const systemClock: DriveRequestPacerClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class DriveRequestPacer {
  private readonly minIntervalMs: number;
  private readonly clock: DriveRequestPacerClock;
  private readonly waiters: Array<() => void> = [];
  private timerHandle: unknown = null;
  private scheduledFor = 0;
  private nextRequestAt = 0;
  private notBefore = 0;

  constructor(options: DriveRequestPacerOptions = {}) {
    const minIntervalMs = options.minIntervalMs ?? SMART_EXPORT_DRIVE_MIN_INTERVAL_MS;
    if (!Number.isFinite(minIntervalMs) || minIntervalMs <= 0) {
      throw new RangeError("minIntervalMs must be a finite positive number");
    }
    this.minIntervalMs = minIntervalMs;
    this.clock = options.clock ?? systemClock;
  }

  beforeRequest(): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      this.scheduleNext();
    });
  }

  noteRateLimit(rateLimit: DriveRateLimit): void {
    let requestedNotBefore: number;

    if (typeof rateLimit === "number") {
      if (!Number.isFinite(rateLimit) || rateLimit <= 0) return;
      requestedNotBefore = this.clock.now() + rateLimit;
    } else if ("notBefore" in rateLimit) {
      if (!Number.isFinite(rateLimit.notBefore) || rateLimit.notBefore <= 0) return;
      requestedNotBefore = rateLimit.notBefore;
    } else {
      if (!Number.isFinite(rateLimit.delayMs) || rateLimit.delayMs <= 0) return;
      requestedNotBefore = this.clock.now() + rateLimit.delayMs;
    }

    if (!Number.isFinite(requestedNotBefore) || requestedNotBefore <= this.notBefore) {
      return;
    }

    this.notBefore = requestedNotBefore;
    if (this.timerHandle !== null && this.scheduledFor < requestedNotBefore) {
      this.clock.clearTimeout(this.timerHandle);
      this.timerHandle = null;
      this.scheduledFor = 0;
      this.scheduleNext();
    }
  }

  private scheduleNext(): void {
    if (this.timerHandle !== null || this.waiters.length === 0) return;

    const now = this.clock.now();
    const startAt = Math.max(now, this.nextRequestAt, this.notBefore);
    const delayMs = startAt - now;

    if (delayMs <= 0) {
      const resolve = this.waiters.shift()!;
      this.nextRequestAt = startAt + this.minIntervalMs;
      resolve();
      this.scheduleNext();
      return;
    }

    this.scheduledFor = startAt;
    this.timerHandle = this.clock.setTimeout(() => {
      this.timerHandle = null;
      this.scheduledFor = 0;
      this.scheduleNext();
    }, delayMs);
  }
}

export const smartExportDriveRequestPacer = new DriveRequestPacer();
