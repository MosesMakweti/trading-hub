-- Removes PropFirmAccount.platform / dataFeed (free-text broker/platform
-- metadata) — no live broker/MT5 connection ever existed behind them.
-- Reintroduce properly (with real connection semantics) if/when MT5 account
-- sync is built.
ALTER TABLE "PropFirmAccount" DROP COLUMN "platform";
ALTER TABLE "PropFirmAccount" DROP COLUMN "dataFeed";
