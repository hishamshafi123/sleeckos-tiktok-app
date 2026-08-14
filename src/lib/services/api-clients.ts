/**
 * Client API keys — one key per CLIENT, granted access to many campaigns.
 *
 * Replaces per-campaign share codes for API consumers: a client keeps one
 * key forever and only swaps the campaignId in the URL when we run a new
 * campaign for them. Access is granted per campaign (ApiClientCampaign).
 *
 * Keys look like "slk_<30 chars>". Only the SHA-256 hash is stored — the raw
 * key is shown ONCE at creation and can never be retrieved again (revoke and
 * re-issue instead). Legacy per-campaign share codes keep working via
 * track-share.validateCampaignApiKey; the public routes try both.
 */

import crypto from "crypto";
import prisma from "@/lib/db";

const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const KEY_PREFIX = "slk_";
const KEY_BODY_LENGTH = 30;

// Throttle lastUsedAt writes: at most one update per key per 60s.
const LAST_USED_THROTTLE_MS = 60_000;

function hashKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

function generateRawKey(): string {
  let body = "";
  for (let i = 0; i < KEY_BODY_LENGTH; i++) {
    body += KEY_ALPHABET[crypto.randomInt(0, KEY_ALPHABET.length)];
  }
  return KEY_PREFIX + body;
}

// ─── Admin management ────────────────────────────────────────────────────────

/** All clients with their keys (prefixes only) and granted campaigns. */
export async function listApiClients() {
  const clients = await prisma.apiClient.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      keys: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          keyPrefix: true,
          label: true,
          createdAt: true,
          lastUsedAt: true,
          revokedAt: true,
        },
      },
      campaigns: { orderBy: { createdAt: "asc" } },
    },
  });

  // Resolve campaign titles for the granted ids (plain column, no FK).
  const campaignIds = [...new Set(clients.flatMap((c) => c.campaigns.map((g) => g.campaignId)))];
  const campaigns = campaignIds.length
    ? await prisma.campaign.findMany({
        where: { id: { in: campaignIds } },
        select: { id: true, title: true, name: true, status: true },
      })
    : [];
  const titleById = new Map(campaigns.map((c) => [c.id, c.title || c.name || "Campaign"]));

  return clients.map((c) => ({
    id: c.id,
    name: c.name,
    notes: c.notes,
    createdAt: c.createdAt.toISOString(),
    revokedAt: c.revokedAt ? c.revokedAt.toISOString() : null,
    keys: c.keys.map((k) => ({
      ...k,
      createdAt: k.createdAt.toISOString(),
      lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
      revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
    })),
    campaigns: c.campaigns.map((g) => ({
      id: g.id,
      campaignId: g.campaignId,
      campaignTitle: titleById.get(g.campaignId) ?? "(deleted campaign)",
    })),
  }));
}

export async function createApiClient(name: string, notes?: string) {
  const client = await prisma.apiClient.create({
    data: { name: name.trim(), notes: notes?.trim() || null },
  });
  return { id: client.id };
}

/** Revoke the whole client — every key stops working immediately. */
export async function revokeApiClient(clientId: string) {
  await prisma.apiClient.update({
    where: { id: clientId },
    data: { revokedAt: new Date() },
  });
}

/**
 * Generate a new key for a client. Returns the RAW key — this is the only
 * time it is ever visible. Store is hash-only.
 */
export async function generateApiKey(
  clientId: string,
  label?: string
): Promise<{ id: string; rawKey: string }> {
  const rawKey = generateRawKey();
  const key = await prisma.apiClientKey.create({
    data: {
      clientId,
      keyHash: hashKey(rawKey),
      keyPrefix: rawKey.slice(0, 12),
      label: label?.trim() || null,
    },
  });
  return { id: key.id, rawKey };
}

export async function revokeApiKey(keyId: string) {
  await prisma.apiClientKey.update({
    where: { id: keyId },
    data: { revokedAt: new Date() },
  });
}

export async function grantCampaignAccess(clientId: string, campaignId: string) {
  await prisma.apiClientCampaign.upsert({
    where: { clientId_campaignId: { clientId, campaignId } },
    create: { clientId, campaignId },
    update: {},
  });
}

export async function revokeCampaignAccess(clientId: string, campaignId: string) {
  await prisma.apiClientCampaign.deleteMany({ where: { clientId, campaignId } });
}

// ─── Public validation ───────────────────────────────────────────────────────

/**
 * Validate a client API key for a campaign. True only when the key exists,
 * is not revoked, belongs to a non-revoked client, and that client has been
 * granted this campaign. Updates lastUsedAt (throttled) on success.
 */
export async function validateClientApiKey(
  campaignId: string,
  rawKey: string
): Promise<boolean> {
  if (!rawKey.startsWith(KEY_PREFIX)) return false;

  const key = await prisma.apiClientKey.findUnique({
    where: { keyHash: hashKey(rawKey) },
    select: {
      id: true,
      revokedAt: true,
      lastUsedAt: true,
      client: {
        select: {
          revokedAt: true,
          campaigns: { where: { campaignId }, select: { id: true } },
        },
      },
    },
  });

  if (!key || key.revokedAt || key.client.revokedAt) return false;
  if (key.client.campaigns.length === 0) return false;

  // Throttled last-used touch (fire-and-forget — never block the response).
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
    prisma.apiClientKey
      .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
  }
  return true;
}
