-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "actualEntry" DECIMAL(18,8),
ADD COLUMN     "actualExit" DECIMAL(18,8),
ADD COLUMN     "areasOfInterest" TEXT,
ADD COLUMN     "executionNotes" TEXT,
ADD COLUMN     "marketContext" TEXT,
ADD COLUMN     "plannedEntry" DECIMAL(18,8),
ADD COLUMN     "plannedStopLoss" DECIMAL(18,8),
ADD COLUMN     "plannedTarget" DECIMAL(18,8),
ADD COLUMN     "reasonForTrade" TEXT,
ADD COLUMN     "whatSurprisedMe" TEXT,
ADD COLUMN     "whatWentWell" TEXT,
ADD COLUMN     "whatWentWrong" TEXT,
ADD COLUMN     "wouldTakeAgain" BOOLEAN;
