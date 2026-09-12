-- AlterEnum
ALTER TYPE "MediaOwnerType" ADD VALUE 'DAILY_ASSET_ANALYSIS';

-- AlterTable
ALTER TABLE "MediaAttachment" ADD COLUMN     "timeframe" TEXT;

-- CreateTable
CREATE TABLE "DailyAssetAnalysis" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tradingDayId" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "marketStructure" JSONB,
    "htfBias" TEXT,
    "sessionBias" TEXT,
    "fundamentalBias" TEXT,
    "finalBias" TEXT,
    "notes" JSONB,
    "keyLevels" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DailyAssetAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyAssetAnalysis_userId_tradingDayId_deletedAt_sortOrder_idx" ON "DailyAssetAnalysis"("userId", "tradingDayId", "deletedAt", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "DailyAssetAnalysis_tradingDayId_assetSymbol_key" ON "DailyAssetAnalysis"("tradingDayId", "assetSymbol");

-- AddForeignKey
ALTER TABLE "DailyAssetAnalysis" ADD CONSTRAINT "DailyAssetAnalysis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyAssetAnalysis" ADD CONSTRAINT "DailyAssetAnalysis_tradingDayId_fkey" FOREIGN KEY ("tradingDayId") REFERENCES "TradingDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;
