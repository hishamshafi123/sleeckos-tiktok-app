import {
  assignVideosFairRoundRobin,
  SmartExportFolderRequest,
} from "../src/lib/services/smart-export-assign";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILURE: ${message}`);
    process.exit(1);
  }
}

// Fisher-Yates, same as the service applies per group before dealing
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

console.log("🚀 Starting Smart Export fairness simulation...");

// ── Scenario: the real starvation case ──────────────────────────────────────
// 29 groups × 15 videos = 435 supply; 35 folders with mixed (color default ×
// days) counts summing to 520 — demand well above supply.
const GROUP_COUNT = 29;
const VIDEOS_PER_GROUP = 15;

const groupIds = Array.from({ length: GROUP_COUNT }, (_, g) => `group_${g + 1}`);
const videoIdsByGroup: Record<string, string[]> = {};
const videoGroup = new Map<string, string>();
for (const gId of groupIds) {
  const ids = shuffle(
    Array.from({ length: VIDEOS_PER_GROUP }, (_, v) => `${gId}_video_${v + 1}`)
  );
  videoIdsByGroup[gId] = ids;
  ids.forEach((id) => videoGroup.set(id, gId));
}
const totalSupply = groupIds.length * VIDEOS_PER_GROUP;

const folderCounts = [
  ...Array(20).fill(15),
  ...Array(10).fill(12),
  ...Array(5).fill(20),
]; // 300 + 120 + 100 = 520 requested
const folders: SmartExportFolderRequest[] = folderCounts.map((count, i) => ({
  id: `folder_${i + 1}`,
  name: `Folder ${i + 1}`,
  count,
}));
const totalDemand = folderCounts.reduce((s, c) => s + c, 0);
console.log(
  `Scenario: ${groupIds.length} groups × ${VIDEOS_PER_GROUP} videos = ${totalSupply} supply; ` +
    `${folders.length} folders requesting ${totalDemand} total`
);

const { assignments, unfulfillable } = assignVideosFairRoundRobin(
  groupIds,
  videoIdsByGroup,
  folders
);

// (a) Every folder with nonzero eligibility gets ≥ 1 video
for (const a of assignments) {
  assert(
    a.videoIds.length >= 1,
    `Folder ${a.driveFolderName} received 0 videos (starved)`
  );
}
console.log(`✅ (a) all ${assignments.length} folders received ≥ 1 video`);

// Hard rule: no folder exceeds its requested count
for (const a of assignments) {
  const requested = folderCounts[folders.findIndex((f) => f.id === a.driveFolderId)];
  assert(
    a.videoIds.length <= requested,
    `Folder ${a.driveFolderName} got ${a.videoIds.length} > requested ${requested}`
  );
}
console.log("✅ no folder exceeds its requested count");

// (b) No folder holds two videos from the same group
for (const a of assignments) {
  const seenGroups = new Set<string>();
  for (const vId of a.videoIds) {
    const gId = videoGroup.get(vId)!;
    assert(
      !seenGroups.has(gId),
      `Folder ${a.driveFolderName} holds two videos from ${gId}`
    );
    seenGroups.add(gId);
  }
}
console.log("✅ (b) no folder holds two videos from the same group");

// (c) No video assigned twice
const globalSeen = new Set<string>();
let totalAssigned = 0;
for (const a of assignments) {
  for (const vId of a.videoIds) {
    assert(!globalSeen.has(vId), `Video ${vId} assigned twice`);
    globalSeen.add(vId);
  }
  totalAssigned += a.videoIds.length;
}
console.log(`✅ (c) no video assigned twice (${totalAssigned} unique assignments)`);

// With demand > supply and enough group diversity, all supply should be placed
assert(
  totalAssigned === totalSupply,
  `Expected all ${totalSupply} videos placed, got ${totalAssigned}`
);
console.log(`✅ all ${totalSupply} supply placed (demand ${totalDemand})`);

// (d) Spread between max/min assigned is small among folders that were NOT
// capped by their own request (capped folders are satisfied by definition)
const assignedCounts = assignments.map((a) => a.videoIds.length);
const uncapped = assignments
  .filter((a, i) => a.videoIds.length < folderCounts[i])
  .map((a) => a.videoIds.length);
const minAll = Math.min(...assignedCounts);
const maxAll = Math.max(...assignedCounts);
const spreadUncapped =
  uncapped.length > 0 ? Math.max(...uncapped) - Math.min(...uncapped) : 0;
console.log(
  `Distribution: min=${minAll} max=${maxAll} (overall); ` +
    `spread among uncapped folders=${spreadUncapped} (${uncapped.length} uncapped)`
);
assert(
  spreadUncapped <= 2,
  `Spread among uncapped folders too large: ${spreadUncapped}`
);
console.log("✅ (d) near-equal distribution across uncapped folders");

// Unfulfillable reporting: partial folders are listed with their partial counts
const unfulfillableById = new Map(unfulfillable.map((u) => [u.driveFolderId, u]));
for (const a of assignments) {
  const requested = folderCounts[folders.findIndex((f) => f.id === a.driveFolderId)];
  const u = unfulfillableById.get(a.driveFolderId);
  if (a.videoIds.length < requested) {
    assert(!!u, `Partial folder ${a.driveFolderName} missing from unfulfillable`);
    assert(
      u!.assignedCount === a.videoIds.length,
      `Unfulfillable assignedCount mismatch for ${a.driveFolderName}`
    );
  } else {
    assert(!u, `Fully satisfied folder ${a.driveFolderName} listed as unfulfillable`);
  }
}
console.log(
  `✅ unfulfillable lists all ${unfulfillable.length} partial folders with correct counts`
);

// ── Comparison: the OLD greedy algorithm on the same scenario ───────────────
// (folders sorted by count desc, each filled completely before the next)
const remaining = { ...videoIdsByGroup };
const sortedFolders = [...folders].sort((a, b) => b.count - a.count);
let oldStarved = 0;
for (const folder of sortedFolders) {
  const usedGroups = new Set<string>();
  let got = 0;
  for (let step = 0; step < folder.count; step++) {
    const candidates = groupIds.filter(
      (gId) => !usedGroups.has(gId) && remaining[gId].length > 0
    );
    if (candidates.length === 0) break;
    candidates.sort((a, b) => remaining[b].length - remaining[a].length);
    remaining[candidates[0]].pop();
    usedGroups.add(candidates[0]);
    got++;
  }
  if (got === 0) oldStarved++;
}
console.log(
  `\nOld greedy algorithm on same input: ${oldStarved}/${folders.length} folders would have received ZERO videos`
);
console.log("New fair round-robin: 0 folders starved 🎉");
