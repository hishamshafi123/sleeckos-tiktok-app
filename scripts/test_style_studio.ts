import fs from "fs";
import path from "path";

// Load local .env file
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  envContent.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
      const index = trimmed.indexOf("=");
      const key = trimmed.substring(0, index).trim();
      let val = trimmed.substring(index + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.substring(1, val.length - 1);
      }
      if (key) {
        process.env[key] = val;
      }
    }
  });
}

console.log("DATABASE_URL is:", process.env.DATABASE_URL);

import { prisma } from "../src/lib/db";
import { 
  seedDefaultStyleTemplates, 
  getStyleTemplates, 
  createSavedStyle, 
  queueRenderJob,
  getSavedStyles,
  deleteSavedStyle
} from "../src/lib/services/style-studio";

async function waitMs(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log("🚀 Starting Style Studio & Remotion Integration Tests...");

  // 1. Seeding and Templates check
  console.log("\nRunning test 1: Seeding templates...");
  await seedDefaultStyleTemplates();
  const templates = await getStyleTemplates();
  console.log(`Found ${templates.length} templates in database.`);
  if (templates.length < 3) {
    throw new Error("Missing seeded default templates!");
  }
  console.log("✅ Seeding test passed!");

  // 2. Saved style creation
  console.log("\nRunning test 2: Saving a style preset...");
  const tpl = templates.find(t => t.key === "brat");
  if (!tpl) throw new Error("Brat template not found");

  const testStyle = await createSavedStyle({
    templateKey: tpl.key,
    name: "__TEST_STYLE_PRESET__",
    params: {
      text: "hello test",
      textColor: "#ff0000",
      bgColor: "#000000",
      fontSize: 80,
      blur: 1,
      isItalic: true,
      isBold: true
    },
    createdBy: "test-user-id"
  });
  console.log(`Created test style preset with ID: ${testStyle.id}`);
  
  // Verify it exists in saved list
  const savedList = await getSavedStyles();
  const found = savedList.find(s => s.id === testStyle.id);
  if (!found) {
    throw new Error("Created style preset not found in database!");
  }
  console.log("✅ Preset saving test passed!");

  // 3. Queue and Render Job Execution
  console.log("\nRunning test 3: Queueing render job and verifying Remotion worker compilation...");
  const job = await queueRenderJob(testStyle.id, {});
  console.log(`Queued job ID: ${job.id}`);

  console.log("Waiting for background worker to render...");
  let attempts = 0;
  let finishedJob = null;
  
  while (attempts < 60) {
    finishedJob = await prisma.styleRenderJob.findUnique({
      where: { id: job.id }
    });
    
    if (finishedJob && (finishedJob.status === "COMPLETED" || finishedJob.status === "FAILED")) {
      break;
    }
    
    await waitMs(2000);
    attempts++;
  }

  if (!finishedJob) {
    throw new Error("Job rendering timeout!");
  }

  console.log(`Finished job status: ${finishedJob.status}`);
  if (finishedJob.status === "FAILED") {
    throw new Error(`Rendering failed with error: ${finishedJob.error}`);
  }

  // Check if output file was created
  const localFilePath = path.join(process.cwd(), "public", finishedJob.outputUrl || "");
  console.log(`Checking output file at: ${localFilePath}`);
  if (!fs.existsSync(localFilePath)) {
    throw new Error("Rendering completed but output file is missing on disk!");
  }
  console.log(`Output file size: ${fs.statSync(localFilePath).size} bytes`);
  console.log("✅ Remotion worker queue compilation test passed!");

  // Clean up
  console.log("\nCleaning up test artifacts...");
  await prisma.styleRenderJob.delete({ where: { id: job.id } });
  await deleteSavedStyle(testStyle.id);
  try {
    fs.unlinkSync(localFilePath);
  } catch {}
  console.log("✅ Cleanup complete!");

  console.log("\n🎉 All Style Studio & Remotion integration tests passed successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Test failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
