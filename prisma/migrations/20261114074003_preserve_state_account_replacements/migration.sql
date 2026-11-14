/*
  Warnings:

  - A unique constraint covering the columns `[managedAccountId]` on the table `StateAccount` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[replacedByAccountId]` on the table `StateAccount` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "StateAccount" DROP CONSTRAINT "StateAccount_accountId_fkey";

-- AlterTable
ALTER TABLE "StateAccount" ADD COLUMN     "driveFolderIdSnapshot" TEXT,
ADD COLUMN     "driveFolderNameSnapshot" TEXT,
ADD COLUMN     "managedAccountId" TEXT,
ADD COLUMN     "replacedByAccountId" TEXT,
ADD COLUMN     "replacementOfAccountId" TEXT,
ADD COLUMN     "usernameSnapshot" TEXT NOT NULL DEFAULT '';

-- Preserve current identities before switching to the nullable login relation.
UPDATE "StateAccount" s SET
  "managedAccountId" = a.id,
  "usernameSnapshot" = a."tiktokUsername",
  "driveFolderIdSnapshot" = a."driveFolderId",
  "driveFolderNameSnapshot" = a."driveFolderName",
  "stateName" = COALESCE(NULLIF(s."stateName", ''),
    (SELECT p.name FROM "GuardianPhone" p WHERE p."profileId" = s."guardianProfileId"),
    a."driveFolderName", a."tiktokDisplayName", a."tiktokUsername")
FROM "ManagedAccount" a WHERE a.id = s."accountId";

-- CreateIndex
CREATE UNIQUE INDEX "StateAccount_managedAccountId_key" ON "StateAccount"("managedAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "StateAccount_replacedByAccountId_key" ON "StateAccount"("replacedByAccountId");

-- AddForeignKey
ALTER TABLE "StateAccount" ADD CONSTRAINT "StateAccount_managedAccountId_fkey" FOREIGN KEY ("managedAccountId") REFERENCES "ManagedAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
