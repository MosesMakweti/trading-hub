import { describe, expect, it } from "vitest";

import { formatCandleTrace, traceReplayCandle } from "@/server/services/market-data/candle-trace";
import { aggregateCandles } from "@/domain/market-data/aggregation";
import { getHistoricalCandles } from "@/server/services/market-data.service";

const MIN = 60_000;
// A Monday — the Fixture provider always returns real (deterministic) data on a weekday.
const MONDAY = Date.UTC(2026, 7, 3, 0, 0, 0);
// A UTC Saturday — the Fixture provider's own deliberate "no candles" gap.
const SATURDAY = Date.UTC(2026, 7, 8, 0, 0, 0);

describe("traceReplayCandle — Stage 21.2 §16 full-pipeline diagnostic (Fixture provider, no live credentials required)", () => {
  it("traces a 15m candle to the EXACT aggregation of the same 1m candles getHistoricalCandles independently returns", async () => {
    const target = MONDAY + 9 * 60 * MIN; // 09:00 UTC — a clean 15m bucket start
    const trace = await traceReplayCandle({ canonicalSymbol: "XAUUSD", timestamp: target + 5 * MIN, timeframe: "15m" });
    expect(trace.ok).toBe(true);
    if (!trace.ok) return;

    expect(trace.displayTimestamp).toBe(target); // snapped to the bucket's own start, not the requested instant
    expect(trace.provider).toBe("fixture");
    expect(trace.baseTimeframe).toBe("1m");
    expect(trace.constituentCount).toBe(15);
    expect(trace.replayVisibleAt).toBe(target + 15 * MIN);
    expect(trace.syntheticCandles).toBe(0);

    // Cross-check against directly calling the real pipeline ourselves.
    const raw = await getHistoricalCandles("XAUUSD", target, target + 15 * MIN - 1);
    if (!raw.ok) throw new Error("unreachable");
    const [expectedAgg] = aggregateCandles(raw.candles, "15m");
    expect(trace.ohlc).toEqual({ open: expectedAgg.open, high: expectedAgg.high, low: expectedAgg.low, close: expectedAgg.close });
  });

  it("reports null OHLC (never fabricated) for a bucket that falls entirely on a Fixture weekend gap", async () => {
    const trace = await traceReplayCandle({ canonicalSymbol: "XAUUSD", timestamp: SATURDAY + 9 * 60 * MIN, timeframe: "1h" });
    expect(trace.ok).toBe(true);
    if (!trace.ok) return;
    expect(trace.constituentCount).toBe(0);
    expect(trace.ohlc).toBeNull();
    expect(trace.syntheticCandles).toBe(0);
    expect(trace.quality.actualCandles).toBe(0);
  });

  it("includes a deterministic quality report scoped to exactly the traced candle's own constituent window", async () => {
    const target = MONDAY + 10 * 60 * MIN;
    const trace = await traceReplayCandle({ canonicalSymbol: "XAUUSD", timestamp: target, timeframe: "1h" });
    expect(trace.ok).toBe(true);
    if (!trace.ok) return;
    expect(trace.quality.expectedIntervals).toBe(60); // one hour of 1m slots
    expect(trace.quality.actualCandles).toBe(60); // a weekday hour is fully covered
    expect(trace.quality.missingIntervals).toEqual([]);
  });

  it("returns a typed error for an unsupported symbol rather than throwing", async () => {
    const trace = await traceReplayCandle({ canonicalSymbol: "NOT_REAL", timestamp: MONDAY, timeframe: "1h" });
    expect(trace.ok).toBe(false);
  });

  it("formatCandleTrace renders a readable summary containing no secrets", async () => {
    const trace = await traceReplayCandle({ canonicalSymbol: "XAUUSD", timestamp: MONDAY + 60 * MIN, timeframe: "1h" });
    if (!trace.ok) throw new Error("unreachable");
    const text = formatCandleTrace(trace);
    expect(text).toContain("Symbol: XAUUSD");
    expect(text).toContain("Provider: Fixture");
    expect(text).not.toMatch(/api[_-]?key/i);
  });
});
