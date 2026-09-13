import { describe, expect, it } from "vitest";

import { FixtureMarketDataProvider } from "@/domain/market-data/providers/fixture-provider";
import { isValidCandle } from "@/domain/market-data/candle";

const DAY_MS = 86_400_000;
// 2026-08-03 is a Monday (trading day); 2026-08-08/09 are Sat/Sun.
const MONDAY = Date.UTC(2026, 7, 3);
const SATURDAY = Date.UTC(2026, 7, 8);
const SUNDAY = Date.UTC(2026, 7, 9);

describe("FixtureMarketDataProvider — symbol resolution (§4)", () => {
  const provider = new FixtureMarketDataProvider();

  it("is always available (no API key needed) — the dev-safe adapter", () => {
    expect(provider.isAvailable()).toBe(true);
  });

  it("resolves a known Traditorium canonical symbol", () => {
    expect(provider.resolveSymbol("XAUUSD")).toEqual({ supported: true, providerSymbol: "XAUUSD", priceBasis: "synthetic" });
  });

  it("resolves a known alias (e.g. a futures continuous-contract root) to its canonical symbol", () => {
    const resolution = provider.resolveSymbol("MES"); // alias -> ES in the instrument catalog
    expect(resolution.supported).toBe(true);
    expect(resolution.providerSymbol).toBe("ES");
  });

  it("reports an unknown symbol as unsupported rather than guessing", () => {
    expect(provider.resolveSymbol("NOT_A_REAL_SYMBOL")).toEqual({ supported: false, providerSymbol: null, priceBasis: "synthetic" });
  });

  it("resolves the new MGC alias to its canonical GC symbol (Stage 17B)", () => {
    const resolution = provider.resolveSymbol("MGC");
    expect(resolution.supported).toBe(true);
    expect(resolution.providerSymbol).toBe("GC");
  });

  it("getSupportedRange is null for an unsupported symbol", () => {
    expect(provider.getSupportedRange("NOT_A_REAL_SYMBOL")).toBeNull();
  });
});

describe("FixtureMarketDataProvider — fetchCandles determinism and gaps (§27)", () => {
  const provider = new FixtureMarketDataProvider();

  it("rejects an unsupported symbol without fabricating data", async () => {
    const result = await provider.fetchCandles({ canonicalSymbol: "NOPE", from: MONDAY, to: MONDAY + DAY_MS });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNSUPPORTED_SYMBOL");
  });

  it("is deterministic — the same request twice returns identical candles", async () => {
    const params = { canonicalSymbol: "XAUUSD", from: MONDAY, to: MONDAY + 60 * 60_000 };
    const first = await provider.fetchCandles(params);
    const second = await provider.fetchCandles(params);
    // Candles are deterministic; `provenance.retrievedAt` deliberately isn't
    // (it's a real "when was this fetched" timestamp, not part of the data).
    expect(first.ok && second.ok && first.candles).toEqual(second.ok && second.candles);
  });

  it("attaches explicit provenance identifying itself as the synthetic source (Stage 17B §11)", async () => {
    const result = await provider.fetchCandles({ canonicalSymbol: "XAUUSD", from: MONDAY, to: MONDAY + 60_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.provenance?.providerId).toBe("fixture");
    expect(result.provenance?.priceBasis).toBe("synthetic");
    expect(result.provenance?.segments).toEqual([{ contractSymbol: "XAUUSD", from: MONDAY, to: MONDAY + 60_000 }]);
  });

  it("produces valid, gap-free 1-minute candles on a trading day", async () => {
    const result = await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: MONDAY, to: MONDAY + DAY_MS - 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candles).toHaveLength(1440);
    expect(result.candles.every(isValidCandle)).toBe(true);
  });

  it("produces NO candles at all on a weekend — a real gap, never fabricated data", async () => {
    const saturday = await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: SATURDAY, to: SATURDAY + DAY_MS - 1 });
    const sunday = await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: SUNDAY, to: SUNDAY + DAY_MS - 1 });
    expect(saturday.ok && saturday.candles).toEqual([]);
    expect(sunday.ok && sunday.candles).toEqual([]);
  });

  it("different assets produce different (independent) series", async () => {
    const gold = await provider.fetchCandles({ canonicalSymbol: "XAUUSD", from: MONDAY, to: MONDAY + 5 * 60_000 });
    const eur = await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: MONDAY, to: MONDAY + 5 * 60_000 });
    expect(gold.ok && eur.ok).toBe(true);
    if (gold.ok && eur.ok) {
      expect(gold.candles[0].open).not.toBe(eur.candles[0].open);
    }
  });

  it("rejects an inverted range", async () => {
    const result = await provider.fetchCandles({ canonicalSymbol: "XAUUSD", from: MONDAY + 1000, to: MONDAY });
    expect(result.ok).toBe(false);
  });
});
