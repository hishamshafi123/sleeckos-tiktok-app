-- CreateTable
CREATE TABLE "ApiClientStateAccess" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "allStates" BOOLEAN NOT NULL DEFAULT true,
    "stateNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiClientStateAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StateAccountShare" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "label" TEXT,
    "allStates" BOOLEAN NOT NULL DEFAULT true,
    "stateNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "StateAccountShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiClientStateAccess_clientId_key" ON "ApiClientStateAccess"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "StateAccountShare_code_key" ON "StateAccountShare"("code");

-- CreateIndex
CREATE INDEX "StateAccountShare_revokedAt_idx" ON "StateAccountShare"("revokedAt");

-- AddForeignKey
ALTER TABLE "ApiClientStateAccess" ADD CONSTRAINT "ApiClientStateAccess_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ApiClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
