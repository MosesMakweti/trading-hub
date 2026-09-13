
-- AlterEnum
ALTER TYPE "ReplayComparisonLinkType" ADD VALUE 'OPPORTUNITY';

-- AlterTable
ALTER TABLE "ReplayComparisonLink" ALTER COLUMN "actualTradeId" DROP NOT NULL;

