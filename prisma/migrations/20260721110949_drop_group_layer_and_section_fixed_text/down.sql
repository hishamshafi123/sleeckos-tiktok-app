-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK for 20260721110949_drop_group_layer_and_section_fixed_text
--
-- Prisma does not run down migrations natively. To roll back, apply this file
-- manually, e.g.:  psql "$DATABASE_URL" -f prisma/migrations/20260721110949_drop_group_layer_and_section_fixed_text/down.sql
--
-- Restores: AccountGroup table (from _MigrationBackup_Group), ManagedAccount.groupId
-- (from _MigrationBackup_AccountGroup), AccountSection fixed-text columns
-- (from _MigrationBackup_SectionFixedText). Removes Campaign.fixedText and
-- ManagedAccount.sectionId. The _MigrationBackup_* tables are left in place.
--
-- NOTE: also revert prisma/schema.prisma to the pre-migration state (git) so the
-- Prisma client matches again.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Recreate the AccountGroup table exactly as it was.
CREATE TABLE "AccountGroup" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "defaultDescription" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountGroup_sectionId_slug_key" ON "AccountGroup"("sectionId", "slug");

-- 2. Restore every group row from the backup (casts reverse the text snapshot).
INSERT INTO "AccountGroup"
  ("id", "sectionId", "name", "slug", "description", "defaultDescription", "isActive", "sortOrder", "createdAt", "updatedAt")
SELECT
  "id",
  "sectionId",
  "name",
  "slug",
  "description",
  "defaultDescription",
  COALESCE("isActive", 'true')::boolean,
  COALESCE("sortOrder", '0')::integer,
  COALESCE("createdAt", now()::text)::timestamp(3),
  COALESCE("updatedAt", now()::text)::timestamp(3)
FROM "_MigrationBackup_Group";

ALTER TABLE "AccountGroup"
  ADD CONSTRAINT "AccountGroup_sectionId_fkey"
  FOREIGN KEY ("sectionId") REFERENCES "AccountSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Re-link accounts to their original groups.
ALTER TABLE "ManagedAccount" ADD COLUMN "groupId" TEXT;

UPDATE "ManagedAccount" a
SET "groupId" = b."groupId"
FROM "_MigrationBackup_AccountGroup" b
WHERE b."accountId" = a."id";

-- Accounts created AFTER the flattening have no backup row; anchor them to a
-- deterministic group within their own section so the NOT NULL constraint holds.
-- (Review and move them manually afterwards.)
DO $$
DECLARE
  unmapped_count INTEGER;
BEGIN
  SELECT count(*) INTO unmapped_count FROM "ManagedAccount" WHERE "groupId" IS NULL;
  IF unmapped_count > 0 THEN
    RAISE WARNING '% account(s) created after the flattening had no group backup; assigning them to the first group of their section', unmapped_count;
    UPDATE "ManagedAccount" a
    SET "groupId" = (
      SELECT g."id" FROM "AccountGroup" g
      WHERE g."sectionId" = a."sectionId"
      ORDER BY g."sortOrder" ASC, g."createdAt" ASC
      LIMIT 1
    )
    WHERE a."groupId" IS NULL;
  END IF;
END $$;

ALTER TABLE "ManagedAccount" ALTER COLUMN "groupId" SET NOT NULL;

ALTER TABLE "ManagedAccount"
  ADD CONSTRAINT "ManagedAccount_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "AccountGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Restore Section fixed-text columns and their values.
ALTER TABLE "AccountSection" ADD COLUMN "descFixedText" TEXT;
ALTER TABLE "AccountSection" ADD COLUMN "descFixedTextEnabled" BOOLEAN NOT NULL DEFAULT true;

UPDATE "AccountSection" s
SET
  "descFixedText" = b."descFixedText",
  "descFixedTextEnabled" = COALESCE(b."descFixedTextEnabled", 'true')::boolean
FROM "_MigrationBackup_SectionFixedText" b
WHERE b."sectionId" = s."id";

-- 5. Remove the post-migration structures.
ALTER TABLE "Campaign" DROP COLUMN "fixedText";

ALTER TABLE "ManagedAccount" DROP CONSTRAINT "ManagedAccount_sectionId_fkey";
DROP INDEX "ManagedAccount_sectionId_idx";
ALTER TABLE "ManagedAccount" DROP COLUMN "sectionId";
