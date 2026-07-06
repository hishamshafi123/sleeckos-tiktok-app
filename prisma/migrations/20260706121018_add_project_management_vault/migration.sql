-- CreateTable
CREATE TABLE "VaultFolder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentFolderId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultFolderAccess" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "userId" TEXT,
    "roleKey" TEXT,
    "permission" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultFolderAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sheet" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SheetColumn" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SheetColumn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SheetRow" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SheetRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SheetCell" (
    "id" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "columnId" TEXT NOT NULL,
    "value" TEXT,
    "valueEncrypted" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SheetCell_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VaultFolderAccess_folderId_userId_key" ON "VaultFolderAccess"("folderId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "VaultFolderAccess_folderId_roleKey_key" ON "VaultFolderAccess"("folderId", "roleKey");

-- CreateIndex
CREATE UNIQUE INDEX "SheetColumn_sheetId_name_key" ON "SheetColumn"("sheetId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SheetCell_rowId_columnId_key" ON "SheetCell"("rowId", "columnId");

-- AddForeignKey
ALTER TABLE "VaultFolder" ADD CONSTRAINT "VaultFolder_parentFolderId_fkey" FOREIGN KEY ("parentFolderId") REFERENCES "VaultFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultFolderAccess" ADD CONSTRAINT "VaultFolderAccess_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "VaultFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sheet" ADD CONSTRAINT "Sheet_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "VaultFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetColumn" ADD CONSTRAINT "SheetColumn_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "Sheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetRow" ADD CONSTRAINT "SheetRow_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "Sheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetCell" ADD CONSTRAINT "SheetCell_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "SheetRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetCell" ADD CONSTRAINT "SheetCell_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "SheetColumn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
