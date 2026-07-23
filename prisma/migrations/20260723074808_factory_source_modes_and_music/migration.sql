-- AlterTable
ALTER TABLE "FactoryBatch" ADD COLUMN     "musicAudioRef" TEXT,
ADD COLUMN     "sourceAccountIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "sourceFolderIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "sourceMode" TEXT NOT NULL DEFAULT 'folders';
