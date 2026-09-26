-- Native Replay — one shared replay clock per Backtest Run × simulation date.
--
-- Prompt 2 kept one position per run × date × asset. Independent clocks let
-- one asset reveal information from later than another (EURUSD at 10:00 while
-- deciding on GBPUSD at 09:20 — cross-asset lookahead). The position becomes
-- the run's simulated WORLD time for the date; every asset is read as of it.

-- 1. Old per-asset guard and day-range CHECK go first (they reference dropped columns).
DROP TRIGGER "BacktestReplayPosition_guard" ON "BacktestReplayPosition";
DROP FUNCTION "native_replay_position_guard"();
ALTER TABLE "BacktestReplayPosition" DROP CONSTRAINT "BacktestReplayPosition_within_day";

-- 2. Merge per-asset positions into one world position per run × date. The
--    LATEST of them is kept: that information has already been revealed, and
--    choosing an earlier one would move a clock backwards (forbidden).
DELETE FROM "BacktestReplayPosition" p
USING "BacktestReplayPosition" q
WHERE p."backtestRunId" = q."backtestRunId"
  AND p."simulationDate" = q."simulationDate"
  AND (p."currentMinute" < q."currentMinute" OR (p."currentMinute" = q."currentMinute" AND p."id" > q."id"));

-- 3. Schema (generated).
ALTER TABLE "BacktestReplayPosition" DROP CONSTRAINT "BacktestReplayPosition_datasetId_fkey";
ALTER TABLE "BacktestReplayPosition" DROP CONSTRAINT "BacktestReplayPosition_pinId_fkey";
DROP INDEX "BacktestReplayPosition_backtestRunId_simulationDate_assetSy_key";
DROP INDEX "BacktestReplayPosition_pinId_idx";
ALTER TABLE "BacktestReplayPosition" DROP COLUMN "assetSymbol",
DROP COLUMN "datasetId",
DROP COLUMN "dayFirstMinute",
DROP COLUMN "dayLastMinute",
DROP COLUMN "pinId";
CREATE UNIQUE INDEX "BacktestReplayPosition_backtestRunId_simulationDate_key" ON "BacktestReplayPosition"("backtestRunId", "simulationDate");

-- 4. World time stays inside its simulation date.
ALTER TABLE "BacktestReplayPosition" ADD CONSTRAINT "BacktestReplayPosition_within_day" CHECK (
  "currentMinute" BETWEEN ("simulationDate" - DATE '1970-01-01') * 1440
                      AND ("simulationDate" - DATE '1970-01-01') * 1440 + 1439
);

-- 5. World time only moves forward, keeps its identity, and always sits on a
--    minute at which at least one of the run's pinned datasets has a real bar.
--    The run's first position freezes every pin of the run.
CREATE FUNCTION "native_replay_position_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."userId" <> OLD."userId" OR NEW."backtestRunId" <> OLD."backtestRunId" OR NEW."simulationDate" <> OLD."simulationDate" THEN
      RAISE EXCEPTION 'NATIVE_REPLAY_INTEGRITY: a replay position cannot change identity';
    END IF;
    IF NEW."currentMinute" < OLD."currentMinute" THEN
      RAISE EXCEPTION 'NATIVE_REPLAY_INTEGRITY: replay time only moves forward';
    END IF;
    IF NEW."currentMinute" = OLD."currentMinute" THEN
      RETURN NEW;
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM "BacktestRun" WHERE "id" = NEW."backtestRunId" AND "userId" = NEW."userId") THEN
      RAISE EXCEPTION 'NATIVE_REPLAY_INTEGRITY: replay position does not match its run';
    END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "BacktestRunDataset" p
    JOIN "HistoricalDataset" d ON d."id" = p."datasetId"
    JOIN "HistoricalBar" b ON b."datasetSeq" = d."seq" AND b."minute" = NEW."currentMinute"
    WHERE p."backtestRunId" = NEW."backtestRunId"
  ) THEN
    RAISE EXCEPTION 'NATIVE_REPLAY_INTEGRITY: replay time must be a minute with an actual M1 bar in one of the run''s datasets';
  END IF;
  IF TG_OP = 'INSERT' THEN
    UPDATE "BacktestRunDataset" SET "frozenAt" = now(), "updatedAt" = now() WHERE "backtestRunId" = NEW."backtestRunId" AND "frozenAt" IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "BacktestReplayPosition_guard"
  BEFORE INSERT OR UPDATE ON "BacktestReplayPosition"
  FOR EACH ROW EXECUTE FUNCTION "native_replay_position_guard"();

-- 6. A pin attached after the run's replay has started is frozen at once
--    (it joins the shared clock; its history can't be swapped later).
CREATE OR REPLACE FUNCTION "native_replay_pin_guard"() RETURNS trigger
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
  IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM "BacktestReplayPosition" WHERE "backtestRunId" = NEW."backtestRunId") THEN
    NEW."frozenAt" := now();
  END IF;
  RETURN NEW;
END;
$$;
