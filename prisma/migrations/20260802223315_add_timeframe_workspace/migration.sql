-- CreateTable
CREATE TABLE "StrategyTimeframe" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StrategyTimeframe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyCheckpoint" (
    "id" TEXT NOT NULL,
    "timeframeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" JSONB,
    "notes" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StrategyCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StrategyTimeframe_strategyId_deletedAt_sortOrder_idx" ON "StrategyTimeframe"("strategyId", "deletedAt", "sortOrder");

-- CreateIndex
CREATE INDEX "StrategyCheckpoint_timeframeId_deletedAt_sortOrder_idx" ON "StrategyCheckpoint"("timeframeId", "deletedAt", "sortOrder");

-- AddForeignKey
ALTER TABLE "StrategyTimeframe" ADD CONSTRAINT "StrategyTimeframe_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyCheckpoint" ADD CONSTRAINT "StrategyCheckpoint_timeframeId_fkey" FOREIGN KEY ("timeframeId") REFERENCES "StrategyTimeframe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
