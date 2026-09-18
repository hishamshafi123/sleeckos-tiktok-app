-- AlterTable
ALTER TABLE "ManagedAccount" ADD COLUMN     "createdByUserId" TEXT;

-- CreateIndex
CREATE INDEX "ManagedAccount_createdByUserId_idx" ON "ManagedAccount"("createdByUserId");
CREATE INDEX "ManagedAccount_createdAt_idx" ON "ManagedAccount"("createdAt");

-- CreateTable
CREATE TABLE "AccountLifecycleEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "username" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountLifecycleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountLifecycleEvent_type_createdAt_idx" ON "AccountLifecycleEvent"("type", "createdAt");
CREATE INDEX "AccountLifecycleEvent_username_idx" ON "AccountLifecycleEvent"("username");

-- AddForeignKey
ALTER TABLE "ManagedAccount" ADD CONSTRAINT "ManagedAccount_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccountLifecycleEvent" ADD CONSTRAINT "AccountLifecycleEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
