export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { cleanupOrphanTempFiles } from "@/lib/services/sourcing";
import fs from "fs";
import path from "path";

function verifyCronSecret(req: NextRequest) {
  const secret =
    req.headers.get("x-cron-secret") ||
    req.nextUrl.searchParams.get("secret");
  return secret === process.env.CRON_SECRET;
}

const PRUNE_DIRS = [
  "public/uploads/renders",
  "public/uploads/clip-mixer-renders",
  "public/uploads/multiplier/renders",
  "public/uploads/multiplier/temp",
  "public/uploads/genres/archives",
];

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, { deleted: number; failed: number; skipped: number }> = {};
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  for (const dirName of PRUNE_DIRS) {
    const absDir = path.join(process.cwd(), dirName);
    results[dirName] = { deleted: 0, failed: 0, skipped: 0 };

    if (!fs.existsSync(absDir)) {
      continue;
    }

    try {
      const files = await fs.promises.readdir(absDir);
      for (const file of files) {
        if (file.startsWith(".")) {
          results[dirName].skipped++;
          continue;
        }

        const filePath = path.join(absDir, file);
        try {
          const stat = await fs.promises.stat(filePath);
          if (stat.isFile()) {
            if (stat.mtimeMs < oneDayAgo) {
              await fs.promises.unlink(filePath);
              results[dirName].deleted++;
            } else {
              results[dirName].skipped++;
            }
          } else {
            results[dirName].skipped++;
          }
        } catch (fileErr) {
          console.error(`[Prune Cron] Failed to process stat/unlink for ${filePath}:`, fileErr);
          results[dirName].failed++;
        }
      }
    } catch (dirErr) {
      console.error(`[Prune Cron] Failed to read directory ${absDir}:`, dirErr);
    }
  }

  // ── Multiplier archives: local .tar files older than 1 day ──────────────
  // Every archive is uploaded to R2 at prep time, and the /api/uploads handler
  // redirects to R2 when the local file is gone — local tars are duplicates.
  const archivesResult = { deleted: 0, failed: 0, skipped: 0 };
  const archivesDir = path.join(process.cwd(), "public", "uploads", "multiplier", "archives");
  results["public/uploads/multiplier/archives (*.tar)"] = archivesResult;
  try {
    if (fs.existsSync(archivesDir)) {
      for (const file of await fs.promises.readdir(archivesDir)) {
        if (!file.endsWith(".tar")) {
          archivesResult.skipped++; // keep status_*.json and anything else
          continue;
        }
        const filePath = path.join(archivesDir, file);
        try {
          const stat = await fs.promises.stat(filePath);
          if (stat.isFile() && stat.mtimeMs < oneDayAgo) {
            await fs.promises.unlink(filePath);
            archivesResult.deleted++;
          } else {
            archivesResult.skipped++;
          }
        } catch (err) {
          console.error(`[Prune Cron] Failed to process archive ${filePath}:`, err);
          archivesResult.failed++;
        }
      }
    }
  } catch (err) {
    console.error("[Prune Cron] Failed to read archives dir:", err);
  }

  // ── Bulk Link Sourcing: temp downloads older than 24h whose video is ──────
  // terminal (uploaded/failed) — successful uploads already delete immediately.
  try {
    results["public/uploads/sourcing/temp"] = await cleanupOrphanTempFiles();
  } catch (err) {
    console.error("[Prune Cron] Sourcing temp cleanup failed:", err);
    results["public/uploads/sourcing/temp"] = { deleted: 0, failed: 0, skipped: 0 };
  }

  return NextResponse.json({
    ok: true,
    message: "Local file pruning run completed",
    results,
  });
}
