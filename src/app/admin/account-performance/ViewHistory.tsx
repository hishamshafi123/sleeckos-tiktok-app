"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type {
  AccountViewHistory,
  AccountViewMonth,
} from "@/lib/services/analytics/account-view-history";

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const full = (value: number) => value.toLocaleString("en-US");
const monthDate = (month: string) => new Date(`${month}-01T00:00:00Z`);
const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(monthDate(month));

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-[#27272a] bg-[#09090b] p-4">
      <p className="text-[11px] text-zinc-500">{label}</p>
      <p
        className="mt-1 text-2xl font-semibold tabular-nums text-white"
        title={full(value)}
      >
        {full(value)}
      </p>
      <p className="mt-1 text-[11px] text-zinc-500">{detail}</p>
    </div>
  );
}

function MonthBreakdown({ month }: { month: AccountViewMonth }) {
  return (
    <div className="mt-4 rounded-lg border border-[#27272a] bg-zinc-950/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-zinc-200">
          {monthLabel(month.month)} by account
        </h3>
        <span className="text-xs tabular-nums text-zinc-400">
          {full(month.views)} views
        </span>
      </div>
      {month.accounts.length ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[#27272a] text-[11px] text-zinc-500">
              <tr>
                <th className="py-2 pr-4 font-medium">Account</th>
                <th className="py-2 pr-4 font-medium">Views gained</th>
                <th className="py-2 text-right font-medium">Share of month</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1c1c21]">
              {month.accounts.map((account) => (
                <tr key={account.accountId}>
                  <td className="py-2.5 pr-4">
                    <span className="text-zinc-200">
                      @{account.accountName.replace(/^@/, "")}
                    </span>
                    {account.archived && (
                      <span className="ml-2 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-500">
                        Former account
                      </span>
                    )}
                    {account.driveFolderName && (
                      <span className="ml-2 text-[10px] text-zinc-600">
                        {account.driveFolderName}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 tabular-nums text-zinc-300">
                    {full(account.views)}
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-zinc-500">
                    {month.views > 0
                      ? `${((account.views / month.views) * 100).toFixed(1)}%`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-xs text-zinc-500">
          No views were gained in the saved statistics for this month.
        </p>
      )}
    </div>
  );
}

export default function ViewHistory({ data }: { data: AccountViewHistory }) {
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const max = Math.max(1, ...data.months.map((month) => month.views));
  const expanded = data.months.find((month) => month.month === expandedMonth);
  const monthChange = data.monthOverMonth;
  const trackingDate = data.trackingSince
    ? new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: data.timezone,
      }).format(new Date(data.trackingSince))
    : null;

  return (
    <section
      className="rounded-lg border border-[#27272a] p-5"
      aria-labelledby="view-history-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="view-history-heading"
            className="text-sm font-semibold text-zinc-200"
          >
            Views since tracking began
          </h2>
          <p className="mt-1 text-[11px] text-zinc-500">
            Saved Account Performance gains across active and former accounts ·{" "}
            {data.timezone}
          </p>
        </div>
        <span className="text-[11px] text-zinc-500">
          {data.activeAccounts} active · {data.archivedAccounts} former
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="All-time tracked views"
          value={data.lifetimeViews}
          detail={
            trackingDate
              ? `Statistics recorded since ${trackingDate}`
              : "No daily statistics yet"
          }
        />
        <SummaryCard
          label={monthLabel(data.currentMonth)}
          value={data.thisMonthViews}
          detail="Current month · partial"
        />
        <SummaryCard
          label="Previous month"
          value={data.previousMonthViews}
          detail={
            monthChange === null
              ? "No prior-month baseline"
              : `${monthChange >= 0 ? "+" : ""}${Math.round(monthChange * 100)}% month over month`
          }
        />
      </div>

      {data.months.length ? (
        <div className="mt-6 overflow-x-auto pb-1">
          <div
            className="flex h-56 w-full items-stretch gap-1"
            style={{ minWidth: Math.max(640, data.months.length * 76) }}
          >
            {data.months.map((month) => {
              const height =
                month.views > 0 ? Math.max(4, (month.views / max) * 100) : 0;
              const isExpanded = expandedMonth === month.month;
              return (
                <button
                  key={month.month}
                  type="button"
                  disabled={month.noData}
                  onClick={() =>
                    setExpandedMonth(isExpanded ? null : month.month)
                  }
                  aria-expanded={month.noData ? undefined : isExpanded}
                  aria-label={`${monthLabel(month.month)}: ${month.noData ? "no saved statistics" : `${full(month.views)} views gained`}`}
                  title={
                    month.noData
                      ? "No saved statistics"
                      : `${full(month.views)} views gained`
                  }
                  className="group flex min-w-16 flex-1 flex-col justify-end rounded-md px-1 py-2 text-center hover:bg-zinc-900/70 disabled:cursor-not-allowed"
                >
                  <span className="mb-1 text-[10px] tabular-nums text-zinc-400 group-hover:text-zinc-200">
                    {month.noData ? "No data" : compact.format(month.views)}
                  </span>
                  <span className="flex h-32 w-full items-end justify-center border-b border-zinc-700">
                    <span
                      className={`w-8 rounded-t transition-colors ${
                        month.noData
                          ? "h-px border-t border-dashed border-zinc-700"
                          : isExpanded
                            ? "bg-blue-400"
                            : "bg-blue-500/70 group-hover:bg-blue-400"
                      }`}
                      style={
                        month.noData ? undefined : { height: `${height}%` }
                      }
                    />
                  </span>
                  <span className="mt-2 text-[10px] text-zinc-500">
                    {new Intl.DateTimeFormat("en", {
                      month: "short",
                      timeZone: "UTC",
                    }).format(monthDate(month.month))}
                  </span>
                  <span className="text-[9px] text-zinc-600">
                    {month.partial ? "Partial" : month.month.slice(0, 4)}
                  </span>
                  {!month.noData && (
                    <span className="mx-auto mt-1 text-zinc-600 group-hover:text-zinc-400">
                      {isExpanded ? (
                        <ChevronDown size={11} />
                      ) : (
                        <ChevronRight size={11} />
                      )}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mt-5 rounded-lg border border-dashed border-[#27272a] px-4 py-8 text-center text-xs text-zinc-500">
          Monthly totals appear after Account Performance records daily
          statistics.
        </div>
      )}

      {expanded && <MonthBreakdown month={expanded} />}
      <p className="mt-4 text-[11px] text-zinc-600">
        Select a month for account contributions. Gaps are marked “No data”
        rather than zero; only the current month is partial.
      </p>
    </section>
  );
}
