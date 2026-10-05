-- Today V3 (Phase 5 hardening): TradeOpportunity.originTradeId must point at
-- a Trade owned by the SAME user, in the same environment. The application
-- already enforces ownership (the only writer loads the trade scoped to the
-- user); this makes a cross-user link impossible at the database level too.
-- Replaces the Phase 4 trigger function in place; no table change, no data
-- touched (any existing link was written by that user-scoped path).
CREATE OR REPLACE FUNCTION backtest_opportunity_origin_trade_same_environment() RETURNS trigger AS $$
BEGIN
  IF NEW."originTradeId" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "Trade" t
    WHERE t."id" = NEW."originTradeId" AND t."backtestRunId" IS DISTINCT FROM NEW."backtestRunId"
  ) THEN
    RAISE EXCEPTION 'BACKTEST_ISOLATION: opportunity and its origin trade belong to different environments';
  END IF;
  IF NEW."originTradeId" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "Trade" t
    WHERE t."id" = NEW."originTradeId" AND t."userId" <> NEW."userId"
  ) THEN
    RAISE EXCEPTION 'OWNERSHIP: opportunity and its origin trade belong to different users';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
