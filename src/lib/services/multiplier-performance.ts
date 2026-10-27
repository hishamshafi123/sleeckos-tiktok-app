import prisma from "@/lib/db";

export const MULTIPLIER_PERFORMANCE_SETTING_KEY = "multiplier.performanceMode";

export type MultiplierPerformanceMode = "balanced" | "render_boost" | "export_boost";
export type MultiplierPerformanceLimits = { render: number; export: number };

export const MULTIPLIER_PERFORMANCE_PROFILES: Record<
  MultiplierPerformanceMode,
  MultiplierPerformanceLimits
> = {
  balanced: { render: 4, export: 8 },
  render_boost: { render: 5, export: 2 },
  export_boost: { render: 1, export: 12 },
};

export function isMultiplierPerformanceMode(value: unknown): value is MultiplierPerformanceMode {
  return value === "balanced" || value === "render_boost" || value === "export_boost";
}

export function getEnvironmentPerformanceLimits(
  env: Record<string, string | undefined> = process.env
): MultiplierPerformanceLimits {
  const render = Number.parseInt(env.RENDER_CONCURRENCY || "4", 10);
  const requestedExport = Number.parseInt(env.EXPORT_WORKER_CONCURRENCY || "8", 10);
  return {
    render: Math.min(16, Math.max(1, render || 4)),
    export: Math.min(16, Math.max(1, Number.isNaN(requestedExport) ? 8 : requestedExport)),
  };
}

export function resolveMultiplierPerformanceSettings(
  storedValue: string | null | undefined,
  env: Record<string, string | undefined> = process.env
): { mode: MultiplierPerformanceMode; limits: MultiplierPerformanceLimits } {
  if (storedValue == null) {
    return { mode: "balanced", limits: getEnvironmentPerformanceLimits(env) };
  }
  const mode = isMultiplierPerformanceMode(storedValue) ? storedValue : "balanced";
  return { mode, limits: { ...MULTIPLIER_PERFORMANCE_PROFILES[mode] } };
}

export type AdmissionRelease = () => void;
export type AdmissionMetrics = {
  limit: number;
  poolLimit: number;
  active: number;
  waiting: number;
};

type AdmissionWaiter = { resolve: (release: AdmissionRelease) => void };

function normalizeLimit(value: number, poolLimit: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(poolLimit, Math.max(1, Math.floor(value)));
}

export class DynamicAdmissionController {
  readonly poolLimit: number;
  private limitValue: number;
  private activeCount = 0;
  private waiters: AdmissionWaiter[] = [];

  constructor(poolLimit: number, initialLimit: number) {
    if (!Number.isFinite(poolLimit) || poolLimit < 1) {
      throw new Error("Admission pool limit must be at least 1");
    }
    this.poolLimit = Math.floor(poolLimit);
    this.limitValue = normalizeLimit(initialLimit, this.poolLimit);
  }

  acquire(): Promise<AdmissionRelease> {
    if (this.activeCount < this.limitValue) {
      this.activeCount++;
      return Promise.resolve(this.createRelease());
    }
    return new Promise((resolve) => {
      this.waiters.push({ resolve });
    });
  }

  async run<T>(work: () => T | Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await work();
    } finally {
      release();
    }
  }

  setLimit(limit: number): void {
    this.limitValue = normalizeLimit(limit, this.poolLimit);
    this.admitWaiters();
  }

  getMetrics(): AdmissionMetrics {
    return {
      limit: this.limitValue,
      poolLimit: this.poolLimit,
      active: this.activeCount,
      waiting: this.waiters.length,
    };
  }

  private createRelease(): AdmissionRelease {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeCount--;
      this.admitWaiters();
    };
  }

  private admitWaiters(): void {
    while (this.activeCount < this.limitValue && this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      this.activeCount++;
      waiter.resolve(this.createRelease());
    }
  }
}

const environmentSettings = resolveMultiplierPerformanceSettings(null);
const profileLimits = Object.values(MULTIPLIER_PERFORMANCE_PROFILES);

export const RENDER_ADMISSION_POOL_LIMIT = Math.max(
  environmentSettings.limits.render,
  ...profileLimits.map((limits) => limits.render)
);
export const EXPORT_ADMISSION_POOL_LIMIT = Math.max(
  environmentSettings.limits.export,
  ...profileLimits.map((limits) => limits.export)
);

export const renderAdmissionController = new DynamicAdmissionController(
  RENDER_ADMISSION_POOL_LIMIT,
  environmentSettings.limits.render
);
export const exportAdmissionController = new DynamicAdmissionController(
  EXPORT_ADMISSION_POOL_LIMIT,
  environmentSettings.limits.export
);

export type MultiplierPerformanceState = {
  mode: MultiplierPerformanceMode;
  limits: MultiplierPerformanceLimits;
  active: MultiplierPerformanceLimits;
  waiting: MultiplierPerformanceLimits;
  poolLimits: MultiplierPerformanceLimits;
};

let currentSettings = environmentSettings;
let settingsLoaded = false;
let settingsLoad: Promise<void> | null = null;
let settingsRevision = 0;

function applyStoredSettings(storedValue: string | null | undefined): void {
  currentSettings = storedValue == null
    ? environmentSettings
    : resolveMultiplierPerformanceSettings(storedValue);
  renderAdmissionController.setLimit(currentSettings.limits.render);
  exportAdmissionController.setLimit(currentSettings.limits.export);
}

function getPerformanceSnapshot(): MultiplierPerformanceState {
  const render = renderAdmissionController.getMetrics();
  const exportMetrics = exportAdmissionController.getMetrics();
  return {
    mode: currentSettings.mode,
    limits: { ...currentSettings.limits },
    active: { render: render.active, export: exportMetrics.active },
    waiting: { render: render.waiting, export: exportMetrics.waiting },
    poolLimits: { render: render.poolLimit, export: exportMetrics.poolLimit },
  };
}

async function readStoredSettings(): Promise<void> {
  const revision = settingsRevision;
  const setting = await prisma.appSetting.findUnique({
    where: { key: MULTIPLIER_PERFORMANCE_SETTING_KEY },
  });
  if (revision !== settingsRevision) return;
  applyStoredSettings(setting?.value ?? null);
  settingsLoaded = true;
}

function loadSettings(force: boolean): Promise<void> {
  if (settingsLoaded && !force) return Promise.resolve();
  if (!settingsLoad) {
    settingsLoad = readStoredSettings().finally(() => {
      settingsLoad = null;
    });
  }
  return settingsLoad;
}

export async function getMultiplierPerformanceState(): Promise<MultiplierPerformanceState> {
  await loadSettings(false);
  return getPerformanceSnapshot();
}

export async function refreshMultiplierPerformance(): Promise<MultiplierPerformanceState> {
  await loadSettings(true);
  return getPerformanceSnapshot();
}

export async function setMultiplierPerformanceMode(
  mode: MultiplierPerformanceMode
): Promise<MultiplierPerformanceState> {
  if (!isMultiplierPerformanceMode(mode)) {
    throw new Error("Invalid multiplier performance mode");
  }
  await prisma.appSetting.upsert({
    where: { key: MULTIPLIER_PERFORMANCE_SETTING_KEY },
    update: { value: mode },
    create: { key: MULTIPLIER_PERFORMANCE_SETTING_KEY, value: mode },
  });
  settingsRevision++;
  applyStoredSettings(mode);
  settingsLoaded = true;
  return getPerformanceSnapshot();
}
