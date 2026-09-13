import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoSuchKey, type PutObjectCommand } from "@aws-sdk/client-s3";

import { DatabentoHistoricalMarketDataProvider } from "@/server/services/market-data/databento-provider";
import { TwelveDataHistoricalMarketDataProvider } from "@/server/services/market-data/twelve-data-provider";

/**
 * Stage 17D §13/§14 — cold/warm/corrupt-cache verification at the PROVIDER
 * orchestration level, not just the cache module in isolation. The
 * per-module tests (`market-data-cache.test.ts`,
 * `twelve-data-cache.test.ts`) already exhaustively prove `readCachedDay`
 * rejects any invalid envelope; what those tests DON'T exercise is whether
 * the ADAPTER correctly falls through to a live fetch on a miss/rejection
 * and writes back a valid replacement. This file exercises the real cache
 * modules end-to-end (only the R2 transport itself is mocked), for BOTH
 * providers, so parity between them is explicit rather than assumed.
 */

const sendMock = vi.fn();
vi.mock("@/lib/r2", () => ({
  isR2Configured: vi.fn(() => true),
  getR2: vi.fn(() => ({ client: { send: sendMock }, bucket: "test-bucket" })),
}));

const DAY_MS = 86_400_000;
const MONDAY = Date.UTC(2026, 7, 3); // safely >2 days in the past relative to real "now" — isDayFullyClosed(true)

function bodyOf(obj: unknown) {
  return { Body: { transformToString: async () => JSON.stringify(obj) } };
}

describe("Databento — provider+cache integration (Stage 17D §13/§14)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendMock.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DATABENTO_API_KEY", "key123");
    vi.stubEnv("DATABENTO_R2_CACHE_ENABLED", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function stubResolve(contractSymbol: string) {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ result: { "ES.v.0": [{ d0: "2026-07-01", d1: "2026-09-01", s: contractSymbol }] } }), { status: 200 }),
    );
  }

  it("cold request: R2 miss -> provider hit -> validated -> cached (PutObject with a valid envelope)", async () => {
    sendMock.mockRejectedValueOnce(new NoSuchKey({ message: "not found", $metadata: {} })); // R2 GetObject miss
    stubResolve("ESU6");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ts_event: new Date(MONDAY).toISOString(), open: "5000", high: "5001", low: "4999", close: "5000.5", volume: "5" }), {
        status: 200,
      }),
    );
    sendMock.mockResolvedValueOnce({}); // R2 PutObject

    const provider = new DatabentoHistoricalMarketDataProvider();
    const result = await provider.fetchCandles({ canonicalSymbol: "ES", from: MONDAY, to: MONDAY + DAY_MS - 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candles).toHaveLength(1);

    const putCall = sendMock.mock.calls.find((c) => (c[0] as PutObjectCommand).constructor.name === "PutObjectCommand");
    expect(putCall).toBeTruthy();
    const written = JSON.parse((putCall![0] as PutObjectCommand).input.Body as string);
    expect(written.schemaVersion).toBe(1);
    expect(written.contractSymbol).toBe("ESU6");
  });

  it("warm request: R2 hit -> no network fetch at all, same candles returned", async () => {
    stubResolve("ESU6"); // symbology.resolve still happens (not day-cached) — only the timeseries GET is short-circuited
    sendMock.mockResolvedValueOnce(
      bodyOf({
        schemaVersion: 1,
        datasetId: "GLBX.MDP3",
        contractSymbol: "ESU6",
        dateKey: "2026-08-03",
        cachedAt: new Date().toISOString(),
        candles: [{ timestamp: MONDAY, open: 5000, high: 5001, low: 4999, close: 5000.5, volume: 5 }],
      }),
    );

    const provider = new DatabentoHistoricalMarketDataProvider();
    const result = await provider.fetchCandles({ canonicalSymbol: "ES", from: MONDAY, to: MONDAY + DAY_MS - 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candles).toEqual([{ timestamp: MONDAY, open: 5000, high: 5001, low: 4999, close: 5000.5, volume: 5 }]);
    // Only the symbology.resolve call happened — no timeseries.get_range network call.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("corrupt cached chunk: rejected -> provider refetches safely -> good replacement cached -> no malformed candles reach the result", async () => {
    stubResolve("ESU6");
    sendMock.mockResolvedValueOnce(bodyOf({ schemaVersion: 1, contractSymbol: "ESZ6" /* mismatched contract — corrupt/stale entry */, dateKey: "2026-08-03", candles: [] }));
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ts_event: new Date(MONDAY).toISOString(), open: "5000", high: "5001", low: "4999", close: "5000.5", volume: "5" }), {
        status: 200,
      }),
    );
    sendMock.mockResolvedValueOnce({}); // the good replacement write

    const provider = new DatabentoHistoricalMarketDataProvider();
    const result = await provider.fetchCandles({ canonicalSymbol: "ES", from: MONDAY, to: MONDAY + DAY_MS - 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candles).toEqual([{ timestamp: MONDAY, open: 5000, high: 5001, low: 4999, close: 5000.5, volume: 5 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2); // resolve + live timeseries fetch — corrupt cache never short-circuited it
  });
});

describe("Twelve Data — provider+cache integration (Stage 17D §13/§14)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendMock.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("TWELVE_DATA_API_KEY", "key123");
    vi.stubEnv("TWELVE_DATA_R2_CACHE_ENABLED", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function liveResponse() {
    return new Response(
      JSON.stringify({
        meta: { symbol: "EUR/USD" },
        values: [{ datetime: "2026-08-03 00:00:00", open: "1.1", high: "1.1001", low: "1.0999", close: "1.1", volume: "5" }],
        status: "ok",
      }),
      { status: 200 },
    );
  }

  it("cold request: R2 miss -> provider hit -> validated -> cached", async () => {
    sendMock.mockRejectedValueOnce(new NoSuchKey({ message: "not found", $metadata: {} }));
    fetchMock.mockResolvedValueOnce(liveResponse());
    sendMock.mockResolvedValueOnce({});

    const provider = new TwelveDataHistoricalMarketDataProvider();
    const result = await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: MONDAY, to: MONDAY + DAY_MS - 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candles).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const putCall = sendMock.mock.calls[1];
    const written = JSON.parse(putCall[0].input.Body);
    expect(written.schemaVersion).toBe(1);
    expect(written.provider).toBe("twelvedata");
    expect(written.providerSymbol).toBe("EUR/USD");
  });

  it("warm request: R2 hit -> ZERO network fetches, same candles returned", async () => {
    sendMock.mockResolvedValueOnce(
      bodyOf({
        schemaVersion: 1,
        provider: "twelvedata",
        priceBasis: "AGGREGATED",
        providerSymbol: "EUR/USD",
        dateKey: "2026-08-03",
        cachedAt: new Date().toISOString(),
        candles: [{ timestamp: MONDAY, open: 1.1, high: 1.1001, low: 1.0999, close: 1.1, volume: 5 }],
      }),
    );

    const provider = new TwelveDataHistoricalMarketDataProvider();
    const result = await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: MONDAY, to: MONDAY + DAY_MS - 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candles).toEqual([{ timestamp: MONDAY, open: 1.1, high: 1.1001, low: 1.0999, close: 1.1, volume: 5 }]);
    expect(fetchMock).not.toHaveBeenCalled(); // no time_series call at all — Twelve Data has no separate resolve step
  });

  it("corrupt cached chunk: rejected -> provider refetches safely -> good replacement cached -> no malformed candles reach the result", async () => {
    sendMock.mockResolvedValueOnce(
      bodyOf({
        schemaVersion: 1,
        provider: "twelvedata",
        priceBasis: "AGGREGATED",
        providerSymbol: "GBP/USD" /* mismatched symbol — corrupt/stale entry for EUR/USD's key */,
        dateKey: "2026-08-03",
        candles: [],
      }),
    );
    fetchMock.mockResolvedValueOnce(liveResponse());
    sendMock.mockResolvedValueOnce({});

    const provider = new TwelveDataHistoricalMarketDataProvider();
    const result = await provider.fetchCandles({ canonicalSymbol: "EURUSD", from: MONDAY, to: MONDAY + DAY_MS - 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candles).toEqual([{ timestamp: MONDAY, open: 1.1, high: 1.1001, low: 1.0999, close: 1.1, volume: 5 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1); // corrupt cache never short-circuited the live fetch
  });
});
