-- Simulation Platform — Phase 2 foundation (docs/SIMULATION_PLATFORM.md).
-- Additive only: new Sim* tables, enums and triggers. No live table changes.

-- CreateEnum
CREATE TYPE "SimProduct" AS ENUM ('STRATEGY_LAB', 'PROP_FIRM');

-- CreateEnum
CREATE TYPE "SimAccountKind" AS ENUM ('LAB', 'EVALUATION', 'FUNDED');

-- CreateEnum
CREATE TYPE "SimAccountStatus" AS ENUM ('CREATED', 'ACTIVE', 'PASSED', 'FAILED', 'BREACHED', 'COMPLETED', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SimSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "SimOrderType" AS ENUM ('MARKET', 'LIMIT', 'STOP');

-- CreateEnum
CREATE TYPE "SimOrderStatus" AS ENUM ('PENDING', 'FILLED', 'CANCELLED', 'EXPIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SimPositionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "SimFillKind" AS ENUM ('OPEN', 'CLOSE');

-- CreateEnum
CREATE TYPE "SimFillReason" AS ENUM ('MARKET', 'PENDING_TRIGGERED', 'STOP_LOSS', 'TAKE_PROFIT', 'MANUAL', 'PARTIAL', 'LIQUIDATION');

-- CreateEnum
CREATE TYPE "SimLedgerType" AS ENUM ('INITIAL_BALANCE', 'REALIZED_PNL', 'COMMISSION', 'SWAP', 'PAYOUT_WITHDRAWAL', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "SimAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "product" "SimProduct" NOT NULL,
    "kind" "SimAccountKind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "SimAccountStatus" NOT NULL DEFAULT 'CREATED',
    "statusReason" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "startingBalance" DECIMAL(14,2) NOT NULL,
    "rules" JSONB NOT NULL,
    "rulesVersion" INTEGER NOT NULL DEFAULT 1,
    "assets" TEXT[],
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "strategyId" TEXT,
    "strategyNameSnapshot" TEXT,
    "strategyVersionSnapshot" INTEGER,
    "strategySnapshot" JSONB,
    "currentMinute" INTEGER,
    "clockVersion" INTEGER NOT NULL DEFAULT 0,
    "recentCommands" JSONB NOT NULL DEFAULT '[]',
    "ledgerSequence" INTEGER NOT NULL DEFAULT 0,
    "challengeId" TEXT,
    "phaseIndex" INTEGER,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimDatasetPin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimDatasetPin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" "SimSide" NOT NULL,
    "type" "SimOrderType" NOT NULL,
    "status" "SimOrderStatus" NOT NULL DEFAULT 'PENDING',
    "pricePoints" INTEGER,
    "stopLoss" INTEGER,
    "takeProfit" INTEGER,
    "priceScale" INTEGER NOT NULL,
    "quantity" DECIMAL(24,10) NOT NULL,
    "riskPercent" DECIMAL(6,3),
    "intendedRisk" DECIMAL(14,2),
    "valuePerPriceUnit" DECIMAL(30,12) NOT NULL,
    "conversionRate" DECIMAL(30,12) NOT NULL,
    "specSnapshot" JSONB NOT NULL,
    "placedMinute" INTEGER NOT NULL,
    "expiresMinute" INTEGER,
    "resolvedMinute" INTEGER,
    "rejectionReason" TEXT,
    "clientRequestId" TEXT,
    "positionId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimPosition" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orderId" TEXT,
    "symbol" TEXT NOT NULL,
    "side" "SimSide" NOT NULL,
    "status" "SimPositionStatus" NOT NULL DEFAULT 'OPEN',
    "quantity" DECIMAL(24,10) NOT NULL,
    "remainingQuantity" DECIMAL(24,10) NOT NULL,
    "priceScale" INTEGER NOT NULL,
    "entryPoints" INTEGER NOT NULL,
    "stopLoss" INTEGER,
    "takeProfit" INTEGER,
    "initialStopLoss" INTEGER,
    "intendedRisk" DECIMAL(14,2),
    "valuePerPriceUnit" DECIMAL(30,12) NOT NULL,
    "conversionRate" DECIMAL(30,12) NOT NULL,
    "specSnapshot" JSONB NOT NULL,
    "openedMinute" INTEGER NOT NULL,
    "closedMinute" INTEGER,
    "realizedPnl" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "commissions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "swaps" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "closeReason" "SimFillReason",
    "ambiguousExit" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimFill" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" "SimFillKind" NOT NULL,
    "reason" "SimFillReason" NOT NULL,
    "minute" INTEGER NOT NULL,
    "pricePoints" INTEGER NOT NULL,
    "quantity" DECIMAL(24,10) NOT NULL,
    "grossPnl" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "commission" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "gapped" BOOLEAN NOT NULL DEFAULT false,
    "ambiguous" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimFill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimLedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" "SimLedgerType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "balanceAfter" DECIMAL(14,2) NOT NULL,
    "minute" INTEGER,
    "positionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "minute" INTEGER,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SimAccount_userId_product_status_idx" ON "SimAccount"("userId", "product", "status");

-- CreateIndex
CREATE INDEX "SimAccount_challengeId_idx" ON "SimAccount"("challengeId");

-- CreateIndex
CREATE INDEX "SimDatasetPin_datasetId_idx" ON "SimDatasetPin"("datasetId");

-- CreateIndex
CREATE UNIQUE INDEX "SimDatasetPin_accountId_assetSymbol_key" ON "SimDatasetPin"("accountId", "assetSymbol");

-- CreateIndex
CREATE UNIQUE INDEX "SimOrder_positionId_key" ON "SimOrder"("positionId");

-- CreateIndex
CREATE INDEX "SimOrder_accountId_status_idx" ON "SimOrder"("accountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SimOrder_accountId_clientRequestId_key" ON "SimOrder"("accountId", "clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "SimPosition_orderId_key" ON "SimPosition"("orderId");

-- CreateIndex
CREATE INDEX "SimPosition_accountId_status_idx" ON "SimPosition"("accountId", "status");

-- CreateIndex
CREATE INDEX "SimPosition_accountId_openedMinute_idx" ON "SimPosition"("accountId", "openedMinute");

-- CreateIndex
CREATE INDEX "SimFill_accountId_minute_idx" ON "SimFill"("accountId", "minute");

-- CreateIndex
CREATE UNIQUE INDEX "SimFill_positionId_sequence_key" ON "SimFill"("positionId", "sequence");

-- CreateIndex
CREATE INDEX "SimLedgerEntry_accountId_minute_idx" ON "SimLedgerEntry"("accountId", "minute");

-- CreateIndex
CREATE UNIQUE INDEX "SimLedgerEntry_accountId_sequence_key" ON "SimLedgerEntry"("accountId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "SimLedgerEntry_accountId_idempotencyKey_key" ON "SimLedgerEntry"("accountId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "SimEvent_accountId_createdAt_idx" ON "SimEvent"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "SimEvent_accountId_type_idx" ON "SimEvent"("accountId", "type");

-- AddForeignKey
ALTER TABLE "SimAccount" ADD CONSTRAINT "SimAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimAccount" ADD CONSTRAINT "SimAccount_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimDatasetPin" ADD CONSTRAINT "SimDatasetPin_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SimAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimDatasetPin" ADD CONSTRAINT "SimDatasetPin_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "HistoricalDataset"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimOrder" ADD CONSTRAINT "SimOrder_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SimAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimPosition" ADD CONSTRAINT "SimPosition_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SimAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimFill" ADD CONSTRAINT "SimFill_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SimAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimFill" ADD CONSTRAINT "SimFill_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "SimPosition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimLedgerEntry" ADD CONSTRAINT "SimLedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SimAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimEvent" ADD CONSTRAINT "SimEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SimAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Integrity triggers ───────────────────────────────────────────────────────

-- Every simulation child row belongs to its account's owner.
CREATE OR REPLACE FUNCTION sim_child_owner_guard() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "SimAccount" a WHERE a."id" = NEW."accountId" AND a."userId" = NEW."userId") THEN
    RAISE EXCEPTION 'SIM_OWNERSHIP: % row and its account belong to different users', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SimDatasetPin_owner" BEFORE INSERT OR UPDATE ON "SimDatasetPin" FOR EACH ROW EXECUTE FUNCTION sim_child_owner_guard();
CREATE TRIGGER "SimOrder_owner" BEFORE INSERT OR UPDATE ON "SimOrder" FOR EACH ROW EXECUTE FUNCTION sim_child_owner_guard();
CREATE TRIGGER "SimPosition_owner" BEFORE INSERT OR UPDATE ON "SimPosition" FOR EACH ROW EXECUTE FUNCTION sim_child_owner_guard();
CREATE TRIGGER "SimFill_owner" BEFORE INSERT ON "SimFill" FOR EACH ROW EXECUTE FUNCTION sim_child_owner_guard();
CREATE TRIGGER "SimLedgerEntry_owner" BEFORE INSERT ON "SimLedgerEntry" FOR EACH ROW EXECUTE FUNCTION sim_child_owner_guard();
CREATE TRIGGER "SimEvent_owner" BEFORE INSERT ON "SimEvent" FOR EACH ROW EXECUTE FUNCTION sim_child_owner_guard();

-- A fill belongs to a position of the same account.
CREATE OR REPLACE FUNCTION sim_fill_position_guard() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "SimPosition" p WHERE p."id" = NEW."positionId" AND p."accountId" = NEW."accountId") THEN
    RAISE EXCEPTION 'SIM_OWNERSHIP: fill and position belong to different accounts';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SimFill_position" BEFORE INSERT ON "SimFill" FOR EACH ROW EXECUTE FUNCTION sim_fill_position_guard();

-- A pinned dataset is the pin owner's own.
CREATE OR REPLACE FUNCTION sim_pin_dataset_guard() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "HistoricalDataset" d WHERE d."id" = NEW."datasetId" AND d."userId" = NEW."userId") THEN
    RAISE EXCEPTION 'SIM_OWNERSHIP: dataset is not the account owner''s';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SimDatasetPin_dataset" BEFORE INSERT OR UPDATE ON "SimDatasetPin" FOR EACH ROW EXECUTE FUNCTION sim_pin_dataset_guard();

-- Pins are frozen once the account's clock has started (reproducible results).
CREATE OR REPLACE FUNCTION sim_pin_frozen_guard() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "SimAccount" a WHERE a."id" = OLD."accountId" AND a."currentMinute" IS NOT NULL) THEN
    RAISE EXCEPTION 'SIM_PIN_FROZEN: the account''s replay has started; its datasets can''t change';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SimDatasetPin_frozen" BEFORE UPDATE OR DELETE ON "SimDatasetPin" FOR EACH ROW EXECUTE FUNCTION sim_pin_frozen_guard();

-- Append-only history: fills, ledger and events can't be edited, and can only
-- be deleted together with their account (cascade).
CREATE OR REPLACE FUNCTION sim_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'SIM_IMMUTABLE: % rows are append-only', TG_TABLE_NAME;
  END IF;
  IF EXISTS (SELECT 1 FROM "SimAccount" a WHERE a."id" = OLD."accountId") THEN
    RAISE EXCEPTION 'SIM_IMMUTABLE: % rows can only be removed with their account', TG_TABLE_NAME;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SimFill_append_only" BEFORE UPDATE OR DELETE ON "SimFill" FOR EACH ROW EXECUTE FUNCTION sim_append_only();
CREATE TRIGGER "SimLedgerEntry_append_only" BEFORE UPDATE OR DELETE ON "SimLedgerEntry" FOR EACH ROW EXECUTE FUNCTION sim_append_only();
CREATE TRIGGER "SimEvent_append_only" BEFORE UPDATE OR DELETE ON "SimEvent" FOR EACH ROW EXECUTE FUNCTION sim_append_only();

-- Ledger: each entry continues the running balance exactly.
CREATE OR REPLACE FUNCTION sim_ledger_insert_guard() RETURNS trigger AS $$
DECLARE prev RECORD;
BEGIN
  IF NEW."sequence" = 1 THEN
    IF NEW."type" <> 'INITIAL_BALANCE' OR NEW."balanceAfter" <> NEW."amount" THEN
      RAISE EXCEPTION 'SIM_LEDGER: the first entry must be INITIAL_BALANCE with balanceAfter = amount';
    END IF;
    RETURN NEW;
  END IF;
  SELECT "balanceAfter" INTO prev FROM "SimLedgerEntry" WHERE "accountId" = NEW."accountId" AND "sequence" = NEW."sequence" - 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SIM_LEDGER: entry % has no predecessor', NEW."sequence";
  END IF;
  IF NEW."balanceAfter" <> prev."balanceAfter" + NEW."amount" THEN
    RAISE EXCEPTION 'SIM_LEDGER: running balance mismatch at entry %', NEW."sequence";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SimLedgerEntry_insert_guard" BEFORE INSERT ON "SimLedgerEntry" FOR EACH ROW EXECUTE FUNCTION sim_ledger_insert_guard();

-- The replay clock only moves forward; owner and product never change.
CREATE OR REPLACE FUNCTION sim_account_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."userId" <> OLD."userId" OR NEW."product" <> OLD."product" OR NEW."kind" <> OLD."kind" THEN
    RAISE EXCEPTION 'SIM_ACCOUNT: owner, product and kind are immutable';
  END IF;
  IF OLD."currentMinute" IS NOT NULL AND (NEW."currentMinute" IS NULL OR NEW."currentMinute" < OLD."currentMinute") THEN
    RAISE EXCEPTION 'SIM_CLOCK: replay time only moves forward';
  END IF;
  IF NEW."rules" IS DISTINCT FROM OLD."rules" AND OLD."currentMinute" IS NOT NULL THEN
    RAISE EXCEPTION 'SIM_ACCOUNT: rules are frozen once trading has started';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SimAccount_guard" BEFORE UPDATE ON "SimAccount" FOR EACH ROW EXECUTE FUNCTION sim_account_guard();

ALTER TABLE "SimOrder" ADD CONSTRAINT "SimOrder_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "SimPosition" ADD CONSTRAINT "SimPosition_quantity_valid" CHECK ("quantity" > 0 AND "remainingQuantity" >= 0 AND "remainingQuantity" <= "quantity");
ALTER TABLE "SimFill" ADD CONSTRAINT "SimFill_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "SimAccount" ADD CONSTRAINT "SimAccount_period_valid" CHECK ("periodEnd" >= "periodStart" AND "startingBalance" > 0);

-- Deferred so deleting a USER (which cascades both its datasets and its
-- accounts → pins) passes regardless of cascade order, while deleting a
-- dataset an account still pins fails at commit.
ALTER TABLE "SimDatasetPin" DROP CONSTRAINT "SimDatasetPin_datasetId_fkey";
ALTER TABLE "SimDatasetPin" ADD CONSTRAINT "SimDatasetPin_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "HistoricalDataset"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
