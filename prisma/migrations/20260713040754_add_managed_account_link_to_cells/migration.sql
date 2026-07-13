-- AlterTable
ALTER TABLE "SheetCell" ADD COLUMN     "managedAccountId" TEXT;

-- AddForeignKey
ALTER TABLE "SheetCell" ADD CONSTRAINT "SheetCell_managedAccountId_fkey" FOREIGN KEY ("managedAccountId") REFERENCES "ManagedAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
