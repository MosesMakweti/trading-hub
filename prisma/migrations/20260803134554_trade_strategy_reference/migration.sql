-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "entryModelNameSnapshot" TEXT,
ADD COLUMN     "strategyId" TEXT,
ADD COLUMN     "strategyNameSnapshot" TEXT,
ADD COLUMN     "strategyVersionSnapshot" INTEGER;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
