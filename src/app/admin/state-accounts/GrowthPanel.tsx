"use client";
import { useState } from "react";
import {
  stateTrajectory,
  type TrajectoryDay,
} from "@/lib/services/state-accounts/trajectory";
const fmt = (n: number | null) =>
  n === null ? "Not enough data" : Math.round(n).toLocaleString("en-US");
export default function GrowthPanel({
  days,
  accounts,
  todayId,
  team,
  name,
}: {
  days: TrajectoryDay[];
  accounts: { accountId: string; createdAt: string }[];
  todayId: string;
  team: string;
  name: string;
}) {
  const result = stateTrajectory(days, accounts, todayId, team);
  const [hover, setHover] = useState<number | null>(null);
  if (!result) return null;
  const { recentAvg, priorAvg, growth, next7, next30 } = result;
  const max = Math.max(1, next30?.high || 0);
  const x = (day: number) => 65 + (day / 30) * 605;
  const y = (views: number) => 170 - (views / max) * 145;
  const at = (day: number, factor = 1) => (recentAvg || 0) * day * factor;
  return (
    <section
      aria-label={`${name} growth and outlook`}
      className="mt-6 border-t border-zinc-800 pt-5"
    >
      <h3 className="font-medium">{name}: growth & outlook</h3>
      <div className="my-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-xs text-zinc-400">Today so far</p>
          <p className="mt-1 text-xl font-semibold">{fmt(result.todayViews)}</p>
          <p className="text-xs text-zinc-500">Views gained · partial day</p>
        </div>
        <div>
          <p className="text-xs text-zinc-400">Last 7 days average</p>
          <p className="mt-1 text-xl font-semibold">{fmt(recentAvg)}</p>
          <p className="text-xs text-zinc-500">
            Views/day · {result.recentDays}/7 usable days
          </p>
        </div>
        <div>
          <p className="text-xs text-zinc-400">Previous 7 days average</p>
          <p className="mt-1 text-xl font-semibold">{fmt(priorAvg)}</p>
          <p className="text-xs text-zinc-500">
            Views/day · {result.priorDays}/7 usable days
          </p>
        </div>
        <div>
          <p className="text-xs text-zinc-400">Week-over-week growth</p>
          <p
            className={`mt-1 text-xl font-semibold ${growth !== null && growth < 0 ? "text-amber-300" : "text-teal-300"}`}
          >
            {growth === null
              ? "Not comparable yet"
              : `${growth >= 0 ? "+" : ""}${(growth * 100).toFixed(1)}%`}
          </p>
          <p className="text-xs text-zinc-500">Change in average daily views</p>
        </div>
      </div>
      {!next7 || !next30 ? (
        <p className="rounded border border-zinc-800 p-4 text-sm text-zinc-400">
          {!result.stable
            ? "The account mix changed during the last week. Projections resume when the comparison uses the same accounts."
            : `Building the forecast: ${result.recentDays} of at least 3 usable completed days collected in the last 7 days.`}{" "}
          Today, onboarding days, missing data, and days without a sync near
          day-end are excluded.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-12 gap-y-4">
            {[next7, next30].map((p) => (
              <div key={p.horizon}>
                <p className="text-sm text-zinc-400">Next {p.horizon} days</p>
                <p className="mt-1 text-2xl font-semibold">
                  {fmt(p.expected)}{" "}
                  <span className="text-sm font-normal text-zinc-400">
                    additional views
                  </span>
                </p>
                <p className="text-xs text-zinc-500">
                  Lower / upper scenario: {fmt(p.low)}–{fmt(p.high)}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-4 overflow-x-auto">
            <svg
              viewBox="0 0 700 215"
              className="w-full min-w-[500px]"
              role="group"
              aria-label="Projected cumulative additional views over the next 30 days"
            >
              {[0, 0.5, 1].map((f) => (
                <g key={f}>
                  <line
                    x1={65}
                    x2={670}
                    y1={y(max * f)}
                    y2={y(max * f)}
                    stroke="#27272a"
                  />
                  <text
                    x={58}
                    y={y(max * f) + 4}
                    fill="#a1a1aa"
                    textAnchor="end"
                    fontSize={10}
                  >
                    {Intl.NumberFormat("en", { notation: "compact" }).format(
                      max * f,
                    )}
                  </text>
                </g>
              ))}
              <polygon
                points={`${x(0)},${y(0)} ${x(30)},${y(at(30, 1.3))} ${x(30)},${y(at(30, 0.7))}`}
                fill="#60a5fa"
                opacity={0.12}
              />
              <line
                x1={x(0)}
                y1={y(0)}
                x2={x(30)}
                y2={y(at(30))}
                stroke="#60a5fa"
                strokeWidth={2}
                strokeDasharray="6 4"
              />
              {[0, 7, 14, 21, 30].map((day) => (
                <g key={day}>
                  <text
                    x={x(day)}
                    y={195}
                    textAnchor="middle"
                    fill="#a1a1aa"
                    fontSize={11}
                  >
                    {day === 0 ? "Forecast start" : `+${day} days`}
                  </text>
                  <circle cx={x(day)} cy={y(at(day))} r={5} fill="#60a5fa" />
                </g>
              ))}
              {Array.from({ length: 30 }, (_, i) => i + 1).map((day) => (
                <rect
                  key={day}
                  x={x(day) - 10}
                  y={15}
                  width={20}
                  height={160}
                  fill="transparent"
                  tabIndex={0}
                  role="img"
                  aria-label={`Next ${day} days: ${fmt(at(day))} additional views; lower ${fmt(at(day, 0.7))}, upper ${fmt(at(day, 1.3))}`}
                  onPointerEnter={() => setHover(day)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(day)}
                  onBlur={() => setHover(null)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setHover(null);
                  }}
                  className="focus:stroke-blue-300 focus:outline-none"
                />
              ))}
            </svg>
          </div>
          <p className="min-h-5 text-xs text-blue-200" aria-live="polite">
            {hover === null
              ? "Hover or focus on the forecast to see exact projected totals."
              : `Next ${hover} days: ${fmt(at(hover))} additional views (lower ${fmt(at(hover, 0.7))}, upper ${fmt(at(hover, 1.3))}).`}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500">
            Trend estimate using the last 7 days’ usable daily average,
            excluding today. Lower and upper scenarios are 30% below and above
            that pace, not statistical confidence limits. Assumes a similar
            posting pace and account mix; it does not predict viral spikes.
          </p>
        </>
      )}
      <p className="mt-3 text-xs text-zinc-500">
        Growth requires at least 3 usable days in each week, a nonzero previous
        average, and the same accounts. Views are attributed to the day they
        were observed by the sync.
      </p>
    </section>
  );
}
