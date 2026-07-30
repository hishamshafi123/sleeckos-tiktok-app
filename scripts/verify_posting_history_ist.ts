/**
 * Verifies org-tz (IST) day bucketing in getPostingHistory.
 *
 * Inserts a PostJob published at 2026-07-23T18:45:00Z — 2026-07-24 00:15 IST —
 * then asserts:
 *   - range from=2026-07-24,to=2026-07-24 counts the post
 *   - range from=2026-07-23,to=2026-07-23 does NOT count the post
 *
 * Run (tsx is NOT installed — use the repo esbuild+node pattern):
 *   node_modules/.bin/esbuild scripts/verify_posting_history_ist.ts \
 *     --bundle --platform=node --format=esm --packages=external \
 *     --tsconfig=tsconfig.json \
 *     --outfile=scratch/verify_posting_history_ist.mjs && node scratch/verify_posting_history_ist.mjs
 */
import prisma from "../src/lib/db";
import { getPostingHistory, exportPostingHistoryCsv } from "../src/lib/services/posting-history";
import { getOrgTimezone } from "../src/lib/services/timezone";

async function main() {
  const tz = await getOrgTimezone();
  console.log(`Org timezone: ${tz}`);

  const stamp = Date.now();
  // Create our own section only if the DB has none (cleaned up in that case).
  let section = await prisma.accountSection.findFirst();
  let createdSection = false;
  if (!section) {
    section = await prisma.accountSection.create({
      data: { name: `IST Verify ${stamp}`, slug: `ist-verify-${stamp}` },
    });
    createdSection = true;
  }
  const account = await prisma.managedAccount.create({
    data: {
      sectionId: section.id,
      tiktokUsername: `ist-verify-${stamp}`,
      driveFolderName: `IST VERIFY ${stamp}`,
    },
  });
  const campaign = await prisma.campaign.create({
    data: {
      slug: `ist-verify-${stamp}`,
      title: `IST Verify ${stamp}`,
      description: "temp",
      brief: "temp",
      payoutPerPostCents: 0,
      totalBudgetCents: 0,
      maxCreators: 1,
      applicationDeadline: new Date("2026-01-01T00:00:00Z"),
      deliveryDeadline: new Date("2026-12-31T00:00:00Z"),
    },
  });
  const postJob = await prisma.postJob.create({
    data: {
      driveFileId: `ist-verify-${stamp}`,
      accountId: account.id,
      campaignId: campaign.id,
      state: "PUBLISHED",
      // 2026-07-23T18:45:00Z === 2026-07-24 00:15:00 IST (just after midnight IST)
      publishedAt: new Date("2026-07-23T18:45:00Z"),
    },
  });
  console.log(
    `Inserted PostJob at 2026-07-23T18:45:00Z (= 2026-07-24 00:15 IST) for @${account.tiktokUsername} / "${campaign.title}"`
  );

  let failures = 0;
  try {
    const in24 = await getPostingHistory({ from: "2026-07-24", to: "2026-07-24" });
    const in23 = await getPostingHistory({ from: "2026-07-23", to: "2026-07-23" });

    const key = `${account.id}::${campaign.id}`;
    const count24 = in24.cells[key] || 0;
    const count23 = in23.cells[key] || 0;
    console.log(`07-24 bucket count for test cell: ${count24}`);
    console.log(`07-23 bucket count for test cell: ${count23}`);

    if (count24 === 1) console.log("PASS: post lands in the 2026-07-24 IST bucket");
    else { console.error("FAIL: post missing from 2026-07-24 bucket"); failures++; }

    if (count23 === 0) console.log("PASS: post does NOT land in the 2026-07-23 bucket");
    else { console.error("FAIL: post leaked into 2026-07-23 bucket"); failures++; }

    // CSV smoke check — row identity flattening + totals
    const csv = await exportPostingHistoryCsv({ from: "2026-07-24", to: "2026-07-24" });
    const row = csv.split("\r\n").find((l) => l.includes(account.tiktokUsername));
    console.log(`CSV row: ${row}`);
    if (row && row.startsWith(`@${account.tiktokUsername} (IST VERIFY ${stamp})`)) {
      console.log("PASS: CSV identity flattened as @user (FOLDER)");
    } else { console.error("FAIL: CSV row identity wrong"); failures++; }
  } finally {
    await prisma.postJob.delete({ where: { id: postJob.id } });
    await prisma.managedAccount.delete({ where: { id: account.id } });
    await prisma.campaign.delete({ where: { id: campaign.id } });
    if (createdSection) {
      await prisma.accountSection.delete({ where: { id: section!.id } });
    }
    console.log("Cleaned up test PostJob, account, campaign" + (createdSection ? ", and section" : ""));
  }

  if (failures > 0) {
    console.error(`${failures} assertion(s) FAILED`);
    process.exit(1);
  }
  console.log("All assertions passed");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
