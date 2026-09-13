
-- CreateEnum
CREATE TYPE "EdgeReviewCommitmentCategory" AS ENUM ('EXECUTION', 'BEHAVIOR', 'PROCESS', 'OPPORTUNITY', 'STRATEGY', 'RISK');

-- CreateEnum
CREATE TYPE "EdgeReviewCommitmentPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "EdgeReviewCommitmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'RETIRED');

-- CreateEnum
CREATE TYPE "EdgeReviewCommitmentSource" AS ENUM ('MANUAL', 'SUGGESTED');

-- CreateEnum
CREATE TYPE "EdgeReviewCommitmentDailyStatus" AS ENUM ('ACKNOWLEDGED', 'FOLLOWED', 'BREACHED');

-- AlterTable
ALTER TABLE "ReplayReviewSession" ADD COLUMN     "reviewFinalizedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EdgeReviewCommitment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "replayReviewSessionId" TEXT,
    "reviewType" "ReplayReviewType" NOT NULL,
    "periodStart" DATE NOT NULL,
    "category" "EdgeReviewCommitmentCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "EdgeReviewCommitmentPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "EdgeReviewCommitmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" "EdgeReviewCommitmentSource" NOT NULL DEFAULT 'MANUAL',
    "sourceFindingType" TEXT,
    "evidenceSnapshot" JSONB,
    "completedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EdgeReviewCommitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EdgeReviewCommitmentDailyState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "commitmentId" TEXT NOT NULL,
    "dateKey" DATE NOT NULL,
    "status" "EdgeReviewCommitmentDailyStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EdgeReviewCommitmentDailyState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EdgeReviewCommitment_userId_status_idx" ON "EdgeReviewCommitment"("userId", "status");

-- CreateIndex
CREATE INDEX "EdgeReviewCommitment_userId_reviewType_periodStart_idx" ON "EdgeReviewCommitment"("userId", "reviewType", "periodStart");

-- CreateIndex
CREATE INDEX "EdgeReviewCommitmentDailyState_userId_dateKey_idx" ON "EdgeReviewCommitmentDailyState"("userId", "dateKey");

-- CreateIndex
CREATE UNIQUE INDEX "EdgeReviewCommitmentDailyState_commitmentId_dateKey_key" ON "EdgeReviewCommitmentDailyState"("commitmentId", "dateKey");

-- AddForeignKey
ALTER TABLE "EdgeReviewCommitment" ADD CONSTRAINT "EdgeReviewCommitment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EdgeReviewCommitment" ADD CONSTRAINT "EdgeReviewCommitment_replayReviewSessionId_fkey" FOREIGN KEY ("replayReviewSessionId") REFERENCES "ReplayReviewSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EdgeReviewCommitmentDailyState" ADD CONSTRAINT "EdgeReviewCommitmentDailyState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EdgeReviewCommitmentDailyState" ADD CONSTRAINT "EdgeReviewCommitmentDailyState_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "EdgeReviewCommitment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

