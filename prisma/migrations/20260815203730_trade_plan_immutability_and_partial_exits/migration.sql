-- CreateEnum
CREATE TYPE "PartialExitSource" AS ENUM ('CONFIRMED', 'MANUAL', 'IMPORTED');

-- AlterTable
ALTER TABLE "TradePlanVersion" ADD COLUMN     "annotationsSnapshot" JSONB;

-- CreateTable
CREATE TABLE "TradeActualPartialExit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "accountExecutionId" TEXT,
    "plannedTargetId" TEXT,
    "exitOrder" INTEGER NOT NULL,
    "exitPrice" DECIMAL(18,8) NOT NULL,
    "percentClosed" DECIMAL(5,2),
    "quantityClosed" DECIMAL(14,4),
    "exitedAt" TIMESTAMP(3) NOT NULL,
    "grossPnl" DECIMAL(14,2),
    "fees" DECIMAL(14,2),
    "netPnl" DECIMAL(14,2),
    "realizedR" DECIMAL(8,4),
    "notes" TEXT,
    "source" "PartialExitSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeActualPartialExit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradeActualPartialExit_tradeId_idx" ON "TradeActualPartialExit"("tradeId");

-- CreateIndex
CREATE INDEX "TradeActualPartialExit_accountExecutionId_idx" ON "TradeActualPartialExit"("accountExecutionId");

-- CreateIndex
CREATE INDEX "TradeActualPartialExit_plannedTargetId_idx" ON "TradeActualPartialExit"("plannedTargetId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeActualPartialExit_tradeId_exitOrder_key" ON "TradeActualPartialExit"("tradeId", "exitOrder");

-- AddForeignKey
ALTER TABLE "TradeActualPartialExit" ADD CONSTRAINT "TradeActualPartialExit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeActualPartialExit" ADD CONSTRAINT "TradeActualPartialExit_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeActualPartialExit" ADD CONSTRAINT "TradeActualPartialExit_accountExecutionId_fkey" FOREIGN KEY ("accountExecutionId") REFERENCES "TradeAccountExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeActualPartialExit" ADD CONSTRAINT "TradeActualPartialExit_plannedTargetId_fkey" FOREIGN KEY ("plannedTargetId") REFERENCES "PlannedTarget"("id") ON DELETE SET NULL ON UPDATE CASCADE;

