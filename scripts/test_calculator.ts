import { calculateProjection } from "../src/lib/services/campaigns";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILURE: ${message}`);
    process.exit(1);
  }
}

console.log("🚀 Starting View-Goal Calculator Unit Tests...");

// Test Case 1: The 3,000,000-view projection scenario
console.log("\nRunning Test Case 1: 3,000,000-view projection example...");
const tc1 = calculateProjection({
  targetViews: 3000000,
  accountsCount: 5,
  avgViewsPerVideo: 15000,
  videosPerAccountPerDay: 2,
});

console.log("Outputs:", tc1);
assert(tc1.totalVideosNeeded === 200, `Expected totalVideosNeeded to be 200, got ${tc1.totalVideosNeeded}`);
assert(tc1.videosPerDay === 10, `Expected videosPerDay to be 10, got ${tc1.videosPerDay}`);
assert(tc1.viewsPerDay === 150000, `Expected viewsPerDay to be 150,000, got ${tc1.viewsPerDay}`);
assert(tc1.daysToGoal === 20, `Expected daysToGoal to be 20, got ${tc1.daysToGoal}`);
assert(tc1.warning === false, `Expected warning to be false, got ${tc1.warning}`);
console.log("✅ Test Case 1 passed!");

// Test Case 2: Posting frequency threshold warning
console.log("\nRunning Test Case 2: Shadowban warning threshold (videosPerAccountPerDay > 3)...");
const tc2 = calculateProjection({
  targetViews: 100000,
  accountsCount: 2,
  avgViewsPerVideo: 5000,
  videosPerAccountPerDay: 4, // > 3
});

console.log("Outputs:", tc2);
assert(tc2.warning === true, `Expected warning to be true, got ${tc2.warning}`);
console.log("✅ Test Case 2 passed!");

// Test Case 3: Division-by-zero & negative checks
console.log("\nRunning Test Case 3: Zero or negative inputs...");
const tc3_zero = calculateProjection({
  targetViews: 0,
  accountsCount: 5,
  avgViewsPerVideo: 15000,
  videosPerAccountPerDay: 2,
});
assert(tc3_zero.daysToGoal === 0 && tc3_zero.totalVideosNeeded === 0, "Zero targetViews should return zeros safely.");

const tc3_negative = calculateProjection({
  targetViews: 3000000,
  accountsCount: -5,
  avgViewsPerVideo: 15000,
  videosPerAccountPerDay: 2,
});
assert(tc3_negative.daysToGoal === 0 && tc3_negative.videosPerDay === 0, "Negative accountsCount should return zeros safely.");

const tc3_zero_views = calculateProjection({
  targetViews: 3000000,
  accountsCount: 5,
  avgViewsPerVideo: 0,
  videosPerAccountPerDay: 2,
});
assert(tc3_zero_views.daysToGoal === 0 && tc3_zero_views.totalVideosNeeded === 0, "Zero avgViewsPerVideo should return zeros safely.");

console.log("✅ Test Case 3 passed!");

console.log("\n🎉 All View-Goal Calculator unit tests passed successfully!");
process.exit(0);
