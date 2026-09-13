-- CreateEnum
CREATE TYPE "ReplayReviewType" AS ENUM ('WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ReplayReviewStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ReplayDecisionType" AS ENUM ('TAKEN', 'SKIPPED', 'MISSED');

-- AlterEnum
ALTER TYPE "MediaOwnerType" ADD VALUE 'REPLAY_TRADE';

-- CreateTable
CREATE TABLE "ReplayReviewSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reviewType" "ReplayReviewType" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "ReplayReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "strategyId" TEXT,
    "assetSymbols" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" JSONB,
    "actualBaselineSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplayReviewSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplayTrade" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "historicalTimestamp" TIMESTAMP(3) NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "direction" "Direction",
    "strategyId" TEXT,
    "strategyNameSnapshot" TEXT,
    "strategyVersionSnapshot" INTEGER,
    "setupTypeNameSnapshot" TEXT,
    "decisionType" "ReplayDecisionType" NOT NULL,
    "plannedEntry" DECIMAL(18,8),
    "plannedStopLoss" DECIMAL(18,8),
    "plannedTargets" JSONB,
    "simulatedEntry" DECIMAL(18,8),
    "simulatedExit" DECIMAL(18,8),
    "realizedReplayR" DECIMAL(8,4),
    "replayValidationSnapshot" JSONB,
    "notes" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplayTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplayTradePartialExit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "replayTradeId" TEXT NOT NULL,
    "exitPrice" DECIMAL(18,8) NOT NULL,
    "percentClosed" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReplayTradePartialExit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReplayReviewSession_userId_status_idx" ON "ReplayReviewSession"("userId", "status");

-- CreateIndex
CREATE INDEX "ReplayReviewSession_userId_startDate_idx" ON "ReplayReviewSession"("userId", "startDate");

-- CreateIndex
CREATE INDEX "ReplayTrade_sessionId_sortOrder_idx" ON "ReplayTrade"("sessionId", "sortOrder");

-- CreateIndex
CREATE INDEX "ReplayTrade_userId_idx" ON "ReplayTrade"("userId");

-- CreateIndex
CREATE INDEX "ReplayTradePartialExit_replayTradeId_idx" ON "ReplayTradePartialExit"("replayTradeId");

-- AddForeignKey
ALTER TABLE "ReplayReviewSession" ADD CONSTRAINT "ReplayReviewSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayReviewSession" ADD CONSTRAINT "ReplayReviewSession_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayTrade" ADD CONSTRAINT "ReplayTrade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayTrade" ADD CONSTRAINT "ReplayTrade_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ReplayReviewSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayTrade" ADD CONSTRAINT "ReplayTrade_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayTradePartialExit" ADD CONSTRAINT "ReplayTradePartialExit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayTradePartialExit" ADD CONSTRAINT "ReplayTradePartialExit_replayTradeId_fkey" FOREIGN KEY ("replayTradeId") REFERENCES "ReplayTrade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
