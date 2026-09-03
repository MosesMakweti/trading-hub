-- CreateEnum
CREATE TYPE "ConfluenceDirection" AS ENUM ('BULLISH', 'BEARISH', 'BOTH');

-- AlterTable
ALTER TABLE "StrategyChecklistItem" ADD COLUMN     "directionApplicability" "ConfluenceDirection" NOT NULL DEFAULT 'BOTH',
ADD COLUMN     "pairId" TEXT;
