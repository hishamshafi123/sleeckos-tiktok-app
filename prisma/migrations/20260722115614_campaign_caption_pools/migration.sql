-- AlterTable
ALTER TABLE "AccountSection" DROP COLUMN "defaultDescription";

-- AlterTable
ALTER TABLE "Campaign"
ADD COLUMN     "descTagCount" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "descTags" TEXT,
ADD COLUMN     "fixedTexts" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill: carry the legacy single fixedText into the new fixedTexts pool
-- before the column is dropped.
UPDATE "Campaign" SET "fixedTexts" = ARRAY["fixedText"] WHERE "fixedText" IS NOT NULL AND btrim("fixedText") <> '';

-- AlterTable
ALTER TABLE "Campaign" DROP COLUMN "fixedText";

-- AlterTable
ALTER TABLE "ManagedAccount" DROP COLUMN "captionSource",
DROP COLUMN "defaultCaption";

-- NOTE: the _MigrationBackup_* preservation tables intentionally survive this
-- migration (they back the admin migration-report worksheet).
