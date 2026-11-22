-- Simulation Platform — Phase 4: Strategy Lab studies, setups, observations. Additive only.

-- CreateEnum
CREATE TYPE "SimStudyStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SimObservationKind" AS ENUM ('TRADED', 'NOT_TRADED', 'MISSED');

-- CreateEnum
CREATE TYPE "SimObservationOutcome" AS ENUM ('WIN', 'LOSS', 'BREAKEVEN', 'UNRESOLVED');

-- CreateTable
CREATE TABLE "SimStudy" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "hypothesis" TEXT,
    "category" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "SimStudyStatus" NOT NULL DEFAULT 'PLANNED',
    "instruments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "timeframes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "periodStart" DATE,
    "periodEnd" DATE,
    "marketConditions" TEXT,
    "setupCriteria" TEXT,
    "confirmationCriteria" TEXT,
    "entryRules" TEXT,
    "exitRules" TEXT,
    "strategyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimStudy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimSetup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimSetup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimObservation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "setupId" TEXT,
    "accountId" TEXT,
    "positionId" TEXT,
    "kind" "SimObservationKind" NOT NULL,
    "symbol" TEXT NOT NULL,
    "minute" INTEGER NOT NULL,
    "timeframe" TEXT,
    "outcome" "SimObservationOutcome",
    "selfReportedR" DECIMAL(8,2),
    "setupTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confirmationTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "explanation" TEXT,
    "lessons" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SimStudy_userId_status_idx" ON "SimStudy"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SimSetup_studyId_name_key" ON "SimSetup"("studyId", "name");

-- CreateIndex
CREATE INDEX "SimObservation_studyId_minute_idx" ON "SimObservation"("studyId", "minute");

-- CreateIndex
CREATE INDEX "SimObservation_setupId_idx" ON "SimObservation"("setupId");

-- CreateIndex
CREATE INDEX "SimObservation_positionId_idx" ON "SimObservation"("positionId");

-- AddForeignKey
ALTER TABLE "SimStudy" ADD CONSTRAINT "SimStudy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimStudy" ADD CONSTRAINT "SimStudy_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimSetup" ADD CONSTRAINT "SimSetup_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "SimStudy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimObservation" ADD CONSTRAINT "SimObservation_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "SimStudy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimObservation" ADD CONSTRAINT "SimObservation_setupId_fkey" FOREIGN KEY ("setupId") REFERENCES "SimSetup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimObservation" ADD CONSTRAINT "SimObservation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SimAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimObservation" ADD CONSTRAINT "SimObservation_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "SimPosition"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Ownership: setups and observations belong to their study's owner; a linked
-- account / position must be the same owner's (and the position that account's).
CREATE OR REPLACE FUNCTION sim_study_child_guard() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "SimStudy" s WHERE s."id" = NEW."studyId" AND s."userId" = NEW."userId") THEN
    RAISE EXCEPTION 'SIM_OWNERSHIP: % row and its study belong to different users', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- UPDATE OF the owner columns only: SET NULL cascades during a user deletion
-- (where the study may already be gone) must not re-check ownership.
CREATE TRIGGER "SimSetup_owner" BEFORE INSERT OR UPDATE OF "userId", "studyId" ON "SimSetup" FOR EACH ROW EXECUTE FUNCTION sim_study_child_guard();
CREATE TRIGGER "SimObservation_owner" BEFORE INSERT OR UPDATE OF "userId", "studyId" ON "SimObservation" FOR EACH ROW EXECUTE FUNCTION sim_study_child_guard();

CREATE OR REPLACE FUNCTION sim_observation_links_guard() RETURNS trigger AS $$
BEGIN
  -- Only links being set (insert, or changed to a non-null value) are checked:
  -- SET NULL cascades from a deleted account/position/setup must pass.
  IF NEW."setupId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."setupId" IS DISTINCT FROM OLD."setupId") AND NOT EXISTS (SELECT 1 FROM "SimSetup" x WHERE x."id" = NEW."setupId" AND x."studyId" = NEW."studyId") THEN
    RAISE EXCEPTION 'SIM_OWNERSHIP: the setup is not part of this study';
  END IF;
  IF NEW."accountId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."accountId" IS DISTINCT FROM OLD."accountId") AND NOT EXISTS (SELECT 1 FROM "SimAccount" a WHERE a."id" = NEW."accountId" AND a."userId" = NEW."userId") THEN
    RAISE EXCEPTION 'SIM_OWNERSHIP: the account is not the observer''s';
  END IF;
  IF NEW."positionId" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."positionId" IS DISTINCT FROM OLD."positionId") AND NOT EXISTS (
    SELECT 1 FROM "SimPosition" p WHERE p."id" = NEW."positionId" AND p."userId" = NEW."userId" AND p."accountId" IS NOT DISTINCT FROM NEW."accountId"
  ) THEN
    RAISE EXCEPTION 'SIM_OWNERSHIP: the position is not part of this observation''s account';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SimObservation_links" BEFORE INSERT OR UPDATE OF "setupId", "accountId", "positionId" ON "SimObservation" FOR EACH ROW EXECUTE FUNCTION sim_observation_links_guard();

-- Phase 2 owner triggers, narrowed the same way (only owner-column updates are
-- re-checked; ordinary row updates and cascades never touch ownership).
DROP TRIGGER "SimDatasetPin_owner" ON "SimDatasetPin";
DROP TRIGGER "SimOrder_owner" ON "SimOrder";
DROP TRIGGER "SimPosition_owner" ON "SimPosition";
CREATE TRIGGER "SimDatasetPin_owner" BEFORE INSERT OR UPDATE OF "userId", "accountId" ON "SimDatasetPin" FOR EACH ROW EXECUTE FUNCTION sim_child_owner_guard();
CREATE TRIGGER "SimOrder_owner" BEFORE INSERT OR UPDATE OF "userId", "accountId" ON "SimOrder" FOR EACH ROW EXECUTE FUNCTION sim_child_owner_guard();
CREATE TRIGGER "SimPosition_owner" BEFORE INSERT OR UPDATE OF "userId", "accountId" ON "SimPosition" FOR EACH ROW EXECUTE FUNCTION sim_child_owner_guard();
