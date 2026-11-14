import type { Prisma } from "@prisma/client";
import { STATES } from "../content-desk/rules";

export function isStatePhone(phone: { tags: unknown }) {
  return (
    Array.isArray(phone.tags) &&
    phone.tags.some(
      (tag) => typeof tag === "string" && tag.toLowerCase() === "state",
    )
  );
}

export const normalizeStateName = (value: string) =>
  value
    .trim()
    .replace(/^@/, "")
    .replace(/^pol\s+acc\s+/i, "")
    .trim()
    .toLowerCase();

export const STATE_WHERE: Prisma.ManagedAccountWhereInput = {
  revokedAt: null,
  OR: [
    {
      labelAssignments: {
        some: { label: { name: { equals: "state", mode: "insensitive" } } },
      },
    },
    { section: { name: { equals: "state", mode: "insensitive" } } },
    { section: { name: { equals: "state accounts", mode: "insensitive" } } },
    // Once explicitly registered, removing a label must not hide the account.
    { stateAccount: { is: { managedAccountId: { not: null } } } },
  ],
};

/** A state is a durable tracking record; deleting the managed login detaches it. */
export async function registerStateAccount(
  tx: Prisma.TransactionClient,
  accountId: string,
  stateName: string | null,
  guardianProfileId: string | null,
  explicit = false,
) {
  const account = await tx.managedAccount.findFirstOrThrow({
    where: { id: accountId, revokedAt: null },
  });
  const current = await tx.stateAccount.findUnique({ where: { accountId } });
  if (
    current?.guardianProfileId &&
    guardianProfileId &&
    current.guardianProfileId !== guardianProfileId
  )
    throw new Error(
      "This account already has a Guardian phone. Change it in account settings.",
    );
  const occupied = guardianProfileId
    ? await tx.stateAccount.findUnique({
        where: { guardianProfileId },
        include: { account: { select: { revokedAt: true } } },
      })
    : null;
  if (occupied && occupied.accountId !== accountId && occupied.account)
    throw new Error("This Guardian phone belongs to another active account.");

  const retired = await tx.stateAccount.findMany({
    where: {
      account: null,
      replacedByAccountId: null,
      accountId: { not: accountId },
    },
  });
  const uniqueFolder =
    !account.driveFolderId ||
    explicit ||
    (await tx.managedAccount.count({
      where: { driveFolderId: account.driveFolderId, revokedAt: null },
    })) === 1;
  const folderMatches =
    account.driveFolderId && uniqueFolder
      ? retired.filter((r) => r.driveFolderIdSnapshot === account.driveFolderId)
      : [];
  const nameMatches =
    explicit && stateName
      ? retired.filter(
          (r) =>
            normalizeStateName(r.stateName || "") ===
            normalizeStateName(stateName),
        )
      : [];
  const predecessor =
    occupied && !occupied.account
      ? occupied
      : folderMatches.length === 1
        ? folderMatches[0]
        : nameMatches.length === 1
          ? nameMatches[0]
          : undefined;
  // An existing, independently configured account must not silently inherit a team.
  const inherit =
    predecessor &&
    (!current || (!current.teamId && !current.replacementOfAccountId));
  if (
    predecessor &&
    (inherit || occupied?.accountId === predecessor.accountId)
  ) {
    await tx.stateAccount.update({
      where: { accountId: predecessor.accountId },
      data: { guardianProfileId: null, replacedByAccountId: accountId },
    });
  }
  const linkedPhoneId =
    guardianProfileId ||
    current?.guardianProfileId ||
    (inherit ? predecessor.guardianProfileId : null);
  const snapshot = {
    managedAccountId: account.id,
    usernameSnapshot: account.tiktokUsername,
    driveFolderIdSnapshot: account.driveFolderId,
    driveFolderNameSnapshot: account.driveFolderName,
  };
  const inheritance = inherit
    ? {
        teamId: predecessor.teamId,
        postsTarget: predecessor.postsTarget,
        warmupTarget: predecessor.warmupTarget,
        replacementOfAccountId: predecessor.accountId,
      }
    : {};
  return tx.stateAccount.upsert({
    where: { accountId },
    create: {
      accountId,
      ...snapshot,
      stateName,
      guardianProfileId: linkedPhoneId,
      ...inheritance,
    },
    update: {
      ...snapshot,
      ...inheritance,
      ...(stateName && (!current?.stateName || explicit) ? { stateName } : {}),
      ...(linkedPhoneId ? { guardianProfileId: linkedPhoneId } : {}),
    },
  });
}

export async function reconcileStateAccounts(
  tx: Prisma.TransactionClient,
  now: Date,
) {
  const labeled = new Set(
    (
      await tx.managedAccount.findMany({
        where: STATE_WHERE,
        select: { id: true },
      })
    ).map((a) => a.id),
  );
  const accounts = await tx.managedAccount.findMany({
    where: { revokedAt: null },
    select: {
      id: true,
      tiktokUsername: true,
      tiktokDisplayName: true,
      driveFolderName: true,
      driveFolderId: true,
    },
  });
  const phones = (await tx.guardianPhone.findMany()).filter(isStatePhone);
  const existing = await tx.stateAccount.findMany();
  const names = (a: (typeof accounts)[number]) =>
    [a.tiktokUsername, a.tiktokDisplayName, a.driveFolderName]
      .filter((s): s is string => !!s)
      .map(normalizeStateName);
  for (const account of accounts) {
    const current = existing.find((a) => a.accountId === account.id);
    const identityNames = names(account);
    const matchedPhones = phones.filter((p) =>
      identityNames.includes(normalizeStateName(p.name)),
    );
    const recognized = STATES.filter((s) =>
      identityNames.includes(normalizeStateName(s.name)),
    );
    const orphanFolders = account.driveFolderId
      ? existing.filter(
          (a) =>
            !a.managedAccountId &&
            !a.replacedByAccountId &&
            a.driveFolderIdSnapshot === account.driveFolderId,
        )
      : [];
    if (
      !current &&
      !labeled.has(account.id) &&
      !recognized.length &&
      !matchedPhones.length &&
      !orphanFolders.length
    )
      continue;
    let phoneId = current?.guardianProfileId || null;
    if (!phoneId) {
      // A replacement phone may share the old phone's name. Only disregard a
      // stale duplicate when exactly one matching phone was observed recently.
      const fresh = matchedPhones.filter(
        (p) => now.getTime() - p.lastSeenAt.getTime() <= 86400000,
      );
      const candidates =
        matchedPhones.length > 1 && fresh.length === 1 ? fresh : matchedPhones;
      if (candidates.length === 1) {
        const phone = candidates[0];
        const uniqueAccount =
          accounts.filter((a) =>
            names(a).includes(normalizeStateName(phone.name)),
          ).length === 1;
        const owner = await tx.stateAccount.findUnique({
          where: { guardianProfileId: phone.profileId },
        });
        if (
          uniqueAccount &&
          (!owner?.managedAccountId || owner.accountId === account.id)
        )
          phoneId = phone.profileId;
      }
    }
    const name =
      current?.stateName ||
      (recognized.length === 1 ? recognized[0].name : null) ||
      (matchedPhones.length ? matchedPhones[0].name : null) ||
      (orphanFolders.length === 1 ? orphanFolders[0].stateName : null);
    await registerStateAccount(tx, account.id, name, phoneId);
  }
}
