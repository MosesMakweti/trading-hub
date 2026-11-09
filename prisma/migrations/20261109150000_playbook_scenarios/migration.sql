-- CreateEnum
CREATE TYPE "SetupScenarioType" AS ENUM ('CONTINUATION', 'REVERSAL', 'BREAKOUT', 'CUSTOM');

-- AlterEnum
ALTER TYPE "SetupScenarioDirection" ADD VALUE 'NEUTRAL';

-- DropIndex
DROP INDEX "StrategySetupScenario_setupTypeId_direction_key";

-- DropIndex
DROP INDEX "StrategySetupScenario_setupTypeId_idx";

-- AlterTable
ALTER TABLE "StrategySetupScenario" ADD COLUMN     "context" JSONB,
ADD COLUMN     "customType" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "executionPlan" JSONB,
ADD COLUMN     "instruments" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "scenarioType" "SetupScenarioType",
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "timeframes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "StrategySetupScenarioCondition" ADD COLUMN     "note" TEXT;

-- CreateIndex
CREATE INDEX "StrategySetupScenario_setupTypeId_deletedAt_sortOrder_idx" ON "StrategySetupScenario"("setupTypeId", "deletedAt", "sortOrder");


-- Backfill: the two scenarios every existing Setup Type already has get a
-- name and a stable order (Bullish first). Nothing else changes for them:
-- same ids, same conditions, same trade links.
UPDATE "StrategySetupScenario" SET "name" = 'Bullish', "sortOrder" = 0 WHERE "direction" = 'BULLISH' AND "name" = '';
UPDATE "StrategySetupScenario" SET "name" = 'Bearish', "sortOrder" = 1 WHERE "direction" = 'BEARISH' AND "name" = '';
