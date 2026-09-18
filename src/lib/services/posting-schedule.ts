/**
 * Shared posting-schedule helpers used by the post-scheduler cron and the
 * daily posting digest. Slot times live on the account as CSV "HH:MM" in the
 * account's own timezone; a deterministic per-(account, slot, day) jitter of
 * ±30 min decides when the slot actually becomes due.
 */

export function dayNumber(date: Date): string {
  const d = date.getDay();
  return d === 0 ? "7" : d.toString();
}

export function parseSlot(slot: string): number {
  const [h, m] = slot.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function getDeterministicJitter(accountId: string, slot: string, dateStr: string): number {
  const seedStr = `${accountId}-${slot}-${dateStr}`;
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    const char = seedStr.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  const val = Math.abs(hash) % 61; // 0 to 60
  return val - 30; // -30 to +30
}

export function accountSlots(account: {
  postTimeSlots: string;
  postTimeHour: number;
  postTimeMinute: number;
}): string[] {
  const raw = account.postTimeSlots || "";
  return raw.trim().length > 0
    ? raw.split(",").map((s) => s.trim())
    : [
        `${account.postTimeHour.toString().padStart(2, "0")}:${account.postTimeMinute
          .toString()
          .padStart(2, "0")}`,
      ];
}

/** Slots whose jittered time is at or before currentMinutes on dateStr. */
export function dueSlotsFor(
  accountId: string,
  slots: string[],
  dateStr: string,
  currentMinutes: number
): string[] {
  return slots.filter(
    (s) => parseSlot(s) + getDeterministicJitter(accountId, s, dateStr) <= currentMinutes
  );
}
