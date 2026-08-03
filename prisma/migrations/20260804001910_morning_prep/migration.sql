-- AlterTable
ALTER TABLE "TradingDay" ADD COLUMN     "marketContext" JSONB,
ADD COLUMN     "readiness" INTEGER,
ADD COLUMN     "routineCompletion" JSONB;
