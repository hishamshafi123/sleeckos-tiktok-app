"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { fromZonedTime } from "date-fns-tz";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  HeartPulse,
  History,
  Loader2,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Smartphone,
  X,
} from "lucide-react";

type Range = "24h" | "7d" | "30d";
type ConfigVersion = string | number;
type Rule = { max_runtime_minutes: number; description: string };
type Rules = {
  by_tag: Record<string, Rule>;
  default: Rule;
};
type Settings = {
  enforcementEnabled: boolean;
  checkIntervalSeconds: number;
  rules: Rules;
  configVersion: ConfigVersion;
};
type Cycle = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  inventoryComplete: boolean;
  runningCount: number;
  stopRequested: number;
  stopSucceeded: number;
  stopFailed: number;
  stopUnknown: number;
  error: string | null;
};
type Phone = {
  profileId: string;
  name: string;
  tags: string[];
  matchedTag: string | null;
  isRunning: boolean;
  status: number | null;
  runningTimeSecs: number | null;
  limitMinutes: number | null;
  lastDecision: string | null;
  lastSeenAt: string;
  lastStoppedAt: string | null;
};
type DailyPoint = { date: string; stopped: number; failed: number; unknown: number };
type Overview = {
  timezone: string;
  settings: Settings;
  health: { heartbeatAt: string | null; stale: boolean; lastCycle: Cycle | null };
  summary: {
    runningNow: number;
    inactiveTracked: number;
    stoppedToday: number;
    stoppedRange: number;
    failedRange: number;
    unknownRange: number;
  };
  daily: DailyPoint[];
  phones: Phone[];
};
type StopEvent = {
  id: string;
  cycleId: string | null;
  profileId: string;
  profileName: string;
  tags: string[];
  matchedTag: string | null;
  runtimeSecs: number | null;
  limitMinutes: number | null;
  result: string;
  error: string | null;
  occurredAt: string;
  createdAt: string;
};
type PageResponse<T> = { items: T[]; nextCursor: string | null };
type PhonePageResponse = PageResponse<Phone> & {
  total: number;
  runningNow: number;
  inactiveTracked: number;
};
type RuleKey = "political" | "general" | "state" | "default";
type RuleDraft = { max_runtime_minutes: string; description: string };
type SettingsDraft = {
  enforcementEnabled: boolean;
  checkIntervalSeconds: string;
  rules: {
    by_tag: Record<string, RuleDraft>;
    default: RuleDraft;
  };
};
type SavedSettingsResponse =
  | Settings
  | {
      settings: Omit<Settings, "configVersion"> & Partial<Pick<Settings, "configVersion">>;
      configVersion?: ConfigVersion;
    };

const DEFAULT_TIMEZONE = "UTC";
const RANGE_OPTIONS: { value: Range; label: string; longLabel: string }[] = [
  { value: "24h", label: "24h", longLabel: "24 hours" },
  { value: "7d", label: "7d", longLabel: "7 days" },
  { value: "30d", label: "30d", longLabel: "30 days" },
];
const RULE_KEYS: RuleKey[] = ["political", "general", "state", "default"];
const EVENT_PAGE_SIZE = 25;
const CYCLE_PAGE_SIZE = 15;
const PHONE_PAGE_SIZE = 50;
const dateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getDateTimeFormatter(timezone: string, full: boolean) {
  const zone = timezone || DEFAULT_TIMEZONE;
  const key = `${full ? "full" : "short"}:${zone}`;
  const cached = dateTimeFormatterCache.get(key);
  if (cached) return cached;
  const options: Intl.DateTimeFormatOptions = {
    timeZone: zone,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(full ? { year: "numeric" as const, second: "2-digit" as const } : {}),
  };
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-GB", options);
  } catch {
    formatter = new Intl.DateTimeFormat("en-GB", { ...options, timeZone: DEFAULT_TIMEZONE });
  }
  dateTimeFormatterCache.set(key, formatter);
  return formatter;
}

function formatNumber(value: number) {
  return value.toLocaleString("en-US");
}

function formatDateTime(value: string | null, timezone: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : getDateTimeFormatter(timezone, false).format(date);
}

function fullDateTime(value: string | null, timezone: string) {
  if (!value) return "No timestamp";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Invalid timestamp"
    : `${getDateTimeFormatter(timezone, true).format(date)} ${timezone}`;
}

function dayLabel(value: string, timezone: string, includeYear = false) {
  const zone = timezone || DEFAULT_TIMEZONE;
  try {
    const date = fromZonedTime(`${value}T00:00:00`, zone);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      ...(includeYear ? { year: "numeric" as const } : {}),
      timeZone: zone,
    }).format(date);
  } catch {
    return value;
  }
}

function formatRuntime(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const totalMinutes = Math.floor(Math.max(0, seconds) / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function formatLimit(minutes: number | null) {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  const clean = (value: number) => Number(value.toFixed(2)).toString();
  if (minutes < 60) return `${clean(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${clean(remainder)}m` : `${hours}h`;
}

function humanize(value: string) {
  return value.replace(/_/g, " ");
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(body?.error || `Request failed (HTTP ${response.status})`);
  }
  return body as T;
}

function toDraft(settings: Settings): SettingsDraft {
  const ruleDraft = (rule: Rule): RuleDraft => ({
    max_runtime_minutes: String(rule.max_runtime_minutes),
    description: rule.description,
  });
  return {
    enforcementEnabled: settings.enforcementEnabled,
    checkIntervalSeconds: String(settings.checkIntervalSeconds),
    rules: {
      by_tag: Object.fromEntries(
        Object.entries(settings.rules.by_tag).map(([tag, rule]) => [tag, ruleDraft(rule)])
      ),
      default: ruleDraft(settings.rules.default),
    },
  };
}

function resultClass(result: string) {
  const normalized = result.toLowerCase();
  if (["stopped", "success", "succeeded", "stop_succeeded"].includes(normalized)) {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-400";
  }
  if (["failed", "failure", "error", "stop_failed"].includes(normalized)) {
    return "border-red-500/20 bg-red-500/10 text-red-400";
  }
  if (["unknown", "stop_unknown"].includes(normalized)) {
    return "border-amber-500/20 bg-amber-500/10 text-amber-400";
  }
  return "border-zinc-700 bg-zinc-800/60 text-zinc-400";
}

function cycleStatusClass(status: string) {
  const normalized = status.toLowerCase();
  if (["completed", "complete", "success", "succeeded", "ok"].includes(normalized)) {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-400";
  }
  if (["failed", "error"].includes(normalized)) {
    return "border-red-500/20 bg-red-500/10 text-red-400";
  }
  if (["running", "in_progress", "started"].includes(normalized)) {
    return "border-blue-500/20 bg-blue-500/10 text-blue-400";
  }
  return "border-zinc-700 bg-zinc-800/60 text-zinc-400";
}

function Badge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-medium ${className}`}>
      {children}
    </span>
  );
}

function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-500/20 bg-red-500/5 px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-red-400">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        <span>{message}</span>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded border border-[#27272a] px-2.5 py-1.5 text-xs text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
      >
        <RefreshCw className="h-3 w-3" /> Retry
      </button>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-md border border-[#27272a] bg-[#09090b] px-4 py-9 text-center">
      <p className="text-xs font-medium text-zinc-400">{title}</p>
      <p className="mx-auto mt-1 max-w-lg text-[11px] leading-relaxed text-zinc-600">{description}</p>
    </div>
  );
}

function SkeletonPanel({ height = "h-40" }: { height?: string }) {
  return <div className={`${height} animate-pulse rounded-md border border-[#27272a] bg-[#0c0c10]`} />;
}

function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-px overflow-hidden rounded-md border border-[#27272a] bg-[#09090b] p-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex animate-pulse items-center gap-4 border-b border-[#18181b] px-1 py-2.5 last:border-0">
          <div className="h-3 w-24 rounded bg-zinc-800" />
          <div className="h-3 flex-1 rounded bg-zinc-900" />
          <div className="h-3 w-20 rounded bg-zinc-900" />
          <div className="h-3 w-16 rounded bg-zinc-800" />
        </div>
      ))}
    </div>
  );
}

function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
        {description && <p className="mt-0.5 text-[11px] text-zinc-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  tone = "text-zinc-100",
  title,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: string;
  title?: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-[#27272a] bg-[#0c0c10] px-3.5 py-3" title={title}>
      <div className={`truncate text-xl font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}</div>
      {sub && <div className="mt-1 truncate text-[10px] text-zinc-600">{sub}</div>}
    </div>
  );
}

function RangeSelector({ value, onChange }: { value: Range; onChange: (range: Range) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-[#27272a] bg-[#09090b] p-0.5" aria-label="Reporting range">
      {RANGE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded px-2.5 py-1.5 text-[11px] font-medium transition ${
            value === option.value ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function PaginationControls({
  page,
  hasNext,
  loading,
  onPrevious,
  onNext,
}: {
  page: number;
  hasNext: boolean;
  loading: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-[#27272a] bg-[#0c0c10] px-3 py-2">
      <span className="text-[10px] text-zinc-600">Page {page}</span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onPrevious}
          disabled={page === 1 || loading}
          className="inline-flex items-center gap-1 rounded border border-[#27272a] px-2 py-1 text-[11px] text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-3 w-3" /> Newer
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasNext || loading}
          className="inline-flex items-center gap-1 rounded border border-[#27272a] px-2 py-1 text-[11px] text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Older <ChevronRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function PagedEmptyState({
  title,
  description,
  page,
  hasNext,
  loading,
  onPrevious,
  onNext,
}: {
  title: string;
  description: string;
  page: number;
  hasNext: boolean;
  loading: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-[#27272a] bg-[#09090b]">
      <div className="px-4 py-9 text-center">
        <p className="text-xs font-medium text-zinc-400">{title}</p>
        <p className="mx-auto mt-1 max-w-lg text-[11px] leading-relaxed text-zinc-600">{description}</p>
      </div>
      {page > 1 && (
        <PaginationControls
          page={page}
          hasNext={hasNext}
          loading={loading}
          onPrevious={onPrevious}
          onNext={onNext}
        />
      )}
    </div>
  );
}

function SettingsPanel({ settings, onSaved }: { settings: Settings; onSaved: (settings: Settings) => void }) {
  const [draft, setDraft] = useState<SettingsDraft>(() => toDraft(settings));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [loadedVersion, setLoadedVersion] = useState<ConfigVersion>(settings.configVersion);

  if (loadedVersion !== settings.configVersion && !dirty) {
    setLoadedVersion(settings.configVersion);
    setDraft(toDraft(settings));
  }

  const markChanged = () => {
    setDirty(true);
    setFeedback(null);
  };

  const updateRule = (key: RuleKey, value: string) => {
    markChanged();
    setDraft((current) => {
      if (key === "default") {
        return {
          ...current,
          rules: {
            ...current.rules,
            default: { ...current.rules.default, max_runtime_minutes: value },
          },
        };
      }
      return {
        ...current,
        rules: {
          ...current.rules,
          by_tag: {
            ...current.rules.by_tag,
            [key]: { ...current.rules.by_tag[key], max_runtime_minutes: value },
          },
        },
      };
    });
  };

  const toggleEnforcement = () => {
    const next = !draft.enforcementEnabled;
    const message = next
      ? "Enable automatic enforcement? Guardian will stop phones that reach their configured runtime limits. Save settings to apply this change on the next cycle."
      : "Disable automatic enforcement? Guardian will keep reporting, but over-limit phones will not be stopped. Save settings to apply this change on the next cycle.";
    if (!window.confirm(message)) return;
    markChanged();
    setDraft((current) => ({ ...current, enforcementEnabled: next }));
  };

  const save = async () => {
    const interval = Number(draft.checkIntervalSeconds);
    if (!Number.isFinite(interval) || interval < 15 || interval > 3600) {
      setFeedback({ type: "error", message: "Check interval must be between 15 and 3600 seconds." });
      return;
    }

    const parseRule = (rule: RuleDraft, label: string): Rule => {
      const limit = Number(rule.max_runtime_minutes);
      if (!Number.isFinite(limit) || limit <= 0 || limit > 1_000_000) {
        throw new Error(`${label} runtime limit must be greater than zero and no more than 1,000,000 minutes.`);
      }
      return { max_runtime_minutes: limit, description: rule.description };
    };

    let rules: Rules;
    try {
      const byTag: Record<string, Rule> = { ...settings.rules.by_tag };
      for (const tag of ["political", "general", "state"] as const) {
        byTag[tag] = parseRule(
          draft.rules.by_tag[tag],
          `${tag.charAt(0).toUpperCase()}${tag.slice(1)}`
        );
      }
      rules = {
        by_tag: byTag,
        default: parseRule(draft.rules.default, "Default"),
      };
    } catch (error) {
      setFeedback({ type: "error", message: errorMessage(error, "Check the runtime limits.") });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      const response = await fetchJson<SavedSettingsResponse>("/api/admin/multilogin-guardian/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enforcementEnabled: draft.enforcementEnabled,
          checkIntervalSeconds: interval,
          rules,
        }),
      });
      const saved: Settings = "settings" in response
        ? {
            ...response.settings,
            configVersion: response.settings.configVersion ?? response.configVersion ?? settings.configVersion,
          }
        : response;
      setDraft(toDraft(saved));
      setDirty(false);
      onSaved(saved);
      setFeedback({ type: "success", message: "Settings saved — applies next cycle." });
    } catch (error) {
      setFeedback({ type: "error", message: errorMessage(error, "Failed to save settings.") });
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setDraft(toDraft(settings));
    setDirty(false);
    setFeedback(null);
  };

  return (
    <section className="space-y-3">
      <SectionHeading
        title="Enforcement & runtime rules"
        description="Saved configuration is picked up next cycle. All custom by_tag rules are preserved, including those not shown below."
        action={dirty ? <Badge className="border-amber-500/20 bg-amber-500/10 text-amber-400">Unsaved changes</Badge> : undefined}
      />
      <div className="rounded-md border border-[#27272a] bg-[#0c0c10]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#27272a] px-4 py-3">
          <div className="flex items-start gap-3">
            <Settings2 className="mt-0.5 h-4 w-4 text-zinc-500" />
            <div>
              <p className="text-xs font-medium text-zinc-200">Automatic phone enforcement</p>
              <p className="mt-0.5 text-[11px] text-zinc-500">Stop running phones when they reach the matching rule limit.</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <span className={`text-[11px] font-medium ${draft.enforcementEnabled ? "text-emerald-400" : "text-zinc-500"}`}>
              {draft.enforcementEnabled ? "Enabled" : "Disabled"}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={draft.enforcementEnabled}
              aria-label="Automatic phone enforcement"
              onClick={toggleEnforcement}
              disabled={saving}
              className={`relative h-5 w-9 rounded-full border transition disabled:opacity-50 ${
                draft.enforcementEnabled ? "border-emerald-500/40 bg-emerald-600" : "border-zinc-700 bg-zinc-800"
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                  draft.enforcementEnabled ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 px-4 py-4 md:grid-cols-3 xl:grid-cols-5">
          {RULE_KEYS.map((key) => {
            const rule = key === "default" ? draft.rules.default : draft.rules.by_tag[key];
            const label = key === "default" ? "Default fallback" : `${key.charAt(0).toUpperCase()}${key.slice(1)} tag`;
            return (
              <label key={key} className="block">
                <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}</span>
                <span className="mt-1 flex items-center rounded border border-[#27272a] bg-[#09090b] focus-within:border-zinc-600">
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={rule.max_runtime_minutes}
                    onChange={(event) => updateRule(key, event.target.value)}
                    disabled={saving}
                    className="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-xs text-zinc-200 outline-none tabular-nums"
                    aria-label={`${label} maximum runtime in minutes`}
                  />
                  <span className="pr-2.5 text-[10px] text-zinc-600">min</span>
                </span>
                <span className="mt-1 block truncate text-[10px] text-zinc-600" title={rule.description}>
                  {rule.description || "Runtime limit"}
                </span>
              </label>
            );
          })}
          <label className="block">
            <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Check interval</span>
            <span className="mt-1 flex items-center rounded border border-[#27272a] bg-[#09090b] focus-within:border-zinc-600">
              <input
                type="number"
                min="15"
                max="3600"
                step="1"
                value={draft.checkIntervalSeconds}
                onChange={(event) => {
                  markChanged();
                  setDraft((current) => ({ ...current, checkIntervalSeconds: event.target.value }));
                }}
                disabled={saving}
                className="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-xs text-zinc-200 outline-none tabular-nums"
                aria-label="Check interval in seconds"
              />
              <span className="pr-2.5 text-[10px] text-zinc-600">sec</span>
            </span>
            <span className="mt-1 block text-[10px] text-zinc-600">Between agent cycles</span>
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#27272a] px-4 py-3">
          <div className="min-h-4 text-[11px]" role="status">
            {feedback ? (
              <span className={`inline-flex items-center gap-1.5 ${feedback.type === "success" ? "text-emerald-400" : "text-red-400"}`}>
                {feedback.type === "success" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                {feedback.message}
              </span>
            ) : (
              <span className="text-zinc-600">Changes are not live until saved; saved changes apply next cycle.</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={reset}
              disabled={!dirty || saving}
              className="rounded border border-[#27272a] px-3 py-1.5 text-xs text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving}
              className="inline-flex items-center gap-1.5 rounded border border-blue-500/30 bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {saving ? "Saving…" : "Save settings"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function phoneStatus(phone: Phone) {
  if (phone.isRunning) return "Running";
  return phone.status === 2 ? "Stopped" : "Inactive";
}

function PhonesPanel({ timezone }: { timezone: string }) {
  const [status, setStatus] = useState<"running" | "inactive" | "all">("all");
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([]);
  const [data, setData] = useState<PhonePageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const beginLoad = () => {
    setLoading(true);
    setError(null);
    setData(null);
  };
  const resetPages = () => {
    beginLoad();
    setCursor(null);
    setCursorStack([]);
  };
  const reload = () => {
    resetPages();
    setNonce((value) => value + 1);
  };

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ status, limit: String(PHONE_PAGE_SIZE) });
    if (query) params.set("q", query);
    if (cursor) params.set("cursor", cursor);
    fetchJson<PhonePageResponse>(`/api/admin/multilogin-guardian/phones?${params.toString()}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((response) => setData(response))
      .catch((requestError) => {
        if (!isAbortError(requestError)) setError(errorMessage(requestError, "Failed to load phones."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [status, query, cursor, nonce]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const nextQuery = searchInput.trim();
    resetPages();
    if (nextQuery === query) setNonce((value) => value + 1);
    else setQuery(nextQuery);
  };
  const clearFilters = () => {
    setSearchInput("");
    setQuery("");
    setStatus("all");
    resetPages();
  };
  const nextPage = () => {
    if (loading || !data?.nextCursor) return;
    beginLoad();
    setCursorStack((stack) => [...stack, cursor]);
    setCursor(data.nextCursor);
  };
  const previousPage = () => {
    if (loading || cursorStack.length === 0) return;
    beginLoad();
    const previous = cursorStack[cursorStack.length - 1] ?? null;
    setCursorStack(cursorStack.slice(0, -1));
    setCursor(previous);
  };
  const hasFilters = status !== "all" || Boolean(query);

  return (
    <section className="space-y-3">
      <SectionHeading
        title="Phones"
        description={data
          ? `${formatNumber(data.runningNow)} running · ${formatNumber(data.inactiveTracked)} recently inactive · server totals`
          : error ? "Phone counts unavailable" : "Loading server phone counts…"}
        action={
          <button
            type="button"
            onClick={reload}
            disabled={loading}
            title="Reload the first phone page"
            className="inline-flex items-center gap-1.5 rounded border border-[#27272a] px-2.5 py-1.5 text-[11px] text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        }
      />
      <div className="flex flex-wrap items-end gap-2">
        <label>
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-500">State</span>
          <select
            value={status}
            onChange={(event) => { setStatus(event.target.value as "running" | "inactive" | "all"); resetPages(); }}
            className="rounded border border-[#27272a] bg-[#09090b] px-2.5 py-1.5 text-xs text-zinc-400 outline-none focus:border-zinc-600"
          >
            <option value="all">All phones</option>
            <option value="running">Running</option>
            <option value="inactive">Recently inactive</option>
          </select>
        </label>
        <form onSubmit={submitSearch} className="flex items-end gap-2">
          <label>
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-500">Search</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-600" />
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                maxLength={200}
                placeholder="Phone name or profile ID"
                aria-label="Search phones"
                className="w-64 rounded border border-[#27272a] bg-[#09090b] py-1.5 pl-8 pr-3 text-xs text-zinc-300 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
              />
            </div>
          </label>
          <button
            type="submit"
            disabled={loading}
            className="rounded border border-[#27272a] bg-[#0c0c10] px-3 py-1.5 text-xs text-zinc-300 transition hover:border-zinc-600 disabled:opacity-40"
          >
            Search
          </button>
        </form>
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex items-center gap-1 rounded border border-[#27272a] px-2.5 py-1.5 text-xs text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        )}
      </div>
      {error ? (
        <SectionError message={error} onRetry={reload} />
      ) : loading ? (
        <TableSkeleton rows={6} />
      ) : !data || data.items.length === 0 ? (
        <PagedEmptyState
          title={hasFilters ? "No phones match these filters" : cursorStack.length ? "No phones on this page" : "No phone inventory yet"}
          description={hasFilters ? "Clear the search or choose another running state." : "Running and recently inactive phones appear after Guardian reports inventory."}
          page={cursorStack.length + 1}
          hasNext={Boolean(data?.nextCursor)}
          loading={loading}
          onPrevious={previousPage}
          onNext={nextPage}
        />
      ) : (
        <div className="overflow-hidden rounded-md border border-[#27272a] bg-[#09090b]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left text-xs">
              <thead>
                <tr className="border-b border-[#27272a] bg-[#0c0c10] text-[10px] uppercase tracking-wider text-zinc-500">
                  <th className="px-4 py-2.5 font-medium">Phone</th>
                  <th className="px-3 py-2.5 font-medium">Tags</th>
                  <th className="px-3 py-2.5 font-medium">State</th>
                  <th className="px-3 py-2.5 text-right font-medium">Runtime</th>
                  <th className="px-3 py-2.5 text-right font-medium">Limit</th>
                  <th className="px-3 py-2.5 font-medium">Rule</th>
                  <th className="px-3 py-2.5 font-medium">Last decision</th>
                  <th className="px-4 py-2.5 font-medium">Last seen ({timezone})</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#18181b]">
                {data.items.map((phone) => (
                  <tr key={phone.profileId} className="transition hover:bg-zinc-900/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Smartphone className={`h-3.5 w-3.5 shrink-0 ${phone.isRunning ? "text-emerald-500" : "text-zinc-600"}`} />
                        <div className="min-w-0">
                          <p className="max-w-[190px] truncate font-medium text-zinc-200" title={phone.name}>{phone.name}</p>
                          <p className="mt-0.5 font-mono text-[10px] text-zinc-600">{phone.profileId}</p>
                        </div>
                      </div>
                    </td>
                    <td className="max-w-[170px] px-3 py-3">
                      {phone.tags.length ? (
                        <div className="flex flex-wrap gap-1" title={phone.tags.join(", ")}>
                          {phone.tags.slice(0, 3).map((item) => (
                            <span key={item} className="rounded border border-[#27272a] bg-[#18181b] px-1.5 py-px text-[10px] text-zinc-400">{item}</span>
                          ))}
                          {phone.tags.length > 3 && <span className="text-[10px] text-zinc-600">+{phone.tags.length - 3}</span>}
                        </div>
                      ) : <span className="text-zinc-700">—</span>}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1.5 ${phone.isRunning ? "text-emerald-400" : "text-zinc-500"}`} title={phone.status == null ? "No Multilogin status reported" : `Multilogin status: ${phone.status}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${phone.isRunning ? "bg-emerald-400" : "bg-zinc-600"}`} />
                        {phoneStatus(phone)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-zinc-300 tabular-nums whitespace-nowrap" title={phone.runningTimeSecs == null ? undefined : `${formatNumber(phone.runningTimeSecs)} seconds`}>
                      {formatRuntime(phone.runningTimeSecs)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-zinc-400 tabular-nums whitespace-nowrap">{formatLimit(phone.limitMinutes)}</td>
                    <td className="px-3 py-3">
                      <Badge className={phone.matchedTag ? "border-blue-500/20 bg-blue-500/10 text-blue-400" : "border-zinc-700 bg-zinc-800/60 text-zinc-400"}>
                        {phone.matchedTag || "default"}
                      </Badge>
                    </td>
                    <td className="max-w-[190px] px-3 py-3">
                      <p className="truncate text-zinc-400" title={phone.lastDecision || undefined}>{phone.lastDecision ? humanize(phone.lastDecision) : "—"}</p>
                      {phone.lastStoppedAt && (
                        <p className="mt-0.5 truncate text-[10px] text-zinc-600" title={fullDateTime(phone.lastStoppedAt, timezone)}>
                          Stopped {formatDateTime(phone.lastStoppedAt, timezone)}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 whitespace-nowrap" title={fullDateTime(phone.lastSeenAt, timezone)}>{formatDateTime(phone.lastSeenAt, timezone)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-[#27272a] bg-[#0c0c10] px-4 py-2 text-[10px] text-zinc-600">
            Showing {data.items.length} of {formatNumber(data.total)} matching phones · runtimes are reported values, rounded down to whole minutes.
          </div>
          <PaginationControls
            page={cursorStack.length + 1}
            hasNext={Boolean(data.nextCursor)}
            loading={loading}
            onPrevious={previousPage}
            onNext={nextPage}
          />
        </div>
      )}
    </section>
  );
}

function DailyChart({ daily, range, timezone }: { daily: DailyPoint[]; range: Range; timezone: string }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const rangeLabel = RANGE_OPTIONS.find((option) => option.value === range)?.longLabel || range;
  if (daily.length === 0) {
    return (
      <section className="space-y-3">
        <SectionHeading title={`Daily stop outcomes · ${rangeLabel}`} description={`Day boundaries use ${timezone}.`} />
        <EmptyState title="No daily activity reported" description="Stopped, failed, and unknown stop outcomes will be charted after Guardian reports activity." />
      </section>
    );
  }

  const max = Math.max(...daily.map((point) => point.stopped + point.failed + point.unknown), 1);
  const hasActivity = daily.some((point) => point.stopped + point.failed + point.unknown > 0);
  const series = [
    { key: "unknown" as const, label: "Unknown", color: "#f59e0b" },
    { key: "failed" as const, label: "Failed", color: "#f87171" },
    { key: "stopped" as const, label: "Stopped", color: "#34d399" },
  ];

  return (
    <section className="space-y-3">
      <SectionHeading
        title={`Daily stop outcomes · ${rangeLabel}`}
        description={`Exact reported counts · day boundaries use ${timezone}. Hover or focus a day for details.`}
        action={
          <div className="flex items-center gap-3 text-[10px] text-zinc-500">
            {[...series].reverse().map((item) => (
              <span key={item.key} className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: item.color }} />{item.label}
              </span>
            ))}
          </div>
        }
      />
      <div className="rounded-md border border-[#27272a] bg-[#0c0c10] px-4 pb-3 pt-9">
        <div className="flex h-36 items-end gap-[3px]">
          {daily.map((point, index) => {
            const total = point.stopped + point.failed + point.unknown;
            const tooltip = `${dayLabel(point.date, timezone, true)} — Stopped: ${formatNumber(point.stopped)} · Failed: ${formatNumber(point.failed)} · Unknown: ${formatNumber(point.unknown)}`;
            return (
              <div
                key={point.date}
                tabIndex={0}
                aria-label={tooltip}
                title={tooltip}
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered((current) => current === index ? null : current)}
                onFocus={() => setHovered(index)}
                onBlur={() => setHovered((current) => current === index ? null : current)}
                className="relative flex h-full min-w-[3px] flex-1 flex-col justify-end rounded-sm outline-none focus:bg-zinc-800/30"
              >
                {total === 0 ? (
                  <div className="h-px w-full bg-[#3f3f46]" />
                ) : (
                  series.map((item) => point[item.key] > 0 && (
                    <div
                      key={item.key}
                      className="w-full"
                      style={{ height: `${(point[item.key] / max) * 100}%`, backgroundColor: item.color }}
                    />
                  ))
                )}
                {hovered === index && (
                  <div className={`pointer-events-none absolute bottom-full z-20 mb-2 whitespace-nowrap rounded-md border border-[#3f3f46] bg-zinc-950 px-2.5 py-1.5 text-[11px] text-zinc-200 shadow-lg ${
                    index === 0 ? "left-0" : index === daily.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2"
                  }`}>
                    <span className="mr-2 text-zinc-500">{dayLabel(point.date, timezone, true)}</span>
                    <span className="text-emerald-400">{formatNumber(point.stopped)} stopped</span>
                    <span className="mx-1 text-zinc-700">·</span>
                    <span className="text-red-400">{formatNumber(point.failed)} failed</span>
                    <span className="mx-1 text-zinc-700">·</span>
                    <span className="text-amber-400">{formatNumber(point.unknown)} unknown</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-zinc-600">
          <span>{dayLabel(daily[0].date, timezone)}</span>
          <span>{dayLabel(daily[daily.length - 1].date, timezone)}</span>
        </div>
        {!hasActivity && <p className="mt-2 text-center text-[10px] text-zinc-600">No stop outcomes recorded in this range.</p>}
      </div>
    </section>
  );
}

function StopHistoryPanel({ range, timezone }: { range: Range; timezone: string }) {
  const [result, setResult] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([]);
  const [data, setData] = useState<PageResponse<StopEvent> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const beginLoad = () => {
    setLoading(true);
    setError(null);
    setData(null);
  };
  const reload = () => {
    beginLoad();
    setCursor(null);
    setCursorStack([]);
    setNonce((value) => value + 1);
  };

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ range, limit: String(EVENT_PAGE_SIZE) });
    if (result !== "all") params.set("result", result);
    if (query) params.set("q", query);
    if (cursor) params.set("cursor", cursor);
    fetchJson<PageResponse<StopEvent>>(`/api/admin/multilogin-guardian/events?${params.toString()}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((response) => setData(response))
      .catch((requestError) => {
        if (!isAbortError(requestError)) setError(errorMessage(requestError, "Failed to load stop history."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [range, result, query, cursor, nonce]);

  const resetPages = () => {
    beginLoad();
    setCursor(null);
    setCursorStack([]);
  };
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const nextQuery = searchInput.trim();
    resetPages();
    if (nextQuery === query) setNonce((value) => value + 1);
    else setQuery(nextQuery);
  };
  const clearFilters = () => {
    setSearchInput("");
    setQuery("");
    setResult("all");
    resetPages();
  };
  const nextPage = () => {
    if (loading || !data?.nextCursor) return;
    beginLoad();
    setCursorStack((stack) => [...stack, cursor]);
    setCursor(data.nextCursor);
  };
  const previousPage = () => {
    if (loading || cursorStack.length === 0) return;
    beginLoad();
    const previous = cursorStack[cursorStack.length - 1] ?? null;
    setCursorStack(cursorStack.slice(0, -1));
    setCursor(previous);
  };
  const hasFilters = result !== "all" || Boolean(query);

  return (
    <section className="space-y-3">
      <SectionHeading
        title="Stop history"
        description="Per-phone stop outcomes for the selected reporting range. Loaded on demand, not polled."
        action={
          <button
            type="button"
            onClick={reload}
            disabled={loading}
            title="Reload stop history"
            className="inline-flex items-center gap-1.5 rounded border border-[#27272a] px-2.5 py-1.5 text-[11px] text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        }
      />
      <div className="flex flex-wrap items-end gap-2">
        <label>
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-500">Result</span>
          <select
            value={result}
            onChange={(event) => { setResult(event.target.value); resetPages(); }}
            className="rounded border border-[#27272a] bg-[#09090b] px-2.5 py-1.5 text-xs text-zinc-400 outline-none focus:border-zinc-600"
          >
            <option value="all">All results</option>
            <option value="stopped">Stopped</option>
            <option value="failed">Failed</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <form onSubmit={submitSearch} className="flex items-end gap-2">
          <label>
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-500">Search</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-600" />
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Phone, profile ID, tag, or error"
                aria-label="Search stop history"
                className="w-64 rounded border border-[#27272a] bg-[#09090b] py-1.5 pl-8 pr-3 text-xs text-zinc-300 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
              />
            </div>
          </label>
          <button
            type="submit"
            disabled={loading}
            className="rounded border border-[#27272a] bg-[#0c0c10] px-3 py-1.5 text-xs text-zinc-300 transition hover:border-zinc-600 disabled:opacity-40"
          >
            Search
          </button>
        </form>
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex items-center gap-1 rounded border border-[#27272a] px-2.5 py-1.5 text-xs text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        )}
      </div>
      {error ? (
        <SectionError message={error} onRetry={reload} />
      ) : loading ? (
        <TableSkeleton rows={7} />
      ) : !data || data.items.length === 0 ? (
        <PagedEmptyState
          title={hasFilters ? "No stop events match these filters" : cursorStack.length ? "No stop events on this page" : "No stop history yet"}
          description={hasFilters ? "Try another result or clear the search." : cursorStack.length ? "Go newer or refresh to return to the first page." : "Stop outcomes and any Multilogin errors will appear after Guardian completes a stop cycle."}
          page={cursorStack.length + 1}
          hasNext={Boolean(data?.nextCursor)}
          loading={loading}
          onPrevious={previousPage}
          onNext={nextPage}
        />
      ) : (
        <div className="overflow-hidden rounded-md border border-[#27272a] bg-[#09090b]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-xs">
              <thead>
                <tr className="border-b border-[#27272a] bg-[#0c0c10] text-[10px] uppercase tracking-wider text-zinc-500">
                  <th className="px-4 py-2.5 font-medium">Occurred ({timezone})</th>
                  <th className="px-3 py-2.5 font-medium">Phone</th>
                  <th className="px-3 py-2.5 font-medium">Rule</th>
                  <th className="px-3 py-2.5 text-right font-medium">Runtime</th>
                  <th className="px-3 py-2.5 text-right font-medium">Limit</th>
                  <th className="px-3 py-2.5 font-medium">Result</th>
                  <th className="px-4 py-2.5 font-medium">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#18181b]">
                {data.items.map((item) => (
                  <tr key={item.id} className="align-top transition hover:bg-zinc-900/40">
                    <td className="px-4 py-3 text-zinc-500 whitespace-nowrap" title={`Actual stop ${fullDateTime(item.occurredAt, timezone)} · received ${fullDateTime(item.createdAt, timezone)}`}>
                      {formatDateTime(item.occurredAt, timezone)}
                      <p className="mt-0.5 font-mono text-[10px] text-zinc-700" title={item.cycleId ? `Cycle ${item.cycleId}` : "No cycle ID"}>
                        {item.cycleId ? `cycle ${item.cycleId.slice(0, 8)}` : "no cycle id"}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <p className="max-w-[200px] truncate font-medium text-zinc-200" title={item.profileName}>{item.profileName}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-zinc-600">{item.profileId}</p>
                      {item.tags.length > 0 && <p className="mt-1 max-w-[200px] truncate text-[10px] text-zinc-600" title={item.tags.join(", ")}>{item.tags.join(" · ")}</p>}
                    </td>
                    <td className="px-3 py-3 text-zinc-400">{item.matchedTag || "default"}</td>
                    <td className="px-3 py-3 text-right font-mono text-zinc-300 tabular-nums whitespace-nowrap" title={item.runtimeSecs == null ? undefined : `${formatNumber(item.runtimeSecs)} seconds`}>{formatRuntime(item.runtimeSecs)}</td>
                    <td className="px-3 py-3 text-right font-mono text-zinc-400 tabular-nums whitespace-nowrap">{formatLimit(item.limitMinutes)}</td>
                    <td className="px-3 py-3 whitespace-nowrap"><Badge className={resultClass(item.result)}>{humanize(item.result)}</Badge></td>
                    <td className="max-w-[300px] px-4 py-3">
                      {item.error ? <p className="whitespace-normal break-words text-[11px] leading-relaxed text-red-400" title={item.error}>{item.error}</p> : <span className="text-zinc-700">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationControls
            page={cursorStack.length + 1}
            hasNext={Boolean(data.nextCursor)}
            loading={loading}
            onPrevious={previousPage}
            onNext={nextPage}
          />
        </div>
      )}
    </section>
  );
}

function RecentCyclesPanel({ timezone }: { timezone: string }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([]);
  const [data, setData] = useState<PageResponse<Cycle> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const beginLoad = () => {
    setLoading(true);
    setError(null);
    setData(null);
  };
  const reload = () => {
    beginLoad();
    setCursor(null);
    setCursorStack([]);
    setNonce((value) => value + 1);
  };

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: String(CYCLE_PAGE_SIZE) });
    if (cursor) params.set("cursor", cursor);
    fetchJson<PageResponse<Cycle>>(`/api/admin/multilogin-guardian/cycles?${params.toString()}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((response) => setData(response))
      .catch((requestError) => {
        if (!isAbortError(requestError)) setError(errorMessage(requestError, "Failed to load recent cycles."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [cursor, nonce]);

  const nextPage = () => {
    if (loading || !data?.nextCursor) return;
    beginLoad();
    setCursorStack((stack) => [...stack, cursor]);
    setCursor(data.nextCursor);
  };
  const previousPage = () => {
    if (loading || cursorStack.length === 0) return;
    beginLoad();
    const previous = cursorStack[cursorStack.length - 1] ?? null;
    setCursorStack(cursorStack.slice(0, -1));
    setCursor(previous);
  };

  return (
    <section className="space-y-3">
      <SectionHeading
        title="Recent cycles"
        description="Agent inventory and stop totals. Loaded once and on manual refresh."
        action={
          <button
            type="button"
            onClick={reload}
            disabled={loading}
            title="Reload recent cycles"
            className="inline-flex items-center gap-1.5 rounded border border-[#27272a] px-2.5 py-1.5 text-[11px] text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        }
      />
      {error ? (
        <SectionError message={error} onRetry={reload} />
      ) : loading ? (
        <TableSkeleton rows={5} />
      ) : !data || data.items.length === 0 ? (
        <PagedEmptyState
          title={cursorStack.length ? "No cycles on this page" : "No Guardian cycles yet"}
          description={cursorStack.length ? "Go newer or refresh to return to the first page." : "Cycle health, inventory completeness, and stop totals will appear after the agent’s first report."}
          page={cursorStack.length + 1}
          hasNext={Boolean(data?.nextCursor)}
          loading={loading}
          onPrevious={previousPage}
          onNext={nextPage}
        />
      ) : (
        <div className="overflow-hidden rounded-md border border-[#27272a] bg-[#09090b]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left text-xs">
              <thead>
                <tr className="border-b border-[#27272a] bg-[#0c0c10] text-[10px] uppercase tracking-wider text-zinc-500">
                  <th className="px-4 py-2.5 font-medium">Started ({timezone})</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Inventory</th>
                  <th className="px-3 py-2.5 text-right font-medium">Running</th>
                  <th className="px-3 py-2.5 font-medium">Stop outcome</th>
                  <th className="px-3 py-2.5 font-medium">Finished ({timezone})</th>
                  <th className="px-4 py-2.5 font-medium">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#18181b]">
                {data.items.map((cycle) => (
                  <tr key={cycle.id} className="align-top transition hover:bg-zinc-900/40">
                    <td className="px-4 py-3 text-zinc-400 whitespace-nowrap" title={fullDateTime(cycle.startedAt, timezone)}>
                      {formatDateTime(cycle.startedAt, timezone)}
                      <p className="mt-0.5 font-mono text-[10px] text-zinc-700" title={cycle.id}>{cycle.id.slice(0, 8)}</p>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap"><Badge className={cycleStatusClass(cycle.status)}>{humanize(cycle.status)}</Badge></td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className={cycle.inventoryComplete ? "text-zinc-400" : "text-amber-400"}>{cycle.inventoryComplete ? "Complete" : "Incomplete"}</span>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-zinc-300 tabular-nums">{formatNumber(cycle.runningCount)}</td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <p className="text-zinc-300"><span className="text-emerald-400">{formatNumber(cycle.stopSucceeded)}</span> stopped <span className="text-zinc-600">/ {formatNumber(cycle.stopRequested)} requested</span></p>
                      <p className="mt-0.5 text-[10px]"><span className="text-red-400">{formatNumber(cycle.stopFailed)} failed</span><span className="mx-1 text-zinc-700">·</span><span className="text-amber-400">{formatNumber(cycle.stopUnknown)} unknown</span></p>
                    </td>
                    <td className="px-3 py-3 text-zinc-500 whitespace-nowrap" title={fullDateTime(cycle.finishedAt, timezone)}>{cycle.finishedAt ? formatDateTime(cycle.finishedAt, timezone) : "In progress"}</td>
                    <td className="max-w-[300px] px-4 py-3">
                      {cycle.error ? <p className="whitespace-normal break-words text-[11px] leading-relaxed text-red-400" title={cycle.error}>{cycle.error}</p> : <span className="text-zinc-700">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationControls
            page={cursorStack.length + 1}
            hasNext={Boolean(data.nextCursor)}
            loading={loading}
            onPrevious={previousPage}
            onNext={nextPage}
          />
        </div>
      )}
    </section>
  );
}

export default function PhoneGuardianClient() {
  const [range, setRange] = useState<Range>("24h");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewRefreshing, setOverviewRefreshing] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewNonce, setOverviewNonce] = useState(0);
  const requestSequence = useRef(0);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    const controller = new AbortController();
    const sequence = ++requestSequence.current;

    const load = async (background: boolean) => {
      if (inFlight) return;
      inFlight = true;
      if (background) setOverviewRefreshing(true);
      setOverviewError(null);
      try {
        const response = await fetchJson<Overview>(`/api/admin/multilogin-guardian/overview?range=${range}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (active && sequence === requestSequence.current) setOverview(response);
      } catch (error) {
        if (active && !isAbortError(error) && sequence === requestSequence.current) {
          setOverviewError(errorMessage(error, "Failed to load the Guardian overview."));
        }
      } finally {
        inFlight = false;
        if (active && sequence === requestSequence.current) {
          setOverviewLoading(false);
          setOverviewRefreshing(false);
        }
      }
    };

    void load(false);
    const interval = window.setInterval(() => void load(true), 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
      controller.abort();
    };
  }, [range, overviewNonce]);

  const changeRange = (next: Range) => {
    if (next === range) return;
    requestSequence.current += 1;
    setOverview(null);
    setOverviewLoading(true);
    setOverviewRefreshing(false);
    setOverviewError(null);
    setRange(next);
  };
  const reloadOverview = () => {
    setOverviewRefreshing(true);
    setOverviewNonce((value) => value + 1);
  };
  const settings = overview?.settings;
  const health = overview?.health;
  const lastCycle = health?.lastCycle;
  const timezone = overview?.timezone || DEFAULT_TIMEZONE;
  const rangeLabel = RANGE_OPTIONS.find((option) => option.value === range)?.longLabel || range;

  return (
    <div className="space-y-7 text-zinc-100">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[#27272a] pb-5">
        <div className="space-y-2">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-5 w-5 text-blue-500" />
            <h1 className="text-xl font-semibold tracking-tight text-white">Phone Guardian</h1>
          </div>
          <p className="text-xs text-zinc-500">Multilogin cloud-phone runtime enforcement and agent health · all times {timezone}</p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {!settings ? (
              <Badge className="border-zinc-700 bg-zinc-800/60 text-zinc-500">
                {overviewLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />}
                {overviewLoading ? "Loading settings" : "Settings unavailable"}
              </Badge>
            ) : (
              <Badge className={settings.enforcementEnabled ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" : "border-zinc-700 bg-zinc-800/60 text-zinc-400"}>
                <ShieldCheck className="h-3 w-3" /> Enforcement {settings.enforcementEnabled ? "enabled" : "disabled"}
              </Badge>
            )}
            <Badge className={health?.heartbeatAt && health.stale ? "border-amber-500/20 bg-amber-500/10 text-amber-400" : health?.heartbeatAt ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" : "border-zinc-700 bg-zinc-800/60 text-zinc-400"}>
              <HeartPulse className="h-3 w-3" />
              {health?.heartbeatAt && health.stale ? "Agent stale" : health?.heartbeatAt ? "Agent healthy" : "No heartbeat yet"}
            </Badge>
            <Badge className="border-[#27272a] bg-[#0c0c10] text-zinc-500">Config {settings ? `v${settings.configVersion}` : "—"}</Badge>
            <span className="text-[10px] text-zinc-600" title={fullDateTime(health?.heartbeatAt ?? null, timezone)}>
              Heartbeat {health?.heartbeatAt ? formatDateTime(health.heartbeatAt, timezone) : "—"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RangeSelector value={range} onChange={changeRange} />
          <button
            type="button"
            onClick={reloadOverview}
            disabled={overviewRefreshing}
            title="Refresh overview; automatic refresh runs every 30 seconds"
            className="inline-flex items-center gap-1.5 rounded border border-[#27272a] bg-[#0c0c10] px-3 py-1.5 text-xs text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${overviewRefreshing ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </header>

      {overviewError && overview && <SectionError message={`Overview refresh failed: ${overviewError}`} onRetry={reloadOverview} />}
      {health?.stale && (health.heartbeatAt || lastCycle) && (
        <div className="flex items-start gap-2.5 rounded-md border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Guardian heartbeat is stale.</p>
            <p className="mt-0.5 text-[11px] text-amber-400/70">Last heartbeat: {formatDateTime(health.heartbeatAt, timezone)} {timezone}. Check the agent before relying on current enforcement.</p>
          </div>
        </div>
      )}
      {overview && !health?.heartbeatAt && !lastCycle && (
        <div className="flex items-start gap-2.5 rounded-md border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-xs text-blue-300">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Waiting for Guardian’s first report.</p>
            <p className="mt-0.5 text-[11px] text-blue-400/70">You can configure rules now. Phone inventory, heartbeat, and cycle results will appear after the agent reports in.</p>
          </div>
        </div>
      )}

      <section className="space-y-3">
        <SectionHeading title={`Operational summary · ${rangeLabel}`} description="Live overview refreshes every 30 seconds; history remains on demand." />
        {overviewError && !overview ? (
          <SectionError message={overviewError} onRetry={reloadOverview} />
        ) : !overview ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, index) => <SkeletonPanel key={index} height="h-[88px]" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KpiCard label="Running now" value={formatNumber(overview.summary.runningNow)} tone="text-emerald-400" sub="Latest phone inventory" />
            <KpiCard label="Tracked inactive" value={formatNumber(overview.summary.inactiveTracked)} sub="Recently inactive phones" />
            <KpiCard label="Stopped today" value={formatNumber(overview.summary.stoppedToday)} tone="text-blue-400" sub={`Current ${timezone} day`} />
            <KpiCard label={`Stopped · ${range}`} value={formatNumber(overview.summary.stoppedRange)} tone="text-blue-400" sub={`Selected ${rangeLabel}`} />
            <KpiCard
              label={`Failed + unknown · ${range}`}
              value={formatNumber(overview.summary.failedRange + overview.summary.unknownRange)}
              tone={overview.summary.failedRange ? "text-red-400" : overview.summary.unknownRange ? "text-amber-400" : "text-zinc-100"}
              sub={`${formatNumber(overview.summary.failedRange)} failed · ${formatNumber(overview.summary.unknownRange)} unknown`}
            />
            <KpiCard
              label="Last cycle"
              value={lastCycle ? <span className="text-sm capitalize">{humanize(lastCycle.status)}</span> : <span className="text-sm text-zinc-500">No cycles yet</span>}
              tone={lastCycle?.status.toLowerCase().includes("fail") ? "text-red-400" : "text-zinc-100"}
              sub={lastCycle ? `${formatDateTime(lastCycle.startedAt, timezone)} · ${formatNumber(lastCycle.runningCount)} running` : "Waiting for agent report"}
              title={lastCycle?.error || (lastCycle ? fullDateTime(lastCycle.startedAt, timezone) : undefined)}
            />
          </div>
        )}
      </section>

      {overview ? (
        <>
          <SettingsPanel
            settings={overview.settings}
            onSaved={(saved) => setOverview((current) => current ? { ...current, settings: saved } : current)}
          />
          <PhonesPanel timezone={timezone} />
          <DailyChart daily={overview.daily} range={range} timezone={timezone} />
        </>
      ) : overviewLoading ? (
        <>
          <SkeletonPanel height="h-64" />
          <TableSkeleton rows={5} />
          <SkeletonPanel height="h-52" />
        </>
      ) : null}

      <StopHistoryPanel key={`${range}:${timezone}`} range={range} timezone={timezone} />
      <RecentCyclesPanel timezone={timezone} />

      <div className="flex items-center justify-center gap-2 pb-2 text-[10px] text-zinc-700">
        <History className="h-3 w-3" /> Guardian only takes automatic actions from saved enforcement rules; this page cannot manually stop phones.
      </div>
    </div>
  );
}
