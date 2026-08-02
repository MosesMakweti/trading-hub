-- CreateTable
CREATE TABLE "StrategyFrameworkStep" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" JSONB,
    "notes" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StrategyFrameworkStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StrategyFrameworkStep_strategyId_deletedAt_sortOrder_idx" ON "StrategyFrameworkStep"("strategyId", "deletedAt", "sortOrder");

-- AddForeignKey
ALTER TABLE "StrategyFrameworkStep" ADD CONSTRAINT "StrategyFrameworkStep_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
