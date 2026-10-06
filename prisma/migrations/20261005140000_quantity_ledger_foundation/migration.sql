-- Quantity ledger (Phase 2) — ADDITIVE ONLY. New enums, one defaulted
-- column on Trade (every existing row becomes LEGACY_PERCENT via the column
-- default — no backfill, no invented quantities), nullable sizing columns on
-- PerformanceRiskSnapshot (null on every existing row), two new tables, and
-- integrity triggers/CHECKs. No existing row is updated; TradeActualPartialExit
-- history is untouched. See docs/EXECUTION_ENGINE.md.

-- CreateEnum
CREATE TYPE "ExecutionModel" AS ENUM ('LEGACY_PERCENT', 'QUANTITY_LEDGER');

-- CreateEnum
CREATE TYPE "PricingModel" AS ENUM ('CONTRACT_SIZE', 'TICK_VALUE');

-- CreateEnum
CREATE TYPE "QuantityUnit" AS ENUM ('LOT', 'CONTRACT', 'UNIT');

-- CreateEnum
CREATE TYPE "PositionFillKind" AS ENUM ('CLOSE', 'REVERSAL');

-- CreateEnum
CREATE TYPE "PositionFillSource" AS ENUM ('MANUAL', 'PLANNED_TARGET', 'CORRECTION', 'IMPORTED');

-- CreateEnum
CREATE TYPE "PercentBasis" AS ENUM ('REMAINING_QUANTITY');

-- AlterTable
ALTER TABLE "PerformanceRiskSnapshot" ADD COLUMN     "effectiveRiskAmount" DECIMAL(20,8),
ADD COLUMN     "executableQuantity" DECIMAL(24,10),
ADD COLUMN     "quantityUnit" "QuantityUnit",
ADD COLUMN     "rawQuantity" DECIMAL(30,16),
ADD COLUMN     "sizingConversionRate" DECIMAL(24,12),
ADD COLUMN     "sizingVersion" INTEGER,
ADD COLUMN     "specSnapshot" JSONB,
ADD COLUMN     "valuePerPriceUnit" DECIMAL(24,10);

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "executionModel" "ExecutionModel" NOT NULL DEFAULT 'LEGACY_PERCENT';

-- CreateTable
CREATE TABLE "UserInstrumentSpec" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "pricingModel" "PricingModel",
    "quoteCurrency" TEXT,
    "contractSize" DECIMAL(24,10),
    "tickSize" DECIMAL(24,10),
    "tickValue" DECIMAL(24,10),
    "quantityUnit" "QuantityUnit",
    "quantityStep" DECIMAL(24,10),
    "minQuantity" DECIMAL(24,10),
    "maxQuantity" DECIMAL(24,10),
    "pipSize" DECIMAL(24,10),
    "pointSize" DECIMAL(24,10),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserInstrumentSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionFill" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "performanceSnapshotId" TEXT,
    "accountExecutionId" TEXT,
    "sequence" INTEGER NOT NULL,
    "kind" "PositionFillKind" NOT NULL,
    "source" "PositionFillSource" NOT NULL,
    "requestedPercent" DECIMAL(12,8),
    "percentBasis" "PercentBasis",
    "requestedQuantity" DECIMAL(24,10),
    "executedQuantity" DECIMAL(24,10) NOT NULL,
    "price" DECIMAL(18,8) NOT NULL,
    "quantityBefore" DECIMAL(24,10) NOT NULL,
    "quantityAfter" DECIMAL(24,10) NOT NULL,
    "grossPnl" DECIMAL(14,2) NOT NULL,
    "fees" DECIMAL(14,2),
    "conversionRate" DECIMAL(24,12) NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL,
    "planVersionId" TEXT,
    "plannedTargetOrder" INTEGER,
    "reversesFillId" TEXT,
    "replacesFillId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PositionFill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserInstrumentSpec_userId_symbol_key" ON "UserInstrumentSpec"("userId", "symbol");

-- CreateIndex
CREATE UNIQUE INDEX "PositionFill_reversesFillId_key" ON "PositionFill"("reversesFillId");

-- CreateIndex
CREATE INDEX "PositionFill_tradeId_idx" ON "PositionFill"("tradeId");

-- CreateIndex
CREATE INDEX "PositionFill_userId_idx" ON "PositionFill"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PositionFill_performanceSnapshotId_sequence_key" ON "PositionFill"("performanceSnapshotId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "PositionFill_accountExecutionId_sequence_key" ON "PositionFill"("accountExecutionId", "sequence");

-- AddForeignKey
ALTER TABLE "UserInstrumentSpec" ADD CONSTRAINT "UserInstrumentSpec_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionFill" ADD CONSTRAINT "PositionFill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionFill" ADD CONSTRAINT "PositionFill_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionFill" ADD CONSTRAINT "PositionFill_performanceSnapshotId_fkey" FOREIGN KEY ("performanceSnapshotId") REFERENCES "PerformanceRiskSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionFill" ADD CONSTRAINT "PositionFill_accountExecutionId_fkey" FOREIGN KEY ("accountExecutionId") REFERENCES "TradeAccountExecution"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionFill" ADD CONSTRAINT "PositionFill_reversesFillId_fkey" FOREIGN KEY ("reversesFillId") REFERENCES "PositionFill"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionFill" ADD CONSTRAINT "PositionFill_replacesFillId_fkey" FOREIGN KEY ("replacesFillId") REFERENCES "PositionFill"("id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- ════════════════════════════════════════════════════════════════════════
-- Integrity (database-level backstops for the service rules)
-- ════════════════════════════════════════════════════════════════════════

-- 1. A backtest trade can never be a quantity-ledger trade.
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_executionModel_live_only"
  CHECK ("executionModel" = 'LEGACY_PERCENT' OR "backtestRunId" IS NULL);

-- 2. Ledger sizing columns are all-or-nothing, and a sized snapshot always
--    carries a genuine initial stop.
ALTER TABLE "PerformanceRiskSnapshot" ADD CONSTRAINT "PerformanceRiskSnapshot_ledger_sizing_complete"
  CHECK (
    "executableQuantity" IS NULL
    OR (
      "executableQuantity" > 0
      AND "effectiveRiskAmount" IS NOT NULL
      AND "rawQuantity" IS NOT NULL
      AND "quantityUnit" IS NOT NULL
      AND "valuePerPriceUnit" IS NOT NULL
      AND "sizingConversionRate" IS NOT NULL
      AND "specSnapshot" IS NOT NULL
      AND "sizingVersion" IS NOT NULL
      AND "initialStop" IS NOT NULL
      AND "initialStopSource" IS NOT NULL
    )
  );

-- 3. PositionFill row-level shape.
ALTER TABLE "PositionFill" ADD CONSTRAINT "PositionFill_one_owner"
  CHECK (num_nonnulls("performanceSnapshotId", "accountExecutionId") = 1);
ALTER TABLE "PositionFill" ADD CONSTRAINT "PositionFill_shape"
  CHECK (
    "sequence" >= 1
    AND "executedQuantity" > 0
    AND "price" > 0
    AND "conversionRate" > 0
    AND "quantityBefore" >= 0
    AND "quantityAfter" >= 0
    AND ("requestedPercent" IS NULL OR ("requestedPercent" > 0 AND "requestedPercent" <= 100))
    AND ("requestedQuantity" IS NULL OR "requestedQuantity" > 0)
    AND (
      ("kind" = 'CLOSE' AND "reversesFillId" IS NULL
        AND "quantityAfter" = "quantityBefore" - "executedQuantity")
      OR ("kind" = 'REVERSAL' AND "reversesFillId" IS NOT NULL AND "replacesFillId" IS NULL
        AND "quantityAfter" = "quantityBefore" + "executedQuantity")
    )
  );

-- 4. PositionFill is append-only. UPDATE is never allowed. DELETE is allowed
--    only as part of deleting the owning trade/user (cascade), i.e. when the
--    owning trade — or its user — is already gone (the ledger snapshot is
--    likewise undeletable while its trade exists, trigger 9).
CREATE OR REPLACE FUNCTION position_fill_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'LEDGER_IMMUTABLE: PositionFill rows are append-only (use a REVERSAL fill)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Trade" t JOIN "User" u ON u."id" = t."userId"
    WHERE t."id" = OLD."tradeId"
  ) THEN
    RAISE EXCEPTION 'LEDGER_IMMUTABLE: PositionFill rows cannot be deleted (use a REVERSAL fill)';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PositionFill_append_only" BEFORE UPDATE OR DELETE ON "PositionFill"
  FOR EACH ROW EXECUTE FUNCTION position_fill_append_only();

-- 5. Backtest trades can never carry a ledger fill (same guard as the
--    Performance snapshot / allocations / prop executions).
CREATE TRIGGER "PositionFill_backtest_forbidden" BEFORE INSERT ON "PositionFill"
  FOR EACH ROW EXECUTE FUNCTION backtest_trade_forbids_live_accounting();

-- 6. Insert-time integrity: owner, model, and strict reversal/replacement rules.
CREATE OR REPLACE FUNCTION position_fill_insert_guard() RETURNS trigger AS $$
DECLARE
  t RECORD;
  target RECORD;
BEGIN
  SELECT "userId", "executionModel" INTO t FROM "Trade" WHERE "id" = NEW."tradeId";
  IF NOT FOUND OR t."userId" <> NEW."userId" THEN
    RAISE EXCEPTION 'OWNERSHIP: fill and trade belong to different users';
  END IF;
  IF t."executionModel" <> 'QUANTITY_LEDGER' THEN
    RAISE EXCEPTION 'EXECUTION_MODEL: a LEGACY_PERCENT trade cannot have PositionFill rows';
  END IF;
  IF NEW."performanceSnapshotId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "PerformanceRiskSnapshot" s
    WHERE s."id" = NEW."performanceSnapshotId" AND s."tradeId" = NEW."tradeId"
      AND s."userId" = NEW."userId" AND s."executableQuantity" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'LEDGER_OWNER: fill owner is not this trade''s sized Performance snapshot';
  END IF;
  IF NEW."accountExecutionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "TradeAccountExecution" e
    WHERE e."id" = NEW."accountExecutionId" AND e."tradeId" = NEW."tradeId" AND e."userId" = NEW."userId"
  ) THEN
    RAISE EXCEPTION 'LEDGER_OWNER: fill owner is not an execution of this trade';
  END IF;

  IF NEW."kind" = 'REVERSAL' THEN
    SELECT * INTO target FROM "PositionFill" WHERE "id" = NEW."reversesFillId";
    IF NOT FOUND
       OR target."tradeId" <> NEW."tradeId"
       OR target."performanceSnapshotId" IS DISTINCT FROM NEW."performanceSnapshotId"
       OR target."accountExecutionId" IS DISTINCT FROM NEW."accountExecutionId" THEN
      RAISE EXCEPTION 'REVERSAL_INVALID: target fill is not in this ledger';
    END IF;
    IF target."kind" <> 'CLOSE' THEN
      RAISE EXCEPTION 'REVERSAL_INVALID: only a CLOSE fill can be reversed';
    END IF;
    IF NEW."executedQuantity" <> target."executedQuantity"
       OR NEW."price" <> target."price"
       OR NEW."conversionRate" <> target."conversionRate"
       OR NEW."grossPnl" <> -target."grossPnl"
       OR NEW."fees" IS DISTINCT FROM (-target."fees") THEN
      RAISE EXCEPTION 'REVERSAL_INVALID: a reversal must exactly negate its target fill';
    END IF;
  END IF;

  IF NEW."replacesFillId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM "PositionFill" o
      WHERE o."id" = NEW."replacesFillId" AND o."tradeId" = NEW."tradeId" AND o."kind" = 'CLOSE'
        AND o."performanceSnapshotId" IS NOT DISTINCT FROM NEW."performanceSnapshotId"
        AND o."accountExecutionId" IS NOT DISTINCT FROM NEW."accountExecutionId"
        AND EXISTS (SELECT 1 FROM "PositionFill" r WHERE r."reversesFillId" = o."id")
    ) THEN
      RAISE EXCEPTION 'REPLACEMENT_INVALID: only a reversed CLOSE fill of this ledger can be replaced';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PositionFill_insert_guard" BEFORE INSERT ON "PositionFill"
  FOR EACH ROW EXECUTE FUNCTION position_fill_insert_guard();

-- 7. One execution history per trade: no legacy partial exit on a ledger trade.
CREATE OR REPLACE FUNCTION partial_exit_forbids_quantity_ledger() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Trade" t WHERE t."id" = NEW."tradeId" AND t."executionModel" = 'QUANTITY_LEDGER') THEN
    RAISE EXCEPTION 'EXECUTION_MODEL: a QUANTITY_LEDGER trade cannot have TradeActualPartialExit rows';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TradeActualPartialExit_forbids_quantity_ledger" BEFORE INSERT OR UPDATE ON "TradeActualPartialExit"
  FOR EACH ROW EXECUTE FUNCTION partial_exit_forbids_quantity_ledger();

-- 8. Trade: executionModel is chosen once (never after the Performance
--    snapshot exists or with legacy partial exits); a ledger trade never
--    carries a legacy actualExit and its frozen entry price never changes.
CREATE OR REPLACE FUNCTION trade_execution_model_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."executionModel" IS DISTINCT FROM OLD."executionModel" THEN
    IF EXISTS (SELECT 1 FROM "PerformanceRiskSnapshot" s WHERE s."tradeId" = NEW."id") THEN
      RAISE EXCEPTION 'EXECUTION_MODEL: the execution model is fixed once the Performance snapshot is locked';
    END IF;
    IF EXISTS (SELECT 1 FROM "TradeActualPartialExit" p WHERE p."tradeId" = NEW."id") THEN
      RAISE EXCEPTION 'EXECUTION_MODEL: a trade with legacy partial exits cannot change execution model';
    END IF;
  END IF;
  IF NEW."executionModel" = 'QUANTITY_LEDGER' THEN
    IF NEW."actualExit" IS NOT NULL THEN
      RAISE EXCEPTION 'EXECUTION_MODEL: a QUANTITY_LEDGER trade never stores actualExit (exits are fills)';
    END IF;
    IF OLD."actualEntry" IS NOT NULL AND NEW."actualEntry" IS DISTINCT FROM OLD."actualEntry" THEN
      RAISE EXCEPTION 'EXECUTION_MODEL: a QUANTITY_LEDGER trade''s entry price is frozen';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Trade_execution_model_guard" BEFORE UPDATE ON "Trade"
  FOR EACH ROW EXECUTE FUNCTION trade_execution_model_guard();

-- 9. PerformanceRiskSnapshot: sizing only at insert, only for ledger trades,
--    and write-once together with the frozen risk inputs.
CREATE OR REPLACE FUNCTION performance_snapshot_ledger_guard() RETURNS trigger AS $$
DECLARE
  model "ExecutionModel";
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- A ledger snapshot owns the fill ledger: it goes only with its trade/user.
    IF OLD."executableQuantity" IS NOT NULL AND EXISTS (
      SELECT 1 FROM "Trade" t JOIN "User" u ON u."id" = t."userId" WHERE t."id" = OLD."tradeId"
    ) THEN
      RAISE EXCEPTION 'LEDGER_IMMUTABLE: a ledger snapshot cannot be deleted while its trade exists';
    END IF;
    RETURN OLD;
  END IF;
  SELECT "executionModel" INTO model FROM "Trade" WHERE "id" = NEW."tradeId";
  IF TG_OP = 'INSERT' THEN
    IF model = 'QUANTITY_LEDGER' AND NEW."executableQuantity" IS NULL THEN
      RAISE EXCEPTION 'EXECUTION_MODEL: a QUANTITY_LEDGER snapshot must be sized at lock';
    END IF;
    IF model IS DISTINCT FROM 'QUANTITY_LEDGER' AND NEW."executableQuantity" IS NOT NULL THEN
      RAISE EXCEPTION 'EXECUTION_MODEL: only a QUANTITY_LEDGER snapshot carries sizing';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."executableQuantity" IS NULL THEN
    IF NEW."executableQuantity" IS NOT NULL THEN
      RAISE EXCEPTION 'LEDGER_IMMUTABLE: sizing is written only when the snapshot is locked';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW."tradeId", NEW."userId", NEW."performanceAccountId", NEW."balanceBefore", NEW."riskPercent",
         NEW."riskAmount", NEW."currency", NEW."actualEntry", NEW."direction", NEW."initialStop",
         NEW."initialStopSource", NEW."effectiveRiskAmount", NEW."rawQuantity", NEW."executableQuantity",
         NEW."quantityUnit", NEW."valuePerPriceUnit", NEW."sizingConversionRate", NEW."specSnapshot"::text,
         NEW."sizingVersion")
     IS DISTINCT FROM
     ROW(OLD."tradeId", OLD."userId", OLD."performanceAccountId", OLD."balanceBefore", OLD."riskPercent",
         OLD."riskAmount", OLD."currency", OLD."actualEntry", OLD."direction", OLD."initialStop",
         OLD."initialStopSource", OLD."effectiveRiskAmount", OLD."rawQuantity", OLD."executableQuantity",
         OLD."quantityUnit", OLD."valuePerPriceUnit", OLD."sizingConversionRate", OLD."specSnapshot"::text,
         OLD."sizingVersion") THEN
    RAISE EXCEPTION 'LEDGER_IMMUTABLE: a ledger snapshot''s frozen risk and sizing never change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PerformanceRiskSnapshot_ledger_guard" BEFORE INSERT OR UPDATE OR DELETE ON "PerformanceRiskSnapshot"
  FOR EACH ROW EXECUTE FUNCTION performance_snapshot_ledger_guard();
