-- Trader timezone foundation (Preparation Phase 0) — ADDITIVE ONLY. One new
-- append-only table. No existing row is touched; TradingDay dates are never
-- re-dated. A user with no row keeps the UTC calendar (prior behaviour).

-- CreateTable
CREATE TABLE "TraderTimezoneVersion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TraderTimezoneVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TraderTimezoneVersion_userId_effectiveFrom_idx" ON "TraderTimezoneVersion"("userId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "TraderTimezoneVersion" ADD CONSTRAINT "TraderTimezoneVersion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Append-only: a timezone change is a NEW version, never an edit. Rows are
-- removed only together with their user (cascade).
CREATE OR REPLACE FUNCTION trader_timezone_version_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'TIMEZONE_IMMUTABLE: timezone versions are append-only';
  END IF;
  IF EXISTS (SELECT 1 FROM "User" u WHERE u."id" = OLD."userId") THEN
    RAISE EXCEPTION 'TIMEZONE_IMMUTABLE: timezone versions are append-only';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TraderTimezoneVersion_append_only" BEFORE UPDATE OR DELETE ON "TraderTimezoneVersion"
  FOR EACH ROW EXECUTE FUNCTION trader_timezone_version_append_only();
