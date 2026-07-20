// Pure Smart Export assignment algorithm (no DB/Drive dependencies).
// Kept in its own module so it can be unit-tested in isolation.

export interface SmartExportFolderRequest {
  id: string;
  name: string;
  count: number; // requested videos (already scaled by export days)
}

export interface SmartExportAssignmentResult {
  driveFolderId: string;
  driveFolderName: string;
  videoIds: string[];
}

export interface SmartExportUnfulfillable {
  driveFolderId: string;
  driveFolderName: string;
  requestedCount: number;
  assignedCount: number;
  reason: string;
}

/**
 * Fair round-robin dealing of group videos across folders.
 *
 * Iterates over groups; for each group, deals its (pre-shuffled) videos one at a
 * time to the eligible folder with the FEWEST already-assigned videos.
 * Eligible = folder hasn't reached its requested count AND doesn't already hold
 * a video from that group. This yields a near-equal spread across folders while
 * preserving both hard rules (≤1 video per group per folder, count ≤ requested).
 * Folders that can't be fully satisfied keep their partial videos and are
 * reported in `unfulfillable` with their partial assignedCount.
 */
export function assignVideosFairRoundRobin(
  groupIds: string[],
  videoIdsByGroup: Record<string, string[]>,
  folders: SmartExportFolderRequest[]
): {
  assignments: SmartExportAssignmentResult[];
  unfulfillable: SmartExportUnfulfillable[];
} {
  const state = folders.map((folder) => ({
    folder,
    videoIds: [] as string[],
    usedGroupIds: new Set<string>(),
  }));

  for (const groupId of groupIds) {
    const videoIds = videoIdsByGroup[groupId] || [];
    for (const videoId of videoIds) {
      // Pick the eligible folder with the fewest assigned videos
      // (linear scan keeps input order as deterministic tie-break).
      let target: (typeof state)[number] | null = null;
      for (const s of state) {
        if (s.videoIds.length >= s.folder.count) continue;
        if (s.usedGroupIds.has(groupId)) continue;
        if (!target || s.videoIds.length < target.videoIds.length) {
          target = s;
        }
      }
      // No eligible folder left for this group — remaining videos stay unassigned.
      if (!target) break;
      target.videoIds.push(videoId);
      target.usedGroupIds.add(groupId);
    }
  }

  const assignments: SmartExportAssignmentResult[] = state.map((s) => ({
    driveFolderId: s.folder.id,
    driveFolderName: s.folder.name,
    videoIds: s.videoIds,
  }));

  const unfulfillable: SmartExportUnfulfillable[] = state
    .filter((s) => s.videoIds.length < s.folder.count)
    .map((s) => ({
      driveFolderId: s.folder.id,
      driveFolderName: s.folder.name,
      requestedCount: s.folder.count,
      assignedCount: s.videoIds.length,
      reason: `requested ${s.folder.count}, only ${s.videoIds.length} available after fair distribution`,
    }));

  return { assignments, unfulfillable };
}
