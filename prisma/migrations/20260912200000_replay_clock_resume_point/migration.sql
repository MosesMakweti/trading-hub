-- AlterTable
ALTER TABLE "ReplayReviewSession" ADD COLUMN     "replayCurrentAsset" TEXT,
ADD COLUMN     "replayCurrentTime" TIMESTAMP(3),
ADD COLUMN     "replayCurrentTimeframe" TEXT;
