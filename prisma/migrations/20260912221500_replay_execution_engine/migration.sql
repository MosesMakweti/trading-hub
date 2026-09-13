-- CreateEnum
CREATE TYPE "ReplayTradeLifecycle" AS ENUM ('PLANNED', 'PENDING', 'OPEN', 'PARTIALLY_CLOSED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReplayOrderType" AS ENUM ('MARKET', 'PENDING');

-- CreateEnum
CREATE TYPE "ReplayCloseReason" AS ENUM ('STOP_LOSS', 'TARGET', 'MANUAL');

-- CreateEnum
CREATE TYPE "ReplayExecutionEventType" AS ENUM ('ORDER_PLACED', 'ORDER_FILLED', 'SL_MOVED', 'PARTIAL_CLOSE', 'FULL_CLOSE', 'ORDER_CANCELLED', 'AMBIGUOUS_CANDLE', 'AMBIGUITY_RESOLVED');

-- CreateEnum
CREATE TYPE "ReplayPartialExitSource" AS ENUM ('TARGET_HIT', 'MANUAL');

-- AlterTable
ALTER TABLE "ReplayTrade" DROP COLUMN "plannedTargets",
ADD COLUMN     "closeReason" "ReplayCloseReason",
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "currentStopLoss" DECIMAL(18,8),
ADD COLUMN     "filledAt" TIMESTAMP(3),
ADD COLUMN     "lastProcessedTime" TIMESTAMP(3),
ADD COLUMN     "lifecycle" "ReplayTradeLifecycle" NOT NULL DEFAULT 'PLANNED',
ADD COLUMN     "orderType" "ReplayOrderType" NOT NULL DEFAULT 'MARKET',
ADD COLUMN     "overrideNote" TEXT,
ADD COLUMN     "overrideReason" "TradeValidationOverrideReason",
ADD COLUMN     "pendingAmbiguity" JSONB,
ADD COLUMN     "remainingPercent" DECIMAL(5,2) NOT NULL DEFAULT 100,
ADD COLUMN     "validationState" "TradeValidationState";

-- Backfill pre-existing (Stage 12 test fixture) rows before enforcing NOT NULL.
UPDATE "ReplayTrade" SET "realizedReplayR" = 0 WHERE "realizedReplayR" IS NULL;

ALTER TABLE "ReplayTrade"
ALTER COLUMN "realizedReplayR" SET NOT NULL,
ALTER COLUMN "realizedReplayR" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "ReplayTradePartialExit" ADD COLUMN     "executedAt" TIMESTAMP(3),
ADD COLUMN     "plannedTargetId" TEXT,
ADD COLUMN     "realizedR" DECIMAL(8,4),
ADD COLUMN     "source" "ReplayPartialExitSource" NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "ReplayTradePlannedTarget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "replayTradeId" TEXT NOT NULL,
    "targetOrder" INTEGER NOT NULL,
    "price" DECIMAL(18,8) NOT NULL,
    "percentToClose" DECIMAL(5,2) NOT NULL,
    "filledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReplayTradePlannedTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplayTradeExecutionEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "replayTradeId" TEXT NOT NULL,
    "eventType" "ReplayExecutionEventType" NOT NULL,
    "historicalTimestamp" TIMESTAMP(3) NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReplayTradeExecutionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReplayTradePlannedTarget_replayTradeId_targetOrder_idx" ON "ReplayTradePlannedTarget"("replayTradeId", "targetOrder");

-- CreateIndex
CREATE INDEX "ReplayTradeExecutionEvent_replayTradeId_historicalTimestamp_idx" ON "ReplayTradeExecutionEvent"("replayTradeId", "historicalTimestamp");

-- AddForeignKey
ALTER TABLE "ReplayTradePlannedTarget" ADD CONSTRAINT "ReplayTradePlannedTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayTradePlannedTarget" ADD CONSTRAINT "ReplayTradePlannedTarget_replayTradeId_fkey" FOREIGN KEY ("replayTradeId") REFERENCES "ReplayTrade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayTradePartialExit" ADD CONSTRAINT "ReplayTradePartialExit_plannedTargetId_fkey" FOREIGN KEY ("plannedTargetId") REFERENCES "ReplayTradePlannedTarget"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayTradeExecutionEvent" ADD CONSTRAINT "ReplayTradeExecutionEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayTradeExecutionEvent" ADD CONSTRAINT "ReplayTradeExecutionEvent_replayTradeId_fkey" FOREIGN KEY ("replayTradeId") REFERENCES "ReplayTrade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

