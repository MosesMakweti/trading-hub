-- Simulation Platform — Phase 5: Prop Firm Simulator. Additive only.

-- CreateEnum
CREATE TYPE "SimChallengeStatus" AS ENUM ('IN_EVALUATION', 'FUNDED', 'FAILED', 'BREACHED', 'ARCHIVED');

-- DropIndex
DROP INDEX "SimAccount_challengeId_idx";

-- AlterTable
ALTER TABLE "SimAccount" ADD COLUMN     "ruleState" JSONB;

-- CreateTable
CREATE TABLE "SimFirmModel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firmName" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimFirmModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firmModelId" TEXT,
    "templateKey" TEXT,
    "firmName" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "modelVersion" INTEGER NOT NULL,
    "definitionSnapshot" JSONB NOT NULL,
    "accountSize" DECIMAL(14,2) NOT NULL,
    "fee" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "SimChallengeStatus" NOT NULL DEFAULT 'IN_EVALUATION',
    "currentPhaseIndex" INTEGER NOT NULL DEFAULT 0,
    "datasets" JSONB NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fundedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimBreach" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "minute" INTEGER NOT NULL,
    "balance" DECIMAL(14,2) NOT NULL,
    "equity" DECIMAL(14,2) NOT NULL,
    "measured" DECIMAL(14,2) NOT NULL,
    "floor" DECIMAL(14,2),
    "basis" TEXT,
    "detail" TEXT NOT NULL,
    "contributors" JSONB NOT NULL,
    "floatingInvolved" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimBreach_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimPayout" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "minute" INTEGER NOT NULL,
    "eligibleProfit" DECIMAL(14,2) NOT NULL,
    "grossPayout" DECIMAL(14,2) NOT NULL,
    "traderShare" DECIMAL(14,2) NOT NULL,
    "firmShare" DECIMAL(14,2) NOT NULL,
    "splitPercent" DECIMAL(5,2) NOT NULL,
    "balanceBefore" DECIMAL(14,2) NOT NULL,
    "balanceAfter" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SimFirmModel_userId_idx" ON "SimFirmModel"("userId");

-- CreateIndex
CREATE INDEX "SimChallenge_userId_status_idx" ON "SimChallenge"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SimBreach_accountId_key" ON "SimBreach"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "SimPayout_accountId_sequence_key" ON "SimPayout"("accountId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "SimAccount_challengeId_phaseIndex_key" ON "SimAccount"("challengeId", "phaseIndex");

-- AddForeignKey
ALTER TABLE "SimAccount" ADD CONSTRAINT "SimAccount_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "SimChallenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimFirmModel" ADD CONSTRAINT "SimFirmModel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimChallenge" ADD CONSTRAINT "SimChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimChallenge" ADD CONSTRAINT "SimChallenge_firmModelId_fkey" FOREIGN KEY ("firmModelId") REFERENCES "SimFirmModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimBreach" ADD CONSTRAINT "SimBreach_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SimAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimPayout" ADD CONSTRAINT "SimPayout_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SimAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Ownership of the new rows, and challenge accounts belong to the challenge owner.
CREATE OR REPLACE FUNCTION sim_challenge_owner_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."challengeId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "SimChallenge" c WHERE c."id" = NEW."challengeId" AND c."userId" = NEW."userId") THEN
    RAISE EXCEPTION 'SIM_OWNERSHIP: account and challenge belong to different users';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "SimAccount_challenge_owner" BEFORE INSERT OR UPDATE OF "challengeId", "userId" ON "SimAccount" FOR EACH ROW EXECUTE FUNCTION sim_challenge_owner_guard();
CREATE TRIGGER "SimBreach_owner" BEFORE INSERT OR UPDATE OF "userId", "accountId" ON "SimBreach" FOR EACH ROW EXECUTE FUNCTION sim_child_owner_guard();
CREATE TRIGGER "SimPayout_owner" BEFORE INSERT OR UPDATE OF "userId", "accountId" ON "SimPayout" FOR EACH ROW EXECUTE FUNCTION sim_child_owner_guard();
-- Breach reports and payouts are history: append-only (removed only with their account).
CREATE TRIGGER "SimBreach_append_only" BEFORE UPDATE OR DELETE ON "SimBreach" FOR EACH ROW EXECUTE FUNCTION sim_append_only();
CREATE TRIGGER "SimPayout_append_only" BEFORE UPDATE OR DELETE ON "SimPayout" FOR EACH ROW EXECUTE FUNCTION sim_append_only();
ALTER TABLE "SimPayout" ADD CONSTRAINT "SimPayout_amounts_valid" CHECK ("grossPayout" > 0 AND "traderShare" + "firmShare" = "grossPayout" AND "balanceAfter" = "balanceBefore" - "grossPayout");
