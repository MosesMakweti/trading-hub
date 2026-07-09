-- Add the permanent Performance Account kind
ALTER TYPE "AccountKind" ADD VALUE 'PERFORMANCE';

-- currentBalance becomes derived (baseline + sum of trade allocation PnLs),
-- computed on read in accounts.service.ts, rather than a stored, driftable value.
ALTER TABLE "TradingAccount" DROP COLUMN "currentBalance";
