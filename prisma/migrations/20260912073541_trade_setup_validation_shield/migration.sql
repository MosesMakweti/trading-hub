-- CreateEnum
CREATE TYPE "TradeValidationState" AS ENUM ('NOT_VALIDATED', 'VALIDATED', 'OVERRIDDEN');

-- CreateEnum
CREATE TYPE "TradeValidationOverrideReason" AS ENUM ('ANTICIPATING_CONFIRMATION', 'DISCRETIONARY_OVERRIDE', 'FOMO', 'MOMENTUM_FAST_MARKET', 'NEWS_DRIVEN', 'OTHER');

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "dailyBiasSnapshot" TEXT,
ADD COLUMN     "overrideNote" TEXT,
ADD COLUMN     "overrideReason" "TradeValidationOverrideReason",
ADD COLUMN     "selectedSetupConditions" JSONB,
ADD COLUMN     "setupScenarioId" TEXT,
ADD COLUMN     "setupTypeId" TEXT,
ADD COLUMN     "setupValidationSnapshot" JSONB,
ADD COLUMN     "validationState" "TradeValidationState";

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_setupTypeId_fkey" FOREIGN KEY ("setupTypeId") REFERENCES "StrategySetupType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_setupScenarioId_fkey" FOREIGN KEY ("setupScenarioId") REFERENCES "StrategySetupScenario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
