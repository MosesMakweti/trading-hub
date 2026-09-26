-- Backtesting V1 — daily notes per Backtest Run (additive; no row changes).
-- Same contract as TradingDay/Trade/TradeOpportunity: NULL = LIVE.

ALTER TABLE "DailyNote" ADD COLUMN "backtestRunId" TEXT;
ALTER TABLE "DailyNote" ADD CONSTRAINT "DailyNote_backtestRunId_fkey" FOREIGN KEY ("backtestRunId") REFERENCES "BacktestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Live uniqueness → partial (LIVE rows only), swapped without a gap.
ALTER INDEX "DailyNote_userId_date_key" RENAME TO "DailyNote_userId_date_key_legacy";
CREATE UNIQUE INDEX "DailyNote_userId_date_key" ON "DailyNote"("userId", "date") WHERE ("backtestRunId" IS NULL);
DROP INDEX "DailyNote_userId_date_key_legacy";

CREATE UNIQUE INDEX "DailyNote_backtestRunId_date_key" ON "DailyNote"("backtestRunId", "date");

-- Same database backstop as the other environment-owned tables.
CREATE TRIGGER "DailyNote_backtest_environment_immutable" BEFORE UPDATE OF "backtestRunId" ON "DailyNote"
  FOR EACH ROW EXECUTE FUNCTION backtest_environment_immutable();
CREATE TRIGGER "DailyNote_backtest_run_owner" BEFORE INSERT ON "DailyNote"
  FOR EACH ROW EXECUTE FUNCTION backtest_run_owner_matches();
