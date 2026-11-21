-- CreateEnum
CREATE TYPE "TradeAuditStatus" AS ENUM ('IN_PROGRESS', 'FINALIZED');

-- CreateEnum
CREATE TYPE "DailyTradeAuditStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "NoTradeReason" AS ENUM ('NO_VALID_SETUP', 'MISSED_OPPORTUNITY', 'STAYED_OUT', 'NOT_TRADING');

-- CreateEnum
CREATE TYPE "TradeAuditVerdict" AS ENUM ('VALID', 'INVALID', 'UNSURE');

-- CreateEnum
CREATE TYPE "AuditInvalidReason" AS ENUM ('NO_VALID_SETUP', 'EARLY_ENTRY', 'OUTSIDE_CONDITIONS', 'REVENGE', 'OVERTRADING', 'RISK_VIOLATION', 'OTHER');

-- CreateEnum
CREATE TYPE "AuditExecutionIssue" AS ENUM ('ENTRY_TIMING', 'NO_CONFIRMATION', 'STOP_PLACEMENT', 'TRADE_MANAGEMENT', 'EXIT_DECISION', 'PREMATURE_EXIT', 'INTERFERENCE', 'OTHER');

-- CreateEnum
CREATE TYPE "AuditWeakness" AS ENUM ('IMPATIENCE', 'FEAR_HESITATION', 'FOMO', 'REVENGE_EMOTION', 'OVERCONFIDENCE', 'LACK_OF_DISCIPLINE', 'STRATEGY_GAP', 'RISK_MANAGEMENT', 'FOCUS', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MediaOwnerType" ADD VALUE 'TRADE_AUDIT_ASSESSMENT';
ALTER TYPE "MediaOwnerType" ADD VALUE 'TRADE_AUDIT_EXPECTED';
ALTER TYPE "MediaOwnerType" ADD VALUE 'TRADE_AUDIT_DAY';

-- AlterTable
ALTER TABLE "EdgeReviewCommitment" ADD COLUMN     "effectiveFrom" DATE,
ADD COLUMN     "weeklyTradeAuditId" TEXT;

-- Backfill (audit finding #1): a commitment governs the period AFTER the one
-- it was written in. Use the creating review's real end date where the
-- session still exists; otherwise derive it from the denormalized
-- periodStart + reviewType (Monday-start week / calendar month).
UPDATE "EdgeReviewCommitment" c
SET "effectiveFrom" = s."endDate" + 1
FROM "ReplayReviewSession" s
WHERE c."replayReviewSessionId" = s."id" AND c."effectiveFrom" IS NULL;

UPDATE "EdgeReviewCommitment"
SET "effectiveFrom" = CASE
  WHEN "reviewType" = 'WEEKLY' THEN "periodStart" + 7
  ELSE (date_trunc('month', "periodStart") + interval '1 month')::date
END
WHERE "effectiveFrom" IS NULL;

-- CreateTable
CREATE TABLE "WeeklyTradeAudit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "weekEnd" DATE NOT NULL,
    "strategyId" TEXT,
    "assetSymbols" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scopeKey" TEXT NOT NULL,
    "status" "TradeAuditStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "finalizedAt" TIMESTAMP(3),
    "reopenedAt" TIMESTAMP(3),
    "executionSummary" TEXT,
    "decisionSummary" TEXT,
    "strongestArea" TEXT,
    "biggestWeakness" TEXT,
    "recurringPatterns" TEXT,
    "mainLesson" TEXT,
    "nextWeekPriority" TEXT,
    "executionQualityRating" INTEGER,
    "tradeSelectionRating" INTEGER,
    "patienceRating" INTEGER,
    "strategyAdherenceRating" INTEGER,
    "riskManagementRating" INTEGER,
    "tradeManagementRating" INTEGER,
    "summarySnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyTradeAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyTradeAudit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "dateKey" DATE NOT NULL,
    "status" "DailyTradeAuditStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "completedAt" TIMESTAMP(3),
    "noTradeReason" "NoTradeReason",
    "wentWell" TEXT,
    "wentWrong" TEXT,
    "couldDoBetter" TEXT,
    "mainLesson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyTradeAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeAuditAssessment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "tradeId" TEXT,
    "dateKey" DATE NOT NULL,
    "verdict" "TradeAuditVerdict",
    "invalidReasons" "AuditInvalidReason"[] DEFAULT ARRAY[]::"AuditInvalidReason"[],
    "executionIssues" "AuditExecutionIssue"[] DEFAULT ARRAY[]::"AuditExecutionIssue"[],
    "executionQuality" INTEGER,
    "mistake" TEXT,
    "weaknesses" "AuditWeakness"[] DEFAULT ARRAY[]::"AuditWeakness"[],
    "underlyingWeakness" TEXT,
    "improvement" TEXT,
    "tradeFingerprint" TEXT,
    "tradeSnapshot" JSONB,
    "assessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeAuditAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditExpectedTrade" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "dateKey" DATE NOT NULL,
    "clientKey" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "direction" "Direction" NOT NULL,
    "intendedEntry" DECIMAL(18,8),
    "stopLoss" DECIMAL(18,8),
    "target" DECIMAL(18,8),
    "intendedRiskPercent" DECIMAL(6,2),
    "strategyId" TEXT,
    "setupName" TEXT,
    "timeframe" TEXT,
    "validityReason" TEXT NOT NULL,
    "criteriaMet" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "missReason" "MissReason",
    "missNote" TEXT,
    "weaknesses" "AuditWeakness"[] DEFAULT ARRAY[]::"AuditWeakness"[],
    "underlyingWeakness" TEXT,
    "improvement" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditExpectedTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeAuditAnnotation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "mediaAttachmentId" TEXT NOT NULL,
    "markers" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeAuditAnnotation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeeklyTradeAudit_userId_status_idx" ON "WeeklyTradeAudit"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyTradeAudit_userId_weekStart_scopeKey_key" ON "WeeklyTradeAudit"("userId", "weekStart", "scopeKey");

-- CreateIndex
CREATE INDEX "DailyTradeAudit_userId_idx" ON "DailyTradeAudit"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyTradeAudit_auditId_dateKey_key" ON "DailyTradeAudit"("auditId", "dateKey");

-- CreateIndex
CREATE INDEX "TradeAuditAssessment_userId_idx" ON "TradeAuditAssessment"("userId");

-- CreateIndex
CREATE INDEX "TradeAuditAssessment_tradeId_idx" ON "TradeAuditAssessment"("tradeId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeAuditAssessment_auditId_tradeId_key" ON "TradeAuditAssessment"("auditId", "tradeId");

-- CreateIndex
CREATE INDEX "AuditExpectedTrade_userId_idx" ON "AuditExpectedTrade"("userId");

-- CreateIndex
CREATE INDEX "AuditExpectedTrade_auditId_dateKey_idx" ON "AuditExpectedTrade"("auditId", "dateKey");

-- CreateIndex
CREATE UNIQUE INDEX "AuditExpectedTrade_auditId_clientKey_key" ON "AuditExpectedTrade"("auditId", "clientKey");

-- CreateIndex
CREATE INDEX "TradeAuditAnnotation_userId_idx" ON "TradeAuditAnnotation"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeAuditAnnotation_auditId_mediaAttachmentId_key" ON "TradeAuditAnnotation"("auditId", "mediaAttachmentId");

-- AddForeignKey
ALTER TABLE "EdgeReviewCommitment" ADD CONSTRAINT "EdgeReviewCommitment_weeklyTradeAuditId_fkey" FOREIGN KEY ("weeklyTradeAuditId") REFERENCES "WeeklyTradeAudit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyTradeAudit" ADD CONSTRAINT "WeeklyTradeAudit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyTradeAudit" ADD CONSTRAINT "WeeklyTradeAudit_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyTradeAudit" ADD CONSTRAINT "DailyTradeAudit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyTradeAudit" ADD CONSTRAINT "DailyTradeAudit_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "WeeklyTradeAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeAuditAssessment" ADD CONSTRAINT "TradeAuditAssessment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeAuditAssessment" ADD CONSTRAINT "TradeAuditAssessment_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "WeeklyTradeAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeAuditAssessment" ADD CONSTRAINT "TradeAuditAssessment_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditExpectedTrade" ADD CONSTRAINT "AuditExpectedTrade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditExpectedTrade" ADD CONSTRAINT "AuditExpectedTrade_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "WeeklyTradeAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditExpectedTrade" ADD CONSTRAINT "AuditExpectedTrade_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeAuditAnnotation" ADD CONSTRAINT "TradeAuditAnnotation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeAuditAnnotation" ADD CONSTRAINT "TradeAuditAnnotation_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "WeeklyTradeAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

