-- AlterTable
ALTER TABLE "TradingDay" ADD COLUMN     "bias" TEXT,
ADD COLUMN     "conviction" INTEGER,
ADD COLUMN     "keyLevels" JSONB,
ADD COLUMN     "riskBudgetPercent" DECIMAL(6,2),
ADD COLUMN     "watchlistFocus" JSONB;
