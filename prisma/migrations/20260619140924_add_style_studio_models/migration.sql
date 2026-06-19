-- CreateTable
CREATE TABLE "StyleTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "paramSchema" TEXT NOT NULL,
    "thumbnail" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StyleTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedStyle" (
    "id" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "params" TEXT NOT NULL,
    "thumbnail" TEXT,
    "createdBy" TEXT,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedStyle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StyleRenderJob" (
    "id" TEXT NOT NULL,
    "savedStyleId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "outputUrl" TEXT,
    "inputProps" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StyleRenderJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StyleTemplate_key_key" ON "StyleTemplate"("key");
