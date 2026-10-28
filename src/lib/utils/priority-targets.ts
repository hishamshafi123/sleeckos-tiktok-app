export type PriorityWeightEntry = {
  id: string;
  status: string;
  priorityRank: number;
};

function compareEntries(a: PriorityWeightEntry, b: PriorityWeightEntry): number {
  if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

export function computePriorityWeights<T extends PriorityWeightEntry>(
  entries: T[]
): Map<string, number> {
  const active = entries
    .filter((entry) => entry.status === "ACTIVE")
    .sort(compareEntries);
  const weightById = new Map<string, number>();
  active.forEach((entry, index) => {
    weightById.set(entry.id, active.length - index);
  });
  return new Map(entries.map((entry) => [entry.id, weightById.get(entry.id) ?? 0]));
}

export function allocatePriorityTargets<T extends PriorityWeightEntry>(
  entries: T[],
  totalPosts: number
): Map<string, number> {
  if (!Number.isSafeInteger(totalPosts) || totalPosts <= 0) {
    throw new RangeError("totalPosts must be a positive safe integer");
  }

  const active = entries
    .filter((entry) => entry.status === "ACTIVE")
    .sort(compareEntries);
  if (active.length === 0) {
    throw new RangeError("At least one ACTIVE campaign is required");
  }

  const weights = computePriorityWeights(entries);
  const totalWeight = active.reduce(
    (sum, entry) => sum + BigInt(weights.get(entry.id) ?? 0),
    BigInt(0)
  );
  const total = BigInt(totalPosts);
  const allocationById = new Map<string, number>(
    entries.map((entry) => [entry.id, 0])
  );
  const remainders: Array<{ entry: T; remainder: bigint }> = [];
  let allocated = 0;

  for (const entry of active) {
    const numerator = total * BigInt(weights.get(entry.id) ?? 0);
    const base = Number(numerator / totalWeight);
    allocationById.set(entry.id, base);
    allocated += base;
    remainders.push({ entry, remainder: numerator % totalWeight });
  }

  remainders.sort((a, b) => {
    if (a.remainder !== b.remainder) {
      return a.remainder > b.remainder ? -1 : 1;
    }
    return compareEntries(a.entry, b.entry);
  });
  for (let index = 0; index < totalPosts - allocated; index++) {
    const id = remainders[index].entry.id;
    allocationById.set(id, (allocationById.get(id) ?? 0) + 1);
  }

  return allocationById;
}
