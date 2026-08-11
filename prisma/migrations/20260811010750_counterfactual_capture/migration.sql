-- CreateEnum
CREATE TYPE "TradeIntent" AS ENUM ('PLANNED', 'FOMO', 'REVENGE', 'BOREDOM', 'IMPULSE', 'MANUAL_OVERRIDE');

-- AlterTable
ALTER TABLE "StrategyTradeManagement" ADD COLUMN     "maxDailyRiskPercent" DOUBLE PRECISION,
ADD COLUMN     "maxTradesPerDay" INTEGER;

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "tradeIntent" "TradeIntent";
