-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerEventType" ADD VALUE 'OTHER_FEE';
ALTER TYPE "LedgerEventType" ADD VALUE 'DEPOSIT';
ALTER TYPE "LedgerEventType" ADD VALUE 'WITHDRAWAL';
ALTER TYPE "LedgerEventType" ADD VALUE 'CREDIT';
ALTER TYPE "LedgerEventType" ADD VALUE 'BALANCE_CORRECTION';

-- AlterEnum
ALTER TYPE "LedgerSourceType" ADD VALUE 'IMPORTED_TRANSACTION';
