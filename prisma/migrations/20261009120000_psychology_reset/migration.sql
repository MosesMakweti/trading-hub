-- Trading Psychology Reset — ADDITIVE ONLY. Two User columns (the feature is
-- OFF for every existing and new user by default) and one new table. No
-- existing row is changed and no session is backfilled for past trades.

-- CreateEnum
CREATE TYPE "PsychologyResetTrigger" AS ENUM ('LOSING_TRADE', 'MISSED_OPPORTUNITY');

-- CreateEnum
CREATE TYPE "PsychologyResetStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "psychologyResetEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "psychologyResetEnabledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PsychologyResetSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trigger" "PsychologyResetTrigger" NOT NULL,
    "tradeId" TEXT,
    "opportunityId" TEXT,
    "flowVersion" INTEGER NOT NULL,
    "status" "PsychologyResetStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "nextAction" TEXT,
    "deferredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PsychologyResetSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PsychologyResetSession_tradeId_key" ON "PsychologyResetSession"("tradeId");

-- CreateIndex
CREATE UNIQUE INDEX "PsychologyResetSession_opportunityId_key" ON "PsychologyResetSession"("opportunityId");

-- CreateIndex
CREATE INDEX "PsychologyResetSession_userId_status_createdAt_idx" ON "PsychologyResetSession"("userId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "PsychologyResetSession" ADD CONSTRAINT "PsychologyResetSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PsychologyResetSession" ADD CONSTRAINT "PsychologyResetSession_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PsychologyResetSession" ADD CONSTRAINT "PsychologyResetSession_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "TradeOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A session targets exactly what its trigger names: a losing trade OR a
-- missed opportunity, never both and never neither.
ALTER TABLE "PsychologyResetSession" ADD CONSTRAINT "PsychologyResetSession_trigger_target_check" CHECK (
  ("trigger" = 'LOSING_TRADE' AND "tradeId" IS NOT NULL AND "opportunityId" IS NULL)
  OR ("trigger" = 'MISSED_OPPORTUNITY' AND "opportunityId" IS NOT NULL AND "tradeId" IS NULL)
);
ALTER TABLE "PsychologyResetSession" ADD CONSTRAINT "PsychologyResetSession_step_check" CHECK ("currentStep" >= 0);
