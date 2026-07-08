-- CreateTable
CREATE TABLE "MultiplierGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "transcript" TEXT,
    "transcriptStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "styleId" TEXT NOT NULL,
    "mappingMode" TEXT NOT NULL DEFAULT 'each',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "errorMessage" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MultiplierGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MultiplierGroupVariation" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "videoRef" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MultiplierGroupVariation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MultiplierHook" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MultiplierHook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MultiplierOutput" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "variationId" TEXT NOT NULL,
    "hookId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "outputRef" TEXT,
    "driveFolderId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MultiplierOutput_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "MultiplierGroup" ADD CONSTRAINT "MultiplierGroup_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultiplierGroupVariation" ADD CONSTRAINT "MultiplierGroupVariation_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "MultiplierGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultiplierHook" ADD CONSTRAINT "MultiplierHook_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "MultiplierGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultiplierOutput" ADD CONSTRAINT "MultiplierOutput_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "MultiplierGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultiplierOutput" ADD CONSTRAINT "MultiplierOutput_variationId_fkey" FOREIGN KEY ("variationId") REFERENCES "MultiplierGroupVariation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultiplierOutput" ADD CONSTRAINT "MultiplierOutput_hookId_fkey" FOREIGN KEY ("hookId") REFERENCES "MultiplierHook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
