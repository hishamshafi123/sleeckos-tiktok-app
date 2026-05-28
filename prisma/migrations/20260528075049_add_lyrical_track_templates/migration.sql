-- AlterTable
ALTER TABLE "GenreBatchItem" ADD COLUMN     "lyricalTemplateId" TEXT;

-- AlterTable
ALTER TABLE "Track" ADD COLUMN     "isLyrical" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lyricalTranscription" TEXT;

-- CreateTable
CREATE TABLE "TrackLyricalTemplate" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "fontFamily" TEXT NOT NULL DEFAULT 'Montserrat-Black',
    "fontSize" INTEGER NOT NULL DEFAULT 48,
    "activeColor" TEXT NOT NULL DEFAULT 'multi',
    "strokeWidth" INTEGER NOT NULL DEFAULT 5,
    "strokeColor" TEXT NOT NULL DEFAULT '#000000',
    "positionY" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
    "overlayVideoUrl" TEXT,
    "previewImageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackLyricalTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackLyricalTemplate_trackId_templateName_key" ON "TrackLyricalTemplate"("trackId", "templateName");

-- AddForeignKey
ALTER TABLE "TrackLyricalTemplate" ADD CONSTRAINT "TrackLyricalTemplate_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenreBatchItem" ADD CONSTRAINT "GenreBatchItem_lyricalTemplateId_fkey" FOREIGN KEY ("lyricalTemplateId") REFERENCES "TrackLyricalTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
