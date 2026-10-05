-- Today V3 (Phase 4): provenance link from a MISSED TradeOpportunity to the
-- cancelled/never-entered Trade the trader explicitly recorded it from
-- ("Record as missed opportunity"). Nullable, additive, no backfill: every
-- existing opportunity was spotted directly, so NULL is correct for all of
-- them. Deliberately separate from Trade.opportunityId, which means "the
-- executed trade" and feeds execution/discrepancy analytics.
ALTER TABLE "TradeOpportunity" ADD COLUMN "originTradeId" TEXT;

-- One missed opportunity per cancelled trade.
CREATE UNIQUE INDEX "TradeOpportunity_originTradeId_key" ON "TradeOpportunity"("originTradeId");

-- SetNull: the opportunity outlives a hard-deleted trade.
ALTER TABLE "TradeOpportunity" ADD CONSTRAINT "TradeOpportunity_originTradeId_fkey" FOREIGN KEY ("originTradeId") REFERENCES "Trade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Database-level isolation backstop (mirrors
-- backtest_trade_opportunity_same_environment): the origin trade and the
-- opportunity must live in the same environment (same run, or both live).
CREATE OR REPLACE FUNCTION backtest_opportunity_origin_trade_same_environment() RETURNS trigger AS $$
BEGIN
  IF NEW."originTradeId" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "Trade" t
    WHERE t."id" = NEW."originTradeId" AND t."backtestRunId" IS DISTINCT FROM NEW."backtestRunId"
  ) THEN
    RAISE EXCEPTION 'BACKTEST_ISOLATION: opportunity and its origin trade belong to different environments';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TradeOpportunity_origin_trade_same_environment" BEFORE INSERT OR UPDATE OF "originTradeId" ON "TradeOpportunity"
  FOR EACH ROW EXECUTE FUNCTION backtest_opportunity_origin_trade_same_environment();
