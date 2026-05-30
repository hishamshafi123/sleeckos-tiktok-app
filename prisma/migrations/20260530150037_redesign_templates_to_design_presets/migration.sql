/*
  Warnings:

  - You are about to drop the column `hookCount` on the `MultiplierTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `hooks` on the `MultiplierTemplate` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "MultiplierItem" ADD COLUMN     "templateId" TEXT;

-- AlterTable
ALTER TABLE "MultiplierTemplate" DROP COLUMN "hookCount",
DROP COLUMN "hooks",
ADD COLUMN     "bgStripColor" TEXT NOT NULL DEFAULT '#000000',
ADD COLUMN     "bgStripOpacity" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
ADD COLUMN     "borderRadius" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN     "fontColor" TEXT NOT NULL DEFAULT '#FFFFFF',
ADD COLUMN     "fontFamily" TEXT NOT NULL DEFAULT 'Outfit-Bold',
ADD COLUMN     "fontSize" INTEGER NOT NULL DEFAULT 42,
ADD COLUMN     "glowColor" TEXT NOT NULL DEFAULT '#FF00FF',
ADD COLUMN     "glowEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "glowIntensity" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "letterSpacing" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
ADD COLUMN     "lineHeight" DOUBLE PRECISION NOT NULL DEFAULT 1.4,
ADD COLUMN     "marginX" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paddingX" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "paddingY" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "positionYPercent" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "shadowColor" TEXT NOT NULL DEFAULT '#000000',
ADD COLUMN     "shadowEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shadowX" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "shadowY" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "stripBorderColor" TEXT NOT NULL DEFAULT '#FFFFFF',
ADD COLUMN     "stripBorderEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripBorderWidth" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "stripShadowColor" TEXT NOT NULL DEFAULT '#000000',
ADD COLUMN     "stripShadowEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripShadowOffset" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "stripWidthMode" TEXT NOT NULL DEFAULT 'FULL',
ADD COLUMN     "stripWidthPercent" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "strokeColor" TEXT NOT NULL DEFAULT '#000000',
ADD COLUMN     "strokeEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "strokeWidth" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "textAlign" TEXT NOT NULL DEFAULT 'CENTER',
ADD COLUMN     "textCase" TEXT NOT NULL DEFAULT 'UPPERCASE';
