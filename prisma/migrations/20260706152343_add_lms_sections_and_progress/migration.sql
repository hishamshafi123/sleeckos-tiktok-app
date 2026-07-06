/*
  Warnings:

  - You are about to drop the column `sopMarkdown` on the `Lesson` table. All the data in the column will be lost.
  - You are about to drop the column `youtubeUrl` on the `Lesson` table. All the data in the column will be lost.
  - Added the required column `stepsMarkdown` to the `Lesson` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Lesson" DROP COLUMN "sopMarkdown",
DROP COLUMN "youtubeUrl",
ADD COLUMN     "resources" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "sectionId" TEXT,
ADD COLUMN     "stepsMarkdown" TEXT NOT NULL,
ADD COLUMN     "youtubeVideoId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "LessonProgress" ADD COLUMN     "lastPositionSec" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "watchedPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
ALTER COLUMN "completedAt" DROP NOT NULL,
ALTER COLUMN "completedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Section" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE SET NULL ON UPDATE CASCADE;
