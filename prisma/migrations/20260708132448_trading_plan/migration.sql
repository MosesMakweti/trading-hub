-- CreateEnum
CREATE TYPE "ChecklistType" AS ENUM ('CONFLUENCE', 'EXECUTION_CONFIRMATION');

-- CreateTable
CREATE TABLE "TradingPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dailyRoutineMorning" JSONB,
    "dailyRoutinePreMarket" JSONB,
    "dailyRoutinePostSession" JSONB,
    "strategyFramework" JSONB,
    "profitTakingRules" JSONB,
    "stopLossPlacement" JSONB,
    "riskManagementRules" JSONB,
    "maxDailyRiskPercent" DECIMAL(6,2),
    "maxWeeklyRiskPercent" DECIMAL(6,2),
    "maxOpenPositions" INTEGER,
    "maxRiskPerTradePercent" DECIMAL(6,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "label" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntryModel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "EntryModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradingSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "maxDailyTradingMinutes" INTEGER,
    "maxTradesPerDay" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TradingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PsychologicalAnchor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PsychologicalAnchor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistItemDefinition" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "ChecklistType" NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ChecklistItemDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TradingPlan_userId_key" ON "TradingPlan"("userId");

-- CreateIndex
CREATE INDEX "Asset_userId_sortOrder_idx" ON "Asset"("userId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_userId_symbol_key" ON "Asset"("userId", "symbol");

-- CreateIndex
CREATE INDEX "EntryModel_userId_sortOrder_idx" ON "EntryModel"("userId", "sortOrder");

-- CreateIndex
CREATE INDEX "TradingSession_userId_sortOrder_idx" ON "TradingSession"("userId", "sortOrder");

-- CreateIndex
CREATE INDEX "PsychologicalAnchor_userId_sortOrder_idx" ON "PsychologicalAnchor"("userId", "sortOrder");

-- CreateIndex
CREATE INDEX "ChecklistItemDefinition_userId_type_sortOrder_idx" ON "ChecklistItemDefinition"("userId", "type", "sortOrder");

-- AddForeignKey
ALTER TABLE "TradingPlan" ADD CONSTRAINT "TradingPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryModel" ADD CONSTRAINT "EntryModel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingSession" ADD CONSTRAINT "TradingSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PsychologicalAnchor" ADD CONSTRAINT "PsychologicalAnchor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItemDefinition" ADD CONSTRAINT "ChecklistItemDefinition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
