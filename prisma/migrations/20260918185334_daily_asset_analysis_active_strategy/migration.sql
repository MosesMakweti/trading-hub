-- AlterTable
ALTER TABLE "DailyAssetAnalysis" ADD COLUMN     "activeStrategyId" TEXT;

-- AddForeignKey
ALTER TABLE "DailyAssetAnalysis" ADD CONSTRAINT "DailyAssetAnalysis_activeStrategyId_fkey" FOREIGN KEY ("activeStrategyId") REFERENCES "Strategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
