-- DropForeignKey
ALTER TABLE "TradeAccountAllocation" DROP CONSTRAINT "TradeAccountAllocation_tradingAccountId_fkey";

-- AddForeignKey
ALTER TABLE "TradeAccountAllocation" ADD CONSTRAINT "TradeAccountAllocation_tradingAccountId_fkey" FOREIGN KEY ("tradingAccountId") REFERENCES "TradingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
