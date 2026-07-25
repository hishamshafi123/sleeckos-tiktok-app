/**
 * Verifies org-tz (IST) day bucketing in getUsersWithoutLogin.
 *
 * Inserts a successful LoginEvent at 2026-07-23T18:30:00Z — exactly midnight
 * IST on 2026-07-24 — then asserts:
 *   - range from=2026-07-24,to=2026-07-24 counts the user as logged IN
 *   - range from=2026-07-23,to=2026-07-23 counts the user as NOT logged in
 *
 * Run (tsx is NOT installed — use the repo esbuild+node pattern):
 *   node_modules/.bin/esbuild scripts/verify_absent_ist.ts \
 *     --bundle --platform=node --format=esm --packages=external \
 *     --tsconfig=tsconfig.json \
 *     --outfile=scratch/verify_absent_ist.mjs && node scratch/verify_absent_ist.mjs
 */
import prisma from "../src/lib/db";
import { getUsersWithoutLogin } from "../src/lib/services/activity";
import { getOrgTimezone } from "../src/lib/services/timezone";

async function main() {
  const tz = await getOrgTimezone();
  console.log(`Org timezone: ${tz}`);

  const role = await prisma.role.findFirst();
  if (!role) throw new Error("No roles in DB");

  const email = `ist-verify-${Date.now()}@example.com`;
  const user = await prisma.user.create({
    data: { email, name: "IST Verify", roleId: role.id },
  });
  const event = await prisma.loginEvent.create({
    data: {
      userId: user.id,
      success: true,
      // 2026-07-23T18:30:00Z === 2026-07-24 00:00:00 IST (just after midnight IST)
      createdAt: new Date("2026-07-23T18:30:00Z"),
    },
  });
  console.log(`Inserted LoginEvent at 2026-07-23T18:30:00Z (= 2026-07-24 00:00 IST) for ${email}`);

  try {
    const day24 = await getUsersWithoutLogin({ from: "2026-07-24", to: "2026-07-24" });
    const inOn24 = !day24.notLoggedIn.some((u) => u.id === user.id);
    console.log(
      `Range 2026-07-24 → 2026-07-24: loggedInCount=${day24.loggedInCount}/${day24.totalUsers}, ` +
        `test user logged in: ${inOn24} (expected true)`
    );

    const day23 = await getUsersWithoutLogin({ from: "2026-07-23", to: "2026-07-23" });
    const absentOn23 = day23.notLoggedIn.some((u) => u.id === user.id);
    console.log(
      `Range 2026-07-23 → 2026-07-23: loggedInCount=${day23.loggedInCount}/${day23.totalUsers}, ` +
        `test user absent: ${absentOn23} (expected true)`
    );

    if (inOn24 && absentOn23) {
      console.log("PASS: IST day bucketing is correct");
    } else {
      console.log("FAIL: IST day bucketing is wrong");
      process.exitCode = 1;
    }
  } finally {
    await prisma.loginEvent.delete({ where: { id: event.id } });
    await prisma.user.delete({ where: { id: user.id } });
    console.log("Cleaned up test user and event");
  }
}

main().finally(() => prisma.$disconnect());
