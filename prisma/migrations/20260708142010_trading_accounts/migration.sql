-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('PROP_FIRM', 'PERSONAL_BROKERAGE');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'PASSED', 'FAILED', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PropFirmPhase" AS ENUM ('PHASE_1', 'PHASE_2', 'MASTER');

-- CreateTable
CREATE TABLE "TradingAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "AccountKind" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "currentBalance" DECIMAL(14,2) NOT NULL,
    "propFirmName" TEXT,
    "accountSize" DECIMAL(14,2),
    "phase" "PropFirmPhase",
    "purchaseCost" DECIMAL(14,2),
    "totalPayouts" DECIMAL(14,2),
    "brokerName" TEXT,
    "startingBalance" DECIMAL(14,2),
    "totalWithdrawals" DECIMAL(14,2),
    "totalDeposits" DECIMAL(14,2),

    CONSTRAINT "TradingAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradingAccount_userId_kind_deletedAt_idx" ON "TradingAccount"("userId", "kind", "deletedAt");

-- AddForeignKey
ALTER TABLE "TradingAccount" ADD CONSTRAINT "TradingAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
