-- CreateTable
CREATE TABLE "ReplayChartDrawing" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "backtestRunId" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "anchors" JSONB NOT NULL,
    "style" JSONB NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "linkedTradeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplayChartDrawing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReplayChartDrawing_backtestRunId_assetSymbol_idx" ON "ReplayChartDrawing"("backtestRunId", "assetSymbol");

-- AddForeignKey
ALTER TABLE "ReplayChartDrawing" ADD CONSTRAINT "ReplayChartDrawing_backtestRunId_fkey" FOREIGN KEY ("backtestRunId") REFERENCES "BacktestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A drawing belongs to its run's owner and to one of the run's assets; it
-- never moves between runs or users.
CREATE FUNCTION "native_replay_drawing_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."userId" <> OLD."userId" OR NEW."backtestRunId" <> OLD."backtestRunId" OR NEW."assetSymbol" <> OLD."assetSymbol") THEN
    RAISE EXCEPTION 'NATIVE_REPLAY_INTEGRITY: a drawing cannot move to another run, user or asset';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "BacktestRun" WHERE "id" = NEW."backtestRunId" AND "userId" = NEW."userId" AND NEW."assetSymbol" = ANY("assets")) THEN
    RAISE EXCEPTION 'NATIVE_REPLAY_INTEGRITY: drawing does not match its run (owner or asset)';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ReplayChartDrawing_guard"
  BEFORE INSERT OR UPDATE ON "ReplayChartDrawing"
  FOR EACH ROW EXECUTE FUNCTION "native_replay_drawing_guard"();
