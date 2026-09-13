import { describe, it } from "vitest";

import { dumpMarketDataSample, formatDiagnosticTable } from "@/server/services/market-data/diagnostic";

/**
 * Stage 17D §12 — manual, development-only runner for the numerical
 * diagnostic. Self-skips unless `RUN_MARKET_DATA_DIAGNOSTIC=1` is set
 * (never part of `npm test`/CI, exactly like the live smoke tests), so it
 * never depends on a live provider connection by default. When run, it
 * prints a small, bounded sample table to the console for manual
 * eyeballing during Stage 17D's live-verification checklist — nothing here
 * is a pass/fail assertion of live data quality, and nothing here is a
 * user-facing feature.
 *
 * Run it for real with, e.g.:
 *   DATABENTO_API_KEY=... RUN_MARKET_DATA_DIAGNOSTIC=1 npx vitest run diagnostic.manual
 *   TWELVE_DATA_API_KEY=... RUN_MARKET_DATA_DIAGNOSTIC=1 npx vitest run diagnostic.manual
 */
const DAY_MS = 86_400_000;
const RUN = process.env.RUN_MARKET_DATA_DIAGNOSTIC === "1";

describe.skipIf(!RUN)("market-data diagnostic — manual sample dump", () => {
  it("prints one day of Databento MES candles, if DATABENTO_API_KEY is set", async () => {
    if (!process.env.DATABENTO_API_KEY) {
      console.log("[diagnostic] Skipping Databento sample — DATABENTO_API_KEY not set.");
      return;
    }
    const day = Date.UTC(2026, 5, 1);
    const result = await dumpMarketDataSample({ providerId: "databento", canonicalSymbol: "MES", fromMs: day, toMs: day + DAY_MS - 1 });
    if (!result.ok) {
      console.log("[diagnostic] Databento MES failed:", result.error);
      return;
    }
    console.log(`[diagnostic] Databento MES — ${result.rows.length} candles${result.truncated ? " (truncated)" : ""}:`);
    console.log(formatDiagnosticTable(result.rows.slice(0, 20))); // first 20 rows is plenty for eyeballing
  }, 30_000);

  it("prints one day of Twelve Data XAUUSD candles, if TWELVE_DATA_API_KEY is set", async () => {
    if (!process.env.TWELVE_DATA_API_KEY) {
      console.log("[diagnostic] Skipping Twelve Data sample — TWELVE_DATA_API_KEY not set.");
      return;
    }
    const day = Date.UTC(2026, 5, 1);
    const result = await dumpMarketDataSample({ providerId: "twelvedata", canonicalSymbol: "XAUUSD", fromMs: day, toMs: day + DAY_MS - 1 });
    if (!result.ok) {
      console.log("[diagnostic] Twelve Data XAUUSD failed:", result.error);
      return;
    }
    console.log(`[diagnostic] Twelve Data XAUUSD — ${result.rows.length} candles${result.truncated ? " (truncated)" : ""}:`);
    console.log(formatDiagnosticTable(result.rows.slice(0, 20)));
  }, 30_000);
});
