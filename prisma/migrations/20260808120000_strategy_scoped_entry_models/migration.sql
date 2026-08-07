-- Strategy-scoped Entry Models: Add Trade now uses the selected strategy's own
-- Entry Models (StrategyEntryModel) instead of a global cross-strategy list.
-- This drops the global EntryModel system and freezes a single entry-model name
-- on each trade (mirroring selectedConfluences/selectedExecution — Strategy = SOT).

-- 1. New frozen field: the one entry model the trade was taken on, by name.
ALTER TABLE "Trade" ADD COLUMN "selectedEntryModel" TEXT;

-- 2. Preserve history: backfill each trade's primary entry model (lowest
--    sortOrder among its tagged global models) so existing records keep it.
UPDATE "Trade" t
SET "selectedEntryModel" = sub."name"
FROM (
  SELECT DISTINCT ON (tem."tradeId") tem."tradeId", em."name"
  FROM "TradeEntryModel" tem
  JOIN "EntryModel" em ON em."id" = tem."entryModelId"
  ORDER BY tem."tradeId", em."sortOrder" ASC, em."name" ASC
) sub
WHERE t."id" = sub."tradeId";

-- 3. Drop the global Entry Model system.
ALTER TABLE "Trade" DROP COLUMN "entryModelNameSnapshot";
DROP TABLE "TradeEntryModel";
DROP TABLE "EntryModel";
