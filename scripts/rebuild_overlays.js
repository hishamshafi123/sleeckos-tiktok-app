const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Load local .env file manually if exists
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const index = trimmed.indexOf('=');
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

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("[-] Error: DATABASE_URL environment variable is not defined.");
  process.exit(1);
}

console.log("[*] Initializing Database Connection...");
const pool = new Pool({ connectionString: dbUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("==================================================================");
  console.log("        SLEECKOS DOCKER CONTAINER OVERLAYS SELF-HEALING UTILITY    ");
  console.log("==================================================================");

  try {
    // Fetch all TrackLyricalTemplate records
    console.log("[*] Fetching lyrical templates from the database...");
    const templates = await prisma.trackLyricalTemplate.findMany({
      include: {
        track: true
      }
    });

    console.log(`[+] Found ${templates.length} total lyrical template records.`);
    
    let repairedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let intactCount = 0;

    for (let i = 0; i < templates.length; i++) {
      const template = templates[i];
      console.log(`\n------------------------------------------------------------------`);
      console.log(`[${i + 1}/${templates.length}] Template: "${template.templateName}" for Song: "${template.track.title}" (${template.track.artist})`);
      console.log(`Track ID: ${template.trackId} | Template ID: ${template.id}`);

      // Check if track is lyrical and has transcription
      if (!template.track.isLyrical || !template.track.lyricalTranscription) {
        console.warn(`[!] Skipping: Track is not fully aligned or is missing Whisper transcription.`);
        skippedCount++;
        continue;
      }

      // Check if files exist
      const overlayRelative = template.overlayVideoUrl;
      const previewRelative = template.previewImageUrl;

      if (!overlayRelative || !previewRelative) {
        console.warn(`[!] Skipping: Template record does not have relative asset URLs populated.`);
        skippedCount++;
        continue;
      }

      const overlayAbs = path.join(process.cwd(), 'public', overlayRelative);
      const previewAbs = path.join(process.cwd(), 'public', previewRelative);
      const trackAudioAbs = path.join(process.cwd(), 'public', template.track.fileUrl);

      const overlayExists = fs.existsSync(overlayAbs);
      const previewExists = fs.existsSync(previewAbs);

      if (overlayExists && previewExists) {
        console.log(`[+] OK: Both physical overlay video and preview frame exist.`);
        console.log(`    Overlay: ${overlayRelative}`);
        console.log(`    Preview: ${previewRelative}`);
        intactCount++;
        continue;
      }

      console.log(`[-] MISSING: Physical overlay video or preview frame is missing!`);
      if (!overlayExists) console.log(`    - Missing overlay MOV at: ${overlayAbs}`);
      if (!previewExists) console.log(`    - Missing preview PNG at: ${previewAbs}`);

      // Verify track audio file is present
      if (!fs.existsSync(trackAudioAbs)) {
        console.error(`[!] ERROR: Audio source file is missing VPS at: ${trackAudioAbs}`);
        console.error(`    Cannot pre-render overlays without the audio source file!`);
        failedCount++;
        continue;
      }

      // Ensure directory boundaries are built
      fs.mkdirSync(path.dirname(overlayAbs), { recursive: true });
      fs.mkdirSync(path.dirname(previewAbs), { recursive: true });

      // Run generation CLI command
      console.log(`[*] Pre-rendering missing assets for template: '${template.templateName}'...`);
      console.log(`    Audio: ${trackAudioAbs}`);
      console.log(`    Overlay Output: ${overlayAbs}`);
      console.log(`    Preview Output: ${previewAbs}`);

      // Escape single quotes in transcription JSON
      const escapedTranscription = template.track.lyricalTranscription.replace(/'/g, "'\\''");

      const cmdParts = [
        `./venv/bin/python3 "scripts/lyrical_composer.py"`,
        `-i "${trackAudioAbs}"`,
        `-o "${overlayAbs}"`,
        `--only-overlay`,
        `--preview-frame "${previewAbs}"`,
        `--transcription-json '${escapedTranscription}'`,
        `--font "${template.fontFamily}"`,
        `--font-size ${template.fontSize}`,
        `--active-color "${template.activeColor}"`,
        `--stroke-width ${template.strokeWidth}`,
        `--stroke-color "${template.strokeColor}"`,
        `--position-y ${template.positionY}`,
        `--fps 60`,
        `--animation-mode "${template.animationMode}"`,
        `--text-margin ${template.textMargin}`,
        `--bg-opacity ${template.bgOpacity}`,
        `--lofi-factor ${template.lofiFactor}`,
        `--aspect-ratio "${template.aspectRatio}"`
      ];

      if (template.textColor) {
        cmdParts.push(`--text-color "${template.textColor}"`);
      }
      if (template.bgColor) {
        cmdParts.push(`--bg-color "${template.bgColor}"`);
      }

      const cmd = cmdParts.join(" ");

      try {
        console.log(`[*] Spawning Python Pre-renderer:`);
        console.log(`    ${cmd.substring(0, 150)}... [truncated]`);
        
        const startTime = Date.now();
        execSync(cmd, {
          cwd: process.cwd(),
          stdio: 'inherit', // stream python output to terminal directly
          env: {
            ...process.env,
            HF_HOME: process.env.HF_HOME || "/home/nextjs/.cache/huggingface"
          }
        });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        // Verify successful write
        if (fs.existsSync(overlayAbs) && fs.existsSync(previewAbs)) {
          console.log(`[+] SUCCESS: Pre-rendered overlays and previews built in ${elapsed}s!`);
          repairedCount++;
        } else {
          throw new Error("Command finished but files were not created.");
        }
      } catch (execErr) {
        console.error(`[-] ERROR: Pre-rendering command failed:`, execErr.message);
        failedCount++;
      }
    }

    console.log("\n==================================================================");
    console.log("                         REBUILD SUMMARY                          ");
    console.log("==================================================================");
    console.log(`- Intact Templates (OK):   ${intactCount}`);
    console.log(`- Repaired Templates (NEW): ${repairedCount}`);
    console.log(`- Skipped Templates:       ${skippedCount}`);
    console.log(`- Failed Templates:        ${failedCount}`);
    console.log("==================================================================");

  } catch (error) {
    console.error("[-] Critical execution failure inside self-healing script:", error);
  } finally {
    await prisma.$disconnect();
    await pool.end();
    console.log("[*] Database connection disconnected cleanly.");
  }
}

main();
