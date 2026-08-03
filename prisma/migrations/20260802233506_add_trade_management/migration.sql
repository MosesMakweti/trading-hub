-- CreateTable
CREATE TABLE "StrategyTradeManagement" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "takeProfitPhilosophy" JSONB,
    "initialStopPlacement" JSONB,
    "breakEvenRules" JSONB,
    "trailingStopRules" JSONB,
    "scalingInRules" JSONB,
    "scalingOutRules" JSONB,
    "maxHoldingTime" TEXT,
    "maxRiskPercent" DECIMAL(6,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StrategyTradeManagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartialTakeProfit" (
    "id" TEXT NOT NULL,
    "tradeManagementId" TEXT NOT NULL,
    "trigger" TEXT,
    "percentToClose" DECIMAL(5,2),
    "reason" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PartialTakeProfit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeManagementRule" (
    "id" TEXT NOT NULL,
    "tradeManagementId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TradeManagementRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StrategyTradeManagement_strategyId_key" ON "StrategyTradeManagement"("strategyId");

-- CreateIndex
CREATE INDEX "PartialTakeProfit_tradeManagementId_deletedAt_sortOrder_idx" ON "PartialTakeProfit"("tradeManagementId", "deletedAt", "sortOrder");

-- CreateIndex
CREATE INDEX "TradeManagementRule_tradeManagementId_deletedAt_sortOrder_idx" ON "TradeManagementRule"("tradeManagementId", "deletedAt", "sortOrder");

-- AddForeignKey
ALTER TABLE "StrategyTradeManagement" ADD CONSTRAINT "StrategyTradeManagement_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartialTakeProfit" ADD CONSTRAINT "PartialTakeProfit_tradeManagementId_fkey" FOREIGN KEY ("tradeManagementId") REFERENCES "StrategyTradeManagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeManagementRule" ADD CONSTRAINT "TradeManagementRule_tradeManagementId_fkey" FOREIGN KEY ("tradeManagementId") REFERENCES "StrategyTradeManagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
