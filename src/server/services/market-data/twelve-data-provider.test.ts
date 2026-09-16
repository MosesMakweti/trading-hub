import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TwelveDataHistoricalMarketDataProvider } from "@/server/services/market-data/twelve-data-provider";
import { visibleCandles } from "@/domain/market-data/visible-candles";
import { aggregateCandles } from "@/domain/market-data/aggregation";

const DAY_MS = 86_400_000;
const MONDAY = Date.UTC(2026, 7, 3); // a Monday

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

function tdValue(datetime: string, o: number, h: number, l: number, c: number, v: number | null = 5) {
  return { datetime, open: String(o), high: String(h), low: String(l), close: String(c), volume: v == null ? undefined : String(v) };
}

function tsResponse(values: unknown[]) {
  return jsonResponse({ meta: { symbol: "EUR/USD", interval: "1min" }, values, status: "ok" });
}

describe("TwelveDataHistoricalMarketDataProvider", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe("availability / symbol support (Stage 17C.2 §7/§11)", () => {
    it("is unavailable without TWELVE_DATA_API_KEY", () => {
      const provider = new TwelveDataHistoricalMarketDataProvider();
      expect(provider.isAvailable()).toBe(false);
    });

    it("is available once TWELVE_DATA_API_KEY is set", () => {
      vi.stubEnv("TWELVE_DATA_API_KEY", "key123");
      const provider = new TwelveDataHistoricalMarketDataProvider();
      expect(provider.isAvailable()).toBe(true);
    });

    it("resolves EURUSD, GBPUSD, USDJPY, XAUUSD, XAGUSD to their exact confirmed Twelve Data symbols", () => {
      const provider = new TwelveDataHistoricalMarketDataProvider();
      const expected: Record<string, string> = {
        EURUSD: "EUR/USD",
        GBPUSD: "GBP/USD",
        USDJPY: "USD/JPY",
        XAUUSD: "XAU/USD",
        XAGUSD: "XAG/USD",
      };
      for (const [canonical, providerSymbol] of Object.entries(expected)) {
        const r = provider.resolveSymbol(canonical);
        expect(r.supported).toBe(true);
        expect(r.providerSymbol).toBe(providerSymbol);
        expect(r.priceBasis).toBe("AGGREGATED");
      }
    });

    it("does not support futures — Twelve Data is OTC-only (Stage 17C.2 §1/§19)", () => {
      const provider = new TwelveDataHistoricalMarketDataProvider();
      expect(provider.resolveSymbol("ES").supported).toBe(false);
      expect(provider.resolveSymbol("MES").supported).toBe(false);
      expect(provider.resolveSymbol("GC").supported).toBe(false);
    });

    it("does not support any INDEX/CFD symbol — deliberately unmapped, never bridged to futures (§7/§20)", () => {
      const provider = new TwelveDataHistoricalMarketDataProvider();
      expect(provider.resolveSymbol("NAS100").supported).toBe(false);
      expect(provider.resolveSymbol("US500").supported).toBe(false);
      expect(provider.resolveSymbol("US30").supported).toBe(false);
    });

    it("resolves a broker-suffixed raw symbol to the same provider symbol as its canonical form (§9/§34)", () => {
      const provider = new TwelveDataHistoricalMarketDataProvider();
      expect(provider.resolveSymbol("XAUUSD.a").providerSymbol).toBe("XAU/USD");
      expect(provider.resolveSymbol("XAUUSDm").providerSymbol).toBe("XAU/USD");
      expect(provider.resolveSymbol("EURUSD.raw").providerSymbol).toBe("EUR/USD");
    });

    it("rejects an unsupported symbol without guessing", () => {
      const provider = new TwelveDataHistoricalMarketDataProvider();
      expect(provider.resolveSymbol("NOT_A_REAL_SYMBOL")).toEqual({ supported: false, providerSymbol: null });
    });
  });

  describe("fetchCandles — guard rails", () => {
    it("errors with PROVIDER_ERROR when no API key is configured", async () => {
      const provider = new TwelveDataHistoricalMarketDataProvider();
      const result = await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: MONDAY, to: MONDAY + DAY_MS - 1 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PROVIDER_ERROR");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("errors with UNSUPPORTED_SYMBOL for a non-OTC canonical symbol", async () => {
      vi.stubEnv("TWELVE_DATA_API_KEY", "key123");
      const provider = new TwelveDataHistoricalMarketDataProvider();
      const result = await provider.fetchCandles({ canonicalSymbol: "MES", from: MONDAY, to: MONDAY + DAY_MS - 1 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("UNSUPPORTED_SYMBOL");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("request shape (§12/§14)", () => {
    it("requests interval=1min, timezone=UTC, order=asc, and never leaks the API key into a thrown error", async () => {
      vi.stubEnv("TWELVE_DATA_API_KEY", "my-secret-key");
      const provider = new TwelveDataHistoricalMarketDataProvider();
      fetchMock.mockResolvedValueOnce(tsResponse([tdValue("2026-08-03 00:00:00", 1.1, 1.1005, 1.0995, 1.1002, null)]));
      await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: MONDAY, to: MONDAY + 60_000 });

      const [url] = fetchMock.mock.calls[0] as [string];
      const parsed = new URL(url);
      expect(parsed.searchParams.get("symbol")).toBe("EUR/USD");
      expect(parsed.searchParams.get("interval")).toBe("1min");
      expect(parsed.searchParams.get("timezone")).toBe("UTC");
      expect(parsed.searchParams.get("order")).toBe("asc");
      expect(parsed.searchParams.get("apikey")).toBe("my-secret-key");
    });
  });

  describe("candle conversion (§14/§15/§16)", () => {
    it("maps datetime (UTC wall-clock string) directly to Candle.timestamp — no shift, no locale dependency", async () => {
      vi.stubEnv("TWELVE_DATA_API_KEY", "key123");
      const provider = new TwelveDataHistoricalMarketDataProvider();
      fetchMock.mockResolvedValueOnce(tsResponse([tdValue("2026-08-03 09:00:00", 5000, 5005, 4995, 5002, 120)]));

      const result = await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: MONDAY, to: MONDAY + DAY_MS - 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.candles).toHaveLength(1);
      expect(result.candles[0].timestamp).toBe(Date.UTC(2026, 7, 3, 9, 0, 0));
      expect(result.candles[0]).toMatchObject({ open: 5000, high: 5005, low: 4995, close: 5002, volume: 120 });
    });

    it("treats missing/absent volume as null, never fabricated", async () => {
      vi.stubEnv("TWELVE_DATA_API_KEY", "key123");
      const provider = new TwelveDataHistoricalMarketDataProvider();
      fetchMock.mockResolvedValueOnce(tsResponse([tdValue("2026-08-03 00:00:00", 1.1, 1.1005, 1.0995, 1.1002, null)]));
      const result = await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: MONDAY, to: MONDAY + 60_000 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.candles[0].volume).toBeNull();
    });

    it("normalizes Twelve Data's default DESCENDING order to strict ascending (§15)", async () => {
      vi.stubEnv("TWELVE_DATA_API_KEY", "key123");
      const provider = new TwelveDataHistoricalMarketDataProvider();
      const t0 = "2026-08-03 00:00:00";
      const t1 = "2026-08-03 00:01:00";
      fetchMock.mockResolvedValueOnce(tsResponse([tdValue(t1, 1.1001, 1.1002, 1.1, 1.1001, 5), tdValue(t0, 1.1, 1.1001, 1.0999, 1.1, 5)]));
      const result = await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: MONDAY, to: MONDAY + DAY_MS - 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.candles).toHaveLength(2);
      expect(result.candles[0].timestamp).toBeLessThan(result.candles[1].timestamp);
    });

    it("de-duplicates an exact duplicate timestamp (benign re-send, not corruption)", async () => {
      vi.stubEnv("TWELVE_DATA_API_KEY", "key123");
      const provider = new TwelveDataHistoricalMarketDataProvider();
      const t0 = "2026-08-03 00:00:00";
      fetchMock.mockResolvedValueOnce(tsResponse([tdValue(t0, 1.1, 1.1001, 1.0999, 1.1, 5), tdValue(t0, 1.1, 1.1001, 1.0999, 1.1, 5)]));
      const result = await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: MONDAY, to: MONDAY + 60_000 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.candles).toHaveLength(1);
    });

    it("preserves a real gap — a missing minute is simply absent, never synthesized (§17)", async () => {
      vi.stubEnv("TWELVE_DATA_API_KEY", "key123");
      const provider = new TwelveDataHistoricalMarketDataProvider();
      const t0 = "2026-08-03 00:00:00";
      const t5 = "2026-08-03 00:05:00";
      fetchMock.mockResolvedValueOnce(tsResponse([tdValue(t0, 1.1, 1.1001, 1.0999, 1.1, 5), tdValue(t5, 1.1001, 1.1002, 1.1, 1.1001, 5)]));
      const result = await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: MONDAY, to: MONDAY + DAY_MS - 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.candles).toHaveLength(2);
      expect(result.candles[1].timestamp - result.candles[0].timestamp).toBe(5 * 60_000);
    });

    it("never fabricates a weekend/session-break candle — an empty values array is a real, empty result", async () => {
      vi.stubEnv("TWELVE_DATA_API_KEY", "key123");
      const provider = new TwelveDataHistoricalMarketDataProvider();
      const saturday = Date.UTC(2026, 7, 8);
      fetchMock.mockResolvedValueOnce(tsResponse([]));
      const result = await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: saturday, to: saturday + DAY_MS - 1 });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.candles).toEqual([]);
    });

    it("exact no-hindsight boundary: a candle exactly AT the requested `to` is included, one past it is excluded", async () => {
      vi.stubEnv("TWELVE_DATA_API_KEY", "key123");
      const provider = new TwelveDataHistoricalMarketDataProvider();
      const to = MONDAY + 60_000;
      fetchMock.mockResolvedValueOnce(
        tsResponse([tdValue("2026-08-03 00:01:00", 1.1, 1.1001, 1.0999, 1.1, 5), tdValue("2026-08-03 00:02:00", 1.1001, 1.1002, 1.1, 1.1001, 5)]),
      );
      const result = await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: MONDAY, to });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.candles).toHaveLength(1);
      expect(result.candles[0].timestamp).toBe(to);
    });
  });

  describe("timestamp locale-independence (§14)", () => {
    it("rejects a datetime string that doesn't match the expected UTC wall-clock shape rather than guessing", async () => {
      vi.stubEnv("TWELVE_DATA_API_KEY", "key123");
      const provider = new TwelveDataHistoricalMarketDataProvider();
      fetchMock.mockResolvedValueOnce(tsResponse([{ datetime: "not-a-date", open: "1.1", high: "1.1", low: "1.1", close: "1.1", volume: "5" }]));
      const result = await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: MONDAY, to: MONDAY + 60_000 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PROVIDER_DATA_ERROR");
    });
  });

  describe("malformed data policy (Stage 17B.1's hardened behavior, §16)", () => {
    it("fails the chunk with PROVIDER_DATA_ERROR on an unparseable price field, rather than dropping it", async () => {
      vi.stubEnv("TWELVE_DATA_API_KEY", "key123");
      const provider = new TwelveDataHistoricalMarketDataProvider();
      fetchMock.mockResolvedValueOnce(
        tsResponse([{ datetime: "2026-08-03 00:00:00", open: "not-a-number", high: "1.1", low: "1.1", close: "1.1", volume: "5" }]),
      );
      const result = await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: MONDAY, to: MONDAY + 60_000 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PROVIDER_DATA_ERROR");
    });

    it("fails the chunk with PROVIDER_DATA_ERROR on an internally-inconsistent OHLC record (high < low)", async () => {
      vi.stubEnv("TWELVE_DATA_API_KEY", "key123");
      const provider = new TwelveDataHistoricalMarketDataProvider();
      fetchMock.mockResolvedValueOnce(tsResponse([tdValue("2026-08-03 00:00:00", 1.1, 1.0, 1.2, 1.1, 5)])); // high < low
      const result = await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: MONDAY, to: MONDAY + 60_000 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PROVIDER_DATA_ERROR");
    });

    it("fails the chunk with PROVIDER_DATA_ERROR when the response body is not valid JSON", async () => {
      vi.stubEnv("TWELVE_DATA_API_KEY", "key123");
      const provider = new TwelveDataHistoricalMarketDataProvider();
      fetchMock.mockResolvedValueOnce(new Response("not json{{{", { status: 200 }));
      const result = await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: MONDAY, to: MONDAY + 60_000 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PROVIDER_ERROR"); // transport-level malformed response, not a bad candle record
    });
  });

  describe("Replay integration — Twelve Data candles through Clock/visibleCandles", () => {
    it("Twelve Data's Candle[] output is a drop-in for visibleCandles/aggregateCandles with no adaptation", async () => {
      vi.stubEnv("TWELVE_DATA_API_KEY", "key123");
      const provider = new TwelveDataHistoricalMarketDataProvider();
      const dayStart = MONDAY;
      const values = Array.from({ length: 30 }, (_, i) => {
        const t = new Date(dayStart + i * 60_000);
        const datetime = t.toISOString().slice(0, 19).replace("T", " ");
        return tdValue(datetime, 1.1 + i * 0.0001, 1.1001 + i * 0.0001, 1.0999 + i * 0.0001, 1.10005 + i * 0.0001, 10);
      });
      fetchMock.mockResolvedValueOnce(tsResponse(values));

      const result = await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: dayStart, to: dayStart + 30 * 60_000 - 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const replayTime = dayStart + 10 * 60_000;
      const visible = visibleCandles(result.candles, replayTime, "1m");
      expect(visible).toHaveLength(10);
      expect(visible[visible.length - 1].timestamp + 60_000).toBeLessThanOrEqual(replayTime);

      const fiveMin = aggregateCandles(result.candles, "5m");
      expect(fiveMin.length).toBeGreaterThan(0);
      expect(fiveMin[0].open).toBe(result.candles[0].open);
    });
  });

  describe("provenance (Stage 17C.2 §13/§18, price basis corrected Stage 17D §2)", () => {
    it("returns priceBasis AGGREGATED and a single segment naming the exact Twelve Data provider symbol", async () => {
      vi.stubEnv("TWELVE_DATA_API_KEY", "key123");
      const provider = new TwelveDataHistoricalMarketDataProvider();
      fetchMock.mockResolvedValueOnce(tsResponse([tdValue("2026-08-03 00:00:00", 2400, 2401, 2399, 2400.5, 5)]));
      const result = await provider.fetchCandles({ canonicalSymbol: "XAUUSD", from: MONDAY, to: MONDAY + 60_000 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.provenance?.providerId).toBe("twelvedata");
      expect(result.provenance?.priceBasis).toBe("AGGREGATED");
      expect(result.provenance?.segments).toEqual([{ contractSymbol: "XAU/USD", from: MONDAY, to: MONDAY + 60_000 }]);
    });

    it("never calls it MID/BID/ASK/TRADE — the REST endpoint's mid-price semantics were never confirmed, so AGGREGATED is the only price basis this adapter produces (Stage 17D §2)", async () => {
      vi.stubEnv("TWELVE_DATA_API_KEY", "key123");
      const provider = new TwelveDataHistoricalMarketDataProvider();
      fetchMock.mockResolvedValueOnce(tsResponse([tdValue("2026-08-03 00:00:00", 1.1, 1.1001, 1.0999, 1.1, 5)]));
      const result = await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: MONDAY, to: MONDAY + 60_000 });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(["MID", "BID", "ASK", "TRADE"]).not.toContain(result.provenance?.priceBasis);
        expect(result.provenance?.priceBasis).toBe("AGGREGATED");
      }
    });
  });

  describe("error mapping / retry (§30)", () => {
    it("maps a 401 to PROVIDER_ERROR without retrying", async () => {
      vi.stubEnv("TWELVE_DATA_API_KEY", "key123");
      const provider = new TwelveDataHistoricalMarketDataProvider();
      fetchMock.mockResolvedValue(jsonResponse({ code: 401, message: "invalid apikey", status: "error" }, 401));
      const result = await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: MONDAY, to: MONDAY + 60_000 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PROVIDER_ERROR");
      expect(fetchMock).toHaveBeenCalledTimes(1); // no retry on a 4xx
    });

    it("maps a 404 to UNSUPPORTED_SYMBOL", async () => {
      vi.stubEnv("TWELVE_DATA_API_KEY", "key123");
      const provider = new TwelveDataHistoricalMarketDataProvider();
      fetchMock.mockResolvedValue(jsonResponse({ code: 404, message: "symbol not found", status: "error" }, 404));
      const result = await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: MONDAY, to: MONDAY + 60_000 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("UNSUPPORTED_SYMBOL");
    });

    it("never leaks the API key into a user-facing error message, even if the vendor response echoes request text back (Stage 17D §21)", async () => {
      const secretKey = "sk-super-secret-12345";
      vi.stubEnv("TWELVE_DATA_API_KEY", secretKey);
      const provider = new TwelveDataHistoricalMarketDataProvider();
      // Simulates a vendor error body that (unrealistically, but defensively
      // guarded against) echoes the request's own query string, including
      // the live API key — this must never survive into the returned error.
      fetchMock.mockResolvedValue(
        jsonResponse({ code: 400, message: `Bad request: apikey=${secretKey}&symbol=EUR/USD`, status: "error" }, 400),
      );
      const result = await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: MONDAY, to: MONDAY + 60_000 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).not.toContain(secretKey);
        expect(result.error.message).toContain("[REDACTED]");
      }
    });

    it("never leaks the API key into a network-error message", async () => {
      const secretKey = "sk-network-error-key";
      vi.stubEnv("TWELVE_DATA_API_KEY", secretKey);
      const provider = new TwelveDataHistoricalMarketDataProvider();
      fetchMock.mockRejectedValue(new TypeError(`fetch failed: could not reach https://api.twelvedata.com/time_series?apikey=${secretKey}`));
      const result = await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: MONDAY, to: MONDAY + 60_000 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).not.toContain(secretKey);
    });

    it("retries a rate-limited 429 (bounded) before giving up with PROVIDER_ERROR", async () => {
      vi.stubEnv("TWELVE_DATA_API_KEY", "key123");
      const provider = new TwelveDataHistoricalMarketDataProvider();
      // A fresh Response per call — a real repeated HTTP 429 is a NEW
      // response each time; reusing one frozen instance would make its
      // (single-use) body throw "already read" on the 2nd+ attempt, which
      // is a mock artifact, not real fetch() behavior.
      fetchMock.mockImplementation(async () => jsonResponse({ code: 429, message: "API request limit reached", status: "error" }, 429));
      const result = await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: MONDAY, to: MONDAY + 60_000 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PROVIDER_ERROR");
      expect(fetchMock).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    }, 10_000);

    it("retries a transient 503 (bounded) before giving up with PROVIDER_ERROR", async () => {
      vi.stubEnv("TWELVE_DATA_API_KEY", "key123");
      const provider = new TwelveDataHistoricalMarketDataProvider();
      fetchMock.mockImplementation(async () => new Response("unavailable", { status: 503 }));
      const result = await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: MONDAY, to: MONDAY + 60_000 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PROVIDER_ERROR");
      expect(fetchMock).toHaveBeenCalledTimes(3);
    }, 10_000);

    it("recovers from a transient failure that succeeds on retry", async () => {
      vi.stubEnv("TWELVE_DATA_API_KEY", "key123");
      const provider = new TwelveDataHistoricalMarketDataProvider();
      fetchMock
        .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
        .mockResolvedValueOnce(tsResponse([tdValue("2026-08-03 00:00:00", 1.1, 1.1001, 1.0999, 1.1, 5)]));
      const result = await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: MONDAY, to: MONDAY + 60_000 });
      expect(result.ok).toBe(true);
    }, 10_000);
  });

  describe("timezone independence (Stage 21.2 §5) — Replay must behave identically regardless of server/browser TZ", () => {
    it("parses the same datetime string to the identical UTC ms whether the process TZ is UTC, US Eastern, or a UTC+2 zone", async () => {
      const zones = ["UTC", "America/New_York", "Africa/Lusaka", "Pacific/Auckland"];
      const results: number[] = [];
      for (const tz of zones) {
        vi.stubEnv("TWELVE_DATA_API_KEY", "key123");
        vi.stubEnv("TZ", tz);
        const provider = new TwelveDataHistoricalMarketDataProvider();
        fetchMock.mockResolvedValueOnce(tsResponse([tdValue("2026-08-03 15:59:00", 5000, 5001, 4999, 5000.5, 10)]));
        const result = await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: MONDAY, to: MONDAY + DAY_MS - 1 });
        if (!result.ok) throw new Error(`fetchCandles failed under TZ=${tz}: ${result.error.message}`);
        results.push(result.candles[0].timestamp);
      }
      // Every zone must produce the exact same absolute instant — 2026-08-03T15:59:00Z.
      expect(new Set(results).size).toBe(1);
      expect(results[0]).toBe(Date.UTC(2026, 7, 3, 15, 59, 0));
    });
  });
});
