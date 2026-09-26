-- CreateEnum
CREATE TYPE "HistoricalImportUploadStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "HistoricalImportUpload" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "declaredBytes" INTEGER NOT NULL,
    "symbolOverride" TEXT,
    "status" "HistoricalImportUploadStatus" NOT NULL DEFAULT 'PENDING',
    "report" JSONB,
    "failureReason" TEXT,
    "datasetId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HistoricalImportUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacktestRunDataset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "backtestRunId" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "frozenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BacktestRunDataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacktestReplayPosition" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "backtestRunId" TEXT NOT NULL,
    "pinId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "simulationDate" DATE NOT NULL,
    "currentMinute" INTEGER NOT NULL,
    "dayFirstMinute" INTEGER NOT NULL,
    "dayLastMinute" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "recentCommands" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BacktestReplayPosition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HistoricalImportUpload_objectKey_key" ON "HistoricalImportUpload"("objectKey");

-- CreateIndex
CREATE INDEX "HistoricalImportUpload_userId_status_idx" ON "HistoricalImportUpload"("userId", "status");

-- CreateIndex
CREATE INDEX "HistoricalImportUpload_status_expiresAt_idx" ON "HistoricalImportUpload"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "BacktestRunDataset_datasetId_idx" ON "BacktestRunDataset"("datasetId");

-- CreateIndex
CREATE UNIQUE INDEX "BacktestRunDataset_backtestRunId_assetSymbol_key" ON "BacktestRunDataset"("backtestRunId", "assetSymbol");

-- CreateIndex
CREATE INDEX "BacktestReplayPosition_pinId_idx" ON "BacktestReplayPosition"("pinId");

-- CreateIndex
CREATE UNIQUE INDEX "BacktestReplayPosition_backtestRunId_simulationDate_assetSy_key" ON "BacktestReplayPosition"("backtestRunId", "simulationDate", "assetSymbol");

-- AddForeignKey
ALTER TABLE "HistoricalImportUpload" ADD CONSTRAINT "HistoricalImportUpload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacktestRunDataset" ADD CONSTRAINT "BacktestRunDataset_backtestRunId_fkey" FOREIGN KEY ("backtestRunId") REFERENCES "BacktestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacktestRunDataset" ADD CONSTRAINT "BacktestRunDataset_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "HistoricalDataset"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacktestReplayPosition" ADD CONSTRAINT "BacktestReplayPosition_backtestRunId_fkey" FOREIGN KEY ("backtestRunId") REFERENCES "BacktestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacktestReplayPosition" ADD CONSTRAINT "BacktestReplayPosition_pinId_fkey" FOREIGN KEY ("pinId") REFERENCES "BacktestRunDataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacktestReplayPosition" ADD CONSTRAINT "BacktestReplayPosition_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "HistoricalDataset"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- ── Native Replay integrity backstops ─────────────────────────────────────

-- Upload objects live under the owner's own prefix (keys are server-generated).
ALTER TABLE "HistoricalImportUpload" ADD CONSTRAINT "HistoricalImportUpload_object_key_owned"
  CHECK ("objectKey" LIKE 'native-replay-imports/' || "userId" || '/%');
ALTER TABLE "HistoricalImportUpload" ADD CONSTRAINT "HistoricalImportUpload_declared_bytes_positive"
  CHECK ("declaredBytes" > 0);

-- A pin joins a run and a dataset of the SAME user, for one of the run's own
-- assets, and only a READY dataset. Once frozen (replay started) its dataset
-- and asset can never change and it can't be un-frozen.
CREATE FUNCTION "native_replay_pin_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  run_user text;
  run_assets text[];
  ds_user text;
  ds_status text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."userId" <> OLD."userId" OR NEW."backtestRunId" <> OLD."backtestRunId" THEN
      RAISE EXCEPTION 'NATIVE_REPLAY_INTEGRITY: a dataset pin cannot move to another run or user';
    END IF;
    IF OLD."frozenAt" IS NOT NULL AND (NEW."frozenAt" IS NULL OR NEW."datasetId" <> OLD."datasetId" OR NEW."assetSymbol" <> OLD."assetSymbol") THEN
      RAISE EXCEPTION 'NATIVE_REPLAY_INTEGRITY: this dataset pin is frozen — replay has started on it';
    END IF;
  END IF;
  SELECT "userId", "assets" INTO run_user, run_assets FROM "BacktestRun" WHERE "id" = NEW."backtestRunId";
  SELECT "userId", "status"::text INTO ds_user, ds_status FROM "HistoricalDataset" WHERE "id" = NEW."datasetId";
  IF run_user IS DISTINCT FROM NEW."userId" OR ds_user IS DISTINCT FROM NEW."userId" THEN
    RAISE EXCEPTION 'NATIVE_REPLAY_INTEGRITY: run, dataset and pin must belong to the same user';
  END IF;
  IF NOT (NEW."assetSymbol" = ANY(run_assets)) THEN
    RAISE EXCEPTION 'NATIVE_REPLAY_INTEGRITY: % is not an asset of this run', NEW."assetSymbol";
  END IF;
  IF (TG_OP = 'INSERT' OR NEW."datasetId" <> OLD."datasetId") AND ds_status <> 'READY' THEN
    RAISE EXCEPTION 'NATIVE_REPLAY_INTEGRITY: only a READY dataset can be attached';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "BacktestRunDataset_guard"
  BEFORE INSERT OR UPDATE ON "BacktestRunDataset"
  FOR EACH ROW EXECUTE FUNCTION "native_replay_pin_guard"();

-- A frozen pin can only disappear with its run (the run's cascade — by then
-- the run row is gone); detaching it directly is refused.
CREATE FUNCTION "native_replay_pin_delete_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."frozenAt" IS NOT NULL AND EXISTS (SELECT 1 FROM "BacktestRun" WHERE "id" = OLD."backtestRunId") THEN
    RAISE EXCEPTION 'NATIVE_REPLAY_INTEGRITY: this dataset pin is frozen — replay has started on it';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "BacktestRunDataset_delete_guard"
  BEFORE DELETE ON "BacktestRunDataset"
  FOR EACH ROW EXECUTE FUNCTION "native_replay_pin_delete_guard"();

-- Replay positions: stay inside their simulation date, sit on a real bar,
-- only move forward, and never change identity. The first position on a pin
-- freezes it.
ALTER TABLE "BacktestReplayPosition" ADD CONSTRAINT "BacktestReplayPosition_within_day" CHECK (
  "dayFirstMinute" <= "dayLastMinute"
  AND "dayFirstMinute" >= ("simulationDate" - DATE '1970-01-01') * 1440
  AND "dayLastMinute" <= ("simulationDate" - DATE '1970-01-01') * 1440 + 1439
  AND "currentMinute" BETWEEN "dayFirstMinute" AND "dayLastMinute"
);

CREATE FUNCTION "native_replay_position_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  pin record;
  ds_seq integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."userId" <> OLD."userId" OR NEW."backtestRunId" <> OLD."backtestRunId" OR NEW."pinId" <> OLD."pinId"
       OR NEW."datasetId" <> OLD."datasetId" OR NEW."assetSymbol" <> OLD."assetSymbol" OR NEW."simulationDate" <> OLD."simulationDate"
       OR NEW."dayFirstMinute" <> OLD."dayFirstMinute" OR NEW."dayLastMinute" <> OLD."dayLastMinute" THEN
      RAISE EXCEPTION 'NATIVE_REPLAY_INTEGRITY: a replay position cannot change identity';
    END IF;
    IF NEW."currentMinute" < OLD."currentMinute" THEN
      RAISE EXCEPTION 'NATIVE_REPLAY_INTEGRITY: replay time only moves forward';
    END IF;
    IF NEW."currentMinute" = OLD."currentMinute" THEN
      RETURN NEW;
    END IF;
  ELSE
    SELECT * INTO pin FROM "BacktestRunDataset" WHERE "id" = NEW."pinId";
    IF pin IS NULL OR pin."backtestRunId" <> NEW."backtestRunId" OR pin."assetSymbol" <> NEW."assetSymbol"
       OR pin."datasetId" <> NEW."datasetId" OR pin."userId" <> NEW."userId" THEN
      RAISE EXCEPTION 'NATIVE_REPLAY_INTEGRITY: replay position does not match its dataset pin';
    END IF;
  END IF;
  SELECT "seq" INTO ds_seq FROM "HistoricalDataset" WHERE "id" = NEW."datasetId";
  IF NOT EXISTS (SELECT 1 FROM "HistoricalBar" WHERE "datasetSeq" = ds_seq AND "minute" = NEW."currentMinute") THEN
    RAISE EXCEPTION 'NATIVE_REPLAY_INTEGRITY: replay position must be an actual M1 bar';
  END IF;
  IF TG_OP = 'INSERT' THEN
    UPDATE "BacktestRunDataset" SET "frozenAt" = now(), "updatedAt" = now() WHERE "id" = NEW."pinId" AND "frozenAt" IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "BacktestReplayPosition_guard"
  BEFORE INSERT OR UPDATE ON "BacktestReplayPosition"
  FOR EACH ROW EXECUTE FUNCTION "native_replay_position_guard"();
