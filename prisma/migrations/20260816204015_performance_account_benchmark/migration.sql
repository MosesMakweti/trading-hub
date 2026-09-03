-- CreateEnum
CREATE TYPE "InitialStopSource" AS ENUM ('ACTUAL', 'PLANNED');

-- AlterTable
ALTER TABLE "TradingAccount" ADD COLUMN     "compoundingEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "currency" TEXT,
ADD COLUMN     "defaultRiskPercent" DECIMAL(6,3),
ADD COLUMN     "effectiveDate" DATE,
ADD COLUMN     "maxRiskPercent" DECIMAL(6,3);

-- CreateTable
CREATE TABLE "PerformanceRiskSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "performanceAccountId" TEXT NOT NULL,
    "planVersionId" TEXT,
    "balanceBefore" DECIMAL(14,2) NOT NULL,
    "riskPercent" DECIMAL(6,3) NOT NULL,
    "riskAmount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "actualEntry" DECIMAL(18,8) NOT NULL,
    "direction" "Direction" NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "initialStop" DECIMAL(18,8),
    "initialStopSource" "InitialStopSource",
    "realizedR" DECIMAL(8,4),
    "performancePnl" DECIMAL(14,2),
    "settledAt" TIMESTAMP(3),
    "calculationVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerformanceRiskSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceRiskSnapshot_tradeId_key" ON "PerformanceRiskSnapshot"("tradeId");

-- CreateIndex
CREATE INDEX "PerformanceRiskSnapshot_userId_idx" ON "PerformanceRiskSnapshot"("userId");

-- CreateIndex
CREATE INDEX "PerformanceRiskSnapshot_performanceAccountId_idx" ON "PerformanceRiskSnapshot"("performanceAccountId");

-- AddForeignKey
ALTER TABLE "PerformanceRiskSnapshot" ADD CONSTRAINT "PerformanceRiskSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceRiskSnapshot" ADD CONSTRAINT "PerformanceRiskSnapshot_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceRiskSnapshot" ADD CONSTRAINT "PerformanceRiskSnapshot_performanceAccountId_fkey" FOREIGN KEY ("performanceAccountId") REFERENCES "TradingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceRiskSnapshot" ADD CONSTRAINT "PerformanceRiskSnapshot_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "TradePlanVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
