-- CreateEnum
CREATE TYPE "EdgeReviewCommitmentDailyStateSource" AS ENUM ('MANUAL', 'SYSTEM');

-- AlterTable
ALTER TABLE "EdgeReviewCommitment" ADD COLUMN     "lineageId" TEXT,
ADD COLUMN     "previousCommitmentId" TEXT;

-- AlterTable
ALTER TABLE "EdgeReviewCommitmentDailyState" ADD COLUMN     "evidence" JSONB,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "relatedTradeId" TEXT,
ADD COLUMN     "source" "EdgeReviewCommitmentDailyStateSource" NOT NULL DEFAULT 'MANUAL';

-- CreateIndex
CREATE INDEX "EdgeReviewCommitment_userId_lineageId_idx" ON "EdgeReviewCommitment"("userId", "lineageId");

-- AddForeignKey
ALTER TABLE "EdgeReviewCommitment" ADD CONSTRAINT "EdgeReviewCommitment_previousCommitmentId_fkey" FOREIGN KEY ("previousCommitmentId") REFERENCES "EdgeReviewCommitment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

