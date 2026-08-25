/**
 * Account labels — reusable colored tags attached to ManagedAccounts for
 * triage (first surfaced on the Account Performance "Receiving but not
 * posting" panel). Reads require the "analytics" tool (same as the page that
 * shows them); mutations require "accounts" (same as managed-account
 * DELETE/PATCH, which is where label edits happen alongside).
 */

import prisma from "@/lib/db";
import { can } from "@/lib/services/permissions";
import { ForbiddenError } from "@/lib/services/analytics/account-performance";
import { isLabelColorKey, LABEL_COLOR_KEYS } from "@/lib/account-labels";

/** 400-class error: bad input or a friendly duplicate-name message. */
export class LabelValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabelValidationError";
  }
}

const NAME_MAX = 40;

async function assertReadAccess(userId: string): Promise<void> {
  if (!(await can(userId, "analytics"))) throw new ForbiddenError();
}

async function assertWriteAccess(userId: string): Promise<void> {
  if (!(await can(userId, "accounts"))) throw new ForbiddenError();
}

export interface AccountLabelDto {
  id: string;
  name: string;
  color: string;
}

export interface AccountLabelWithUsage extends AccountLabelDto {
  createdAt: string;
  accountCount: number;
}

/** All labels, alphabetical, with per-label account usage counts. */
export async function listLabels(userId: string): Promise<AccountLabelWithUsage[]> {
  await assertReadAccess(userId);
  const rows = await prisma.accountLabel.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { assignments: true } } },
  });
  return rows.map((l) => ({
    id: l.id,
    name: l.name,
    color: l.color,
    createdAt: l.createdAt.toISOString(),
    accountCount: l._count.assignments,
  }));
}

export async function createLabel(
  userId: string,
  name: string,
  color: string
): Promise<AccountLabelDto> {
  await assertWriteAccess(userId);
  const trimmed = (name ?? "").trim();
  if (trimmed.length < 1 || trimmed.length > NAME_MAX) {
    throw new LabelValidationError(`Label name must be 1–${NAME_MAX} characters.`);
  }
  if (!isLabelColorKey(color)) {
    throw new LabelValidationError(
      `Color must be one of: ${LABEL_COLOR_KEYS.join(", ")}.`
    );
  }
  try {
    const label = await prisma.accountLabel.create({
      data: { name: trimmed, color },
    });
    return { id: label.id, name: label.name, color: label.color };
  } catch (err: any) {
    // P2002 = unique constraint (AccountLabel.name)
    if (err?.code === "P2002") {
      throw new LabelValidationError(`A label named "${trimmed}" already exists.`);
    }
    throw err;
  }
}

/** Returns false when the label does not exist (route maps that to 404). */
export async function deleteLabel(userId: string, id: string): Promise<boolean> {
  await assertWriteAccess(userId);
  const existing = await prisma.accountLabel.findUnique({ where: { id } });
  if (!existing) return false;
  // Assignments cascade per the schema relation.
  await prisma.accountLabel.delete({ where: { id } });
  return true;
}

/**
 * Replace semantics: the account's label set becomes exactly `labelIds`.
 * Returns null when the account does not exist (route maps that to 404);
 * throws LabelValidationError for unknown label ids.
 */
export async function setAccountLabels(
  userId: string,
  accountId: string,
  labelIds: string[]
): Promise<AccountLabelDto[] | null> {
  await assertWriteAccess(userId);
  if (!Array.isArray(labelIds) || labelIds.some((id) => typeof id !== "string")) {
    throw new LabelValidationError("labelIds must be an array of label ids.");
  }
  const uniqueIds = [...new Set(labelIds)];

  const account = await prisma.managedAccount.findUnique({
    where: { id: accountId },
    select: { id: true },
  });
  if (!account) return null;

  const labels = uniqueIds.length
    ? await prisma.accountLabel.findMany({ where: { id: { in: uniqueIds } } })
    : [];
  if (labels.length !== uniqueIds.length) {
    const found = new Set(labels.map((l) => l.id));
    const missing = uniqueIds.filter((id) => !found.has(id));
    throw new LabelValidationError(`Unknown label id(s): ${missing.join(", ")}`);
  }

  await prisma.$transaction([
    prisma.accountLabelAssignment.deleteMany({ where: { accountId } }),
    prisma.accountLabelAssignment.createMany({
      data: uniqueIds.map((labelId) => ({ accountId, labelId })),
    }),
  ]);

  return labels
    .map((l) => ({ id: l.id, name: l.name, color: l.color }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Bulk fetch, no permission check — internal helper for services that have
 * already authorized the caller (e.g. account-performance fed-silent).
 */
export async function getLabelsForAccounts(
  accountIds: string[]
): Promise<Map<string, AccountLabelDto[]>> {
  const map = new Map<string, AccountLabelDto[]>();
  if (accountIds.length === 0) return map;
  const rows = await prisma.accountLabelAssignment.findMany({
    where: { accountId: { in: accountIds } },
    select: {
      accountId: true,
      label: { select: { id: true, name: true, color: true } },
    },
    orderBy: { label: { name: "asc" } },
  });
  for (const r of rows) {
    const arr = map.get(r.accountId) ?? [];
    arr.push(r.label);
    map.set(r.accountId, arr);
  }
  return map;
}
