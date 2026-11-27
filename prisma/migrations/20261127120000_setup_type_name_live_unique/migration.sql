-- Strategy Lab audit #5: an archived (soft-deleted) Setup Type must not block
-- reusing its name. Uniqueness now applies to live rows only.
DROP INDEX IF EXISTS "StrategySetupType_strategyId_name_key";
CREATE UNIQUE INDEX "StrategySetupType_strategyId_name_key" ON "StrategySetupType"("strategyId", "name") WHERE ("deletedAt" IS NULL);
