-- AlterTable
ALTER TABLE "AuditExpectedTrade" ADD COLUMN     "linkedTradeId" TEXT;

-- CreateIndex
CREATE INDEX "AuditExpectedTrade_linkedTradeId_idx" ON "AuditExpectedTrade"("linkedTradeId");

-- AddForeignKey
ALTER TABLE "AuditExpectedTrade" ADD CONSTRAINT "AuditExpectedTrade_linkedTradeId_fkey" FOREIGN KEY ("linkedTradeId") REFERENCES "Trade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

