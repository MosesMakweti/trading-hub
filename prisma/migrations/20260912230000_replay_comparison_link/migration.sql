
-- CreateEnum
CREATE TYPE "ReplayComparisonLinkType" AS ENUM ('MATCHED', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "ReplayComparisonLinkSource" AS ENUM ('AUTO', 'MANUAL');

-- CreateTable
CREATE TABLE "ReplayComparisonLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "replayReviewSessionId" TEXT NOT NULL,
    "actualTradeId" TEXT NOT NULL,
    "replayTradeId" TEXT NOT NULL,
    "linkType" "ReplayComparisonLinkType" NOT NULL DEFAULT 'MATCHED',
    "source" "ReplayComparisonLinkSource" NOT NULL DEFAULT 'MANUAL',
    "opportunityClassification" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplayComparisonLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReplayComparisonLink_replayReviewSessionId_idx" ON "ReplayComparisonLink"("replayReviewSessionId");

-- CreateIndex
CREATE INDEX "ReplayComparisonLink_actualTradeId_idx" ON "ReplayComparisonLink"("actualTradeId");

-- CreateIndex
CREATE INDEX "ReplayComparisonLink_replayTradeId_idx" ON "ReplayComparisonLink"("replayTradeId");

-- CreateIndex
CREATE UNIQUE INDEX "ReplayComparisonLink_replayReviewSessionId_actualTradeId_re_key" ON "ReplayComparisonLink"("replayReviewSessionId", "actualTradeId", "replayTradeId");

-- AddForeignKey
ALTER TABLE "ReplayComparisonLink" ADD CONSTRAINT "ReplayComparisonLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayComparisonLink" ADD CONSTRAINT "ReplayComparisonLink_replayReviewSessionId_fkey" FOREIGN KEY ("replayReviewSessionId") REFERENCES "ReplayReviewSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayComparisonLink" ADD CONSTRAINT "ReplayComparisonLink_replayTradeId_fkey" FOREIGN KEY ("replayTradeId") REFERENCES "ReplayTrade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

