/*
  Warnings:

  - The values [CREATOR,BRAND_OWNER] on the enum `UserRole` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `brandId` on the `Campaign` table. All the data in the column will be lost.
  - You are about to drop the `Application` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `AuditLog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Brand` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CreatorProfile` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Deliverable` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PostMetric` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TiktokAccount` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "UserRole_new" AS ENUM ('ADMIN');
ALTER TABLE "public"."User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "public"."UserRole_old";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'ADMIN';
COMMIT;

-- DropForeignKey
ALTER TABLE "Application" DROP CONSTRAINT "Application_campaignId_fkey";

-- DropForeignKey
ALTER TABLE "Application" DROP CONSTRAINT "Application_creatorUserId_fkey";

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_actorUserId_fkey";

-- DropForeignKey
ALTER TABLE "Brand" DROP CONSTRAINT "Brand_approvedById_fkey";

-- DropForeignKey
ALTER TABLE "Brand" DROP CONSTRAINT "Brand_ownerUserId_fkey";

-- DropForeignKey
ALTER TABLE "Campaign" DROP CONSTRAINT "Campaign_brandId_fkey";

-- DropForeignKey
ALTER TABLE "CreatorProfile" DROP CONSTRAINT "CreatorProfile_approvedById_fkey";

-- DropForeignKey
ALTER TABLE "CreatorProfile" DROP CONSTRAINT "CreatorProfile_userId_fkey";

-- DropForeignKey
ALTER TABLE "Deliverable" DROP CONSTRAINT "Deliverable_applicationId_fkey";

-- DropForeignKey
ALTER TABLE "Deliverable" DROP CONSTRAINT "Deliverable_campaignId_fkey";

-- DropForeignKey
ALTER TABLE "Deliverable" DROP CONSTRAINT "Deliverable_creatorUserId_fkey";

-- DropForeignKey
ALTER TABLE "PostMetric" DROP CONSTRAINT "PostMetric_deliverableId_fkey";

-- DropForeignKey
ALTER TABLE "TiktokAccount" DROP CONSTRAINT "TiktokAccount_userId_fkey";

-- AlterTable
ALTER TABLE "Campaign" DROP COLUMN "brandId";

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'ADMIN';

-- DropTable
DROP TABLE "Application";

-- DropTable
DROP TABLE "AuditLog";

-- DropTable
DROP TABLE "Brand";

-- DropTable
DROP TABLE "CreatorProfile";

-- DropTable
DROP TABLE "Deliverable";

-- DropTable
DROP TABLE "PostMetric";

-- DropTable
DROP TABLE "TiktokAccount";

-- DropEnum
DROP TYPE "ApplicationStatus";

-- DropEnum
DROP TYPE "BrandCategory";

-- DropEnum
DROP TYPE "BrandStatus";

-- DropEnum
DROP TYPE "DeliverableStatus";
