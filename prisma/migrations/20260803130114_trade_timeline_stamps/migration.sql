-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedAt" TIMESTAMP(3);

-- Backfill lifecycle stamps for trades that predate this migration. Their exact
-- transition times weren't recorded, so `updatedAt` is used as a best-effort
-- approximation (going forward these are captured precisely at transition time):
--  * closedAt  <- updatedAt where a result (actualRR) was recorded
--  * reviewedAt <- updatedAt where any review content exists
UPDATE "Trade" SET "closedAt" = "updatedAt" WHERE "actualRR" IS NOT NULL;
UPDATE "Trade" SET "reviewedAt" = "updatedAt" WHERE (
  "psychPostTradeReflection" IS NOT NULL
  OR "psychLessonsLearned" IS NOT NULL
  OR "psychWhatToWorkOn" IS NOT NULL
  OR "whatWentWell" IS NOT NULL
  OR "whatWentWrong" IS NOT NULL
  OR "whatSurprisedMe" IS NOT NULL
);
