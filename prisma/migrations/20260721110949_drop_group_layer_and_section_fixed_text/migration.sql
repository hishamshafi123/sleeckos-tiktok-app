-- DropForeignKey
ALTER TABLE "AccountGroup" DROP CONSTRAINT "AccountGroup_sectionId_fkey";

-- DropForeignKey
ALTER TABLE "ManagedAccount" DROP CONSTRAINT "ManagedAccount_groupId_fkey";

-- AlterTable
ALTER TABLE "AccountSection" DROP COLUMN "descFixedText",
DROP COLUMN "descFixedTextEnabled";

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "fixedText" TEXT;

-- AlterTable
ALTER TABLE "ManagedAccount" DROP COLUMN "groupId";

-- DropTable
DROP TABLE "AccountGroup";

-- NOTE: the _MigrationBackup_* preservation tables intentionally survive this
-- migration. They are the rollback source (see down.sql) and power the admin
-- migration report used to manually reassign fixed text to Campaigns.
