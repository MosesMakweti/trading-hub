-- AlterTable
ALTER TABLE "StrategyChecklistItem" ADD COLUMN     "mandatory" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "validationCriteria" TEXT;

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "missingConfluences" JSONB,
ADD COLUMN     "setupRating" TEXT,
ADD COLUMN     "setupScore" DOUBLE PRECISION,
ADD COLUMN     "setupValid" BOOLEAN;

