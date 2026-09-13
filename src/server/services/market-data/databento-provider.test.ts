import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DatabentoHistoricalMarketDataProvider, resolveContract } from "@/server/services/market-data/databento-provider";
import { visibleCandles } from "@/domain/market-data/visible-candles";
import { aggregateCandles } from "@/domain/market-data/aggregation";

const DAY_MS = 86_400_000;
const MONDAY = Date.UTC(2026, 7, 3); // a Monday, well within GLBX.MDP3 coverage

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

function ndjsonResponse(records: unknown[], status = 200): Response {
  return new Response(records.map((r) => JSON.stringify(r)).join("\n"), { status });
}

function ohlcvRecord(ts: string, o: number, h: number, l: number, c: number, v: number) {
  return { ts_event: ts, open: String(o), high: String(h), low: String(l), close: String(c), volume: String(v) };
}

describe("DatabentoHistoricalMarketDataProvider", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe("availability / symbol support (§4/§6)", () => {
    it("is unavailable without DATABENTO_API_KEY", () => {
      const provider = new DatabentoHistoricalMarketDataProvider();
      expect(provider.isAvailable()).toBe(false);
    });

    it("is available once DATABENTO_API_KEY is set", () => {
      vi.stubEnv("DATABENTO_API_KEY", "key123");
      const provider = new DatabentoHistoricalMarketDataProvider();
      expect(provider.isAvailable()).toBe(true);
    });

    it("supports GC/ES/NQ (and their micro aliases resolve to these at the catalog layer)", () => {
      const provider = new DatabentoHistoricalMarketDataProvider();
      for (const sym of ["GC", "ES", "NQ"]) {
        const r = provider.resolveSymbol(sym);
        expect(r.supported).toBe(true);
        expect(r.providerSymbol).toBe(`${sym}.v.0`);
        expect(r.priceBasis).toBe("raw-unadjusted");
      }
    });

    it("does not support forex/metals — Stage 17B is futures-only", () => {
      const provider = new DatabentoHistoricalMarketDataProvider();
      expect(provider.resolveSymbol("XAUUSD").supported).toBe(false);
      expect(provider.resolveSymbol("EURUSD").supported).toBe(false);
    });
  });

  describe("fetchCandles — guard rails", () => {
    it("errors with PROVIDER_ERROR when no API key is configured", async () => {
      const provider = new DatabentoHistoricalMarketDataProvider();
      const result = await provider.fetchCandles({ canonicalSymbol: "ES", from: MONDAY, to: MONDAY + DAY_MS - 1 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PROVIDER_ERROR");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("errors with UNSUPPORTED_SYMBOL for a non-futures canonical symbol", async () => {
      vi.stubEnv("DATABENTO_API_KEY", "key123");
      const provider = new DatabentoHistoricalMarketDataProvider();
      const result = await provider.fetchCandles({ canonicalSymbol: "XAUUSD", from: MONDAY, to: MONDAY + DAY_MS - 1 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("UNSUPPORTED_SYMBOL");
    });

    it("errors with OUT_OF_COVERAGE for a range before GLBX.MDP3 coverage begins", async () => {
      vi.stubEnv("DATABENTO_API_KEY", "key123");
      const provider = new DatabentoHistoricalMarketDataProvider();
      const before = Date.UTC(2005, 0, 1);
      const result = await provider.fetchCandles({ canonicalSymbol: "ES", from: before, to: before + DAY_MS });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("OUT_OF_COVERAGE");
    });
  });

  describe("contract resolution (§7/§8/§10) via symbology.resolve", () => {
    it("resolves a single contract for a normal (non-rollover) period", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ result: { "ES.v.0": [{ d0: "2026-07-01", d1: "2026-09-01", s: "ESU6" }] } }),
      );
      const segments = await resolveContract("ES", MONDAY, MONDAY + DAY_MS - 1, "key123");
      expect(segments).toEqual([{ contractSymbol: "ESU6", from: MONDAY, to: MONDAY + DAY_MS - 1 }]);
    });

    it("resolves MULTIPLE contract segments for a period crossing a rollover", async () => {
      const rolloverDay = Date.UTC(2026, 8, 18); // mid-September
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          result: {
            "ES.v.0": [
              { d0: "2026-09-01", d1: "2026-09-18", s: "ESU6" },
              { d0: "2026-09-18", d1: "2026-10-01", s: "ESZ6" },
            ],
          },
        }),
      );
      const from = Date.UTC(2026, 8, 10);
      const to = Date.UTC(2026, 8, 25);
      const segments = await resolveContract("ES", from, to, "key123");
      expect(segments).toHaveLength(2);
      expect(segments[0].contractSymbol).toBe("ESU6");
      expect(segments[1].contractSymbol).toBe("ESZ6");
      // Segments never overlap and stay clipped to the requested range.
      expect(segments[0].to).toBeLessThan(segments[1].from);
      expect(segments[0].from).toBe(from);
      expect(segments[1].to).toBe(to);
      void rolloverDay;
    });

    it("returns no segments when the provider has no mapping for the continuous symbol (missing metadata)", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ result: {} }));
      const segments = await resolveContract("ES", MONDAY, MONDAY + DAY_MS - 1, "key123");
      expect(segments).toEqual([]);
    });

    it("is deterministic for the same inputs (same mocked response twice)", async () => {
      const response = () => jsonResponse({ result: { "GC.v.0": [{ d0: "2026-07-01", d1: "2026-09-01", s: "GCQ6" }] } });
      fetchMock.mockResolvedValueOnce(response()).mockResolvedValueOnce(response());
      const a = await resolveContract("GC", MONDAY, MONDAY + DAY_MS - 1, "key123");
      const b = await resolveContract("GC", MONDAY, MONDAY + DAY_MS - 1, "key123");
      expect(a).toEqual(b);
    });

    it("sends Basic Auth with the API key as username and an empty password", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ result: { "GC.v.0": [{ d0: "2026-07-01", d1: "2026-09-01", s: "GCQ6" }] } }));
      await resolveContract("GC", MONDAY, MONDAY + DAY_MS - 1, "my-secret-key");
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const authHeader = (init.headers as Record<string, string>).Authorization;
      expect(authHeader).toBe(`Basic ${Buffer.from("my-secret-key:").toString("base64")}`);
    });
  });

  describe("candle conversion (§13/§14/§17)", () => {
    function stubResolveThenTimeseries(contractSymbol: string, records: unknown[]) {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ result: { "ES.v.0": [{ d0: "2026-07-01", d1: "2026-09-01", s: contractSymbol }] } }),
      );
      fetchMock.mockResolvedValueOnce(ndjsonResponse(records));
    }

    it("maps ts_event (ISO string) directly to Candle.timestamp — no shift (§17)", async () => {
      vi.stubEnv("DATABENTO_API_KEY", "key123");
      const provider = new DatabentoHistoricalMarketDataProvider();
      const openTime = new Date(MONDAY + 9 * 60 * 60_000).toISOString(); // 09:00 UTC bar open
      stubResolveThenTimeseries("ESU6", [ohlcvRecord(openTime, 5000, 5005, 4995, 5002, 120)]);

      const result = await provider.fetchCandles({ canonicalSymbol: "ES", from: MONDAY, to: MONDAY + DAY_MS - 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.candles).toHaveLength(1);
      expect(result.candles[0].timestamp).toBe(Date.parse(openTime));
      expect(result.candles[0]).toMatchObject({ open: 5000, high: 5005, low: 4995, close: 5002, volume: 120 });
    });

    it("falls back to fixed-point (×1e-9) price parsing when pretty_px isn't honored", async () => {
      vi.stubEnv("DATABENTO_API_KEY", "key123");
      const provider = new DatabentoHistoricalMarketDataProvider();
      const openTime = new Date(MONDAY + 60_000).toISOString();
      stubResolveThenTimeseries("ESU6", [
        { ts_event: openTime, open: 5000_000000000, high: 5005_000000000, low: 4995_000000000, close: 5002_000000000, volume: 10 },
      ]);
      const result = await provider.fetchCandles({ canonicalSymbol: "ES", from: MONDAY, to: MONDAY + DAY_MS - 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.candles[0].open).toBeCloseTo(5000, 6);
      expect(result.candles[0].close).toBeCloseTo(5002, 6);
    });

    it("parses ts_event as a raw nanosecond string when pretty_ts isn't honored", async () => {
      vi.stubEnv("DATABENTO_API_KEY", "key123");
      const provider = new DatabentoHistoricalMarketDataProvider();
      const ms = MONDAY + 5 * 60_000;
      const ns = BigInt(ms) * BigInt(1_000_000);
      stubResolveThenTimeseries("ESU6", [ohlcvRecord(ns.toString(), 5000, 5001, 4999, 5000.5, 5)]);
      const result = await provider.fetchCandles({ canonicalSymbol: "ES", from: MONDAY, to: MONDAY + DAY_MS - 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.candles[0].timestamp).toBe(ms);
    });

    it("sorts out-of-order records and de-duplicates identical timestamps (never fabricating a gap-fill)", async () => {
      vi.stubEnv("DATABENTO_API_KEY", "key123");
      const provider = new DatabentoHistoricalMarketDataProvider();
      const t0 = new Date(MONDAY).toISOString();
      const t1 = new Date(MONDAY + 60_000).toISOString();
      stubResolveThenTimeseries("ESU6", [
        ohlcvRecord(t1, 5001, 5002, 5000, 5001.5, 5),
        ohlcvRecord(t0, 5000, 5001, 4999, 5000.5, 5),
        ohlcvRecord(t0, 5000, 5001, 4999, 5000.5, 5), // exact duplicate — must collapse to one
      ]);
      const result = await provider.fetchCandles({ canonicalSymbol: "ES", from: MONDAY, to: MONDAY + DAY_MS - 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.candles).toHaveLength(2);
      expect(result.candles[0].timestamp).toBeLessThan(result.candles[1].timestamp);
    });

    it("preserves a real gap — a missing minute is simply absent, never synthesized", async () => {
      vi.stubEnv("DATABENTO_API_KEY", "key123");
      const provider = new DatabentoHistoricalMarketDataProvider();
      const t0 = new Date(MONDAY).toISOString();
      const t5 = new Date(MONDAY + 5 * 60_000).toISOString(); // a 5-minute gap
      stubResolveThenTimeseries("ESU6", [ohlcvRecord(t0, 5000, 5001, 4999, 5000.5, 5), ohlcvRecord(t5, 5001, 5002, 5000, 5001.5, 5)]);
      const result = await provider.fetchCandles({ canonicalSymbol: "ES", from: MONDAY, to: MONDAY + DAY_MS - 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.candles).toHaveLength(2);
      expect(result.candles[1].timestamp - result.candles[0].timestamp).toBe(5 * 60_000);
    });

    it("exact no-hindsight boundary: a candle exactly AT the requested `to` is included, one past it is excluded", async () => {
      vi.stubEnv("DATABENTO_API_KEY", "key123");
      const provider = new DatabentoHistoricalMarketDataProvider();
      const to = MONDAY + 60_000;
      const atBoundary = new Date(to).toISOString();
      const pastBoundary = new Date(to + 60_000).toISOString();
      stubResolveThenTimeseries("ESU6", [
        ohlcvRecord(atBoundary, 5000, 5001, 4999, 5000.5, 5),
        ohlcvRecord(pastBoundary, 5001, 5002, 5000, 5001.5, 5),
      ]);
      const result = await provider.fetchCandles({ canonicalSymbol: "ES", from: MONDAY, to });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.candles).toHaveLength(1);
      expect(result.candles[0].timestamp).toBe(to);
    });
  });

  describe("Replay integration — Databento candles through Clock/visibleCandles (§31)", () => {
    it("Databento's Candle[] output is a drop-in for visibleCandles/aggregateCandles with no adaptation", async () => {
      vi.stubEnv("DATABENTO_API_KEY", "key123");
      const provider = new DatabentoHistoricalMarketDataProvider();
      const dayStart = MONDAY;
      const records = Array.from({ length: 30 }, (_, i) =>
        ohlcvRecord(new Date(dayStart + i * 60_000).toISOString(), 5000 + i, 5001 + i, 4999 + i, 5000.5 + i, 10),
      );
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ result: { "ES.v.0": [{ d0: "2026-07-01", d1: "2026-09-01", s: "ESU6" }] } }))
        .mockResolvedValueOnce(ndjsonResponse(records));

      const result = await provider.fetchCandles({ canonicalSymbol: "ES", from: dayStart, to: dayStart + 30 * 60_000 - 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // No-hindsight: at a replay time mid-way through, only fully-closed
      // 1m candles up to that instant are visible — same rule as Fixture data.
      const replayTime = dayStart + 10 * 60_000;
      const visible = visibleCandles(result.candles, replayTime, "1m");
      expect(visible).toHaveLength(10);
      expect(visible[visible.length - 1].timestamp + 60_000).toBeLessThanOrEqual(replayTime);

      // Aggregation to a higher timeframe works identically to Fixture data.
      const fiveMin = aggregateCandles(result.candles, "5m");
      expect(fiveMin.length).toBeGreaterThan(0);
      expect(fiveMin[0].open).toBe(result.candles[0].open);
    });

    it("provenance stays stable (same contract) across two back-to-back fetches of the same period", async () => {
      vi.stubEnv("DATABENTO_API_KEY", "key123");
      const provider = new DatabentoHistoricalMarketDataProvider();
      const resolveOnce = () => jsonResponse({ result: { "ES.v.0": [{ d0: "2026-07-01", d1: "2026-09-01", s: "ESU6" }] } });
      const dataOnce = () => ndjsonResponse([ohlcvRecord(new Date(MONDAY).toISOString(), 5000, 5001, 4999, 5000.5, 5)]);
      fetchMock.mockResolvedValueOnce(resolveOnce()).mockResolvedValueOnce(dataOnce());
      fetchMock.mockResolvedValueOnce(resolveOnce()).mockResolvedValueOnce(dataOnce());

      const first = await provider.fetchCandles({ canonicalSymbol: "ES", from: MONDAY, to: MONDAY + 60_000 });
      const second = await provider.fetchCandles({ canonicalSymbol: "ES", from: MONDAY, to: MONDAY + 60_000 });
      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      expect(first.provenance?.segments[0].contractSymbol).toBe(second.provenance?.segments[0].contractSymbol);
    });
  });

  describe("provenance (§11)", () => {
    it("returns one segment per literal contract actually used, tagged with the dataset/price basis", async () => {
      vi.stubEnv("DATABENTO_API_KEY", "key123");
      const provider = new DatabentoHistoricalMarketDataProvider();
      const t0 = new Date(MONDAY).toISOString();
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ result: { "ES.v.0": [{ d0: "2026-07-01", d1: "2026-09-01", s: "ESU6" }] } }))
        .mockResolvedValueOnce(ndjsonResponse([ohlcvRecord(t0, 5000, 5001, 4999, 5000.5, 5)]));

      const result = await provider.fetchCandles({ canonicalSymbol: "ES", from: MONDAY, to: MONDAY + 60_000 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.provenance?.providerId).toBe("databento");
      expect(result.provenance?.datasetId).toBe("GLBX.MDP3");
      expect(result.provenance?.priceBasis).toBe("raw-unadjusted");
      expect(result.provenance?.segments[0].contractSymbol).toBe("ESU6");
    });
  });

  describe("error mapping / retry (§26)", () => {
    it("maps a 401 to PROVIDER_ERROR without retrying", async () => {
      vi.stubEnv("DATABENTO_API_KEY", "key123");
      const provider = new DatabentoHistoricalMarketDataProvider();
      fetchMock.mockResolvedValue(new Response("unauthorized", { status: 401 }));
      const result = await provider.fetchCandles({ canonicalSymbol: "ES", from: MONDAY, to: MONDAY + 60_000 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PROVIDER_ERROR");
      expect(fetchMock).toHaveBeenCalledTimes(1); // no retry on a 4xx
    });

    it("maps a 404 (symbol not found) to UNSUPPORTED_SYMBOL", async () => {
      vi.stubEnv("DATABENTO_API_KEY", "key123");
      const provider = new DatabentoHistoricalMarketDataProvider();
      fetchMock.mockResolvedValue(new Response("not found", { status: 404 }));
      const result = await provider.fetchCandles({ canonicalSymbol: "ES", from: MONDAY, to: MONDAY + 60_000 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("UNSUPPORTED_SYMBOL");
    });

    it("retries a transient 503 (bounded) before giving up with PROVIDER_ERROR", async () => {
      vi.stubEnv("DATABENTO_API_KEY", "key123");
      const provider = new DatabentoHistoricalMarketDataProvider();
      fetchMock.mockResolvedValue(new Response("unavailable", { status: 503 }));
      const result = await provider.fetchCandles({ canonicalSymbol: "ES", from: MONDAY, to: MONDAY + 60_000 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PROVIDER_ERROR");
      // 1 initial + 2 retries = 3 attempts for the failing symbology.resolve call.
      expect(fetchMock).toHaveBeenCalledTimes(3);
    }, 10_000);

    it("recovers from a transient failure that succeeds on retry", async () => {
      vi.stubEnv("DATABENTO_API_KEY", "key123");
      const provider = new DatabentoHistoricalMarketDataProvider();
      fetchMock
        .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
        .mockResolvedValueOnce(jsonResponse({ result: { "ES.v.0": [{ d0: "2026-07-01", d1: "2026-09-01", s: "ESU6" }] } }))
        .mockResolvedValueOnce(ndjsonResponse([ohlcvRecord(new Date(MONDAY).toISOString(), 5000, 5001, 4999, 5000.5, 5)]));

      const result = await provider.fetchCandles({ canonicalSymbol: "ES", from: MONDAY, to: MONDAY + 60_000 });
      expect(result.ok).toBe(true);
    }, 10_000);
  });
});
