-- Removes Trade.hitTP1/hitTP2/hitTP3/hitFullTP (manual "did this target get
-- hit" checkboxes) — redundant with PlannedTarget rows already captured via
-- the TradingView Trade Plan. The Journal day view and Trade Execution
-- section now render planned targets directly from PlannedTarget instead.
ALTER TABLE "Trade" DROP COLUMN "hitTP1";
ALTER TABLE "Trade" DROP COLUMN "hitTP2";
ALTER TABLE "Trade" DROP COLUMN "hitTP3";
ALTER TABLE "Trade" DROP COLUMN "hitFullTP";
