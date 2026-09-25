import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getHistoricalCandles,
  getMarketDataProviderInfo,
  getProviderById,
  isProviderDisplayPermitted,
  resolveMarketDataProvider,
} from "@/server/services/market-data.service";
import type { FetchCandlesResult, HistoricalMarketDataProvider } from "@/domain/market-data/provider-types";

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

  it("reports Databento for all SIX distinct futures identities only once BOTH the API key AND the licensing guard are set (Stage 17B.1 §1)", () => {
    vi.stubEnv("DATABENTO_API_KEY", "test-key");
    vi.stubEnv("MARKET_DATA_EXTERNAL_DISPLAY_ENABLED", "true");
    for (const sym of ["GC", "MGC", "ES", "MES", "NQ", "MNQ"]) {
      expect(resolveMarketDataProvider(sym).id).toBe("databento");
    }
  });

  it("never routes a non-Databento futures/forex symbol to Databento even with everything enabled", () => {
    vi.stubEnv("DATABENTO_API_KEY", "test-key");
    vi.stubEnv("MARKET_DATA_EXTERNAL_DISPLAY_ENABLED", "true");
    expect(resolveMarketDataProvider("XAUUSD").id).toBe("fixture");
    expect(resolveMarketDataProvider("EURUSD").id).toBe("fixture");
  });

  it("reports Fixture for an OTC symbol when TWELVE_DATA_API_KEY is not configured", () => {
    expect(resolveMarketDataProvider("EURUSD").id).toBe("fixture");
  });

  it("still reports Fixture for an OTC symbol with an API key but the licensing guard OFF (default) — Stage 17C.2 §6", () => {
    vi.stubEnv("TWELVE_DATA_API_KEY", "test-key");
    vi.stubEnv("TWELVE_DATA_EXTERNAL_DISPLAY_ENABLED", "");
    expect(resolveMarketDataProvider("EURUSD").id).toBe("fixture");
  });

  it("reports Twelve Data for all FIVE OTC identities only once BOTH the API key AND ITS OWN licensing guard are set (§19)", () => {
    vi.stubEnv("TWELVE_DATA_API_KEY", "test-key");
    vi.stubEnv("TWELVE_DATA_EXTERNAL_DISPLAY_ENABLED", "true");
    for (const sym of ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "XAGUSD"]) {
      expect(resolveMarketDataProvider(sym).id).toBe("twelvedata");
    }
  });

  it("enabling Databento's licensing flag does NOT enable Twelve Data, and vice versa — independent per-vendor guards (§6)", () => {
    vi.stubEnv("DATABENTO_API_KEY", "test-key");
    vi.stubEnv("MARKET_DATA_EXTERNAL_DISPLAY_ENABLED", "true");
    vi.stubEnv("TWELVE_DATA_API_KEY", "test-key");
    // TWELVE_DATA_EXTERNAL_DISPLAY_ENABLED left unset.
    expect(resolveMarketDataProvider("ES").id).toBe("databento");
    expect(resolveMarketDataProvider("EURUSD").id).toBe("fixture");
  });

  it("never routes a futures symbol to Twelve Data, or an OTC symbol to Databento, even with everything enabled (§19)", () => {
    vi.stubEnv("DATABENTO_API_KEY", "test-key");
    vi.stubEnv("MARKET_DATA_EXTERNAL_DISPLAY_ENABLED", "true");
    vi.stubEnv("TWELVE_DATA_API_KEY", "test-key");
    vi.stubEnv("TWELVE_DATA_EXTERNAL_DISPLAY_ENABLED", "true");
    expect(resolveMarketDataProvider("MES").id).toBe("databento");
    expect(resolveMarketDataProvider("EURUSD").id).toBe("twelvedata");
  });

  it("never routes an INDEX/CFD symbol (NAS100) to Databento's futures data just because it correlates with NQ (§20)", () => {
    vi.stubEnv("DATABENTO_API_KEY", "test-key");
    vi.stubEnv("MARKET_DATA_EXTERNAL_DISPLAY_ENABLED", "true");
    vi.stubEnv("TWELVE_DATA_API_KEY", "test-key");
    vi.stubEnv("TWELVE_DATA_EXTERNAL_DISPLAY_ENABLED", "true");
    expect(resolveMarketDataProvider("NAS100").id).toBe("fixture");
    expect(resolveMarketDataProvider("US500").id).toBe("fixture");
  });

  it("routes a broker-suffixed raw OTC symbol (XAUUSD.a) to Twelve Data once permitted (§9/§34)", () => {
    vi.stubEnv("TWELVE_DATA_API_KEY", "test-key");
    vi.stubEnv("TWELVE_DATA_EXTERNAL_DISPLAY_ENABLED", "true");
    expect(resolveMarketDataProvider("XAUUSD.a").id).toBe("twelvedata");
    expect(resolveMarketDataProvider("EURUSDm").id).toBe("twelvedata");
  });

  it("getProviderById finds a provider by id regardless of current config (freeze-once lookup)", () => {
    expect(getProviderById("fixture")?.id).toBe("fixture");
    expect(getProviderById("databento")?.id).toBe("databento");
    expect(getProviderById("twelvedata")?.id).toBe("twelvedata");
    expect(getProviderById("not-a-real-provider")).toBeNull();
  });

  it("never routes any symbol to MT5 Imported automatically — resolveMarketDataProvider has no MT5 branch (Stage 21.3B §5)", () => {
    // An MT5 import's mere existence must never override an existing
    // user's Databento/Twelve Data/Fixture resolution for a symbol — that
    // requires an explicit Data Source selection (not built this stage),
    // never automatic symbol-based dispatch. This guards against a future
    // edit accidentally adding such a branch to resolveMarketDataProvider.
    for (const sym of ["EURUSD", "XAUUSD", "ES", "GBPUSD", "NAS100", "SOME_UNKNOWN_SYMBOL"]) {
      expect(resolveMarketDataProvider(sym).id).not.toBe("mt5-imported");
    }
  });
});

describe("getProviderById — MT5 Imported (Stage 21.3B §4/§6)", () => {
  it("resolves to an MT5 Imported provider instance when a userId is supplied", () => {
    const provider = getProviderById("mt5-imported", { userId: "user_1" });
    expect(provider?.id).toBe("mt5-imported");
    expect(provider?.displayName).toBe("MT5 Imported");
    expect(provider?.baseTimeframe).toBe("1m"); // default when no timeframe given
  });

  it("returns null without a userId — MT5 Imported cannot be resolved anonymously", () => {
    expect(getProviderById("mt5-imported")).toBeNull();
    expect(getProviderById("mt5-imported", {})).toBeNull();
  });

  it("honors an explicit timeframe context, defaulting to 1m when omitted", () => {
    expect(getProviderById("mt5-imported", { userId: "user_1" })?.baseTimeframe).toBe("1m");
    expect(getProviderById("mt5-imported", { userId: "user_1", timeframe: "5m" })?.baseTimeframe).toBe("5m");
  });

  it("constructs a fresh instance per call — never a shared singleton across users", () => {
    const a = getProviderById("mt5-imported", { userId: "user_a" });
    const b = getProviderById("mt5-imported", { userId: "user_b" });
    expect(a).not.toBe(b);
  });
});

describe("isProviderDisplayPermitted — licensing permission is separate from freeze-once provenance (Stage 17B.1 §10/§11)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("MT5 Imported is always permitted — the trader's own private data, no vendor licensing concern (Stage 21.3B §4)", () => {
    expect(isProviderDisplayPermitted("mt5-imported")).toBe(true);
  });

  it("Fixture is always permitted — no licensing concern", () => {
    expect(isProviderDisplayPermitted("fixture")).toBe(true);
  });

  it("Databento is NOT permitted by default (no key/flag)", () => {
    expect(isProviderDisplayPermitted("databento")).toBe(false);
  });

  it("Databento is permitted once the licensing flag is explicitly enabled", () => {
    vi.stubEnv("MARKET_DATA_EXTERNAL_DISPLAY_ENABLED", "true");
    expect(isProviderDisplayPermitted("databento")).toBe(true);
  });

  it("Databento is permitted under the explicit non-production dev override even with the flag off", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("MARKET_DATA_EXTERNAL_DISPLAY_DEV_OVERRIDE", "true");
    expect(isProviderDisplayPermitted("databento")).toBe(true);
  });

  it("the dev override never applies in production, even if the var is set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MARKET_DATA_EXTERNAL_DISPLAY_DEV_OVERRIDE", "true");
    expect(isProviderDisplayPermitted("databento")).toBe(false);
  });

  it("an unrecognized provider id is never permitted", () => {
    expect(isProviderDisplayPermitted("some-retired-vendor")).toBe(false);
  });

  it("Twelve Data is NOT permitted by default (no key/flag) — Stage 17C.2 §6", () => {
    expect(isProviderDisplayPermitted("twelvedata")).toBe(false);
  });

  it("Twelve Data is permitted once ITS OWN licensing flag is explicitly enabled", () => {
    vi.stubEnv("TWELVE_DATA_EXTERNAL_DISPLAY_ENABLED", "true");
    expect(isProviderDisplayPermitted("twelvedata")).toBe(true);
  });

  it("enabling Databento's flag alone does NOT permit Twelve Data — independent per-vendor guards", () => {
    vi.stubEnv("MARKET_DATA_EXTERNAL_DISPLAY_ENABLED", "true");
    expect(isProviderDisplayPermitted("twelvedata")).toBe(false);
    expect(isProviderDisplayPermitted("databento")).toBe(true);
  });

  it("Twelve Data is permitted under the shared explicit non-production dev override even with its flag off", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("MARKET_DATA_EXTERNAL_DISPLAY_DEV_OVERRIDE", "true");
    expect(isProviderDisplayPermitted("twelvedata")).toBe(true);
  });

  it("the dev override never applies to Twelve Data in production either", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MARKET_DATA_EXTERNAL_DISPLAY_DEV_OVERRIDE", "true");
    expect(isProviderDisplayPermitted("twelvedata")).toBe(false);
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

  it("never shares the day-cache across providers sharing the mt5-imported id (Stage 21.3B — cross-user leak regression)", async () => {
    // Two FAKE providers both claim id "mt5-imported" (exactly what two
    // different users' real Mt5ImportedHistoricalMarketDataProvider
    // instances do) but return different candles for the SAME
    // symbol+day. If getHistoricalCandles's day-cache were still keyed by
    // (providerId, symbol, day) alone for this id, the second call would
    // wrongly return the first provider's cached candles.
    function fakeMt5Provider(closePrice: number): HistoricalMarketDataProvider {
      return {
        id: "mt5-imported",
        displayName: "MT5 Imported (fake)",
        baseTimeframe: "1m",
        isAvailable: () => true,
        resolveSymbol: () => ({ supported: true, providerSymbol: "XAUUSD" }),
        getSupportedRange: () => null,
        fetchCandles: async (params) => ({
          ok: true,
          candles: [{ timestamp: params.from, open: closePrice, high: closePrice, low: closePrice, close: closePrice, volume: null }],
          provenance: { providerId: "mt5-imported", retrievedAt: new Date().toISOString(), segments: [] },
        }),
      };
    }

    const from = Date.UTC(2026, 7, 10);
    const ownerResult = await getHistoricalCandles("XAUUSD", from, from + 60_000, fakeMt5Provider(1111));
    const attackerResult = await getHistoricalCandles("XAUUSD", from, from + 60_000, fakeMt5Provider(2222));

    expect(ownerResult.ok).toBe(true);
    expect(attackerResult.ok).toBe(true);
    if (ownerResult.ok && attackerResult.ok) {
      expect(ownerResult.candles[0]?.close).toBe(1111);
      expect(attackerResult.candles[0]?.close).toBe(2222); // never the owner's cached 1111
    }
  });
});

describe("getHistoricalCandles — concurrent-request dedup (Stage 17D §15)", () => {
  function makeControllableProvider(): {
    provider: HistoricalMarketDataProvider;
    resolveFetch: (result: FetchCandlesResult) => void;
    fetchCallCount: () => number;
  } {
    let callCount = 0;
    let resolveFetch: (result: FetchCandlesResult) => void = () => {};
    const provider: HistoricalMarketDataProvider = {
      id: "dedup-test-provider",
      displayName: "Dedup Test Provider",
      baseTimeframe: "1m",
      isAvailable: () => true,
      resolveSymbol: () => ({ supported: true, providerSymbol: "TEST" }),
      getSupportedRange: () => ({ from: 0, to: Number.MAX_SAFE_INTEGER }),
      fetchCandles: () => {
        callCount += 1;
        return new Promise((resolve) => {
          resolveFetch = resolve;
        });
      },
    };
    return { provider, resolveFetch: (result) => resolveFetch(result), fetchCallCount: () => callCount };
  }

  it("two concurrent requests for the same (provider, symbol, day) share ONE provider call, not two", async () => {
    const { provider, resolveFetch, fetchCallCount } = makeControllableProvider();

    const first = getHistoricalCandles("EURUSD", MONDAY, MONDAY + 60_000, provider);
    const second = getHistoricalCandles("EURUSD", MONDAY, MONDAY + 60_000, provider);

    // Both callers are now awaiting the fetch — only ONE actual provider call should have happened.
    await Promise.resolve(); // let both getHistoricalCandles calls reach their await point
    expect(fetchCallCount()).toBe(1);

    const candle = { timestamp: MONDAY, open: 1, high: 1, low: 1, close: 1, volume: null };
    resolveFetch({ ok: true, candles: [candle], provenance: { providerId: provider.id, retrievedAt: new Date().toISOString(), segments: [] } });

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual(secondResult);
    expect(fetchCallCount()).toBe(1);
  });

  it("a later, non-overlapping request still issues its own provider call (dedup doesn't over-suppress)", async () => {
    const { provider, resolveFetch, fetchCallCount } = makeControllableProvider();

    const first = getHistoricalCandles("GBPUSD", MONDAY, MONDAY + 60_000, provider);
    const candle = { timestamp: MONDAY, open: 1, high: 1, low: 1, close: 1, volume: null };
    resolveFetch({ ok: true, candles: [candle], provenance: { providerId: provider.id, retrievedAt: new Date().toISOString(), segments: [] } });
    await first;
    expect(fetchCallCount()).toBe(1);

    // A DIFFERENT day for the same symbol is a cache miss and a fresh in-flight entry — must still fetch.
    const tuesday = MONDAY + DAY_MS;
    const second = getHistoricalCandles("GBPUSD", tuesday, tuesday + 60_000, provider);
    resolveFetch({ ok: true, candles: [{ ...candle, timestamp: tuesday }], provenance: { providerId: provider.id, retrievedAt: new Date().toISOString(), segments: [] } });
    await second;
    expect(fetchCallCount()).toBe(2);
  });
});
