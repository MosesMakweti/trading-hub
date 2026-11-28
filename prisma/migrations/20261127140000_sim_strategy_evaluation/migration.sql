-- Strategy evaluation frozen at the trade decision (Backtesting terminal).
ALTER TABLE "SimOrder" ADD COLUMN "strategyEvaluation" JSONB;
ALTER TABLE "SimPosition" ADD COLUMN "strategyEvaluation" JSONB,
  ADD COLUMN "setupTypeName" TEXT,
  ADD COLUMN "strategySessionName" TEXT,
  ADD COLUMN "executionScore" INTEGER,
  ADD COLUMN "followedRules" BOOLEAN;
