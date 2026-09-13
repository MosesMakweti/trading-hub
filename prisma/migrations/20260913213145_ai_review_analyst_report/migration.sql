-- CreateTable
CREATE TABLE "AiReviewAnalystReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "replayReviewSessionId" TEXT NOT NULL,
    "evidenceFingerprint" TEXT NOT NULL,
    "evidencePackageVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "reportJson" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiReviewAnalystReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiReviewAnalystReport_userId_replayReviewSessionId_generate_idx" ON "AiReviewAnalystReport"("userId", "replayReviewSessionId", "generatedAt");

-- AddForeignKey
ALTER TABLE "AiReviewAnalystReport" ADD CONSTRAINT "AiReviewAnalystReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiReviewAnalystReport" ADD CONSTRAINT "AiReviewAnalystReport_replayReviewSessionId_fkey" FOREIGN KEY ("replayReviewSessionId") REFERENCES "ReplayReviewSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
