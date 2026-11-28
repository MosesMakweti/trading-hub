-- MT5 Connector (Stage 1) — account-history sync foundation.
-- Additive only: new enums, new tables, indexes, FKs, one CHECK constraint
-- and one immutability trigger. No existing table, column, index or row is
-- altered. See docs/MT5_CONNECTOR.md.
--
-- Cascades: deleting a User or a TradingAccount deletes its Mt5Connection
-- and, through it, every MT5 row of that connection.

-- CreateEnum
CREATE TYPE "Mt5ConnectionStatus" AS ENUM ('PENDING_PAIRING', 'ACTIVE', 'PAUSED', 'REVOKED');

-- CreateEnum
CREATE TYPE "Mt5MarginMode" AS ENUM ('NETTING', 'HEDGING', 'EXCHANGE');

-- CreateEnum
CREATE TYPE "Mt5TradeMode" AS ENUM ('DEMO', 'CONTEST', 'REAL');

-- CreateEnum
CREATE TYPE "Mt5SyncBatchKind" AS ENUM ('BACKFILL', 'RECONCILE', 'LIVE');

-- CreateEnum
CREATE TYPE "Mt5DealCategory" AS ENUM ('TRADE', 'TRADE_CANCELED', 'BALANCE', 'CREDIT', 'CHARGE', 'CORRECTION', 'BONUS', 'COMMISSION', 'INTEREST', 'DIVIDEND', 'TAX', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "Mt5Side" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "Mt5DealEntry" AS ENUM ('IN', 'OUT', 'INOUT', 'OUT_BY');

-- CreateEnum
CREATE TYPE "Mt5PositionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "Mt5InitialStopSource" AS ENUM ('OPENING_DEAL', 'OPENING_ORDER', 'NONE_AT_OPEN', 'UNAVAILABLE');

-- CreateTable
CREATE TABLE "Mt5Connection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tradingAccountId" TEXT NOT NULL,
    "status" "Mt5ConnectionStatus" NOT NULL DEFAULT 'PENDING_PAIRING',
    "login" TEXT,
    "server" TEXT,
    "brokerCompany" TEXT,
    "accountName" TEXT,
    "accountCurrency" TEXT,
    "currencyDigits" INTEGER,
    "leverage" INTEGER,
    "marginMode" "Mt5MarginMode",
    "tradeMode" "Mt5TradeMode",
    "terminalBuild" INTEGER,
    "eaVersion" TEXT,
    "timeConventionJson" JSONB,
    "observedOffsetMinutes" INTEGER,
    "pairingCodeHash" TEXT,
    "pairingExpiresAt" TIMESTAMP(3),
    "tokenHash" TEXT,
    "tokenPrefix" TEXT,
    "pairedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "backfillStartedAt" TIMESTAMP(3),
    "backfillCompletedAt" TIMESTAMP(3),
    "historyFromMsc" BIGINT,
    "historyToMsc" BIGINT,
    "lastDealTimeMsc" BIGINT,
    "pausedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mt5Connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mt5SyncBatch" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "kind" "Mt5SyncBatchKind" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "batchSeq" INTEGER,
    "rangeFromMsc" BIGINT,
    "rangeToMsc" BIGINT,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "receivedDeals" INTEGER NOT NULL DEFAULT 0,
    "insertedDeals" INTEGER NOT NULL DEFAULT 0,
    "duplicateDeals" INTEGER NOT NULL DEFAULT 0,
    "receivedOrders" INTEGER NOT NULL DEFAULT 0,
    "insertedOrders" INTEGER NOT NULL DEFAULT 0,
    "duplicateOrders" INTEGER NOT NULL DEFAULT 0,
    "conflicts" INTEGER NOT NULL DEFAULT 0,
    "responseJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mt5SyncBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mt5Deal" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "ticket" TEXT NOT NULL,
    "orderTicket" TEXT,
    "positionId" TEXT,
    "timeMsc" BIGINT NOT NULL,
    "serverTime" TIMESTAMP(3) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "utcOffsetMinutes" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "category" "Mt5DealCategory" NOT NULL,
    "side" "Mt5Side",
    "entry" "Mt5DealEntry",
    "reason" TEXT,
    "symbol" TEXT,
    "volume" DECIMAL(24,10),
    "price" DECIMAL(24,10),
    "profit" DECIMAL(24,8) NOT NULL,
    "commission" DECIMAL(24,8) NOT NULL,
    "swap" DECIMAL(24,8) NOT NULL,
    "fee" DECIMAL(24,8) NOT NULL,
    "stopLoss" DECIMAL(24,10),
    "takeProfit" DECIMAL(24,10),
    "magic" TEXT,
    "comment" TEXT,
    "externalId" TEXT,
    "raw" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mt5Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mt5Order" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "ticket" TEXT NOT NULL,
    "positionId" TEXT,
    "positionById" TEXT,
    "type" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "reason" TEXT,
    "symbol" TEXT,
    "timeSetupMsc" BIGINT,
    "timeDoneMsc" BIGINT,
    "setupAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "volumeInitial" DECIMAL(24,10),
    "volumeCurrent" DECIMAL(24,10),
    "priceOpen" DECIMAL(24,10),
    "priceStopLimit" DECIMAL(24,10),
    "stopLoss" DECIMAL(24,10),
    "takeProfit" DECIMAL(24,10),
    "magic" TEXT,
    "comment" TEXT,
    "externalId" TEXT,
    "raw" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mt5Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mt5Position" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "direction" "Direction" NOT NULL,
    "status" "Mt5PositionStatus" NOT NULL,
    "openedMsc" BIGINT,
    "openedAt" TIMESTAMP(3),
    "closedMsc" BIGINT,
    "closedAt" TIMESTAMP(3),
    "volumeIn" DECIMAL(24,10) NOT NULL,
    "volumeOut" DECIMAL(24,10) NOT NULL,
    "openVolume" DECIMAL(24,10) NOT NULL,
    "avgEntryPrice" DECIMAL(24,10),
    "avgExitPrice" DECIMAL(24,10),
    "profit" DECIMAL(24,8) NOT NULL,
    "commission" DECIMAL(24,8) NOT NULL,
    "swap" DECIMAL(24,8) NOT NULL,
    "fee" DECIMAL(24,8) NOT NULL,
    "netProfit" DECIMAL(24,8) NOT NULL,
    "dealCount" INTEGER NOT NULL,
    "entryCount" INTEGER NOT NULL,
    "exitCount" INTEGER NOT NULL,
    "reversalCount" INTEGER NOT NULL DEFAULT 0,
    "initialStopLoss" DECIMAL(24,10),
    "initialTakeProfit" DECIMAL(24,10),
    "initialStopSource" "Mt5InitialStopSource" NOT NULL DEFAULT 'UNAVAILABLE',
    "segments" JSONB NOT NULL,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "derivationVersion" INTEGER NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "derivedAt" TIMESTAMP(3) NOT NULL,
    "liveOpen" BOOLEAN NOT NULL DEFAULT false,
    "liveStopLoss" DECIMAL(24,10),
    "liveTakeProfit" DECIMAL(24,10),
    "liveCurrentPrice" DECIMAL(24,10),
    "liveProfit" DECIMAL(24,8),
    "liveObservedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mt5Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mt5PositionEvent" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "stopLoss" DECIMAL(24,10),
    "takeProfit" DECIMAL(24,10),
    "observedMsc" BIGINT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mt5PositionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mt5AccountSnapshot" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "balance" DECIMAL(24,8) NOT NULL,
    "equity" DECIMAL(24,8) NOT NULL,
    "margin" DECIMAL(24,8) NOT NULL,
    "freeMargin" DECIMAL(24,8) NOT NULL,
    "credit" DECIMAL(24,8) NOT NULL,
    "profit" DECIMAL(24,8) NOT NULL,
    "openPositions" JSONB NOT NULL,
    "serverTimeMsc" BIGINT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mt5AccountSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mt5SymbolSpec" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "description" TEXT,
    "digits" INTEGER,
    "contractSize" DECIMAL(24,10),
    "tickSize" DECIMAL(24,10),
    "tickValue" DECIMAL(24,10),
    "volumeMin" DECIMAL(24,10),
    "volumeMax" DECIMAL(24,10),
    "volumeStep" DECIMAL(24,10),
    "currencyBase" TEXT,
    "currencyProfit" TEXT,
    "currencyMargin" TEXT,
    "raw" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mt5SymbolSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mt5PairingAttempt" (
    "id" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mt5PairingAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Mt5Connection_tradingAccountId_key" ON "Mt5Connection"("tradingAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Mt5Connection_pairingCodeHash_key" ON "Mt5Connection"("pairingCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "Mt5Connection_tokenHash_key" ON "Mt5Connection"("tokenHash");

-- CreateIndex
CREATE INDEX "Mt5Connection_userId_status_idx" ON "Mt5Connection"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Mt5Connection_userId_server_login_key" ON "Mt5Connection"("userId", "server", "login");

-- CreateIndex
CREATE INDEX "Mt5SyncBatch_connectionId_createdAt_idx" ON "Mt5SyncBatch"("connectionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Mt5SyncBatch_connectionId_idempotencyKey_key" ON "Mt5SyncBatch"("connectionId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Mt5Deal_connectionId_positionId_idx" ON "Mt5Deal"("connectionId", "positionId");

-- CreateIndex
CREATE INDEX "Mt5Deal_connectionId_timeMsc_idx" ON "Mt5Deal"("connectionId", "timeMsc");

-- CreateIndex
CREATE INDEX "Mt5Deal_connectionId_category_idx" ON "Mt5Deal"("connectionId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Mt5Deal_connectionId_ticket_key" ON "Mt5Deal"("connectionId", "ticket");

-- CreateIndex
CREATE INDEX "Mt5Order_connectionId_positionId_idx" ON "Mt5Order"("connectionId", "positionId");

-- CreateIndex
CREATE INDEX "Mt5Order_connectionId_timeDoneMsc_idx" ON "Mt5Order"("connectionId", "timeDoneMsc");

-- CreateIndex
CREATE UNIQUE INDEX "Mt5Order_connectionId_ticket_key" ON "Mt5Order"("connectionId", "ticket");

-- CreateIndex
CREATE INDEX "Mt5Position_connectionId_status_idx" ON "Mt5Position"("connectionId", "status");

-- CreateIndex
CREATE INDEX "Mt5Position_connectionId_openedMsc_idx" ON "Mt5Position"("connectionId", "openedMsc");

-- CreateIndex
CREATE INDEX "Mt5Position_connectionId_closedMsc_idx" ON "Mt5Position"("connectionId", "closedMsc");

-- CreateIndex
CREATE UNIQUE INDEX "Mt5Position_connectionId_positionId_key" ON "Mt5Position"("connectionId", "positionId");

-- CreateIndex
CREATE INDEX "Mt5PositionEvent_connectionId_positionId_idx" ON "Mt5PositionEvent"("connectionId", "positionId");

-- CreateIndex
CREATE UNIQUE INDEX "Mt5PositionEvent_connectionId_positionId_observedMsc_key" ON "Mt5PositionEvent"("connectionId", "positionId", "observedMsc");

-- CreateIndex
CREATE INDEX "Mt5AccountSnapshot_connectionId_capturedAt_idx" ON "Mt5AccountSnapshot"("connectionId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Mt5SymbolSpec_connectionId_symbol_key" ON "Mt5SymbolSpec"("connectionId", "symbol");

-- CreateIndex
CREATE INDEX "Mt5PairingAttempt_ipHash_createdAt_idx" ON "Mt5PairingAttempt"("ipHash", "createdAt");

-- CreateIndex
CREATE INDEX "Mt5PairingAttempt_createdAt_idx" ON "Mt5PairingAttempt"("createdAt");

-- AddForeignKey
ALTER TABLE "Mt5Connection" ADD CONSTRAINT "Mt5Connection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mt5Connection" ADD CONSTRAINT "Mt5Connection_tradingAccountId_fkey" FOREIGN KEY ("tradingAccountId") REFERENCES "TradingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mt5SyncBatch" ADD CONSTRAINT "Mt5SyncBatch_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Mt5Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mt5Deal" ADD CONSTRAINT "Mt5Deal_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Mt5Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mt5Order" ADD CONSTRAINT "Mt5Order_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Mt5Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mt5Position" ADD CONSTRAINT "Mt5Position_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Mt5Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mt5PositionEvent" ADD CONSTRAINT "Mt5PositionEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Mt5Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mt5AccountSnapshot" ADD CONSTRAINT "Mt5AccountSnapshot_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Mt5Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mt5SymbolSpec" ADD CONSTRAINT "Mt5SymbolSpec_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Mt5Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A device token may exist only while the connection is ACTIVE or PAUSED;
-- revoking (or re-issuing a pairing code) must destroy the token hash.
ALTER TABLE "Mt5Connection" ADD CONSTRAINT "Mt5Connection_token_only_when_paired_check"
  CHECK ("status" IN ('ACTIVE', 'PAUSED') OR "tokenHash" IS NULL);

-- Raw broker records are immutable once stored. The only columns that may
-- change are the derived UTC normalization of the server time (a corrected
-- server-time convention re-normalizes history; the raw server time and
-- millisecond timestamp never change).
CREATE OR REPLACE FUNCTION "mt5_raw_record_immutable"() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'Mt5Deal' THEN
    IF (to_jsonb(NEW) - 'occurredAt' - 'utcOffsetMinutes') IS DISTINCT FROM (to_jsonb(OLD) - 'occurredAt' - 'utcOffsetMinutes') THEN
      RAISE EXCEPTION 'Mt5Deal rows are immutable (ticket %)', OLD."ticket";
    END IF;
  ELSE
    IF (to_jsonb(NEW) - 'setupAt' - 'doneAt') IS DISTINCT FROM (to_jsonb(OLD) - 'setupAt' - 'doneAt') THEN
      RAISE EXCEPTION 'Mt5Order rows are immutable (ticket %)', OLD."ticket";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Mt5Deal_immutable" BEFORE UPDATE ON "Mt5Deal"
  FOR EACH ROW EXECUTE FUNCTION "mt5_raw_record_immutable"();
CREATE TRIGGER "Mt5Order_immutable" BEFORE UPDATE ON "Mt5Order"
  FOR EACH ROW EXECUTE FUNCTION "mt5_raw_record_immutable"();
