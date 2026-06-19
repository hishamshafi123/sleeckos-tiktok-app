-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");

-- Insert default roles
INSERT INTO "Role" ("id", "key", "label") VALUES
  ('ea9b2a75-b82b-426b-8df7-b088cc10db84', 'admin', 'Administrator'),
  ('ccb47f4d-1b1a-4712-8877-e9a970d4400a', 'team_lead', 'Team Lead'),
  ('fd66133e-e67c-473d-82d2-8b4317f2dfaa', 'editor', 'Editor'),
  ('170cf871-3312-421f-82ff-85f782f9d562', 'curator', 'Curator');

-- CreateTable
CREATE TABLE "RoleDefault" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "toolKey" TEXT NOT NULL,

    CONSTRAINT "RoleDefault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserEntitlement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "toolKey" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,

    CONSTRAINT "UserEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoleDefault_roleId_toolKey_key" ON "RoleDefault"("roleId", "toolKey");

-- CreateIndex
CREATE UNIQUE INDEX "UserEntitlement_userId_toolKey_key" ON "UserEntitlement"("userId", "toolKey");

-- Add temporary nullable roleId to User
ALTER TABLE "User" ADD COLUMN "roleId" TEXT;

-- Update existing users to admin role ID
UPDATE "User" SET "roleId" = 'ea9b2a75-b82b-426b-8df7-b088cc10db84';

-- Make roleId NOT NULL
ALTER TABLE "User" ALTER COLUMN "roleId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleDefault" ADD CONSTRAINT "RoleDefault_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserEntitlement" ADD CONSTRAINT "UserEntitlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Convert UserStatus enum values with data
ALTER TABLE "User" ALTER COLUMN "status" DROP DEFAULT;
CREATE TYPE "UserStatus_new" AS ENUM ('ACTIVE', 'TRIAL', 'DISABLED');
ALTER TABLE "User" ALTER COLUMN "status" TYPE "UserStatus_new" USING (
  CASE "status"::text
    WHEN 'APPROVED' THEN 'ACTIVE'::"UserStatus_new"
    WHEN 'PENDING' THEN 'TRIAL'::"UserStatus_new"
    WHEN 'SUSPENDED' THEN 'DISABLED'::"UserStatus_new"
    ELSE 'TRIAL'::"UserStatus_new"
  END
);
ALTER TYPE "UserStatus" RENAME TO "UserStatus_old";
ALTER TYPE "UserStatus_new" RENAME TO "UserStatus";
DROP TYPE "UserStatus_old";
ALTER TABLE "User" ALTER COLUMN "status" SET DEFAULT 'TRIAL';

-- Drop old role column and type
ALTER TABLE "User" DROP COLUMN "role";
DROP TYPE "UserRole";
