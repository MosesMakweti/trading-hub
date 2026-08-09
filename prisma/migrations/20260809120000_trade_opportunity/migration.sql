-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('PENDING', 'EXECUTED', 'MISSED', 'INVALIDATED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MissReason" AS ENUM ('FEAR', 'HESITATION', 'FOMO_ELSEWHERE', 'DISTRACTED', 'MISSED_ALERT', 'LATE_CONFIRMATION', 'RISK_CONCERNS', 'TECHNICAL_ISSUE', 'RULE_UNCERTAINTY', 'INTENTIONAL_SKIP', 'OTHER');

-- CreateEnum
CREATE TYPE "MissedOutcome" AS ENUM ('MISSED_WIN', 'MISSED_LOSS', 'MISSED_BREAKEVEN', 'MISSED_UNDETERMINED');

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "opportunityId" TEXT;

-- CreateTable
CREATE TABLE "TradeOpportunity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "spottedAt" DATE NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "direction" "Direction" NOT NULL,
    "timeframe" TEXT,
    "strategyId" TEXT,
    "strategyNameSnapshot" TEXT,
    "strategyVersionSnapshot" INTEGER,
    "selectedConfluences" JSONB,
    "selectedExecution" JSONB,
    "missingConfluences" JSONB,
    "confluencePercent" DOUBLE PRECISION,
    "executionPercent" DOUBLE PRECISION,
    "setupScore" DOUBLE PRECISION,
    "setupRating" TEXT,
    "setupValid" BOOLEAN,
    "plannedEntry" DECIMAL(18,8),
    "plannedStopLoss" DECIMAL(18,8),
    "plannedTarget" DECIMAL(18,8),
    "plannedRR" DECIMAL(8,2),
    "expectedExpectancyR" DECIMAL(8,2),
    "status" "OpportunityStatus" NOT NULL DEFAULT 'PENDING',
    "missReason" "MissReason",
    "missNote" TEXT,
    "missedOutcome" "MissedOutcome",
    "missedRealizedR" DECIMAL(8,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TradeOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradeOpportunity_userId_spottedAt_idx" ON "TradeOpportunity"("userId", "spottedAt");

-- CreateIndex
CREATE INDEX "TradeOpportunity_userId_status_idx" ON "TradeOpportunity"("userId", "status");

-- CreateIndex
CREATE INDEX "TradeOpportunity_userId_strategyId_idx" ON "TradeOpportunity"("userId", "strategyId");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_opportunityId_key" ON "Trade"("opportunityId");

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "TradeOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOpportunity" ADD CONSTRAINT "TradeOpportunity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOpportunity" ADD CONSTRAINT "TradeOpportunity_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
