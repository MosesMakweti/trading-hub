-- Strategy development inside the Backtesting terminal: isolated experiments
-- built on the existing Strategy tree (additive only).
CREATE TYPE "StrategyExperimentMode" AS ENUM ('REFINEMENT', 'BUILD');
CREATE TYPE "StrategyExperimentStatus" AS ENUM ('ACTIVE', 'SAVED_AS_VERSION', 'PROMOTED', 'DISCARDED');

ALTER TABLE "Strategy" ADD COLUMN "isExperiment" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SimAccount" ADD COLUMN "experimentId" TEXT;

CREATE TABLE "StrategyExperiment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "StrategyExperimentMode" NOT NULL,
    "status" "StrategyExperimentStatus" NOT NULL DEFAULT 'ACTIVE',
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "baselineStrategyId" TEXT,
    "baselineVersion" INTEGER,
    "baselineSnapshot" JSONB,
    "workingStrategyId" TEXT NOT NULL,
    "hypothesis" TEXT,
    "expectedEffect" TEXT,
    "actualOutcome" TEXT,
    "notes" TEXT,
    "resultVersion" INTEGER,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StrategyExperiment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StrategyExperiment_workingStrategyId_key" ON "StrategyExperiment"("workingStrategyId");
CREATE INDEX "StrategyExperiment_userId_status_idx" ON "StrategyExperiment"("userId", "status");
CREATE INDEX "StrategyExperiment_baselineStrategyId_sequence_idx" ON "StrategyExperiment"("baselineStrategyId", "sequence");
CREATE INDEX "SimAccount_experimentId_idx" ON "SimAccount"("experimentId");

ALTER TABLE "StrategyExperiment" ADD CONSTRAINT "StrategyExperiment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StrategyExperiment" ADD CONSTRAINT "StrategyExperiment_baselineStrategyId_fkey" FOREIGN KEY ("baselineStrategyId") REFERENCES "Strategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StrategyExperiment" ADD CONSTRAINT "StrategyExperiment_workingStrategyId_fkey" FOREIGN KEY ("workingStrategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SimAccount" ADD CONSTRAINT "SimAccount_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "StrategyExperiment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Ownership guard (defence in depth, same idea as the Sim* owner triggers):
-- an experiment's working and baseline strategies must belong to its user.
CREATE OR REPLACE FUNCTION "strategy_experiment_owner_check"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Strategy" WHERE "id" = NEW."workingStrategyId" AND "userId" = NEW."userId") THEN
    RAISE EXCEPTION 'STRATEGY_EXPERIMENT_OWNER: working strategy does not belong to the experiment owner';
  END IF;
  IF NEW."baselineStrategyId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Strategy" WHERE "id" = NEW."baselineStrategyId" AND "userId" = NEW."userId") THEN
    RAISE EXCEPTION 'STRATEGY_EXPERIMENT_OWNER: baseline strategy does not belong to the experiment owner';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "strategy_experiment_owner_check"
  BEFORE INSERT OR UPDATE OF "userId", "workingStrategyId", "baselineStrategyId" ON "StrategyExperiment"
  FOR EACH ROW EXECUTE FUNCTION "strategy_experiment_owner_check"();

-- A simulation session may only test the owner's own experiment.
CREATE OR REPLACE FUNCTION "sim_account_experiment_owner_check"() RETURNS trigger AS $$
BEGIN
  IF NEW."experimentId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "StrategyExperiment" WHERE "id" = NEW."experimentId" AND "userId" = NEW."userId") THEN
    RAISE EXCEPTION 'SIM_OWNER: experiment does not belong to the account owner';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sim_account_experiment_owner_check"
  BEFORE INSERT OR UPDATE OF "experimentId", "userId" ON "SimAccount"
  FOR EACH ROW EXECUTE FUNCTION "sim_account_experiment_owner_check"();
