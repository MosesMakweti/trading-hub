-- CreateTable
CREATE TABLE "ArsenalConcept" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definition" JSONB,
    "purpose" JSONB,
    "howIIdentify" JSONB,
    "whyItMatters" JSONB,
    "whenIUse" JSONB,
    "whenIIgnore" JSONB,
    "examples" JSONB,
    "personalNotes" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ArsenalConcept_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArsenalConcept_strategyId_deletedAt_sortOrder_idx" ON "ArsenalConcept"("strategyId", "deletedAt", "sortOrder");

-- AddForeignKey
ALTER TABLE "ArsenalConcept" ADD CONSTRAINT "ArsenalConcept_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
