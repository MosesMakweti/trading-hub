import { afterEach, describe, expect, it, vi } from "vitest";

import { getHistoricalCandles, getMarketDataProviderInfo, getProviderById, resolveMarketDataProvider } from "@/server/services/market-data.service";

const DAY_MS = 86_400_000;
const MONDAY = Date.UTC(2026, 7, 3);

describe("market-data.service — provider selection (Stage 13 §7, extended Stage 17B §12/§16)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports Fixture for a forex symbol regardless of Databento config", () => {
    const info = getMarketDataProviderInfo("EURUSD");
    expect(info.id).toBe("fixture");
    expect(info.baseTimeframe).toBe("1m");
  });

  it("reports Fixture for a futures symbol when DATABENTO_API_KEY is not configured", () => {
    expect(resolveMarketDataProvider("ES").id).toBe("fixture");
  });

  it("still reports Fixture for a futures symbol with an API key but the licensing guard OFF (default)", () => {
    vi.stubEnv("DATABENTO_API_KEY", "test-key");
    vi.stubEnv("MARKET_DATA_EXTERNAL_DISPLAY_ENABLED", "");
    expect(resolveMarketDataProvider("ES").id).toBe("fixture");
  });

  it("reports Databento for GC/ES/NQ only once BOTH the API key AND the licensing guard are set", () => {
    vi.stubEnv("DATABENTO_API_KEY", "test-key");
    vi.stubEnv("MARKET_DATA_EXTERNAL_DISPLAY_ENABLED", "true");
    expect(resolveMarketDataProvider("GC").id).toBe("databento");
    expect(resolveMarketDataProvider("ES").id).toBe("databento");
    expect(resolveMarketDataProvider("NQ").id).toBe("databento");
  });

  it("never routes a non-Databento futures/forex symbol to Databento even with everything enabled", () => {
    vi.stubEnv("DATABENTO_API_KEY", "test-key");
    vi.stubEnv("MARKET_DATA_EXTERNAL_DISPLAY_ENABLED", "true");
    expect(resolveMarketDataProvider("XAUUSD").id).toBe("fixture");
    expect(resolveMarketDataProvider("EURUSD").id).toBe("fixture");
  });

  it("getProviderById finds a provider by id regardless of current config (freeze-once lookup)", () => {
    expect(getProviderById("fixture")?.id).toBe("fixture");
    expect(getProviderById("databento")?.id).toBe("databento");
    expect(getProviderById("not-a-real-provider")).toBeNull();
  });
});

describe("getHistoricalCandles — day-chunked cache (§8)", () => {
  it("returns exactly the requested range, trimmed at both ends", async () => {
    const from = MONDAY + 90 * 60_000;
    const to = MONDAY + 95 * 60_000;
    const result = await getHistoricalCandles("XAUUSD", from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candles[0].timestamp).toBe(from);
    expect(result.candles[result.candles.length - 1].timestamp).toBe(to);
    expect(result.candles.every((c) => c.timestamp >= from && c.timestamp <= to)).toBe(true);
  });

  it("spans multiple UTC-day chunks correctly (a range crossing midnight)", async () => {
    const from = MONDAY + 23 * 60 * 60_000; // 23:00 Monday
    const to = MONDAY + DAY_MS + 60 * 60_000; // 01:00 Tuesday
    const result = await getHistoricalCandles("EURUSD", from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 60 minutes before midnight + 61 minutes after = 121 candles.
    expect(result.candles).toHaveLength(121);
  });

  it("repeated calls for the same day return identical (cached) candles", async () => {
    const params = ["NQ", MONDAY, MONDAY + 10 * 60_000] as const;
    const first = await getHistoricalCandles(...params);
    const second = await getHistoricalCandles(...params);
    expect(first).toEqual(second);
  });

  it("rejects an unsupported symbol", async () => {
    const result = await getHistoricalCandles("NOT_REAL", MONDAY, MONDAY + 60_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNSUPPORTED_SYMBOL");
  });

  it("a weekend range returns an empty (never fabricated) series", async () => {
    const saturday = Date.UTC(2026, 7, 8);
    const result = await getHistoricalCandles("EURUSD", saturday, saturday + DAY_MS - 1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.candles).toEqual([]);
  });
});
