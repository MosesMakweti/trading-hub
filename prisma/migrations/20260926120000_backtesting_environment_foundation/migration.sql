-- Backtesting Environment — Stage 1 (schema foundation).
--
-- Purely additive for existing data: three nullable `backtestRunId` columns
-- (NULL = LIVE, which every existing row is), one new table, and two unique
-- indexes narrowed to LIVE rows. No row is modified or deleted.
--
-- The live-uniqueness swap renames the original index first, creates the
-- partial replacement, then drops the renamed original — so per-user
-- uniqueness of (userId, date) / (userId, tradeNumber) is enforced at every
-- moment of the migration.

-- CreateEnum
CREATE TYPE "BacktestRunStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "BacktestRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "strategyId" TEXT,
    "strategyNameSnapshot" TEXT,
    "strategyVersionSnapshot" INTEGER,
    "strategySnapshot" JSONB,
    "assets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "tradingWeekdays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "status" "BacktestRunStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSessionDate" DATE,
    "lastActiveAt" TIMESTAMP(3),
    "startingBalance" DECIMAL(14,2),
    "riskPercentPerTrade" DECIMAL(6,3),
    "currency" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "BacktestRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BacktestRun_period_check" CHECK ("endDate" >= "startDate")
);

CREATE INDEX "BacktestRun_userId_status_updatedAt_idx" ON "BacktestRun"("userId", "status", "updatedAt");
CREATE INDEX "BacktestRun_strategyId_idx" ON "BacktestRun"("strategyId");

ALTER TABLE "BacktestRun" ADD CONSTRAINT "BacktestRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BacktestRun" ADD CONSTRAINT "BacktestRun_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Environment discriminator columns (NULL = LIVE).
ALTER TABLE "TradingDay" ADD COLUMN "backtestRunId" TEXT;
ALTER TABLE "Trade" ADD COLUMN "backtestRunId" TEXT;
ALTER TABLE "TradeOpportunity" ADD COLUMN "backtestRunId" TEXT;

ALTER TABLE "TradingDay" ADD CONSTRAINT "TradingDay_backtestRunId_fkey" FOREIGN KEY ("backtestRunId") REFERENCES "BacktestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_backtestRunId_fkey" FOREIGN KEY ("backtestRunId") REFERENCES "BacktestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TradeOpportunity" ADD CONSTRAINT "TradeOpportunity_backtestRunId_fkey" FOREIGN KEY ("backtestRunId") REFERENCES "BacktestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Live uniqueness → partial (LIVE rows only), swapped without a gap.
ALTER INDEX "TradingDay_userId_date_key" RENAME TO "TradingDay_userId_date_key_legacy";
CREATE UNIQUE INDEX "TradingDay_userId_date_key" ON "TradingDay"("userId", "date") WHERE ("backtestRunId" IS NULL);
DROP INDEX "TradingDay_userId_date_key_legacy";

ALTER INDEX "Trade_userId_tradeNumber_key" RENAME TO "Trade_userId_tradeNumber_key_legacy";
CREATE UNIQUE INDEX "Trade_userId_tradeNumber_key" ON "Trade"("userId", "tradeNumber") WHERE ("backtestRunId" IS NULL);
DROP INDEX "Trade_userId_tradeNumber_key_legacy";

-- Per-run uniqueness for simulated rows (NULLs are distinct, so LIVE rows
-- never participate in these).
CREATE UNIQUE INDEX "TradingDay_backtestRunId_date_key" ON "TradingDay"("backtestRunId", "date");
CREATE UNIQUE INDEX "Trade_backtestRunId_tradeNumber_key" ON "Trade"("backtestRunId", "tradeNumber");
CREATE INDEX "Trade_backtestRunId_tradeDate_idx" ON "Trade"("backtestRunId", "tradeDate");
CREATE INDEX "TradeOpportunity_backtestRunId_spottedAt_idx" ON "TradeOpportunity"("backtestRunId", "spottedAt");

-- ─────────────────────────────────────────────────────────────────────────
-- Database-level isolation backstop. The application layer (workspace-scope
-- Prisma extension + service guards) is the primary boundary; these triggers
-- make the money-affecting and environment-relabelling failure modes
-- impossible even if an application bug slips through. Every error message
-- is prefixed BACKTEST_ISOLATION so it is recognisable in logs/tests.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. A row's environment is fixed at insert: a simulated day/trade/
--    opportunity can never become live, and a live one can never be moved
--    into a run.
CREATE OR REPLACE FUNCTION backtest_environment_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW."backtestRunId" IS DISTINCT FROM OLD."backtestRunId" THEN
    RAISE EXCEPTION 'BACKTEST_ISOLATION: %.backtestRunId is immutable', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TradingDay_backtest_environment_immutable" BEFORE UPDATE OF "backtestRunId" ON "TradingDay"
  FOR EACH ROW EXECUTE FUNCTION backtest_environment_immutable();
CREATE TRIGGER "Trade_backtest_environment_immutable" BEFORE UPDATE OF "backtestRunId" ON "Trade"
  FOR EACH ROW EXECUTE FUNCTION backtest_environment_immutable();
CREATE TRIGGER "TradeOpportunity_backtest_environment_immutable" BEFORE UPDATE OF "backtestRunId" ON "TradeOpportunity"
  FOR EACH ROW EXECUTE FUNCTION backtest_environment_immutable();

-- 2. A simulated row must belong to the same user as its run.
CREATE OR REPLACE FUNCTION backtest_run_owner_matches() RETURNS trigger AS $$
BEGIN
  IF NEW."backtestRunId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "BacktestRun" r WHERE r."id" = NEW."backtestRunId" AND r."userId" = NEW."userId"
  ) THEN
    RAISE EXCEPTION 'BACKTEST_ISOLATION: %.userId does not own backtest run %', TG_TABLE_NAME, NEW."backtestRunId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TradingDay_backtest_run_owner" BEFORE INSERT ON "TradingDay"
  FOR EACH ROW EXECUTE FUNCTION backtest_run_owner_matches();
CREATE TRIGGER "Trade_backtest_run_owner" BEFORE INSERT ON "Trade"
  FOR EACH ROW EXECUTE FUNCTION backtest_run_owner_matches();
CREATE TRIGGER "TradeOpportunity_backtest_run_owner" BEFORE INSERT ON "TradeOpportunity"
  FOR EACH ROW EXECUTE FUNCTION backtest_run_owner_matches();

-- 3. Simulated trades never touch live accounting: no Performance Account
--    allocation, no Performance risk snapshot, no Prop Firm execution.
CREATE OR REPLACE FUNCTION backtest_trade_forbids_live_accounting() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Trade" t WHERE t."id" = NEW."tradeId" AND t."backtestRunId" IS NOT NULL) THEN
    RAISE EXCEPTION 'BACKTEST_ISOLATION: a backtest trade cannot have a % row', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TradeAccountAllocation_backtest_forbidden" BEFORE INSERT OR UPDATE OF "tradeId" ON "TradeAccountAllocation"
  FOR EACH ROW EXECUTE FUNCTION backtest_trade_forbids_live_accounting();
CREATE TRIGGER "PerformanceRiskSnapshot_backtest_forbidden" BEFORE INSERT OR UPDATE OF "tradeId" ON "PerformanceRiskSnapshot"
  FOR EACH ROW EXECUTE FUNCTION backtest_trade_forbids_live_accounting();
CREATE TRIGGER "TradeAccountExecution_backtest_forbidden" BEFORE INSERT OR UPDATE OF "tradeId" ON "TradeAccountExecution"
  FOR EACH ROW EXECUTE FUNCTION backtest_trade_forbids_live_accounting();

-- 4. An executed trade and the opportunity it resolves must live in the
--    same environment (same run, or both live).
CREATE OR REPLACE FUNCTION backtest_trade_opportunity_same_environment() RETURNS trigger AS $$
BEGIN
  IF NEW."opportunityId" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "TradeOpportunity" o
    WHERE o."id" = NEW."opportunityId" AND o."backtestRunId" IS DISTINCT FROM NEW."backtestRunId"
  ) THEN
    RAISE EXCEPTION 'BACKTEST_ISOLATION: trade and opportunity belong to different environments';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Trade_backtest_opportunity_same_environment" BEFORE INSERT OR UPDATE OF "opportunityId" ON "Trade"
  FOR EACH ROW EXECUTE FUNCTION backtest_trade_opportunity_same_environment();
