-- AlterTable
ALTER TABLE "StrategyTradeManagement" ADD COLUMN     "expectedAvgRr" DOUBLE PRECISION,
ADD COLUMN     "expectedExpectancy" DOUBLE PRECISION,
ADD COLUMN     "expectedWinRate" DOUBLE PRECISION,
ADD COLUMN     "minExecutionScore" INTEGER;

