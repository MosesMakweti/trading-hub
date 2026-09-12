-- AlterTable
ALTER TABLE "TradingDay" ADD COLUMN     "activeSessions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "dailyFundamentalOutlook" JSONB,
ADD COLUMN     "importantConditions" JSONB,
ADD COLUMN     "lookingFor" JSONB,
ADD COLUMN     "maxTradesPerDay" INTEGER,
ADD COLUMN     "newsAcknowledged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "newsNotes" JSONB,
ADD COLUMN     "stayOutConditions" JSONB,
ADD COLUMN     "watchlist" TEXT[] DEFAULT ARRAY[]::TEXT[];
