-- CreateEnum
CREATE TYPE "HistoricalDataSource" AS ENUM ('MT5');

-- CreateEnum
CREATE TYPE "HistoricalDatasetStatus" AS ENUM ('IMPORTING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "HistoricalTimeBasis" AS ENUM ('BROKER_SERVER');

-- CreateTable
CREATE TABLE "HistoricalDataset" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "HistoricalDataSource" NOT NULL,
    "sourceSymbol" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "baseTimeframe" TEXT NOT NULL DEFAULT 'M1',
    "timeBasis" "HistoricalTimeBasis" NOT NULL DEFAULT 'BROKER_SERVER',
    "utcOffsetMinutes" INTEGER,
    "priceScale" INTEGER NOT NULL,
    "firstBarMinute" INTEGER,
    "lastBarMinute" INTEGER,
    "barCount" INTEGER NOT NULL DEFAULT 0,
    "hasTickVolume" BOOLEAN NOT NULL DEFAULT false,
    "hasRealVolume" BOOLEAN NOT NULL DEFAULT false,
    "hasSpread" BOOLEAN NOT NULL DEFAULT false,
    "originalFileName" TEXT,
    "fileSizeBytes" INTEGER,
    "fileSha256" TEXT,
    "sourceFormat" JSONB NOT NULL,
    "validationReport" JSONB NOT NULL,
    "parserVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "HistoricalDatasetStatus" NOT NULL DEFAULT 'IMPORTING',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "readyAt" TIMESTAMP(3),

    CONSTRAINT "HistoricalDataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricalBar" (
    "datasetSeq" INTEGER NOT NULL,
    "minute" INTEGER NOT NULL,
    "open" INTEGER NOT NULL,
    "high" INTEGER NOT NULL,
    "low" INTEGER NOT NULL,
    "close" INTEGER NOT NULL,
    "tickVolume" INTEGER,
    "realVolume" DOUBLE PRECISION,
    "spread" INTEGER,

    CONSTRAINT "HistoricalBar_pkey" PRIMARY KEY ("datasetSeq","minute")
);

-- CreateIndex
CREATE UNIQUE INDEX "HistoricalDataset_seq_key" ON "HistoricalDataset"("seq");

-- CreateIndex
CREATE INDEX "HistoricalDataset_userId_status_createdAt_idx" ON "HistoricalDataset"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "HistoricalDataset_userId_symbol_idx" ON "HistoricalDataset"("userId", "symbol");

-- AddForeignKey
ALTER TABLE "HistoricalDataset" ADD CONSTRAINT "HistoricalDataset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalBar" ADD CONSTRAINT "HistoricalBar_datasetSeq_fkey" FOREIGN KEY ("datasetSeq") REFERENCES "HistoricalDataset"("seq") ON DELETE CASCADE ON UPDATE CASCADE;

-- Native Replay integrity backstops (Prisma does not model CHECK constraints,
-- so these never show up as schema drift). The application validates first;
-- these make an invalid canonical bar impossible to store even if app code
-- is bypassed.
ALTER TABLE "HistoricalBar" ADD CONSTRAINT "HistoricalBar_ohlc_valid" CHECK (
  "low" > 0 AND "high" >= "low" AND "high" >= "open" AND "high" >= "close" AND "low" <= "open" AND "low" <= "close"
);
ALTER TABLE "HistoricalBar" ADD CONSTRAINT "HistoricalBar_minute_nonnegative" CHECK ("minute" >= 0);
ALTER TABLE "HistoricalBar" ADD CONSTRAINT "HistoricalBar_volumes_nonnegative" CHECK (
  ("tickVolume" IS NULL OR "tickVolume" >= 0) AND ("realVolume" IS NULL OR "realVolume" >= 0) AND ("spread" IS NULL OR "spread" >= 0)
);
ALTER TABLE "HistoricalDataset" ADD CONSTRAINT "HistoricalDataset_price_scale_range" CHECK ("priceScale" BETWEEN 0 AND 8);
ALTER TABLE "HistoricalDataset" ADD CONSTRAINT "HistoricalDataset_base_timeframe_m1" CHECK ("baseTimeframe" = 'M1');
ALTER TABLE "HistoricalDataset" ADD CONSTRAINT "HistoricalDataset_ready_is_complete" CHECK (
  "status" <> 'READY' OR ("barCount" > 0 AND "firstBarMinute" IS NOT NULL AND "lastBarMinute" IS NOT NULL AND "readyAt" IS NOT NULL)
);
