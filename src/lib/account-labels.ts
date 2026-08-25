/**
 * Shared account-label palette. `AccountLabel.color` in the DB stores one of
 * these KEYS (not a hex) so server validation and the UI stay in sync.
 * Classes are written out in full so Tailwind's scanner sees them.
 */

export const LABEL_COLORS = {
  red: {
    badge: "bg-red-500/10 border-red-500/30 text-red-400",
    dot: "bg-red-500",
  },
  orange: {
    badge: "bg-orange-500/10 border-orange-500/30 text-orange-400",
    dot: "bg-orange-500",
  },
  amber: {
    badge: "bg-amber-500/10 border-amber-500/30 text-amber-400",
    dot: "bg-amber-500",
  },
  green: {
    badge: "bg-green-500/10 border-green-500/30 text-green-400",
    dot: "bg-green-500",
  },
  teal: {
    badge: "bg-teal-500/10 border-teal-500/30 text-teal-400",
    dot: "bg-teal-500",
  },
  blue: {
    badge: "bg-blue-500/10 border-blue-500/30 text-blue-400",
    dot: "bg-blue-500",
  },
  purple: {
    badge: "bg-purple-500/10 border-purple-500/30 text-purple-400",
    dot: "bg-purple-500",
  },
  zinc: {
    badge: "bg-zinc-500/10 border-zinc-500/30 text-zinc-400",
    dot: "bg-zinc-500",
  },
} as const;

export type LabelColorKey = keyof typeof LABEL_COLORS;

export const LABEL_COLOR_KEYS = Object.keys(LABEL_COLORS) as LabelColorKey[];

export function isLabelColorKey(value: unknown): value is LabelColorKey {
  return typeof value === "string" && value in LABEL_COLORS;
}

/** Badge classes for a stored color key; unknown keys fall back to zinc. */
export function labelBadgeClass(color: string): string {
  return (isLabelColorKey(color) ? LABEL_COLORS[color] : LABEL_COLORS.zinc).badge;
}
