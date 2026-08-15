-- DropIndex
DROP INDEX "StageRule_stageId_idx";

-- AlterTable
ALTER TABLE "StageRule" ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "StageRule_stageId_sortOrder_idx" ON "StageRule"("stageId", "sortOrder");
