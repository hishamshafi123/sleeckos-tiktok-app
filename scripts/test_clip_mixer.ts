import { calculateRecipeFingerprint, VideoRecipe } from "../src/lib/services/clip-mixer";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILURE: ${message}`);
    process.exit(1);
  }
}

console.log("🚀 Starting Clip Mixer Unit Tests...");

// Test Case 1: Uniqueness Fingerprint Calculations
console.log("\nRunning Test Case 1: Recipe fingerprinting checks...");
const baseRecipe: VideoRecipe = {
  clipSlices: [
    { clipId: "clip_A", start: 1.0, duration: 4.0 },
    { clipId: "clip_B", start: 0.5, duration: 3.5 },
  ],
  trackId: "track_X",
  trackStart: 0.0,
  muteAudio: false,
  templateId: "template_1",
};

const identicalRecipe: VideoRecipe = {
  clipSlices: [
    { clipId: "clip_A", start: 1.0, duration: 4.0 },
    { clipId: "clip_B", start: 0.5, duration: 3.5 },
  ],
  trackId: "track_X",
  trackStart: 0.0,
  muteAudio: false,
  templateId: "template_1",
};

const differentRecipe: VideoRecipe = {
  clipSlices: [
    { clipId: "clip_A", start: 1.1, duration: 4.0 }, // slightly different start
    { clipId: "clip_B", start: 0.5, duration: 3.5 },
  ],
  trackId: "track_X",
  trackStart: 0.0,
  muteAudio: false,
  templateId: "template_1",
};

const hash1 = calculateRecipeFingerprint(baseRecipe);
const hash2 = calculateRecipeFingerprint(identicalRecipe);
const hash3 = calculateRecipeFingerprint(differentRecipe);

console.log(`Hash 1: ${hash1}`);
console.log(`Hash 2: ${hash2}`);
console.log(`Hash 3: ${hash3}`);

assert(hash1 === hash2, "Identical recipes must produce matching fingerprints.");
assert(hash1 !== hash3, "Different trim start coordinates must produce different fingerprints.");
console.log("✅ Test Case 1 passed!");

// Test Case 2: Simulating recipe shuffling & unique constraints checks
console.log("\nRunning Test Case 2: Shuffling uniqueness logic simulation...");

const dummyClips = [
  { id: "clip_1", duration: 10.0 },
  { id: "clip_2", duration: 12.0 },
  { id: "clip_3", duration: 8.0 },
  { id: "clip_4", duration: 9.0 },
  { id: "clip_5", duration: 11.0 },
];

// Simple simulate logic mimicking generateRecipesForBatch to test uniqueness constraints
function simulateGenerateRecipes(opts: {
  clipsCount: number;
  videosCount: number;
  targetDuration: number;
  variationStrength: number;
}) {
  const generatedHashes = new Set<string>();
  const localClips = dummyClips.slice(0, opts.clipsCount);
  
  if (localClips.length === 0) {
    throw new Error("No clips available.");
  }
  
  for (let i = 0; i < opts.videosCount; i++) {
    let attempts = 0;
    while (attempts < 100) {
      // Simulate shuffle & trim
      const selected = [...localClips].sort(() => Math.random() - 0.5);
      if (selected.length === 0) throw new Error("No clips chosen.");
      
      const recipe: VideoRecipe = {
        clipSlices: selected.map(c => ({
          clipId: c.id,
          start: opts.variationStrength === 1 ? 0 : Math.random() * (c.duration - 3.0),
          duration: opts.variationStrength === 1 ? 3.0 : 3.0 + Math.random(),
        })),
        trackId: "track_1",
        trackStart: 0.0,
        muteAudio: false,
        templateId: "template_1",
      };
      
      const hash = calculateRecipeFingerprint(recipe);
      if (!generatedHashes.has(hash)) {
        generatedHashes.add(hash);
        break;
      }
      attempts++;
    }
    if (attempts >= 100) {
      throw new Error("Duplicate recipes generated due to insufficient clips.");
    }
  }
  return generatedHashes.size;
}

const uniqueCount = simulateGenerateRecipes({
  clipsCount: 5,
  videosCount: 8,
  targetDuration: 10.0,
  variationStrength: 3,
});

console.log(`Generated ${uniqueCount} unique video recipe hashes successfully.`);
assert(uniqueCount === 8, "Expected 8 unique videos hashes.");
console.log("✅ Test Case 2 passed!");

// Test Case 3: Folder scarcity warnings
console.log("\nRunning Test Case 3: Insufficient folder assets warnings...");
let warned = false;
try {
  // Try generating 50 videos from a set of clips that cannot support that many unique slice permutations
  // This triggers an error
  simulateGenerateRecipes({
    clipsCount: 1, // only 1 clip, cannot make 50 unique videos
    videosCount: 50,
    targetDuration: 10.0,
    variationStrength: 1, // low strength, fixed trims
  });
} catch (e: any) {
  warned = true;
  console.log("Expected warning/error caught successfully:", e.message);
}
assert(warned, "Expected an error to be thrown due to folder asset scarcity.");
console.log("✅ Test Case 3 passed!");

console.log("\n🎉 All Clip Mixer unit tests passed successfully!");
process.exit(0);
