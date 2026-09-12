-- CreateEnum
CREATE TYPE "SetupScenarioDirection" AS ENUM ('BULLISH', 'BEARISH');

-- CreateTable
CREATE TABLE "StrategySetupType" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StrategySetupType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategySetupScenario" (
    "id" TEXT NOT NULL,
    "setupTypeId" TEXT NOT NULL,
    "direction" "SetupScenarioDirection" NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategySetupScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategySetupScenarioCondition" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "checklistItemId" TEXT NOT NULL,
    "mandatoryOverride" BOOLEAN,
    "weightOverride" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategySetupScenarioCondition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StrategySetupType_strategyId_deletedAt_sortOrder_idx" ON "StrategySetupType"("strategyId", "deletedAt", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "StrategySetupType_strategyId_name_key" ON "StrategySetupType"("strategyId", "name");

-- CreateIndex
CREATE INDEX "StrategySetupScenario_setupTypeId_idx" ON "StrategySetupScenario"("setupTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "StrategySetupScenario_setupTypeId_direction_key" ON "StrategySetupScenario"("setupTypeId", "direction");

-- CreateIndex
CREATE INDEX "StrategySetupScenarioCondition_scenarioId_sortOrder_idx" ON "StrategySetupScenarioCondition"("scenarioId", "sortOrder");

-- CreateIndex
CREATE INDEX "StrategySetupScenarioCondition_checklistItemId_idx" ON "StrategySetupScenarioCondition"("checklistItemId");

-- CreateIndex
CREATE UNIQUE INDEX "StrategySetupScenarioCondition_scenarioId_checklistItemId_key" ON "StrategySetupScenarioCondition"("scenarioId", "checklistItemId");

-- AddForeignKey
ALTER TABLE "StrategySetupType" ADD CONSTRAINT "StrategySetupType_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategySetupType" ADD CONSTRAINT "StrategySetupType_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategySetupScenario" ADD CONSTRAINT "StrategySetupScenario_setupTypeId_fkey" FOREIGN KEY ("setupTypeId") REFERENCES "StrategySetupType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategySetupScenarioCondition" ADD CONSTRAINT "StrategySetupScenarioCondition_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "StrategySetupScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategySetupScenarioCondition" ADD CONSTRAINT "StrategySetupScenarioCondition_checklistItemId_fkey" FOREIGN KEY ("checklistItemId") REFERENCES "StrategyChecklistItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
