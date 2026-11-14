import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/lib/db";
import {
  ensureStateDay,
  getStateDashboard,
  updateStateConfig,
} from "../src/lib/services/state-accounts/data";
import { statePosts } from "../src/lib/services/state-accounts/posts";

async function main() {
  assert.match(
    new URL(process.env.DATABASE_URL!).pathname,
    /state_accounts_verify$/,
  );
  const suffix = randomUUID();
  const section = await prisma.accountSection.create({
    data: { name: suffix, slug: suffix },
  });
  const team = await prisma.stateTeam.create({
    data: { name: suffix, postsTarget: 3, warmupTarget: 35 },
  });
  const ids: string[] = [];
  const phones: string[] = [];
  const create = async (
    username: string,
    folder: string | null,
    folderId?: string,
  ) => {
    const a = await prisma.managedAccount.create({
      data: {
        sectionId: section.id,
        tiktokUsername: username + suffix,
        driveFolderName: folder,
        driveFolderId: folderId,
      },
    });
    ids.push(a.id);
    return a;
  };
  const phone = async (name: string, daysAgo: number) => {
    const p = await prisma.guardianPhone.create({
      data: {
        profileId: randomUUID(),
        name,
        tags: ["State"],
        lastSeenAt: new Date(Date.now() - daysAgo * 86400000),
      },
    });
    phones.push(p.profileId);
    return p;
  };
  try {
    const oldPhone = await phone("Georgia", 4);
    const freshPhone = await phone("Georgia", 0);
    const old = await create(
      "old-georgia-",
      "POL ACC Georgia",
      "folder-" + suffix,
    );
    let day = await ensureStateDay();
    assert.equal(
      (
        await prisma.stateAccount.findUniqueOrThrow({
          where: { accountId: old.id },
        })
      ).guardianProfileId,
      freshPhone.profileId,
      "unique fresh phone wins over stale duplicate",
    );
    await updateStateConfig({
      action: "account",
      accountId: old.id,
      stateName: "Georgia",
      teamId: team.id,
      guardianProfileId: freshPhone.profileId,
      postsTarget: 4,
      warmupTarget: 40,
    });
    await prisma.stateVideo.create({
      data: {
        videoId: suffix,
        accountId: old.id,
        url: "https://www.tiktok.com/@old/video/123",
        publishedAt: new Date(day.startsAt.getTime() + 1000),
        views: BigInt(12),
        likes: BigInt(2),
        lastObservedAt: new Date(),
      },
    });
    await prisma.managedAccount.delete({ where: { id: old.id } });
    const archived = await prisma.stateAccount.findUniqueOrThrow({
      where: { accountId: old.id },
    });
    assert.equal(archived.managedAccountId, null);
    assert.equal(archived.usernameSnapshot, old.tiktokUsername);
    assert.equal(
      await prisma.stateVideo.count({ where: { accountId: old.id } }),
      1,
      "deleting the login preserves posts",
    );
    const missing = await getStateDashboard(true);
    assert.ok(missing.missingStates.includes("Georgia"));
    const replacement = await create(
      "new-georgia-",
      "renamed folder",
      old.driveFolderId!,
    );
    await ensureStateDay();
    let next = await prisma.stateAccount.findUniqueOrThrow({
      where: { accountId: replacement.id },
    });
    assert.equal(next.stateName, "Georgia");
    assert.equal(next.teamId, team.id);
    assert.equal(next.postsTarget, 4);
    assert.equal(next.warmupTarget, 40);
    assert.equal(next.guardianProfileId, freshPhone.profileId);
    assert.equal(
      next.followers,
      null,
      "replacement starts its own follower baseline",
    );
    assert.equal(next.replacementOfAccountId, old.id);
    const row = await prisma.stateAccountDay.findUniqueOrThrow({
      where: { accountId_dayId: { accountId: replacement.id, dayId: day.id } },
    });
    assert.equal(
      row.guardianProfileId,
      null,
      "one phone cannot receive two full-day credits",
    );
    assert.equal(
      row.postsTarget,
      0,
      "replacement does not duplicate the old daily target",
    );
    const history = await statePosts(
      new URLSearchParams({ day: day.id, account: old.id }),
    );
    assert.equal(history?.posts[0].username, old.tiktokUsername);
    assert.equal(history?.total, 1);
    day = await ensureStateDay(new Date(day.endsAt.getTime() + 1));
    const tomorrow = await prisma.stateAccountDay.findUniqueOrThrow({
      where: { accountId_dayId: { accountId: replacement.id, dayId: day.id } },
    });
    assert.equal(tomorrow.postsTarget, 4);
    assert.equal(tomorrow.guardianProfileId, freshPhone.profileId);
    assert.equal(
      await prisma.stateAccountDay.count({
        where: { dayId: day.id, accountId: old.id },
      }),
      0,
    );

    // Both phone names are current: the account remains visible without guessing.
    await prisma.guardianPhone.updateMany({
      where: { profileId: { in: [oldPhone.profileId, freshPhone.profileId] } },
      data: { lastSeenAt: new Date() },
    });
    const ambiguous = await create("another-georgia-", "POL ACC Georgia");
    await ensureStateDay();
    next = await prisma.stateAccount.findUniqueOrThrow({
      where: { accountId: ambiguous.id },
    });
    assert.equal(next.guardianProfileId, null);
    assert.ok(
      (await getStateDashboard(false)).accounts.some(
        (a) => a.accountId === ambiguous.id,
      ),
    );
    await assert.rejects(
      updateStateConfig({
        action: "link",
        accountId: ambiguous.id,
        stateName: "Georgia",
        guardianProfileId: freshPhone.profileId,
      }),
      /another active/,
    );

    const unknown = await create("unrelated-", "Unrelated folder");
    await ensureStateDay();
    assert.equal(
      await prisma.stateAccount.findUnique({
        where: { accountId: unknown.id },
      }),
      null,
    );
    await updateStateConfig({
      action: "link",
      accountId: unknown.id,
      stateName: "Nevada",
    });
    assert.ok(
      (await getStateDashboard(true)).accounts.some(
        (a) => a.accountId === unknown.id && a.stateName === "Nevada",
      ),
    );
    assert.equal((await getStateDashboard(false)).candidateAccounts.length, 0);
    console.log(
      "PASS: stale/ambiguous phones, deleted-login history, stable-folder replacement, inherited targets, separate baselines, day boundaries, explicit linking, directory permissions",
    );
  } finally {
    await prisma.stateAccount.deleteMany({ where: { accountId: { in: ids } } });
    await prisma.managedAccount.deleteMany({ where: { id: { in: ids } } });
    await prisma.guardianPhone.deleteMany({
      where: { profileId: { in: phones } },
    });
    await prisma.stateTeam.delete({ where: { id: team.id } });
    await prisma.accountSection.delete({ where: { id: section.id } });
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
