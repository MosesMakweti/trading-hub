-- CreateEnum
CREATE TYPE "PropFirmImportPlatform" AS ENUM ('MT4', 'MT5', 'CTRADER', 'NINJATRADER', 'TRADOVATE', 'GENERIC_CSV');

-- CreateEnum
CREATE TYPE "PropFirmImportFileFormat" AS ENUM ('CSV', 'HTML', 'XML');

-- CreateEnum
CREATE TYPE "PropFirmImportBatchStatus" AS ENUM ('CONFIRMED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "PropFirmTransactionClassification" AS ENUM ('DEPOSIT', 'WITHDRAWAL_PAYOUT', 'WITHDRAWAL_UNCLASSIFIED', 'INTERNAL_TRANSFER', 'ACCOUNT_RESET', 'FEE', 'COMMISSION', 'REFUND', 'BALANCE_CORRECTION', 'CREDIT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PropFirmImportedTradeStatus" AS ENUM ('OPEN', 'PARTIAL', 'CLOSED');

-- AlterTable
ALTER TABLE "Payout" ADD COLUMN     "importBatchId" TEXT,
ADD COLUMN     "platformTransactionId" TEXT,
ADD COLUMN     "sourceTransactionId" TEXT;

-- CreateTable
CREATE TABLE "PropFirmImportBatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "platform" "PropFirmImportPlatform" NOT NULL,
    "fileFormat" "PropFirmImportFileFormat" NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "PropFirmImportBatchStatus" NOT NULL DEFAULT 'CONFIRMED',
    "dateRangeFrom" TIMESTAMP(3),
    "dateRangeTo" TIMESTAMP(3),
    "newExecutionsCount" INTEGER NOT NULL DEFAULT 0,
    "newTradesCount" INTEGER NOT NULL DEFAULT 0,
    "newPayoutsCount" INTEGER NOT NULL DEFAULT 0,
    "skippedDuplicatesCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedRowsCount" INTEGER NOT NULL DEFAULT 0,
    "warnings" JSONB,
    "mappingTemplateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rolledBackAt" TIMESTAMP(3),

    CONSTRAINT "PropFirmImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropFirmImportedExecution" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "platform" "PropFirmImportPlatform" NOT NULL,
    "platformExecutionId" TEXT,
    "platformOrderId" TEXT,
    "platformDealId" TEXT,
    "instrumentRaw" TEXT NOT NULL,
    "instrumentNormalized" TEXT NOT NULL,
    "direction" "Direction" NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "price" DECIMAL(18,8) NOT NULL,
    "grossPnl" DECIMAL(14,2),
    "commission" DECIMAL(14,2),
    "swap" DECIMAL(14,2),
    "otherFees" DECIMAL(14,2),
    "currency" TEXT,
    "executedAt" TIMESTAMP(3) NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "rawRow" JSONB NOT NULL,
    "reconstructedTradeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropFirmImportedExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropFirmImportedTrade" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "instrument" TEXT NOT NULL,
    "direction" "Direction" NOT NULL,
    "status" "PropFirmImportedTradeStatus" NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "entryCount" INTEGER NOT NULL,
    "exitCount" INTEGER NOT NULL,
    "totalQuantity" DECIMAL(14,4) NOT NULL,
    "avgEntryPrice" DECIMAL(18,8) NOT NULL,
    "avgExitPrice" DECIMAL(18,8),
    "grossPnl" DECIMAL(14,2) NOT NULL,
    "commission" DECIMAL(14,2) NOT NULL,
    "swap" DECIMAL(14,2) NOT NULL,
    "otherFees" DECIMAL(14,2) NOT NULL,
    "netPnl" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropFirmImportedTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropFirmTransaction" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "platform" "PropFirmImportPlatform" NOT NULL,
    "platformTransactionId" TEXT,
    "rawType" TEXT NOT NULL,
    "classification" "PropFirmTransactionClassification" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "rawRow" JSONB NOT NULL,
    "requiresReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropFirmTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropFirmImportMappingTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" "PropFirmImportPlatform" NOT NULL,
    "columnMapping" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropFirmImportMappingTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PropFirmImportBatch_accountId_createdAt_idx" ON "PropFirmImportBatch"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "PropFirmImportedExecution_importBatchId_idx" ON "PropFirmImportedExecution"("importBatchId");

-- CreateIndex
CREATE INDEX "PropFirmImportedExecution_reconstructedTradeId_idx" ON "PropFirmImportedExecution"("reconstructedTradeId");

-- CreateIndex
CREATE UNIQUE INDEX "PropFirmImportedExecution_accountId_dedupeKey_key" ON "PropFirmImportedExecution"("accountId", "dedupeKey");

-- CreateIndex
CREATE INDEX "PropFirmImportedTrade_accountId_idx" ON "PropFirmImportedTrade"("accountId");

-- CreateIndex
CREATE INDEX "PropFirmTransaction_importBatchId_idx" ON "PropFirmTransaction"("importBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "PropFirmTransaction_accountId_dedupeKey_key" ON "PropFirmTransaction"("accountId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "PropFirmImportMappingTemplate_userId_name_key" ON "PropFirmImportMappingTemplate"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_sourceTransactionId_key" ON "Payout"("sourceTransactionId");

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "PropFirmImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_sourceTransactionId_fkey" FOREIGN KEY ("sourceTransactionId") REFERENCES "PropFirmTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropFirmImportBatch" ADD CONSTRAINT "PropFirmImportBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropFirmImportBatch" ADD CONSTRAINT "PropFirmImportBatch_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PropFirmAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropFirmImportBatch" ADD CONSTRAINT "PropFirmImportBatch_mappingTemplateId_fkey" FOREIGN KEY ("mappingTemplateId") REFERENCES "PropFirmImportMappingTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropFirmImportedExecution" ADD CONSTRAINT "PropFirmImportedExecution_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PropFirmAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropFirmImportedExecution" ADD CONSTRAINT "PropFirmImportedExecution_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "PropFirmImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropFirmImportedExecution" ADD CONSTRAINT "PropFirmImportedExecution_reconstructedTradeId_fkey" FOREIGN KEY ("reconstructedTradeId") REFERENCES "PropFirmImportedTrade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropFirmImportedTrade" ADD CONSTRAINT "PropFirmImportedTrade_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PropFirmAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropFirmTransaction" ADD CONSTRAINT "PropFirmTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PropFirmAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropFirmTransaction" ADD CONSTRAINT "PropFirmTransaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "PropFirmImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropFirmImportMappingTemplate" ADD CONSTRAINT "PropFirmImportMappingTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

