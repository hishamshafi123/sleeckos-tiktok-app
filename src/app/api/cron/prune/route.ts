export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
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

  return NextResponse.json({
    ok: true,
    message: "Local file pruning run completed",
    results,
  });
}
