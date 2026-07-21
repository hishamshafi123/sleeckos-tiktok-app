-- AlterTable
ALTER TABLE "ManagedAccount" ADD COLUMN     "sectionId" TEXT;

-- CreateIndex
CREATE INDEX "ManagedAccount_sectionId_idx" ON "ManagedAccount"("sectionId");

-- AddForeignKey
ALTER TABLE "ManagedAccount" ADD CONSTRAINT "ManagedAccount_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "AccountSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Data backfill: every account inherits its Group's sectionId ────────────
UPDATE "ManagedAccount" a SET "sectionId" = g."sectionId" FROM "AccountGroup" g WHERE g.id = a."groupId";

-- Guard: refuse to proceed if any account could not be resolved to a section.
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT count(*) INTO orphan_count FROM "ManagedAccount" WHERE "sectionId" IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % ManagedAccount row(s) have NULL sectionId', orphan_count;
  END IF;
END $$;

-- ─── Preservation tables (survive the Group drop; used by down.sql + admin report) ───
-- Every AccountGroup column, stored as plain text for a lossless, type-agnostic snapshot.
CREATE TABLE "_MigrationBackup_Group" (
  "id"                 TEXT PRIMARY KEY,
  "sectionId"          TEXT,
  "name"               TEXT,
  "slug"               TEXT,
  "description"        TEXT,
  "defaultDescription" TEXT,
  "isActive"           TEXT,
  "sortOrder"          TEXT,
  "createdAt"          TEXT,
  "updatedAt"          TEXT
);

INSERT INTO "_MigrationBackup_Group"
  ("id", "sectionId", "name", "slug", "description", "defaultDescription", "isActive", "sortOrder", "createdAt", "updatedAt")
SELECT
  "id", "sectionId", "name", "slug", "description", "defaultDescription",
  "isActive"::text, "sortOrder"::text, "createdAt"::text, "updatedAt"::text
FROM "AccountGroup";

-- Section-level fixed text (removed from AccountSection in the next migration).
CREATE TABLE "_MigrationBackup_SectionFixedText" (
  "sectionId"             TEXT PRIMARY KEY,
  "name"                  TEXT,
  "slug"                  TEXT,
  "descFixedText"         TEXT,
  "descFixedTextEnabled"  TEXT,
  "descTags"              TEXT,
  "descTagCount"          TEXT
);

INSERT INTO "_MigrationBackup_SectionFixedText"
  ("sectionId", "name", "slug", "descFixedText", "descFixedTextEnabled", "descTags", "descTagCount")
SELECT
  "id", "name", "slug", "descFixedText", "descFixedTextEnabled"::text, "descTags", "descTagCount"::text
FROM "AccountSection";

-- Account → Group membership snapshot (required to re-link accounts on rollback).
CREATE TABLE "_MigrationBackup_AccountGroup" (
  "accountId" TEXT PRIMARY KEY,
  "groupId"   TEXT
);

INSERT INTO "_MigrationBackup_AccountGroup" ("accountId", "groupId")
SELECT "id", "groupId" FROM "ManagedAccount";

-- Backfill verified above — make the column required.
ALTER TABLE "ManagedAccount" ALTER COLUMN "sectionId" SET NOT NULL;
