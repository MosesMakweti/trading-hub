-- CreateEnum
CREATE TYPE "RiskEntryMode" AS ENUM ('PERCENT', 'AMOUNT', 'FIXED_SIZE');

-- CreateEnum
CREATE TYPE "RiskBasis" AS ENUM ('CURRENT_BALANCE', 'CURRENT_EQUITY', 'STAGE_STARTING_BALANCE');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('PLANNED', 'OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LedgerEventType" AS ENUM ('ACCOUNT_INITIALIZED', 'TRADE_PNL', 'MANUAL_ADJUSTMENT', 'COMMISSION_FEE', 'CHALLENGE_PURCHASE_FEE', 'RESET_FEE', 'ACTIVATION_FEE', 'PAYOUT', 'REFUND', 'STAGE_PASSED', 'STAGE_FAILED', 'ACCOUNT_BREACHED', 'STAGE_STARTING_BALANCE_RESET', 'CUSTOM_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "LedgerSourceType" AS ENUM ('TRADE_EXECUTION', 'PAYOUT', 'STAGE_TRANSITION', 'ACCOUNT_INIT', 'MANUAL');

-- AlterTable
ALTER TABLE "PropFirmAccount" ADD COLUMN     "dailyResetHour" INTEGER DEFAULT 0,
ADD COLUMN     "dailyResetTimezone" TEXT;

-- AlterTable
ALTER TABLE "StageRule" ADD COLUMN     "criticalThreshold" DECIMAL(14,4);

-- CreateTable
CREATE TABLE "TradeAccountExecution" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "propFirmAccountId" TEXT NOT NULL,
    "accountStageId" TEXT NOT NULL,
    "riskEntryMode" "RiskEntryMode" NOT NULL,
    "riskBasis" "RiskBasis" NOT NULL,
    "riskInputValue" DECIMAL(14,4) NOT NULL,
    "plannedRiskAmount" DECIMAL(14,2) NOT NULL,
    "plannedPositionSize" DECIMAL(14,4),
    "positionSizeMissingReason" TEXT,
    "plannedEntryOverride" DECIMAL(18,8),
    "plannedStopLossOverride" DECIMAL(18,8),
    "plannedTargetOverride" DECIMAL(18,8),
    "plannedR" DECIMAL(8,4),
    "actualEntry" DECIMAL(18,8),
    "actualExit" DECIMAL(18,8),
    "actualLotSize" DECIMAL(14,4),
    "actualContractQty" DECIMAL(14,4),
    "grossPnl" DECIMAL(14,2),
    "commission" DECIMAL(14,2),
    "swapFinancing" DECIMAL(14,2),
    "otherFees" DECIMAL(14,2),
    "netPnl" DECIMAL(14,2),
    "isPnlEstimated" BOOLEAN NOT NULL DEFAULT false,
    "actualR" DECIMAL(8,4),
    "status" "ExecutionStatus" NOT NULL DEFAULT 'PLANNED',
    "executionNotes" TEXT,
    "plannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TradeAccountExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountLedgerEntry" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "stageId" TEXT,
    "eventType" "LedgerEventType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "balanceAfter" DECIMAL(14,2) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "sourceType" "LedgerSourceType",
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradeAccountExecution_userId_propFirmAccountId_deletedAt_idx" ON "TradeAccountExecution"("userId", "propFirmAccountId", "deletedAt");

-- CreateIndex
CREATE INDEX "TradeAccountExecution_accountStageId_idx" ON "TradeAccountExecution"("accountStageId");

-- CreateIndex
CREATE INDEX "TradeAccountExecution_tradeId_idx" ON "TradeAccountExecution"("tradeId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeAccountExecution_tradeId_propFirmAccountId_key" ON "TradeAccountExecution"("tradeId", "propFirmAccountId");

-- CreateIndex
CREATE INDEX "AccountLedgerEntry_accountId_occurredAt_idx" ON "AccountLedgerEntry"("accountId", "occurredAt");

-- CreateIndex
CREATE INDEX "AccountLedgerEntry_stageId_idx" ON "AccountLedgerEntry"("stageId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountLedgerEntry_sourceType_sourceId_eventType_key" ON "AccountLedgerEntry"("sourceType", "sourceId", "eventType");

-- AddForeignKey
ALTER TABLE "TradeAccountExecution" ADD CONSTRAINT "TradeAccountExecution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeAccountExecution" ADD CONSTRAINT "TradeAccountExecution_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeAccountExecution" ADD CONSTRAINT "TradeAccountExecution_propFirmAccountId_fkey" FOREIGN KEY ("propFirmAccountId") REFERENCES "PropFirmAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeAccountExecution" ADD CONSTRAINT "TradeAccountExecution_accountStageId_fkey" FOREIGN KEY ("accountStageId") REFERENCES "AccountStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountLedgerEntry" ADD CONSTRAINT "AccountLedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PropFirmAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountLedgerEntry" ADD CONSTRAINT "AccountLedgerEntry_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "AccountStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
