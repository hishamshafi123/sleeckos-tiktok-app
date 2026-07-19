/**
 * Performs a natural (numeric-aware) comparison of two strings.
 * For example, "POL ACC 2" will come before "POL ACC 10".
 */
export function naturalCompare(a: string, b: string): number {
  const regex = /(\d+)|(\D+)/g;
  const aParts = String(a).match(regex) || [];
  const bParts = String(b).match(regex) || [];

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    if (aParts[i] === undefined) return -1;
    if (bParts[i] === undefined) return 1;

    const aIsNum = !isNaN(Number(aParts[i]));
    const bIsNum = !isNaN(Number(bParts[i]));

    if (aIsNum && bIsNum) {
      const diff = Number(aParts[i]) - Number(bParts[i]);
      if (diff !== 0) return diff;
    } else {
      const diff = aParts[i].localeCompare(bParts[i], undefined, { sensitivity: "base" });
      if (diff !== 0) return diff;
    }
  }
  return 0;
}
