-- AlterTable
ALTER TABLE "WeeklyReview" ADD COLUMN "reviewType" "ReplayReviewType" NOT NULL DEFAULT 'WEEKLY';

-- DropIndex
DROP INDEX "WeeklyReview_userId_weekStart_key";

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyReview_userId_weekStart_reviewType_key" ON "WeeklyReview"("userId", "weekStart", "reviewType");
