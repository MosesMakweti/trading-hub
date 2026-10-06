-- Preparation Score Phase 2 — ADDITIVE ONLY. New enums + four new tables and
-- two nullable TradingDay columns. No existing row is changed: no backfill,
-- no inferred first-ready times, no invented completion timestamps. Scoring
-- begins at the first confirmed PreparationScheduleVersion.effectiveFrom.

-- CreateEnum
CREATE TYPE "PreparationStatus" AS ENUM ('VERY_EARLY', 'EARLY', 'ON_TIME', 'LATE', 'VERY_LATE', 'INCOMPLETE', 'MISSED', 'DAY_OFF', 'NOT_SCHEDULED');

-- CreateEnum
CREATE TYPE "PreparationExceptionKind" AS ENUM ('DAY_OFF', 'EXTRA_DAY');

-- AlterTable
ALTER TABLE "TradingDay" ADD COLUMN     "routineFirstReadyAt" TIMESTAMP(3),
ADD COLUMN     "routineScoringRequirements" JSONB;

-- CreateTable
CREATE TABLE "PreparationScheduleVersion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "timezone" TEXT NOT NULL,
    "targetMinutes" INTEGER NOT NULL,
    "weekdays" INTEGER[],
    "rules" JSONB NOT NULL,
    "scoringVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreparationScheduleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreparationDayException" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "PreparationExceptionKind" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreparationDayException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreparationDayRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "scheduleVersionId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "targetAt" TIMESTAMP(3) NOT NULL,
    "cutoffAt" TIMESTAMP(3) NOT NULL,
    "readyAt" TIMESTAMP(3),
    "deviationSeconds" INTEGER,
    "deviationMinutes" INTEGER,
    "requiredTotal" INTEGER NOT NULL,
    "requiredDone" INTEGER NOT NULL,
    "completionPoints" INTEGER NOT NULL,
    "timingPoints" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "status" "PreparationStatus" NOT NULL,
    "bandLabel" TEXT,
    "scoringVersion" INTEGER NOT NULL,
    "finalizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "noticeAcknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "PreparationDayRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreparationDayCorrection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "status" "PreparationStatus" NOT NULL,
    "score" INTEGER NOT NULL,
    "completionPoints" INTEGER,
    "timingPoints" INTEGER,
    "reason" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreparationDayCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PreparationScheduleVersion_userId_effectiveFrom_idx" ON "PreparationScheduleVersion"("userId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "PreparationDayException_userId_date_idx" ON "PreparationDayException"("userId", "date");

-- CreateIndex
CREATE INDEX "PreparationDayRecord_scheduleVersionId_idx" ON "PreparationDayRecord"("scheduleVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "PreparationDayRecord_userId_date_key" ON "PreparationDayRecord"("userId", "date");

-- CreateIndex
CREATE INDEX "PreparationDayCorrection_recordId_idx" ON "PreparationDayCorrection"("recordId");

-- CreateIndex
CREATE INDEX "PreparationDayCorrection_userId_idx" ON "PreparationDayCorrection"("userId");

-- AddForeignKey
ALTER TABLE "PreparationScheduleVersion" ADD CONSTRAINT "PreparationScheduleVersion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreparationDayException" ADD CONSTRAINT "PreparationDayException_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreparationDayRecord" ADD CONSTRAINT "PreparationDayRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreparationDayRecord" ADD CONSTRAINT "PreparationDayRecord_scheduleVersionId_fkey" FOREIGN KEY ("scheduleVersionId") REFERENCES "PreparationScheduleVersion"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreparationDayCorrection" ADD CONSTRAINT "PreparationDayCorrection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreparationDayCorrection" ADD CONSTRAINT "PreparationDayCorrection_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "PreparationDayRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ════════════════════════════════════════════════════════════════════════
-- Integrity
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE "PreparationScheduleVersion" ADD CONSTRAINT "PreparationScheduleVersion_shape"
  CHECK ("targetMinutes" BETWEEN 0 AND 1439 AND cardinality("weekdays") > 0 AND "scoringVersion" >= 1);

ALTER TABLE "PreparationDayRecord" ADD CONSTRAINT "PreparationDayRecord_shape"
  CHECK (
    "requiredDone" BETWEEN 0 AND "requiredTotal"
    AND "completionPoints" BETWEEN 0 AND 100
    AND "timingPoints" BETWEEN 0 AND 100
    AND "score" = "completionPoints" + "timingPoints"
    AND "score" BETWEEN 0 AND 100
    AND "cutoffAt" >= "targetAt"
  );

ALTER TABLE "PreparationDayCorrection" ADD CONSTRAINT "PreparationDayCorrection_audited"
  CHECK (length(btrim("reason")) > 0 AND length(btrim("actor")) > 0 AND "score" BETWEEN 0 AND 100);

-- Append-only history: UPDATE is always rejected; DELETE only as part of
-- deleting the owning user (cascade — the user row is already gone).
CREATE OR REPLACE FUNCTION preparation_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'PREPARATION_IMMUTABLE: % rows are append-only', TG_TABLE_NAME;
  END IF;
  IF EXISTS (SELECT 1 FROM "User" u WHERE u."id" = OLD."userId") THEN
    RAISE EXCEPTION 'PREPARATION_IMMUTABLE: % rows are append-only', TG_TABLE_NAME;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PreparationScheduleVersion_append_only" BEFORE UPDATE OR DELETE ON "PreparationScheduleVersion"
  FOR EACH ROW EXECUTE FUNCTION preparation_append_only();
CREATE TRIGGER "PreparationDayException_append_only" BEFORE UPDATE OR DELETE ON "PreparationDayException"
  FOR EACH ROW EXECUTE FUNCTION preparation_append_only();
CREATE TRIGGER "PreparationDayCorrection_append_only" BEFORE UPDATE OR DELETE ON "PreparationDayCorrection"
  FOR EACH ROW EXECUTE FUNCTION preparation_append_only();

-- A day record is immutable except a single acknowledgment write
-- (noticeAcknowledgedAt NULL → set); DELETE only with its user.
CREATE OR REPLACE FUNCTION preparation_day_record_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "User" u WHERE u."id" = OLD."userId") THEN
      RAISE EXCEPTION 'PREPARATION_IMMUTABLE: a Preparation day record cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF (to_jsonb(NEW) - 'noticeAcknowledgedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'noticeAcknowledgedAt') THEN
    RAISE EXCEPTION 'PREPARATION_IMMUTABLE: a Preparation day record outcome never changes (use a correction)';
  END IF;
  IF OLD."noticeAcknowledgedAt" IS NOT NULL AND NEW."noticeAcknowledgedAt" IS DISTINCT FROM OLD."noticeAcknowledgedAt" THEN
    RAISE EXCEPTION 'PREPARATION_IMMUTABLE: a notice acknowledgment is written once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PreparationDayRecord_guard" BEFORE UPDATE OR DELETE ON "PreparationDayRecord"
  FOR EACH ROW EXECUTE FUNCTION preparation_day_record_guard();

-- TradingDay scoring facts are write-once: the first readiness instant, the
-- frozen scoring requirements, and every response's firstCompletedAt.
CREATE OR REPLACE FUNCTION trading_day_preparation_facts_guard() RETURNS trigger AS $$
DECLARE
  k text;
  v jsonb;
BEGIN
  IF OLD."routineFirstReadyAt" IS NOT NULL AND NEW."routineFirstReadyAt" IS DISTINCT FROM OLD."routineFirstReadyAt" THEN
    RAISE EXCEPTION 'PREPARATION_IMMUTABLE: routineFirstReadyAt is write-once';
  END IF;
  IF OLD."routineScoringRequirements" IS NOT NULL
     AND NEW."routineScoringRequirements" IS DISTINCT FROM OLD."routineScoringRequirements" THEN
    RAISE EXCEPTION 'PREPARATION_IMMUTABLE: routineScoringRequirements is write-once';
  END IF;
  IF OLD."routineSnapshot" IS NOT NULL AND NEW."routineSnapshot" IS DISTINCT FROM OLD."routineSnapshot"
     AND jsonb_typeof(OLD."routineSnapshot"->'responses') = 'object' THEN
    FOR k, v IN SELECT key, value FROM jsonb_each(OLD."routineSnapshot"->'responses') LOOP
      IF v ? 'firstCompletedAt'
         AND (NEW."routineSnapshot"->'responses'->k->'firstCompletedAt') IS DISTINCT FROM (v->'firstCompletedAt') THEN
        RAISE EXCEPTION 'PREPARATION_IMMUTABLE: a routine item''s firstCompletedAt is write-once';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TradingDay_preparation_facts_guard" BEFORE UPDATE ON "TradingDay"
  FOR EACH ROW EXECUTE FUNCTION trading_day_preparation_facts_guard();
