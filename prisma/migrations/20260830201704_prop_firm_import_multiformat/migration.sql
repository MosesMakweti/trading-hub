-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PropFirmImportFileFormat" ADD VALUE 'TSV';
ALTER TYPE "PropFirmImportFileFormat" ADD VALUE 'TXT';
ALTER TYPE "PropFirmImportFileFormat" ADD VALUE 'XLSX';
ALTER TYPE "PropFirmImportFileFormat" ADD VALUE 'XLS';

-- AlterTable
ALTER TABLE "PropFirmImportBatch" ADD COLUMN     "sheetOrTableName" TEXT,
ADD COLUMN     "sourceMimeType" TEXT;
