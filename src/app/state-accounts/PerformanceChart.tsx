"use client";

import { useMemo, useState } from "react";
import { BarChart3, TrendingUp } from "lucide-react";
import type { ClientStateDailyPoint } from "@/lib/services/state-accounts/client-portal";

export type ChartMetric = "viewsGained" | "likesGained" | "posts" | "followerGrowth";
export type ChartMode = "daily" | "cumulative";

const METRIC_META: Record<
  ChartMetric,
  { label: string; short: string; color: string; stroke: string; glow: string }
> = {
  viewsGained: {
    label: "Views Gained",
    short: "views",
    color: "#f43f5e",
    stroke: "#fb7185",
    glow: "rgba(244,63,94,0.22)",
  },
  likesGained: {
    label: "Likes Gained",
    short: "likes",
    color: "#a855f7",
    stroke: "#c084fc",
    glow: "rgba(168,85,247,0.22)",
  },
  posts: {
    label: "Posts Published",
    short: "posts",
    color: "#3b82f6",
    stroke: "#60a5fa",
    glow: "rgba(59,130,246,0.22)",
  },
  followerGrowth: {
    label: "Follower Growth",
    short: "followers",
    color: "#10b981",
    stroke: "#34d399",
    glow: "rgba(16,185,129,0.22)",
  },
};

const formatCompact = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${n}`;
};

const formatShortDate = (dateStr: string) => {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
};

export function MiniSparkline({
  values,
  color = "#fb7185",
}: {
  values: number[];
  color?: string;
}) {
  if (values.length < 2 || values.every((v) => v === 0)) {
    return (
      <svg viewBox="0 0 100 28" className="h-7 w-full overflow-visible">
        <line
          x1="0"
          y1="24"
          x2="100"
          y2="24"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="1.5"
          strokeDasharray="3 3"
        />
      </svg>
    );
  }
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const range = Math.max(1, max - min);
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = 25 - ((v - min) / range) * 21;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `0,27 ${pts.join(" ")} 100,27`;
  const gradId = `sp-${color.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <svg viewBox="0 0 100 28" className="h-7 w-full overflow-visible">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradId})`} />
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts.join(" ")}
      />
    </svg>
  );
}

export default function PerformanceChart({
  daily,
  timezone,
  title,
  currentDayDate,
}: {
  daily: ClientStateDailyPoint[];
  timezone: string;
  title: string;
  currentDayDate?: string | null;
}) {
  const [metric, setMetric] = useState<ChartMetric>("viewsGained");
  const [mode, setMode] = useState<ChartMode>("daily");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const meta = METRIC_META[metric];

  const series = useMemo(() => {
    const out: (ClientStateDailyPoint & { value: number; raw: number })[] = [];
    for (let i = 0; i < daily.length; i++) {
      const d = daily[i];
      const raw = d[metric];
      const prevSum = i > 0 ? out[i - 1].value : 0;
      const cum = mode === "cumulative" ? prevSum + raw : raw;
      out.push({ ...d, value: cum, raw });
    }
    return out;
  }, [daily, metric, mode]);

  const stats = useMemo(() => {
    if (!daily.length) return { total: 0, avg: 0, peak: null as { date: string; value: number } | null };
    const total = daily.reduce((s, d) => s + d[metric], 0);
    const avg = Math.round(total / daily.length);
    let peak = { date: daily[0].date, value: daily[0][metric] };
    for (const d of daily) {
      if (d[metric] > peak.value) peak = { date: d.date, value: d[metric] };
    }
    return { total, avg, peak };
  }, [daily, metric]);

  const hasData = series.some((s) => s.value !== 0);

  // SVG coordinate geometry
  const W = 720;
  const H = 248;
  const PAD_L = 52;
  const PAD_R = 16;
  const PAD_T = 18;
  const PAD_B = 30;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const rawMin = Math.min(0, ...series.map((s) => s.value));
  const rawMax = Math.max(1, ...series.map((s) => s.value));
  const ySpan = Math.max(1, rawMax - rawMin);
  const yOf = (v: number) => PAD_T + innerH - ((v - rawMin) / ySpan) * innerH;
  const zeroY = yOf(0);

  const slotW = series.length > 0 ? innerW / series.length : innerW;
  const xCenter = (i: number) =>
    series.length === 1
      ? PAD_L + innerW / 2
      : mode === "cumulative"
        ? PAD_L + (i / (series.length - 1)) * innerW
        : PAD_L + (i + 0.5) * slotW;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const val = rawMin + ySpan * t;
    return { val, y: yOf(val) };
  });

  const labelStep = Math.max(1, Math.ceil(series.length / 7));

  const linePath =
    series.length === 0
      ? ""
      : series
          .map((pt, i) => `${i === 0 ? "M" : "L"} ${xCenter(i).toFixed(1)} ${yOf(pt.value).toFixed(1)}`)
          .join(" ");

  const areaPath =
    series.length === 0
      ? ""
      : `${linePath} L ${xCenter(series.length - 1).toFixed(1)} ${zeroY.toFixed(1)} L ${xCenter(0).toFixed(1)} ${zeroY.toFixed(1)} Z`;

  const hovered = hoverIdx !== null ? series[hoverIdx] : null;
  const hoverPct =
    hoverIdx !== null && series.length > 0
      ? (xCenter(hoverIdx) / W) * 100
      : 50;

  return (
    <div className="relative flex flex-col rounded-2xl border border-white/[0.07] bg-[#0c0c10] p-5 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-white/[0.06] pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="inline-flex h-2 w-2 rounded-full"
              style={{ backgroundColor: meta.color, boxShadow: `0 0 10px ${meta.color}` }}
            />
            <h2 className="text-sm font-semibold tracking-tight text-zinc-100">
              {title}
            </h2>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            {mode === "daily" ? "Daily observed activity" : "Cumulative trajectory"} ·{" "}
            {series.length} {series.length === 1 ? "day" : "days"} · {timezone}
          </p>
        </div>

        {/* Mode toggle */}
        <div className="flex items-center gap-1 self-start rounded-lg border border-white/[0.07] bg-zinc-950/80 p-0.5 sm:self-auto">
          {(
            [
              ["daily", "Daily", BarChart3],
              ["cumulative", "Cumulative", TrendingUp],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                mode === id
                  ? "bg-zinc-800 text-zinc-100 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Icon size={12} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Metric selector + quick summary strip */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(METRIC_META) as ChartMetric[]).map((m) => {
            const active = metric === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMetric(m)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition ${
                  active
                    ? "border-white/20 bg-white/[0.08] text-white"
                    : "border-white/[0.06] bg-transparent text-zinc-400 hover:border-white/15 hover:text-zinc-200"
                }`}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    backgroundColor: METRIC_META[m].color,
                    opacity: active ? 1 : 0.45,
                  }}
                />
                {METRIC_META[m].label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-4 text-[11px] text-zinc-400">
          <span>
            Total{" "}
            <strong className="font-mono font-semibold text-zinc-100 tabular-nums">
              {stats.total > 0 && metric === "followerGrowth" ? "+" : ""}
              {formatCompact(stats.total)}
            </strong>
          </span>
          <span className="text-zinc-700">|</span>
          <span>
            Avg/day{" "}
            <strong className="font-mono font-semibold text-zinc-200 tabular-nums">
              {formatCompact(stats.avg)}
            </strong>
          </span>
          {stats.peak && stats.peak.value > 0 && (
            <>
              <span className="hidden text-zinc-700 sm:inline">|</span>
              <span className="hidden sm:inline">
                Peak{" "}
                <strong className="font-mono font-semibold text-zinc-200 tabular-nums">
                  {formatCompact(stats.peak.value)}
                </strong>{" "}
                <span className="text-zinc-500">({formatShortDate(stats.peak.date)})</span>
              </span>
            </>
          )}
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="relative mt-5">
        {!series.length || !hasData ? (
          <div className="flex h-[248px] flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.07] bg-zinc-950/40 text-center">
            <BarChart3 className="mb-2 h-5 w-5 text-zinc-600" />
            <p className="text-xs font-medium text-zinc-400">
              No {meta.label.toLowerCase()} recorded in this window yet
            </p>
            <p className="mt-1 text-[11px] text-zinc-600">
              Data populates automatically as hourly syncs observe account activity.
            </p>
          </div>
        ) : (
          <div
            className="relative select-none"
            onMouseLeave={() => setHoverIdx(null)}
          >
            {/* Floating Tooltip */}
            {hovered && hoverIdx !== null && (
              <div
                className="pointer-events-none absolute top-1 z-20 -translate-x-1/2 transition-all duration-75"
                style={{
                  left: `${Math.min(82, Math.max(18, hoverPct))}%`,
                }}
              >
                <div className="rounded-xl border border-white/15 bg-[#121218]/95 px-3 py-2 shadow-2xl backdrop-blur-md">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                      {formatShortDate(hovered.date)}
                      {hovered.date === currentDayDate ? " · Today" : ""}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-sm font-bold text-white tabular-nums">
                    {hovered.value > 0 && metric !== "posts" ? "+" : ""}
                    {hovered.value.toLocaleString("en-US")}{" "}
                    <span className="text-[10px] font-normal text-zinc-400">
                      {mode === "cumulative" ? `cum. ${meta.short}` : meta.short}
                    </span>
                  </p>
                  <div className="mt-1.5 flex items-center gap-3 border-t border-white/[0.07] pt-1.5 font-mono text-[10px] text-zinc-400 tabular-nums">
                    <span>{formatCompact(hovered.viewsGained)} views</span>
                    <span>{formatCompact(hovered.likesGained)} likes</span>
                    <span>{hovered.posts} posts</span>
                  </div>
                </div>
              </div>
            )}

            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="h-auto w-full overflow-visible"
              role="img"
              aria-label={`${title} ${meta.label} chart`}
            >
              <defs>
                <linearGradient id={`barGrad-${metric}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={meta.stroke} stopOpacity="0.95" />
                  <stop offset="100%" stopColor={meta.color} stopOpacity="0.28" />
                </linearGradient>
                <linearGradient id={`areaGrad-${metric}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={meta.color} stopOpacity="0.30" />
                  <stop offset="100%" stopColor={meta.color} stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Horizontal gridlines + Y labels */}
              {yTicks.map((t, i) => (
                <g key={i}>
                  <line
                    x1={PAD_L}
                    x2={W - PAD_R}
                    y1={t.y}
                    y2={t.y}
                    stroke={Math.abs(t.val) < 0.01 ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.05)"}
                    strokeDasharray={Math.abs(t.val) < 0.01 ? undefined : "3 4"}
                  />
                  <text
                    x={PAD_L - 8}
                    y={t.y + 3.5}
                    textAnchor="end"
                    fill="#71717a"
                    fontSize={10}
                    fontFamily="ui-monospace, SFMono-Regular, monospace"
                  >
                    {formatCompact(Math.round(t.val))}
                  </text>
                </g>
              ))}

              {/* Hover crosshair */}
              {hoverIdx !== null && (
                <line
                  x1={xCenter(hoverIdx)}
                  x2={xCenter(hoverIdx)}
                  y1={PAD_T}
                  y2={H - PAD_B}
                  stroke="rgba(255,255,255,0.16)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
              )}

              {/* Data Geometry */}
              {mode === "cumulative" ? (
                <>
                  <path d={areaPath} fill={`url(#areaGrad-${metric})`} />
                  <path
                    d={linePath}
                    fill="none"
                    stroke={meta.stroke}
                    strokeWidth={2.25}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {series.map((pt, i) => {
                    const isHover = hoverIdx === i;
                    return (
                      <circle
                        key={pt.date}
                        cx={xCenter(i)}
                        cy={yOf(pt.value)}
                        r={isHover ? 5 : series.length <= 14 ? 2.5 : 0}
                        fill={isHover ? "#ffffff" : meta.stroke}
                        stroke={meta.color}
                        strokeWidth={isHover ? 2.5 : 0}
                      />
                    );
                  })}
                </>
              ) : (
                series.map((pt, i) => {
                  const isHover = hoverIdx === i;
                  const barW = Math.min(26, Math.max(4, slotW * 0.62));
                  const cx = xCenter(i);
                  const valY = yOf(pt.value);
                  const barTop = Math.min(valY, zeroY);
                  const barH = Math.max(pt.value !== 0 ? 2 : 0, Math.abs(zeroY - valY));
                  return (
                    <rect
                      key={pt.date}
                      x={cx - barW / 2}
                      y={barTop}
                      width={barW}
                      height={barH}
                      rx={Math.min(4, barW / 2)}
                      fill={`url(#barGrad-${metric})`}
                      opacity={hoverIdx === null || isHover ? 1 : 0.42}
                      className="transition-opacity duration-150"
                    />
                  );
                })
              )}

              {/* X-Axis Labels */}
              {series.map((pt, i) => {
                if (i % labelStep !== 0 && i !== series.length - 1) return null;
                return (
                  <text
                    key={`x-${pt.date}`}
                    x={xCenter(i)}
                    y={H - 8}
                    textAnchor="middle"
                    fill={hoverIdx === i ? "#e4e4e7" : "#71717a"}
                    fontSize={10}
                    fontFamily="ui-monospace, SFMono-Regular, monospace"
                  >
                    {formatShortDate(pt.date)}
                  </text>
                );
              })}

              {/* Invisible interactive hit columns */}
              {series.map((pt, i) => {
                const hitW =
                  mode === "cumulative" && series.length > 1
                    ? innerW / (series.length - 1)
                    : slotW;
                return (
                  <rect
                    key={`hit-${pt.date}`}
                    x={xCenter(i) - hitW / 2}
                    y={PAD_T}
                    width={hitW}
                    height={innerH}
                    fill="transparent"
                    className="cursor-crosshair"
                    onMouseEnter={() => setHoverIdx(i)}
                    onTouchStart={() => setHoverIdx(i)}
                  />
                );
              })}
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}
