-- AlterTable
ALTER TABLE "DailyAssetAnalysis" ADD COLUMN     "fundamentalNotes" JSONB;

-- CreateTable
CREATE TABLE "DirectionalEvidenceItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dailyAssetAnalysisId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "checked" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectionalEvidenceItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DirectionalEvidenceItem_dailyAssetAnalysisId_sortOrder_idx" ON "DirectionalEvidenceItem"("dailyAssetAnalysisId", "sortOrder");

-- AddForeignKey
ALTER TABLE "DirectionalEvidenceItem" ADD CONSTRAINT "DirectionalEvidenceItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectionalEvidenceItem" ADD CONSTRAINT "DirectionalEvidenceItem_dailyAssetAnalysisId_fkey" FOREIGN KEY ("dailyAssetAnalysisId") REFERENCES "DailyAssetAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
