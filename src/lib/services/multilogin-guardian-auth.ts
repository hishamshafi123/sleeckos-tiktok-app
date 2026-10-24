import { createHash, timingSafeEqual } from "crypto";

export type GuardianAuthStatus = "ok" | "missing" | "invalid";

export function getGuardianAuthStatus(
  supplied: string | null,
  expected = process.env.GUARDIAN_INTEGRATION_SECRET
): GuardianAuthStatus {
  if (!expected) return "missing";
  const expectedDigest = createHash("sha256").update(expected).digest();
  const suppliedDigest = createHash("sha256").update(supplied ?? "").digest();
  return timingSafeEqual(expectedDigest, suppliedDigest) ? "ok" : "invalid";
}
