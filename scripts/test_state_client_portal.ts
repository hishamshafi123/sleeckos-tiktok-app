/**
 * Verification suite for State Accounts Client Dashboard & Public REST API v1.
 * Run only against the isolated verification database:
 * DATABASE_URL=postgresql://hishamshafi@localhost:5432/sleeckos_state_accounts_verify npx tsx scripts/test_state_client_portal.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import prisma from "../src/lib/db";
import {
  createStateAccountShare,
  listStateAccountShares,
  revokeStateAccountShare,
  validateStateApiAccess,
} from "../src/lib/services/state-accounts/client-portal";
import {
  createApiClient,
  generateApiKey,
  revokeApiClientStateAccess,
  setApiClientStateAccess,
} from "../src/lib/services/api-clients";
import { POST as portalLookup } from "../src/app/api/state-portal/lookup/route";
import { GET as portalCsv } from "../src/app/api/state-portal/csv/route";
import { GET as apiList, OPTIONS as apiListOptions } from "../src/app/api/public/v1/state-accounts/route";
import { GET as apiDetail } from "../src/app/api/public/v1/state-accounts/[stateOrId]/route";
import { GET as apiPosts } from "../src/app/api/public/v1/state-accounts/posts/route";
import { GET as apiStatePosts } from "../src/app/api/public/v1/state-accounts/[stateOrId]/posts/route";

async function main() {
  assert.match(
    new URL(process.env.DATABASE_URL!).pathname,
    /state_accounts_verify$/,
    "Use the isolated verification database.",
  );

  // Clean isolated test tables
  await prisma.stateAccountShare.deleteMany();
  await prisma.apiClientStateAccess.deleteMany();
  await prisma.apiClientKey.deleteMany();
  await prisma.apiClientCampaign.deleteMany();
  await prisma.apiClient.deleteMany();
  await prisma.stateVideo.deleteMany();
  await prisma.stateAccountDay.deleteMany();
  await prisma.stateAccount.deleteMany();
  await prisma.stateTeam.deleteMany();
  await prisma.stateReportingDay.deleteMany();
  await prisma.managedAccount.deleteMany({
    where: { tiktokUsername: { startsWith: "portal_qa_" } },
  });

  // Seed a state label, section & 2 active state accounts (Georgia with a retired predecessor + Nevada)
  const stateLabel = await prisma.accountLabel.upsert({
    where: { name: "state" },
    create: { name: "state", color: "#3b82f6" },
    update: {},
  });
  const stateSection = await prisma.accountSection.upsert({
    where: { slug: "state-accounts" },
    create: { name: "State Accounts", slug: "state-accounts" },
    update: {},
  });

  const gaManaged = await prisma.managedAccount.create({
    data: {
      tiktokUsername: "portal_qa_georgia",
      tiktokDisplayName: "Georgia News",
      driveFolderName: "POL ACC Georgia",
      isActive: true,
      sectionId: stateSection.id,
      labelAssignments: { create: { labelId: stateLabel.id } },
    },
  });
  const nvManaged = await prisma.managedAccount.create({
    data: {
      tiktokUsername: "portal_qa_nevada",
      tiktokDisplayName: "Nevada News",
      driveFolderName: "POL ACC Nevada",
      isActive: true,
      sectionId: stateSection.id,
      labelAssignments: { create: { labelId: stateLabel.id } },
    },
  });

  const secretTeam = await prisma.stateTeam.create({
    data: { name: "SECRET_INTERNAL_TEAM_ALPHA", postsTarget: 3, warmupTarget: 35 },
  });

  const oldGaId = randomUUID();
  await prisma.stateAccount.create({
    data: {
      accountId: oldGaId,
      managedAccountId: null,
      usernameSnapshot: "portal_qa_georgia_old",
      stateName: "Georgia",
      replacedByAccountId: gaManaged.id,
      teamId: secretTeam.id,
    },
  });
  await prisma.stateAccount.create({
    data: {
      accountId: gaManaged.id,
      managedAccountId: gaManaged.id,
      usernameSnapshot: "portal_qa_georgia",
      stateName: "Georgia",
      replacementOfAccountId: oldGaId,
      teamId: secretTeam.id,
      followers: BigInt(15200),
      profileLikes: BigInt(98400),
      lastSyncAt: new Date("2026-11-21T18:00:00Z"),
    },
  });
  await prisma.stateAccount.create({
    data: {
      accountId: nvManaged.id,
      managedAccountId: nvManaged.id,
      usernameSnapshot: "portal_qa_nevada",
      stateName: "Nevada",
      teamId: secretTeam.id,
      followers: BigInt(8400),
      profileLikes: BigInt(41200),
      lastSyncAt: new Date("2026-11-21T17:30:00Z"),
    },
  });

  // Seed 2 reporting days (yesterday completed + today)
  const day1 = await prisma.stateReportingDay.create({
    data: {
      label: "2026-11-20",
      timezone: "Asia/Kolkata",
      startsAt: new Date("2026-11-19T18:30:00Z"),
      endsAt: new Date("2026-11-20T18:30:00Z"),
    },
  });
  const day2 = await prisma.stateReportingDay.create({
    data: {
      label: "2026-11-21",
      timezone: "Asia/Kolkata",
      startsAt: new Date("2026-11-20T18:30:00Z"),
      endsAt: new Date("2026-11-21T18:30:00Z"),
    },
  });

  // Old GA had views on day1; new GA has views on day2 (tests lineage rollup!)
  await prisma.stateAccountDay.createMany({
    data: [
      {
        dayId: day1.id,
        accountId: oldGaId,
        teamId: secretTeam.id,
        posts: 2,
        warmupMinutes: 40,
        views: BigInt(50000),
        likes: BigInt(2500),
        followerGrowth: BigInt(300),
        metricsObserved: true,
        followersObserved: true,
      },
      {
        dayId: day2.id,
        accountId: gaManaged.id,
        teamId: secretTeam.id,
        posts: 3,
        warmupMinutes: 35,
        views: BigInt(75000),
        likes: BigInt(4100),
        followerGrowth: BigInt(450),
        metricsObserved: true,
        followersObserved: true,
      },
      {
        dayId: day2.id,
        accountId: nvManaged.id,
        teamId: secretTeam.id,
        posts: 1,
        warmupMinutes: 38,
        views: BigInt(22000),
        likes: BigInt(1100),
        followerGrowth: BigInt(120),
        metricsObserved: true,
        followersObserved: true,
      },
    ],
  });

  // Videos across old GA, new GA, Nevada, plus one unavailable video
  await prisma.stateVideo.createMany({
    data: [
      {
        videoId: "7000000000000000001",
        accountId: oldGaId,
        url: "https://www.tiktok.com/@portal_qa_georgia_old/video/7000000000000000001",
        publishedAt: new Date("2026-11-20T10:00:00Z"),
        views: BigInt(50000),
        likes: BigInt(2500),
        lastObservedAt: new Date("2026-11-20T18:00:00Z"),
      },
      {
        videoId: "7000000000000000002",
        accountId: gaManaged.id,
        url: "https://www.tiktok.com/@portal_qa_georgia/video/7000000000000000002",
        publishedAt: new Date("2026-11-21T12:00:00Z"),
        views: BigInt(120000),
        likes: BigInt(7200),
        lastObservedAt: new Date("2026-11-21T18:00:00Z"),
      },
      {
        videoId: "7000000000000000003",
        accountId: gaManaged.id,
        url: "https://www.tiktok.com/@portal_qa_georgia/video/7000000000000000003",
        publishedAt: new Date("2026-11-21T13:00:00Z"),
        views: BigInt(99999),
        likes: BigInt(100),
        lastObservedAt: new Date("2026-11-21T18:00:00Z"),
        unavailable: true, // Should be hidden from public results!
      },
      {
        videoId: "7000000000000000004",
        accountId: nvManaged.id,
        url: "https://www.tiktok.com/@portal_qa_nevada/video/7000000000000000004",
        publishedAt: new Date("2026-11-21T15:00:00Z"),
        views: BigInt(30000),
        likes: BigInt(1800),
        lastObservedAt: new Date("2026-11-21T17:30:00Z"),
      },
    ],
  });

  // 1. Create All-States share & Georgia-Only share
  const allShare = await createStateAccountShare({
    title: "All States Client Report",
    label: "Test All",
    allStates: true,
    createdBy: "qa@sleeckos.com",
  });
  const gaShare = await createStateAccountShare({
    title: "Georgia Only Report",
    allStates: false,
    stateNames: ["Georgia"],
    expiresInDays: 30,
  });

  const listed = await listStateAccountShares();
  assert.equal(listed.length, 2);

  // 2. Test POST /api/state-portal/lookup with All-States share
  const lookupRes = await portalLookup(
    new NextRequest("http://localhost/api/state-portal/lookup", {
      method: "POST",
      body: JSON.stringify({ code: allShare.code.toLowerCase() }),
      headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1" },
    }),
  );
  assert.equal(lookupRes.status, 200);
  const portalBody = await lookupRes.json();
  assert.equal(portalBody.scope.title, "All States Client Report");
  assert.equal(portalBody.accounts.length, 2);

  // Verify privacy: no internal team name or warmupMinutes leaked anywhere
  const serializedPortal = JSON.stringify(portalBody);
  assert.ok(!serializedPortal.includes("SECRET_INTERNAL_TEAM_ALPHA"), "Must not leak internal team name");
  assert.ok(!serializedPortal.includes("warmupMinutes"), "Must not leak warmupMinutes");

  // Verify Georgia lineage rollup: active + predecessor videos (2 visible, 1 unavailable excluded)
  const gaPortalAcc = portalBody.accounts.find((a: { slug: string }) => a.slug === "georgia");
  assert.ok(gaPortalAcc, "Georgia account should exist");
  assert.equal(gaPortalAcc.stateCode, "GA");
  assert.equal(gaPortalAcc.trackedVideos, 2, "Includes predecessor + active video, excludes unavailable");
  assert.equal(gaPortalAcc.totalVideoViews, 170000, "50k predecessor + 120k active");
  assert.equal(gaPortalAcc.periodViewsGained, 125000, "50k day1 predecessor + 75k day2 active");
  assert.equal(gaPortalAcc.followers, 15200);

  // 3. Test CSV export scoped by state
  const csvRes = await portalCsv(
    new NextRequest(
      `http://localhost/api/state-portal/csv?code=${allShare.code}&state=georgia`,
      { headers: { "x-forwarded-for": "10.0.0.1" } },
    ),
  );
  assert.equal(csvRes.status, 200);
  const csvText = await csvRes.text();
  assert.ok(csvText.startsWith("state,state_code,username,url,published_at,views,likes,engagement_rate_pct,last_observed_at"));
  assert.ok(csvText.includes("7000000000000000002"));
  assert.ok(!csvText.includes("7000000000000000004"), "Filtered to Georgia only");
  assert.ok(!csvText.includes("7000000000000000003"), "Unavailable excluded");

  // 4. Test Public REST API v1 with Georgia-Only share code & ApiClient key
  // Missing key -> 404 + CORS headers
  const noKeyRes = await apiList(
    new NextRequest("http://localhost/api/public/v1/state-accounts", {
      headers: { "x-forwarded-for": "10.0.0.2" },
    }),
  );
  assert.equal(noKeyRes.status, 404);
  assert.equal(noKeyRes.headers.get("access-control-allow-origin"), "*");

  // OPTIONS preflight
  const optRes = await apiListOptions();
  assert.equal(optRes.status, 204);
  assert.equal(optRes.headers.get("access-control-allow-origin"), "*");

  // Georgia-only share code on /api/public/v1/state-accounts
  const gaSummaryRes = await apiList(
    new NextRequest("http://localhost/api/public/v1/state-accounts?days=30", {
      headers: { "x-api-key": gaShare.code, "x-forwarded-for": "10.0.0.2" },
    }),
  );
  assert.equal(gaSummaryRes.status, 200);
  const gaSummary = await gaSummaryRes.json();
  assert.equal(gaSummary.accounts.length, 1);
  assert.equal(gaSummary.accounts[0].slug, "georgia");
  assert.equal(gaSummary.totals.totalVideoViews, 170000);

  // Georgia-only key trying to read Nevada -> 404 (strict scope isolation!)
  const forbiddenNv = await apiDetail(
    new NextRequest("http://localhost/api/public/v1/state-accounts/nevada", {
      headers: { "x-api-key": gaShare.code, "x-forwarded-for": "10.0.0.2" },
    }),
    { params: Promise.resolve({ stateOrId: "nevada" }) },
  );
  assert.equal(forbiddenNv.status, 404);

  // Georgia-only key reading Georgia by 2-letter code "GA" -> 200
  const gaByCode = await apiDetail(
    new NextRequest("http://localhost/api/public/v1/state-accounts/GA?days=7", {
      headers: { "x-api-key": gaShare.code, "x-forwarded-for": "10.0.0.2" },
    }),
    { params: Promise.resolve({ stateOrId: "GA" }) },
  );
  assert.equal(gaByCode.status, 200);
  const gaDetailBody = await gaByCode.json();
  assert.equal(gaDetailBody.account.slug, "georgia");
  assert.equal(gaDetailBody.topVideos[0].videoId, "7000000000000000002");

  // 5. Test ApiClient slk_ key with State Accounts access
  const { id: clientId } = await createApiClient("Acme PAC");
  const { rawKey } = await generateApiKey(clientId, "Production");

  // Before granting stateAccess -> denied (null / 404)
  assert.equal(await validateStateApiAccess(rawKey), null);

  // Grant all states -> works!
  await setApiClientStateAccess(clientId, { allStates: true });
  const postsRes = await apiPosts(
    new NextRequest(
      "http://localhost/api/public/v1/state-accounts/posts?sort=views&limit=2",
      { headers: { "x-api-key": rawKey, "x-forwarded-for": "10.0.0.3" } },
    ),
  );
  assert.equal(postsRes.status, 200);
  const postsBody = await postsRes.json();
  assert.equal(postsBody.total, 3);
  assert.equal(postsBody.count, 2);
  assert.equal(postsBody.posts[0].videoId, "7000000000000000002");
  assert.equal(postsBody.posts[1].videoId, "7000000000000000001");

  // Single state posts route with date filter
  const nvPostsRes = await apiStatePosts(
    new NextRequest(
      "http://localhost/api/public/v1/state-accounts/nv/posts?from=2026-11-21&to=2026-11-21",
      { headers: { "x-api-key": rawKey, "x-forwarded-for": "10.0.0.3" } },
    ),
    { params: Promise.resolve({ stateOrId: "nv" }) },
  );
  assert.equal(nvPostsRes.status, 200);
  const nvPostsBody = await nvPostsRes.json();
  assert.equal(nvPostsBody.count, 1);
  assert.equal(nvPostsBody.posts[0].stateCode, "NV");

  // Invalid date range -> 400
  const badDateRes = await apiPosts(
    new NextRequest(
      "http://localhost/api/public/v1/state-accounts/posts?from=2026-11-25&to=2026-11-20",
      { headers: { "x-api-key": rawKey, "x-forwarded-for": "10.0.0.3" } },
    ),
  );
  assert.equal(badDateRes.status, 400);

  // Revoke state access on ApiClient -> immediately returns 404
  await revokeApiClientStateAccess(clientId);
  assert.equal(await validateStateApiAccess(rawKey), null);

  // Revoke share code -> immediately returns 404
  await revokeStateAccountShare(allShare.id);
  const revokedLookup = await portalLookup(
    new NextRequest("http://localhost/api/state-portal/lookup", {
      method: "POST",
      body: JSON.stringify({ code: allShare.code }),
      headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.4" },
    }),
  );
  assert.equal(revokedLookup.status, 404);

  console.log("PASS all State Accounts Client Portal & Public API v1 tests!");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.stateAccountShare.deleteMany().catch(() => {});
    await prisma.apiClientStateAccess.deleteMany().catch(() => {});
    await prisma.apiClient.deleteMany({ where: { name: "Acme PAC" } }).catch(() => {});
    await prisma.stateVideo.deleteMany().catch(() => {});
    await prisma.stateAccountDay.deleteMany().catch(() => {});
    await prisma.stateAccount.deleteMany().catch(() => {});
    await prisma.stateTeam.deleteMany({ where: { name: "SECRET_INTERNAL_TEAM_ALPHA" } }).catch(() => {});
    await prisma.managedAccount.deleteMany({ where: { tiktokUsername: { startsWith: "portal_qa_" } } }).catch(() => {});
    await prisma.$disconnect();
  });
