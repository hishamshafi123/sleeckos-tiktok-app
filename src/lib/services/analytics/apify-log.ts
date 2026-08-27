/**
 * Apify call ledger — fire-and-forget writes to ApifyCallLog. Called from the
 * Apify provider (the single chokepoint for Apify traffic) after every actor
 * call. Logging must NEVER break the caller: every failure is swallowed with
 * a console warning.
 */

import prisma from "@/lib/db";

export interface ApifyCallLogEntry {
  source: string; // sweep | refresh | spot_check | recover | capture
  inputType: "account" | "urls";
  inputSummary: string; // handle or first URL
  inputCount: number;
  resultCount: number;
  apifyRunId: string | null;
  actorId: string | null;
  durationMs: number | null;
  usageUsd: number | null; // usageTotalUsd reported by the Apify run object
  chargedEventCounts: Record<string, number> | null;
  status: "ok" | "error";
  errorKind: string | null;
}

export async function logApifyCall(entry: ApifyCallLogEntry): Promise<void> {
  try {
    await prisma.apifyCallLog.create({
      data: {
        source: entry.source,
        inputType: entry.inputType,
        inputSummary: entry.inputSummary.slice(0, 200),
        inputCount: entry.inputCount,
        resultCount: entry.resultCount,
        apifyRunId: entry.apifyRunId,
        actorId: entry.actorId,
        durationMs: entry.durationMs,
        usageUsd: entry.usageUsd,
        chargedEventCounts: entry.chargedEventCounts ?? undefined,
        status: entry.status,
        errorKind: entry.errorKind,
      },
    });
  } catch (err: any) {
    console.warn(`[Apify] Failed to write call log: ${err?.message || err}`);
  }
}
