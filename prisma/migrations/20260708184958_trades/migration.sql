-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('LONG', 'SHORT');

-- CreateEnum
CREATE TYPE "Bias" AS ENUM ('BULLISH', 'BEARISH');

-- CreateEnum
CREATE TYPE "RiskInputType" AS ENUM ('PERCENT', 'AMOUNT');

-- CreateEnum
CREATE TYPE "ImageCategory" AS ENUM ('ANALYSIS', 'BEFORE', 'AFTER');

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tradeDate" DATE NOT NULL,
    "assetId" TEXT NOT NULL,
    "executionMinutes" INTEGER NOT NULL,
    "direction" "Direction" NOT NULL,
    "higherTimeframeBias" "Bias" NOT NULL,
    "biasConfidencePercent" INTEGER NOT NULL,
    "sessionId" TEXT,
    "expectedRR" DECIMAL(8,2) NOT NULL,
    "actualRR" DECIMAL(8,2),
    "hitTP1" BOOLEAN NOT NULL DEFAULT false,
    "hitTP2" BOOLEAN NOT NULL DEFAULT false,
    "hitTP3" BOOLEAN NOT NULL DEFAULT false,
    "hitFullTP" BOOLEAN NOT NULL DEFAULT false,
    "psychPreTradeMindset" TEXT,
    "psychPostTradeReflection" TEXT,
    "psychLessonsLearned" TEXT,
    "psychWhatToWorkOn" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeAccountAllocation" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "tradingAccountId" TEXT NOT NULL,
    "riskInputType" "RiskInputType" NOT NULL,
    "riskValue" DECIMAL(14,2) NOT NULL,
    "closingPnlGross" DECIMAL(14,2) NOT NULL,
    "closingPnlNet" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "TradeAccountAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeImage" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "category" "ImageCategory" NOT NULL,
    "url" TEXT NOT NULL,
    "uploadthingKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeChecklistSelection" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "checklistItemId" TEXT NOT NULL,

    CONSTRAINT "TradeChecklistSelection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeEntryModel" (
    "tradeId" TEXT NOT NULL,
    "entryModelId" TEXT NOT NULL,

    CONSTRAINT "TradeEntryModel_pkey" PRIMARY KEY ("tradeId","entryModelId")
);

-- CreateIndex
CREATE INDEX "Trade_userId_tradeDate_idx" ON "Trade"("userId", "tradeDate");

-- CreateIndex
CREATE UNIQUE INDEX "TradeAccountAllocation_tradeId_tradingAccountId_key" ON "TradeAccountAllocation"("tradeId", "tradingAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeChecklistSelection_tradeId_checklistItemId_key" ON "TradeChecklistSelection"("tradeId", "checklistItemId");

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TradingSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeAccountAllocation" ADD CONSTRAINT "TradeAccountAllocation_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeAccountAllocation" ADD CONSTRAINT "TradeAccountAllocation_tradingAccountId_fkey" FOREIGN KEY ("tradingAccountId") REFERENCES "TradingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeImage" ADD CONSTRAINT "TradeImage_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeChecklistSelection" ADD CONSTRAINT "TradeChecklistSelection_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeChecklistSelection" ADD CONSTRAINT "TradeChecklistSelection_checklistItemId_fkey" FOREIGN KEY ("checklistItemId") REFERENCES "ChecklistItemDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeEntryModel" ADD CONSTRAINT "TradeEntryModel_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeEntryModel" ADD CONSTRAINT "TradeEntryModel_entryModelId_fkey" FOREIGN KEY ("entryModelId") REFERENCES "EntryModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
