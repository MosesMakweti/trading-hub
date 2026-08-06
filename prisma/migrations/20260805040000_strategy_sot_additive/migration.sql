-- CreateEnum
CREATE TYPE "TagColor" AS ENUM ('GRAY', 'BLUE', 'GREEN', 'AMBER', 'RED', 'PURPLE', 'YELLOW', 'TEAL');

-- CreateEnum
CREATE TYPE "StrategyChecklistKind" AS ENUM ('CONFLUENCE', 'EXECUTION');

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "assetSymbol" TEXT,
ADD COLUMN     "confluencePercent" DOUBLE PRECISION,
ADD COLUMN     "executionPercent" DOUBLE PRECISION,
ADD COLUMN     "selectedConfluences" JSONB,
ADD COLUMN     "selectedExecution" JSONB,
ADD COLUMN     "selectedSession" TEXT,
ADD COLUMN     "strategyExecutionSnapshot" JSONB,
ADD COLUMN     "tradeQualityPercent" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "StrategyChecklistItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "kind" "StrategyChecklistKind" NOT NULL,
    "name" TEXT NOT NULL,
    "color" "TagColor" NOT NULL DEFAULT 'GRAY',
    "icon" TEXT,
    "category" TEXT,
    "description" TEXT,
    "weight" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StrategyChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategySession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" "TagColor" NOT NULL DEFAULT 'GRAY',
    "startMinutes" INTEGER,
    "endMinutes" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StrategySession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StrategyChecklistItem_userId_strategyId_kind_sortOrder_idx" ON "StrategyChecklistItem"("userId", "strategyId", "kind", "sortOrder");

-- CreateIndex
CREATE INDEX "StrategySession_userId_strategyId_sortOrder_idx" ON "StrategySession"("userId", "strategyId", "sortOrder");

-- AddForeignKey
ALTER TABLE "StrategyChecklistItem" ADD CONSTRAINT "StrategyChecklistItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyChecklistItem" ADD CONSTRAINT "StrategyChecklistItem_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategySession" ADD CONSTRAINT "StrategySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategySession" ADD CONSTRAINT "StrategySession_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: denormalize each existing trade's market symbol from its Asset FK.
UPDATE "Trade" t SET "assetSymbol" = a."symbol"
FROM "Asset" a
WHERE t."assetId" = a."id" AND t."assetSymbol" IS NULL;
