-- CreateEnum
CREATE TYPE "MarketCategory" AS ENUM ('CFD', 'FUTURES');

-- CreateEnum
CREATE TYPE "PropFirmIdentityKind" AS ENUM ('DIRECTORY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "UserPropFirmStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PropFirmAccountModelType" AS ENUM ('ONE_PHASE', 'TWO_PHASE', 'THREE_PHASE', 'INSTANT_FUNDED', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PropFirmAccountStatus" AS ENUM ('ACTIVE', 'PASSED', 'FAILED', 'BREACHED', 'FUNDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AccountStageType" AS ENUM ('PHASE_1', 'PHASE_2', 'PHASE_3', 'VERIFICATION', 'MASTER_FUNDED', 'PAYOUT_ELIGIBLE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AccountStageStatus" AS ENUM ('PENDING', 'ACTIVE', 'PASSED', 'FAILED', 'BREACHED', 'RESET', 'ABANDONED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RuleKey" AS ENUM ('PROFIT_TARGET', 'MAX_DAILY_LOSS', 'MAX_TOTAL_LOSS', 'STATIC_DRAWDOWN', 'INTRADAY_TRAILING_DRAWDOWN', 'EOD_TRAILING_DRAWDOWN', 'DRAWDOWN_BALANCE_BASED', 'DRAWDOWN_EQUITY_BASED', 'MIN_TRADING_DAYS', 'MAX_TRADING_DAYS', 'CONSISTENCY_RULE', 'MAX_RISK_PER_TRADE', 'MAX_RISK_PER_DAY', 'MAX_OPEN_POSITIONS', 'MAX_LOT_SIZE', 'MAX_CONTRACT_SIZE', 'NEWS_TRADING_RESTRICTION', 'WEEKEND_HOLDING_RESTRICTION', 'OVERNIGHT_HOLDING_RESTRICTION', 'COPY_TRADING_RESTRICTION', 'EA_BOT_RESTRICTION', 'INACTIVITY_LIMIT', 'PAYOUT_WAITING_PERIOD', 'PROFIT_SPLIT', 'SCALING_REQUIREMENT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "RuleValueType" AS ENUM ('NUMERIC', 'MONETARY', 'PERCENTAGE', 'BOOLEAN', 'TEXT');

-- CreateEnum
CREATE TYPE "RuleBreachAction" AS ENUM ('WARNING_ONLY', 'SOFT_BREACH', 'HARD_BREACH_FAIL', 'HARD_BREACH_TERMINATE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "MilestoneType" AS ENUM ('ACCOUNT_PURCHASED', 'PHASE_PASSED', 'PHASE_FAILED', 'STAGE_RESET', 'FUNDED_ACHIEVED', 'PAYOUT_RECEIVED', 'SCALING_MILESTONE', 'ACCOUNT_BREACHED', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('AVAILABLE', 'REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "MediaOwnerType" ADD VALUE 'PROP_FIRM_MILESTONE';

-- AlterTable
ALTER TABLE "MediaAttachment" ADD COLUMN     "caption" TEXT;

-- CreateTable
CREATE TABLE "PropFirmDirectoryEntry" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT,
    "markets" "MarketCategory"[],
    "website" TEXT,
    "accentColor" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropFirmDirectoryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPropFirm" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "identityKind" "PropFirmIdentityKind" NOT NULL,
    "directoryEntryId" TEXT,
    "customCompanyName" TEXT,
    "customLogoUrl" TEXT,
    "customWebsite" TEXT,
    "customAccentColor" TEXT,
    "marketCategory" "MarketCategory" NOT NULL,
    "isPriority" BOOLEAN NOT NULL DEFAULT false,
    "priorityOrder" INTEGER,
    "status" "UserPropFirmStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "UserPropFirm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropFirmAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userPropFirmId" TEXT NOT NULL,
    "tradingAccountId" TEXT,
    "displayName" TEXT NOT NULL,
    "externalRef" TEXT,
    "marketCategory" "MarketCategory" NOT NULL,
    "modelName" TEXT,
    "modelType" "PropFirmAccountModelType" NOT NULL,
    "accountSize" DECIMAL(14,2) NOT NULL,
    "accountCurrency" TEXT NOT NULL DEFAULT 'USD',
    "purchasePrice" DECIMAL(14,2),
    "discount" DECIMAL(14,2),
    "resetFees" DECIMAL(14,2),
    "activationFees" DECIMAL(14,2),
    "otherCosts" DECIMAL(14,2),
    "purchaseDate" DATE,
    "platform" TEXT,
    "dataFeed" TEXT,
    "status" "PropFirmAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "startingBalance" DECIMAL(14,2) NOT NULL,
    "currentBalance" DECIMAL(14,2),
    "currentEquity" DECIMAL(14,2),
    "archivedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PropFirmAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountStage" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" "AccountStageType" NOT NULL,
    "startingBalance" DECIMAL(14,2) NOT NULL,
    "currentBalance" DECIMAL(14,2),
    "startDate" TIMESTAMP(3),
    "completionDate" TIMESTAMP(3),
    "status" "AccountStageStatus" NOT NULL DEFAULT 'PENDING',
    "profitLoss" DECIMAL(14,2),
    "completionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageRule" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ruleKey" "RuleKey" NOT NULL,
    "valueType" "RuleValueType" NOT NULL,
    "numericValue" DECIMAL(14,4),
    "booleanValue" BOOLEAN,
    "textValue" TEXT,
    "measurementBasis" TEXT,
    "measurementPeriod" TEXT,
    "warningThreshold" DECIMAL(14,4),
    "breachThreshold" DECIMAL(14,4),
    "breachAction" "RuleBreachAction",
    "description" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "evaluationMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StageRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountMilestone" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "stageId" TEXT,
    "type" "MilestoneType" NOT NULL,
    "title" TEXT,
    "achievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "stageId" TEXT,
    "grossPayout" DECIMAL(14,2) NOT NULL,
    "profitSplitPercent" DECIMAL(5,2),
    "netExpected" DECIMAL(14,2),
    "netReceived" DECIMAL(14,2),
    "requestedDate" DATE,
    "approvedDate" DATE,
    "paidDate" DATE,
    "status" "PayoutStatus" NOT NULL DEFAULT 'AVAILABLE',
    "paymentMethod" TEXT,
    "referenceId" TEXT,
    "feesDeductions" DECIMAL(14,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PropFirmDirectoryEntry_slug_key" ON "PropFirmDirectoryEntry"("slug");

-- CreateIndex
CREATE INDEX "PropFirmDirectoryEntry_isActive_sortOrder_idx" ON "PropFirmDirectoryEntry"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "UserPropFirm_userId_status_deletedAt_idx" ON "UserPropFirm"("userId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "UserPropFirm_userId_isPriority_priorityOrder_idx" ON "UserPropFirm"("userId", "isPriority", "priorityOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PropFirmAccount_tradingAccountId_key" ON "PropFirmAccount"("tradingAccountId");

-- CreateIndex
CREATE INDEX "PropFirmAccount_userId_status_deletedAt_idx" ON "PropFirmAccount"("userId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "PropFirmAccount_userPropFirmId_idx" ON "PropFirmAccount"("userPropFirmId");

-- CreateIndex
CREATE INDEX "AccountStage_accountId_order_idx" ON "AccountStage"("accountId", "order");

-- CreateIndex
CREATE INDEX "AccountStage_accountId_status_idx" ON "AccountStage"("accountId", "status");

-- CreateIndex
CREATE INDEX "StageRule_stageId_idx" ON "StageRule"("stageId");

-- CreateIndex
CREATE INDEX "AccountMilestone_accountId_idx" ON "AccountMilestone"("accountId");

-- CreateIndex
CREATE INDEX "AccountMilestone_stageId_idx" ON "AccountMilestone"("stageId");

-- CreateIndex
CREATE INDEX "Payout_accountId_status_idx" ON "Payout"("accountId", "status");

-- AddForeignKey
ALTER TABLE "UserPropFirm" ADD CONSTRAINT "UserPropFirm_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPropFirm" ADD CONSTRAINT "UserPropFirm_directoryEntryId_fkey" FOREIGN KEY ("directoryEntryId") REFERENCES "PropFirmDirectoryEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropFirmAccount" ADD CONSTRAINT "PropFirmAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropFirmAccount" ADD CONSTRAINT "PropFirmAccount_userPropFirmId_fkey" FOREIGN KEY ("userPropFirmId") REFERENCES "UserPropFirm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropFirmAccount" ADD CONSTRAINT "PropFirmAccount_tradingAccountId_fkey" FOREIGN KEY ("tradingAccountId") REFERENCES "TradingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountStage" ADD CONSTRAINT "AccountStage_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PropFirmAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageRule" ADD CONSTRAINT "StageRule_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "AccountStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountMilestone" ADD CONSTRAINT "AccountMilestone_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PropFirmAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountMilestone" ADD CONSTRAINT "AccountMilestone_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "AccountStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PropFirmAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "AccountStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
