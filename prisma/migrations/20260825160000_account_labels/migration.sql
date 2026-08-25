-- CreateTable
CREATE TABLE "AccountLabel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountLabelAssignment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountLabelAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountLabel_name_key" ON "AccountLabel"("name");

-- CreateIndex
CREATE INDEX "AccountLabelAssignment_labelId_idx" ON "AccountLabelAssignment"("labelId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountLabelAssignment_accountId_labelId_key" ON "AccountLabelAssignment"("accountId", "labelId");

-- AddForeignKey
ALTER TABLE "AccountLabelAssignment" ADD CONSTRAINT "AccountLabelAssignment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ManagedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountLabelAssignment" ADD CONSTRAINT "AccountLabelAssignment_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "AccountLabel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
