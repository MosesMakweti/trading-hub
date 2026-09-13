import { describe, it } from "vitest";

import { DatabentoHistoricalMarketDataProvider } from "@/server/services/market-data/databento-provider";

/**
 * Dev-only LIVE smoke test (Stage 17B §29-30) — NOT part of required CI.
 * Self-skips whenever `DATABENTO_API_KEY` isn't set (the default in every
 * CI/dev environment that hasn't been given a real Databento account), so
 * `npx vitest run` never depends on a live connection — per §37, "Live
 * Databento verification pending API key" is an acceptable, non-failing
 * outcome here, not something this suite should ever turn red over.
 *
 * Run it for real with: `DATABENTO_API_KEY=... npx vitest run
 * databento-live-smoke`. It makes REAL network calls and burns REAL query
 * quota — that's the point (everything else in this stage's test suite is
 * deterministic/mocked specifically so this is the only place that does).
 */
const DAY_MS = 86_400_000;

describe.skipIf(!process.env.DATABENTO_API_KEY)("Databento LIVE smoke test — MES, one trading day, 1m", () => {
  it("resolves a real contract and fetches a real day of candles", async () => {
    const provider = new DatabentoHistoricalMarketDataProvider();
    // A known, unambiguous, long-past trading day — never "yesterday" (avoids
    // Databento's own publication-lag edge case making this flaky).
    const day = Date.UTC(2026, 5, 1); // 2026-06-01, a Monday
    const result = await provider.fetchCandles({ canonicalSymbol: "ES", from: day, to: day + DAY_MS - 1 });

    console.log("[databento-live-smoke] result:", {
      ok: result.ok,
      resolvedContracts: result.ok ? result.provenance?.segments.map((s) => s.contractSymbol) : undefined,
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

function countGaps(timestamps: number[]): number {
  const MINUTE_MS = 60_000;
  let gaps = 0;
  for (let i = 1; i < timestamps.length; i += 1) {
    if (timestamps[i] - timestamps[i - 1] > MINUTE_MS) gaps += 1;
  }
  return gaps;
}
