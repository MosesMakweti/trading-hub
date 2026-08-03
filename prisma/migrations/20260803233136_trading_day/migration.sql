-- CreateEnum
CREATE TYPE "TradingDayStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
-- CreateTable
CREATE TABLE "TradingDay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "TradingDayStatus" NOT NULL DEFAULT 'ACTIVE',
    "prepCompletedAt" TIMESTAMP(3),
    "planCompletedAt" TIMESTAMP(3),
    "analyzedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TradingDay_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "TradingDay_userId_status_idx" ON "TradingDay"("userId", "status");
-- CreateIndex
CREATE UNIQUE INDEX "TradingDay_userId_date_key" ON "TradingDay"("userId", "date");
-- AddForeignKey
ALTER TABLE "TradingDay" ADD CONSTRAINT "TradingDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
