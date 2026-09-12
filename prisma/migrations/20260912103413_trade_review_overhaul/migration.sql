-- CreateEnum
CREATE TYPE "TradeReviewLifecycleStatus" AS ENUM ('FULLY_CLOSED', 'PARTIALLY_CLOSED', 'STILL_HOLDING', 'CANCELLED_NEVER_TRIGGERED');

-- CreateEnum
CREATE TYPE "BehaviourLabelPolarity" AS ENUM ('POSITIVE', 'NEGATIVE');

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "reviewLifecycleStatus" "TradeReviewLifecycleStatus",
ADD COLUMN     "whatCouldImprove" TEXT;

-- CreateTable
CREATE TABLE "BehaviourLabel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "polarity" "BehaviourLabelPolarity" NOT NULL,
    "color" "TagColor" NOT NULL DEFAULT 'GRAY',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "BehaviourLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeBehaviourLabel" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "behaviourLabelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeBehaviourLabel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BehaviourLabel_userId_deletedAt_polarity_sortOrder_idx" ON "BehaviourLabel"("userId", "deletedAt", "polarity", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "BehaviourLabel_userId_name_key" ON "BehaviourLabel"("userId", "name");

-- CreateIndex
CREATE INDEX "TradeBehaviourLabel_tradeId_idx" ON "TradeBehaviourLabel"("tradeId");

-- CreateIndex
CREATE INDEX "TradeBehaviourLabel_behaviourLabelId_idx" ON "TradeBehaviourLabel"("behaviourLabelId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeBehaviourLabel_tradeId_behaviourLabelId_key" ON "TradeBehaviourLabel"("tradeId", "behaviourLabelId");

-- CreateIndex
CREATE INDEX "Trade_userId_reviewLifecycleStatus_idx" ON "Trade"("userId", "reviewLifecycleStatus");

-- AddForeignKey
ALTER TABLE "BehaviourLabel" ADD CONSTRAINT "BehaviourLabel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeBehaviourLabel" ADD CONSTRAINT "TradeBehaviourLabel_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeBehaviourLabel" ADD CONSTRAINT "TradeBehaviourLabel_behaviourLabelId_fkey" FOREIGN KEY ("behaviourLabelId") REFERENCES "BehaviourLabel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
