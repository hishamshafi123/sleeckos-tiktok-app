import { createHash } from "crypto";
import { fromZonedTime } from "date-fns-tz";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/db";
import { notifyAdmin } from "@/lib/services/notifications";
import { getOrgTimezone, getZonedDateString } from "@/lib/services/timezone";

const ENFORCEMENT_KEY = "guardian.enforcementEnabled";
const RULES_KEY = "guardian.rules";
const INTERVAL_KEY = "guardian.checkIntervalSeconds";
const INVENTORY_WATERMARK_KEY = "guardian.inventoryWatermark";
const DEFAULT_INTERVAL_SECONDS = 60;
const MAX_ITEMS = 5000;
const MAX_PAGE_SIZE = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const INT_MAX = 2_147_483_647;
const CYCLE_STATUSES = new Set(["success", "partial", "error"]);
const DECISIONS = new Set(["keep", "stop", "skip", "disabled"]);
const STOP_RESULTS = new Set(["stopped", "failed", "unknown"]);
const REQUIRED_TAGS = ["political", "general", "state"] as const;
const RANGES = new Set(["24h", "7d", "30d"]);

export type GuardianRange = "24h" | "7d" | "30d";

export interface GuardianRuntimeRule {
  max_runtime_minutes: number;
  description: string;
}

export interface GuardianRules {
  by_tag: Record<string, GuardianRuntimeRule>;
  default: GuardianRuntimeRule;
}

export interface GuardianSettings {
  enforcementEnabled: boolean;
  checkIntervalSeconds: number;
  rules: GuardianRules;
}

export interface GuardianConfig extends GuardianSettings {
  configVersion: string;
}

export class GuardianValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardianValidationError";
  }
}

function defaultRules(): GuardianRules {
  return {
    by_tag: {
      political: { max_runtime_minutes: 10, description: "Political accounts" },
      general: { max_runtime_minutes: 10, description: "General accounts" },
      state: { max_runtime_minutes: 35, description: "State accounts" },
    },
    default: { max_runtime_minutes: 10, description: "Fallback" },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseRuntimeRule(value: unknown, path: string): GuardianRuntimeRule {
  if (!isRecord(value)) throw new GuardianValidationError(`${path} must be an object.`);
  const limit = value.max_runtime_minutes;
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0 || limit > 1_000_000) {
    throw new GuardianValidationError(`${path}.max_runtime_minutes must be a finite positive number.`);
  }
  const description = value.description ?? "";
  if (typeof description !== "string" || description.length > 500) {
    throw new GuardianValidationError(`${path}.description must be a string of at most 500 characters.`);
  }
  return { max_runtime_minutes: limit, description };
}

function parseRules(value: unknown): GuardianRules {
  if (!isRecord(value) || !isRecord(value.by_tag)) {
    throw new GuardianValidationError("rules.by_tag must be an object.");
  }
  const entries = Object.entries(value.by_tag);
  if (entries.length > 100) {
    throw new GuardianValidationError("rules.by_tag cannot contain more than 100 tags.");
  }

  const normalized = new Map<string, GuardianRuntimeRule>();
  for (const [rawTag, rule] of entries) {
    const tag = rawTag.trim().toLowerCase();
    if (
      !tag ||
      tag.length > 64 ||
      /[\u0000-\u001f\u007f]/.test(tag) ||
      tag === "__proto__" ||
      tag === "prototype" ||
      tag === "constructor"
    ) {
      throw new GuardianValidationError("rules.by_tag contains an invalid tag.");
    }
    if (normalized.has(tag)) {
      throw new GuardianValidationError(`rules.by_tag contains duplicate tag '${tag}'.`);
    }
    normalized.set(tag, parseRuntimeRule(rule, `rules.by_tag.${tag}`));
  }
  for (const tag of REQUIRED_TAGS) {
    if (!normalized.has(tag)) {
      throw new GuardianValidationError(`rules.by_tag.${tag} is required.`);
    }
  }

  return {
    by_tag: Object.fromEntries([...normalized.entries()].sort(([a], [b]) => a.localeCompare(b))),
    default: parseRuntimeRule(value.default, "rules.default"),
  };
}

function parseSettings(value: unknown): GuardianSettings {
  if (!isRecord(value)) throw new GuardianValidationError("Settings body must be an object.");
  if (typeof value.enforcementEnabled !== "boolean") {
    throw new GuardianValidationError("enforcementEnabled must be a boolean.");
  }
  if (
    typeof value.checkIntervalSeconds !== "number" ||
    !Number.isFinite(value.checkIntervalSeconds) ||
    value.checkIntervalSeconds < 15 ||
    value.checkIntervalSeconds > 3600
  ) {
    throw new GuardianValidationError("checkIntervalSeconds must be between 15 and 3600.");
  }
  return {
    enforcementEnabled: value.enforcementEnabled,
    checkIntervalSeconds: value.checkIntervalSeconds,
    rules: parseRules(value.rules),
  };
}

function withConfigVersion(settings: GuardianSettings): GuardianConfig {
  const canonical = JSON.stringify({
    enforcementEnabled: settings.enforcementEnabled,
    checkIntervalSeconds: settings.checkIntervalSeconds,
    rules: {
      ...settings.rules,
      by_tag: Object.fromEntries(
        Object.entries(settings.rules.by_tag).sort(([a], [b]) => a.localeCompare(b))
      ),
    },
  });
  return {
    ...settings,
    configVersion: createHash("sha256").update(canonical).digest("hex").slice(0, 16),
  };
}

async function readSettings(): Promise<GuardianSettings> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: [ENFORCEMENT_KEY, RULES_KEY, INTERVAL_KEY] } },
  });
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const storedInterval = Number(values.get(INTERVAL_KEY));
  let rules = defaultRules();
  const storedRules = values.get(RULES_KEY);
  if (storedRules) {
    try {
      rules = parseRules(JSON.parse(storedRules));
    } catch {
      rules = defaultRules();
    }
  }
  return {
    enforcementEnabled: values.get(ENFORCEMENT_KEY) === "true",
    checkIntervalSeconds:
      Number.isFinite(storedInterval) && storedInterval >= 15 && storedInterval <= 3600
        ? storedInterval
        : DEFAULT_INTERVAL_SECONDS,
    rules,
  };
}

export async function getGuardianConfig(): Promise<GuardianConfig> {
  return withConfigVersion(await readSettings());
}

export async function saveGuardianSettings(value: unknown): Promise<GuardianConfig> {
  const settings = parseSettings(value);
  const serializedRules = JSON.stringify(settings.rules);
  await prisma.$transaction([
    prisma.appSetting.upsert({
      where: { key: ENFORCEMENT_KEY },
      update: { value: String(settings.enforcementEnabled) },
      create: { key: ENFORCEMENT_KEY, value: String(settings.enforcementEnabled) },
    }),
    prisma.appSetting.upsert({
      where: { key: RULES_KEY },
      update: { value: serializedRules },
      create: { key: RULES_KEY, value: serializedRules },
    }),
    prisma.appSetting.upsert({
      where: { key: INTERVAL_KEY },
      update: { value: String(settings.checkIntervalSeconds) },
      create: { key: INTERVAL_KEY, value: String(settings.checkIntervalSeconds) },
    }),
  ]);
  return withConfigVersion(settings);
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new GuardianValidationError(`${field} must be a string.`);
  const result = value.trim();
  if (!result || result.length > maxLength) {
    throw new GuardianValidationError(`${field} must contain 1 to ${maxLength} characters.`);
  }
  return result;
}

function nullableString(value: unknown, field: string, maxLength: number): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new GuardianValidationError(`${field} must be null or a string of at most ${maxLength} characters.`);
  }
  return value;
}

function optionalString(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined) return null;
  return nullableString(value, field, maxLength);
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new GuardianValidationError(`${field} must be a boolean.`);
  return value;
}

function counter(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
    throw new GuardianValidationError(`${field} must be a non-negative integer.`);
  }
  return value;
}

function nullableSeconds(value: unknown, field: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > INT_MAX) {
    throw new GuardianValidationError(`${field} must be null or a finite non-negative number.`);
  }
  const rounded = Math.round(value);
  if (rounded > INT_MAX) throw new GuardianValidationError(`${field} is too large.`);
  return rounded;
}

function nullableStatus(value: unknown, field: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < -1_000_000 || value > 1_000_000) {
    throw new GuardianValidationError(`${field} must be null or an integer.`);
  }
  return value;
}

function nullableLimit(value: unknown, field: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1_000_000) {
    throw new GuardianValidationError(`${field} must be null or a finite positive number.`);
  }
  return value;
}

function tags(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 50) {
    throw new GuardianValidationError(`${field} must be an array with at most 50 tags.`);
  }
  return value.map((tag, index) => requiredString(tag, `${field}[${index}]`, 100));
}

function timestamp(value: unknown, field: string): Date {
  const raw = requiredString(value, field, 64);
  const date = new Date(raw);
  const min = Date.parse("2000-01-01T00:00:00.000Z");
  const max = Date.parse("2100-01-01T00:00:00.000Z");
  if (!Number.isFinite(date.getTime()) || date.getTime() < min || date.getTime() > max) {
    throw new GuardianValidationError(`${field} must be a valid timestamp between 2000 and 2100.`);
  }
  return date;
}

interface GuardianProfileInput {
  profileId: string;
  name: string;
  tags: string[];
  status: number | null;
  runningTimeSecs: number | null;
  matchedTag: string | null;
  limitMinutes: number | null;
  decision: string;
}

interface GuardianStopInput {
  profileId: string;
  name: string;
  tags: string[];
  matchedTag: string | null;
  runtimeSecs: number | null;
  limitMinutes: number | null;
  result: string;
  error: string | null;
  occurredAt: Date;
}

interface GuardianCycleInput {
  cycleId: string;
  startedAt: Date;
  finishedAt: Date;
  status: string;
  inventoryComplete: boolean;
  runningCount: number;
  stopRequested: number;
  stopSucceeded: number;
  stopFailed: number;
  stopUnknown: number;
  error: string | null;
  profiles: GuardianProfileInput[];
  stops: GuardianStopInput[];
}

function parseCycleReport(value: unknown): GuardianCycleInput {
  if (!isRecord(value)) throw new GuardianValidationError("Cycle report must be an object.");
  if (!Array.isArray(value.profiles) || value.profiles.length > MAX_ITEMS) {
    throw new GuardianValidationError(`profiles must be an array with at most ${MAX_ITEMS} rows.`);
  }
  if (!Array.isArray(value.stops) || value.stops.length > MAX_ITEMS) {
    throw new GuardianValidationError(`stops must be an array with at most ${MAX_ITEMS} rows.`);
  }
  if (typeof value.status !== "string" || !CYCLE_STATUSES.has(value.status)) {
    throw new GuardianValidationError("status must be success, partial, or error.");
  }

  const startedAt = timestamp(value.startedAt, "startedAt");
  const finishedAt = timestamp(value.finishedAt, "finishedAt");
  if (finishedAt < startedAt || finishedAt.getTime() - startedAt.getTime() > 7 * DAY_MS) {
    throw new GuardianValidationError("finishedAt must be after startedAt and within a seven-day cycle.");
  }

  const profiles = value.profiles.map((raw, index): GuardianProfileInput => {
    if (!isRecord(raw)) throw new GuardianValidationError(`profiles[${index}] must be an object.`);
    if (typeof raw.decision !== "string" || !DECISIONS.has(raw.decision)) {
      throw new GuardianValidationError(`profiles[${index}].decision is invalid.`);
    }
    return {
      profileId: requiredString(raw.profileId, `profiles[${index}].profileId`, 200),
      name: requiredString(raw.name, `profiles[${index}].name`, 300),
      tags: tags(raw.tags, `profiles[${index}].tags`),
      status: nullableStatus(raw.status, `profiles[${index}].status`),
      runningTimeSecs: nullableSeconds(raw.runningTimeSecs, `profiles[${index}].runningTimeSecs`),
      matchedTag: nullableString(raw.matchedTag, `profiles[${index}].matchedTag`, 100),
      limitMinutes: nullableLimit(raw.limitMinutes, `profiles[${index}].limitMinutes`),
      decision: raw.decision,
    };
  });
  const stops = value.stops.map((raw, index): GuardianStopInput => {
    if (!isRecord(raw)) throw new GuardianValidationError(`stops[${index}] must be an object.`);
    if (typeof raw.result !== "string" || !STOP_RESULTS.has(raw.result)) {
      throw new GuardianValidationError(`stops[${index}].result is invalid.`);
    }
    return {
      profileId: requiredString(raw.profileId, `stops[${index}].profileId`, 200),
      name: requiredString(raw.name, `stops[${index}].name`, 300),
      tags: tags(raw.tags, `stops[${index}].tags`),
      matchedTag: nullableString(raw.matchedTag, `stops[${index}].matchedTag`, 100),
      runtimeSecs: nullableSeconds(raw.runtimeSecs, `stops[${index}].runtimeSecs`),
      limitMinutes: nullableLimit(raw.limitMinutes, `stops[${index}].limitMinutes`),
      result: raw.result,
      error: optionalString(raw.error, `stops[${index}].error`, 4000),
      occurredAt:
        raw.occurredAt === undefined
          ? finishedAt
          : timestamp(raw.occurredAt, `stops[${index}].occurredAt`),
    };
  });

  if (new Set(profiles.map((profile) => profile.profileId)).size !== profiles.length) {
    throw new GuardianValidationError("profiles cannot contain duplicate profileId values.");
  }
  if (new Set(stops.map((stop) => stop.profileId)).size !== stops.length) {
    throw new GuardianValidationError("stops cannot contain duplicate profileId values.");
  }

  return {
    cycleId: requiredString(value.cycleId, "cycleId", 200),
    startedAt,
    finishedAt,
    status: value.status,
    inventoryComplete: requiredBoolean(value.inventoryComplete, "inventoryComplete"),
    runningCount: counter(value.runningCount, "runningCount"),
    stopRequested: counter(value.stopRequested, "stopRequested"),
    stopSucceeded: counter(value.stopSucceeded, "stopSucceeded"),
    stopFailed: counter(value.stopFailed, "stopFailed"),
    stopUnknown: counter(value.stopUnknown, "stopUnknown"),
    error: optionalString(value.error, "error", 4000),
    profiles,
    stops,
  };
}

export async function ingestGuardianCycle(value: unknown): Promise<{ ok: true; duplicate: boolean }> {
  const report = parseCycleReport(value);
  let ingested = false;

  try {
    await prisma.$transaction(
      async (tx) => {
        const existingCycle = await tx.guardianCycle.findUnique({
          where: { id: report.cycleId },
          select: { id: true },
        });
        if (existingCycle) return;
        const existingEvent = await tx.guardianStopEvent.findFirst({
          where: { sourceCycleId: report.cycleId },
          select: { id: true },
        });
        if (existingEvent) return;

        await tx.guardianCycle.create({
          data: {
            id: report.cycleId,
            startedAt: report.startedAt,
            finishedAt: report.finishedAt,
            status: report.status,
            inventoryComplete: report.inventoryComplete,
            runningCount: report.runningCount,
            stopRequested: report.stopRequested,
            stopSucceeded: report.stopSucceeded,
            stopFailed: report.stopFailed,
            stopUnknown: report.stopUnknown,
            error: report.error,
          },
        });
        ingested = true;

        if (report.stops.length > 0) {
          await tx.guardianStopEvent.createMany({
            data: report.stops.map((stop) => ({
              cycleId: report.cycleId,
              sourceCycleId: report.cycleId,
              profileId: stop.profileId,
              profileName: stop.name,
              tags: stop.tags,
              matchedTag: stop.matchedTag,
              runtimeSecs: stop.runtimeSecs,
              limitMinutes: stop.limitMinutes,
              result: stop.result,
              error: stop.error,
              occurredAt: stop.occurredAt,
            })),
          });
        }

        if (!report.inventoryComplete) return;

        const marker = `${report.finishedAt.toISOString()}|${report.cycleId}`;
        await tx.appSetting.createMany({
          data: [{ key: INVENTORY_WATERMARK_KEY, value: "" }],
          skipDuplicates: true,
        });
        const claim = await tx.appSetting.updateMany({
          where: { key: INVENTORY_WATERMARK_KEY, value: { lt: marker } },
          data: { value: marker },
        });
        if (claim.count === 0) return;

        const snapshots = report.profiles.map((profile) => ({
          profileId: profile.profileId,
          snapshot: {
            name: profile.name,
            tags: profile.tags,
            matchedTag: profile.matchedTag,
            isRunning: true,
            status: profile.status,
            runningTimeSecs: profile.runningTimeSecs,
            limitMinutes: profile.limitMinutes,
            lastDecision: profile.decision,
            lastSeenAt: report.finishedAt,
          },
        }));
        if (snapshots.length > 0) {
          await tx.guardianPhone.createMany({
            data: snapshots.map(({ profileId, snapshot }) => ({ profileId, ...snapshot })),
            skipDuplicates: true,
          });
          for (const { profileId, snapshot } of snapshots) {
            await tx.guardianPhone.updateMany({
              where: {
                profileId,
                lastSeenAt: { lte: report.finishedAt },
                OR: [
                  { lastStoppedAt: null },
                  { lastStoppedAt: { lte: report.finishedAt } },
                ],
              },
              data: snapshot,
            });
          }
        }

        const stoppedIds = report.stops
          .filter((stop) => stop.result === "stopped")
          .map((stop) => stop.profileId);
        if (stoppedIds.length > 0) {
          await tx.guardianPhone.updateMany({
            where: {
              profileId: { in: stoppedIds },
              lastSeenAt: { lte: report.finishedAt },
              OR: [
                { lastStoppedAt: null },
                { lastStoppedAt: { lte: report.finishedAt } },
              ],
            },
            data: { isRunning: false, status: 2, lastStoppedAt: report.finishedAt },
          });
        }

        const profileIds = snapshots.map(({ profileId }) => profileId);
        await tx.guardianPhone.updateMany({
          where: {
            isRunning: true,
            lastSeenAt: { lte: report.finishedAt },
            OR: [
              { lastStoppedAt: null },
              { lastStoppedAt: { lte: report.finishedAt } },
            ],
            ...(profileIds.length > 0 ? { profileId: { notIn: profileIds } } : {}),
          },
          data: { isRunning: false, lastSeenAt: report.finishedAt },
        });
      },
      { maxWait: 10_000, timeout: 120_000 }
    );
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") {
      const existingCycle = await prisma.guardianCycle.findUnique({
        where: { id: report.cycleId },
        select: { id: true },
      });
      if (existingCycle) return { ok: true, duplicate: true };
      const existingEvent = await prisma.guardianStopEvent.findFirst({
        where: { sourceCycleId: report.cycleId },
        select: { id: true },
      });
      if (existingEvent) return { ok: true, duplicate: true };
    }
    throw error;
  }

  if (!ingested) return { ok: true, duplicate: true };

  for (const stop of report.stops) {
    if (stop.result === "stopped") continue;
    await notifyAdmin({
      level: stop.result === "failed" ? "error" : "warning",
      title: `Phone Guardian stop ${stop.result}: ${stop.name}`,
      body: `Profile ${stop.name} (${stop.profileId}) reported stop ${stop.result} in cycle ${report.cycleId}.${stop.error ? ` ${stop.error}` : ""}`,
      source: "multilogin_guardian",
    });
  }

  return { ok: true, duplicate: false };
}

function range(value: string | null | undefined): GuardianRange {
  const result = value || "24h";
  if (!RANGES.has(result)) throw new GuardianValidationError("range must be 24h, 7d, or 30d.");
  return result as GuardianRange;
}

function rangeStart(value: GuardianRange, now: Date): Date {
  const hours = value === "24h" ? 24 : value === "7d" ? 7 * 24 : 30 * 24;
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

function pageLimit(value: string | null | undefined): number {
  if (!value) return 50;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new GuardianValidationError("limit must be a positive integer.");
  }
  return Math.min(parsed, MAX_PAGE_SIZE);
}

interface PageCursor {
  date: Date;
  id: string;
}

function encodeCursor(date: Date, id: string): string {
  return Buffer.from(JSON.stringify({ d: date.toISOString(), id })).toString("base64url");
}

function decodeCursor(value: string | null | undefined): PageCursor | null {
  if (!value) return null;
  if (value.length > 2048) throw new GuardianValidationError("cursor is invalid.");
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!isRecord(parsed) || typeof parsed.d !== "string" || typeof parsed.id !== "string") {
      throw new Error("invalid");
    }
    const date = new Date(parsed.d);
    if (!Number.isFinite(date.getTime()) || !parsed.id || parsed.id.length > 200) {
      throw new Error("invalid");
    }
    return { date, id: parsed.id };
  } catch {
    throw new GuardianValidationError("cursor is invalid.");
  }
}

interface PhonePageCursor extends PageCursor {
  isRunning: boolean;
}

function encodePhoneCursor(phone: {
  isRunning: boolean;
  lastSeenAt: Date;
  profileId: string;
}): string {
  return Buffer.from(
    JSON.stringify({ d: phone.lastSeenAt.toISOString(), id: phone.profileId, r: phone.isRunning })
  ).toString("base64url");
}

function decodePhoneCursor(value: string | null | undefined): PhonePageCursor | null {
  if (!value) return null;
  if (value.length > 2048) throw new GuardianValidationError("cursor is invalid.");
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      !isRecord(parsed) ||
      typeof parsed.d !== "string" ||
      typeof parsed.id !== "string" ||
      typeof parsed.r !== "boolean"
    ) {
      throw new Error("invalid");
    }
    const date = new Date(parsed.d);
    if (!Number.isFinite(date.getTime()) || !parsed.id || parsed.id.length > 200) {
      throw new Error("invalid");
    }
    return { date, id: parsed.id, isRunning: parsed.r };
  } catch {
    throw new GuardianValidationError("cursor is invalid.");
  }
}

function serializeCycle(cycle: {
  id: string;
  startedAt: Date;
  finishedAt: Date;
  status: string;
  inventoryComplete: boolean;
  runningCount: number;
  stopRequested: number;
  stopSucceeded: number;
  stopFailed: number;
  stopUnknown: number;
  error: string | null;
  createdAt: Date;
}) {
  return {
    ...cycle,
    startedAt: cycle.startedAt.toISOString(),
    finishedAt: cycle.finishedAt.toISOString(),
    createdAt: cycle.createdAt.toISOString(),
  };
}

function serializePhone<T extends {
  lastSeenAt: Date;
  lastStoppedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>(phone: T) {
  return {
    ...phone,
    lastSeenAt: phone.lastSeenAt.toISOString(),
    lastStoppedAt: phone.lastStoppedAt?.toISOString() ?? null,
    createdAt: phone.createdAt.toISOString(),
    updatedAt: phone.updatedAt.toISOString(),
  };
}

function serializeStopEvent(event: {
  id: string;
  cycleId: string | null;
  profileId: string;
  profileName: string;
  tags: Prisma.JsonValue;
  matchedTag: string | null;
  runtimeSecs: number | null;
  limitMinutes: number | null;
  result: string;
  error: string | null;
  occurredAt: Date;
  createdAt: Date;
}) {
  return {
    id: event.id,
    cycleId: event.cycleId,
    profileId: event.profileId,
    profileName: event.profileName,
    tags: event.tags,
    matchedTag: event.matchedTag,
    runtimeSecs: event.runtimeSecs,
    limitMinutes: event.limitMinutes,
    result: event.result,
    error: event.error,
    occurredAt: event.occurredAt.toISOString(),
    createdAt: event.createdAt.toISOString(),
  };
}

function dailyDates(start: Date, end: Date, timezone: string): string[] {
  const first = getZonedDateString(start, timezone);
  const last = getZonedDateString(end, timezone);
  const dates: string[] = [];
  for (let time = Date.parse(`${first}T00:00:00Z`); ; time += DAY_MS) {
    const date = new Date(time).toISOString().slice(0, 10);
    dates.push(date);
    if (date === last) break;
    if (dates.length > 32) throw new Error("Invalid Guardian daily range.");
  }
  return dates;
}

export async function getGuardianOverview(rawRange?: string | null) {
  const selectedRange = range(rawRange);
  const now = new Date();
  const since = rangeStart(selectedRange, now);
  const [settings, timezone] = await Promise.all([readSettings(), getOrgTimezone()]);
  const todayStart = fromZonedTime(`${getZonedDateString(now, timezone)}T00:00:00`, timezone);

  const [lastSuccessfulCycle, lastCycle, runningNow, inactiveTracked, stopEvents, runningPhones] =
    await Promise.all([
      prisma.guardianCycle.findFirst({
        where: { status: "success" },
        orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
      }),
      prisma.guardianCycle.findFirst({ orderBy: [{ finishedAt: "desc" }, { id: "desc" }] }),
      prisma.guardianPhone.count({ where: { isRunning: true } }),
      prisma.guardianPhone.count({ where: { isRunning: false } }),
      prisma.guardianStopEvent.findMany({
        where: { occurredAt: { gte: since } },
        select: { result: true, occurredAt: true },
      }),
      prisma.guardianPhone.findMany({
        where: { isRunning: true },
        orderBy: [{ lastSeenAt: "desc" }, { profileId: "asc" }],
        take: 500,
      }),
    ]);

  const inactivePhones = await prisma.guardianPhone.findMany({
    where: { isRunning: false },
    orderBy: [{ lastSeenAt: "desc" }, { profileId: "asc" }],
    take: Math.max(0, 500 - runningPhones.length),
  });

  const dates = dailyDates(since, now, timezone);
  const daily = dates.map((date) => ({ date, stopped: 0, failed: 0, unknown: 0 }));
  const byDate = new Map(daily.map((day) => [day.date, day]));
  const summary = {
    runningNow,
    inactiveTracked,
    stoppedToday: 0,
    stoppedRange: 0,
    failedRange: 0,
    unknownRange: 0,
  };
  for (const event of stopEvents) {
    if (event.result !== "stopped" && event.result !== "failed" && event.result !== "unknown") continue;
    if (event.result === "stopped") {
      summary.stoppedRange++;
      if (event.occurredAt >= todayStart) summary.stoppedToday++;
    } else if (event.result === "failed") {
      summary.failedRange++;
    } else {
      summary.unknownRange++;
    }
    const day = byDate.get(getZonedDateString(event.occurredAt, timezone));
    if (day) day[event.result]++;
  }

  const heartbeatAt = lastSuccessfulCycle?.finishedAt ?? null;
  const staleAfterMs = Math.max(180_000, settings.checkIntervalSeconds * 3000);
  return {
    settings: withConfigVersion(settings),
    timezone,
    health: {
      heartbeatAt: heartbeatAt?.toISOString() ?? null,
      stale: !heartbeatAt || now.getTime() - heartbeatAt.getTime() > staleAfterMs,
      lastCycle: lastCycle ? serializeCycle(lastCycle) : null,
    },
    summary,
    daily,
    phones: [...runningPhones, ...inactivePhones].map(serializePhone),
  };
}

export async function getGuardianEvents(options: {
  range?: string | null;
  result?: string | null;
  q?: string | null;
  cursor?: string | null;
  limit?: string | null;
}) {
  const selectedRange = range(options.range);
  const limit = pageLimit(options.limit);
  const cursor = decodeCursor(options.cursor);
  const result = options.result?.trim() || null;
  if (result && !STOP_RESULTS.has(result)) {
    throw new GuardianValidationError("result must be stopped, failed, or unknown.");
  }
  const q = options.q?.trim() || null;
  if (q && q.length > 200) throw new GuardianValidationError("q must be at most 200 characters.");

  const where: Prisma.GuardianStopEventWhereInput = {
    occurredAt: { gte: rangeStart(selectedRange, new Date()) },
    ...(result ? { result } : {}),
  };
  if (q) {
    where.OR = [
      { profileId: { contains: q, mode: "insensitive" } },
      { profileName: { contains: q, mode: "insensitive" } },
      { cycleId: { contains: q, mode: "insensitive" } },
      { matchedTag: { contains: q, mode: "insensitive" } },
      { error: { contains: q, mode: "insensitive" } },
    ];
  }
  if (cursor) {
    where.AND = [
      {
        OR: [
          { occurredAt: { lt: cursor.date } },
          { occurredAt: cursor.date, id: { lt: cursor.id } },
        ],
      },
    ];
  }

  const rows = await prisma.guardianStopEvent.findMany({
    where,
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items: items.map(serializeStopEvent),
    nextCursor: rows.length > limit && last ? encodeCursor(last.occurredAt, last.id) : null,
  };
}

export async function getGuardianCycles(options: { cursor?: string | null; limit?: string | null }) {
  const limit = pageLimit(options.limit);
  const cursor = decodeCursor(options.cursor);
  const where: Prisma.GuardianCycleWhereInput = cursor
    ? {
        OR: [
          { finishedAt: { lt: cursor.date } },
          { finishedAt: cursor.date, id: { lt: cursor.id } },
        ],
      }
    : {};
  const rows = await prisma.guardianCycle.findMany({
    where,
    orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items: items.map(serializeCycle),
    nextCursor: rows.length > limit && last ? encodeCursor(last.finishedAt, last.id) : null,
  };
}

export async function getGuardianPhones(options: {
  status?: string | null;
  q?: string | null;
  cursor?: string | null;
  limit?: string | null;
}) {
  const status = options.status?.trim() || "all";
  if (status !== "running" && status !== "inactive" && status !== "all") {
    throw new GuardianValidationError("status must be running, inactive, or all.");
  }
  const limit = pageLimit(options.limit);
  const cursor = decodePhoneCursor(options.cursor);
  const q = options.q?.trim() || null;
  if (q && q.length > 200) throw new GuardianValidationError("q must be at most 200 characters.");

  const filters: Prisma.GuardianPhoneWhereInput = {
    ...(status === "running" ? { isRunning: true } : {}),
    ...(status === "inactive" ? { isRunning: false } : {}),
  };
  if (q) {
    filters.OR = [
      { profileId: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { matchedTag: { contains: q, mode: "insensitive" } },
    ];
  }

  const where: Prisma.GuardianPhoneWhereInput = { ...filters };
  if (cursor) {
    const cursorConditions: Prisma.GuardianPhoneWhereInput[] = [
      { isRunning: cursor.isRunning, lastSeenAt: { lt: cursor.date } },
      {
        isRunning: cursor.isRunning,
        lastSeenAt: cursor.date,
        profileId: { gt: cursor.id },
      },
    ];
    if (cursor.isRunning) cursorConditions.unshift({ isRunning: false });
    where.AND = [{ OR: cursorConditions }];
  }

  const [rows, total, runningNow, inactiveTracked] = await Promise.all([
    prisma.guardianPhone.findMany({
      where,
      orderBy: [{ isRunning: "desc" }, { lastSeenAt: "desc" }, { profileId: "asc" }],
      take: limit + 1,
    }),
    prisma.guardianPhone.count({ where: filters }),
    prisma.guardianPhone.count({ where: { isRunning: true } }),
    prisma.guardianPhone.count({ where: { isRunning: false } }),
  ]);
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items: items.map(serializePhone),
    nextCursor: rows.length > limit && last ? encodePhoneCursor(last) : null,
    total,
    runningNow,
    inactiveTracked,
  };
}
