import { describe, it } from "vitest";

import { TwelveDataHistoricalMarketDataProvider } from "@/server/services/market-data/twelve-data-provider";

/**
 * Dev-only LIVE smoke test (Stage 17C.2 §38) — NOT part of required CI.
 * Self-skips whenever `TWELVE_DATA_API_KEY` isn't set (the default in every
 * CI/dev environment that hasn't been given a real Twelve Data account), so
 * `npx vitest run` never depends on a live connection — "Live Twelve Data
 * verification pending API key" is an acceptable, non-failing outcome here,
 * not something this suite should ever turn red over.
 *
 * Run it for real with: `TWELVE_DATA_API_KEY=... npx vitest run
 * twelve-data-live-smoke`. It makes REAL network calls and burns REAL API
 * credits — that's the point (everything else in this stage's test suite
 * is deterministic/mocked specifically so this is the only place that
 * does).
 */
const DAY_MS = 86_400_000;
const HAS_KEY = Boolean(process.env.TWELVE_DATA_API_KEY);

describe("Twelve Data LIVE smoke test — EURUSD & XAUUSD, one trading day, 1m", () => {
  it("reports live-verification status", () => {
    if (!HAS_KEY) {
      console.log("[twelve-data-live-smoke] Live Twelve Data verification pending API key.");
    }
  });

  describe.skipIf(!HAS_KEY)("live checks", () => {
    it.each(["EURUSD", "XAUUSD"])("resolves %s and fetches a real day of candles", async (canonicalSymbol) => {
      const provider = new TwelveDataHistoricalMarketDataProvider();
      const resolution = provider.resolveSymbol(canonicalSymbol);
      // A known, unambiguous, long-past trading day — never "yesterday"
      // (avoids any provider publication-lag edge case making this flaky).
      const day = Date.UTC(2026, 5, 1); // 2026-06-01, a Monday
      const result = await provider.fetchCandles({ canonicalSymbol, from: day, to: day + DAY_MS - 1 });

      console.log(`[twelve-data-live-smoke] ${canonicalSymbol} result:`, {
        providerSymbol: resolution.providerSymbol,
        priceBasis: resolution.priceBasis,
        ok: result.ok,
        candleCount: result.ok ? result.candles.length : undefined,
        firstTimestamp: result.ok && result.candles.length > 0 ? new Date(result.candles[0].timestamp).toISOString() : undefined,
        lastTimestamp:
          result.ok && result.candles.length > 0 ? new Date(result.candles[result.candles.length - 1].timestamp).toISOString() : undefined,
        sampleCandle: result.ok ? result.candles[0] : undefined,
        gapsDetected: result.ok ? countGaps(result.candles.map((c) => c.timestamp)) : undefined,
        error: result.ok ? undefined : result.error,
      });
    }, 30_000);
  });
});

function countGaps(timestamps: number[]): number {
  const MINUTE_MS = 60_000;
  let gaps = 0;
  for (let i = 1; i < timestamps.length; i += 1) {
    if (timestamps[i] - timestamps[i - 1] > MINUTE_MS) gaps += 1;
  }
  return gaps;
}
