-- Today V3 (Phase 2): daily-limit override accountability on Trade.
-- Nullable, no default, no backfill: existing rows mean "no override needed".
ALTER TABLE "Trade" ADD COLUMN "limitOverrideReason" TEXT;
ALTER TABLE "Trade" ADD COLUMN "limitOverrideContext" JSONB;
