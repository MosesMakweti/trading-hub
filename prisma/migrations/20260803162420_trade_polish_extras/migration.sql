-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('OPEN', 'CLOSED', 'REVIEWED');

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "adherenceAnswers" JSONB,
ADD COLUMN     "adherencePercent" DOUBLE PRECISION,
ADD COLUMN     "status" "TradeStatus" NOT NULL DEFAULT 'OPEN',
ADD COLUMN     "tradeNumber" INTEGER;

-- Backfill tradeNumber: a stable, per-user monotonic number ordered by creation
-- (includes soft-deleted rows so numbers are never reused). Going forward,
-- createTrade assigns MAX(tradeNumber)+1 per user.
WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY "createdAt", "id") AS rn
  FROM "Trade"
)
UPDATE "Trade" t SET "tradeNumber" = n.rn FROM numbered n WHERE t."id" = n."id";

-- Backfill status from the lifecycle stamps (default is already OPEN).
UPDATE "Trade" SET "status" = 'REVIEWED' WHERE "closedAt" IS NOT NULL AND "reviewedAt" IS NOT NULL;
UPDATE "Trade" SET "status" = 'CLOSED'   WHERE "closedAt" IS NOT NULL AND "reviewedAt" IS NULL;

-- CreateIndex
CREATE INDEX "Trade_userId_status_idx" ON "Trade"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_userId_tradeNumber_key" ON "Trade"("userId", "tradeNumber");
