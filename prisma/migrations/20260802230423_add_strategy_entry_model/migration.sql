-- CreateTable
CREATE TABLE "StrategyEntryModel" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" JSONB,
    "conditions" JSONB,
    "confirmationChecklist" JSONB,
    "invalidation" JSONB,
    "stopPlacement" JSONB,
    "targetLogic" JSONB,
    "notes" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StrategyEntryModel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StrategyEntryModel_strategyId_deletedAt_sortOrder_idx" ON "StrategyEntryModel"("strategyId", "deletedAt", "sortOrder");

-- AddForeignKey
ALTER TABLE "StrategyEntryModel" ADD CONSTRAINT "StrategyEntryModel_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
