-- CreateEnum
CREATE TYPE "Mt5ImportStatus" AS ENUM ('READY', 'READY_WITH_WARNINGS', 'NEEDS_USER_INPUT', 'INVALID');

-- CreateTable
CREATE TABLE "MarketDataImport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceLabel" TEXT,
    "sourceSymbol" TEXT NOT NULL,
    "canonicalSymbol" TEXT NOT NULL,
    "nativeTimeframe" TEXT NOT NULL,
    "timeConventionJson" JSONB NOT NULL,
    "rangeFrom" TIMESTAMP(3) NOT NULL,
    "rangeTo" TIMESTAMP(3) NOT NULL,
    "originalFileName" TEXT,
    "qualitySummaryJson" JSONB NOT NULL,
    "status" "Mt5ImportStatus" NOT NULL,
    "normalizationVersion" INTEGER NOT NULL DEFAULT 1,
    "candleCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketDataImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketDataImport_userId_canonicalSymbol_nativeTimeframe_idx" ON "MarketDataImport"("userId", "canonicalSymbol", "nativeTimeframe");

-- AddForeignKey
ALTER TABLE "MarketDataImport" ADD CONSTRAINT "MarketDataImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
