import { afterEach, describe, expect, it, vi } from "vitest";

import { dumpMarketDataSample, formatDiagnosticTable } from "@/server/services/market-data/diagnostic";

const DAY_MS = 86_400_000;
const MONDAY = Date.UTC(2026, 7, 3);

describe("dumpMarketDataSample — Stage 17D §12 dev-only diagnostic", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("rejects an unknown provider id", async () => {
    const result = await dumpMarketDataSample({ providerId: "not-a-real-provider", canonicalSymbol: "EURUSD", fromMs: MONDAY, toMs: MONDAY + 60_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/unknown provider/i);
  });

  it("reports Databento as not configured when no API key is set", async () => {
    const result = await dumpMarketDataSample({ providerId: "databento", canonicalSymbol: "ES", fromMs: MONDAY, toMs: MONDAY + 60_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not configured/i);
  });

  it("rejects an inverted range without calling the provider", async () => {
    vi.stubEnv("DATABENTO_API_KEY", "key123");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await dumpMarketDataSample({ providerId: "databento", canonicalSymbol: "ES", fromMs: MONDAY + 60_000, toMs: MONDAY });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shapes rows with provider/symbol/contract/priceBasis from real Databento provenance", async () => {
    vi.stubEnv("DATABENTO_API_KEY", "key123");
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { "ES.v.0": [{ d0: "2026-07-01", d1: "2026-09-01", s: "ESU6" }] } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ts_event: new Date(MONDAY).toISOString(), open: "5000", high: "5001", low: "4999", close: "5000.5", volume: "5" }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await dumpMarketDataSample({ providerId: "databento", canonicalSymbol: "ES", fromMs: MONDAY, toMs: MONDAY + 60_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      open: 5000,
      high: 5001,
      low: 4999,
      close: 5000.5,
      volume: 5,
      provider: "databento",
      canonicalSymbol: "ES",
      providerSymbol: "ES.v.0",
      contract: "ESU6",
      priceBasis: "raw-unadjusted",
    });
  });

  it("shapes rows for Twelve Data with the corrected AGGREGATED price basis", async () => {
    vi.stubEnv("TWELVE_DATA_API_KEY", "key123");
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          meta: { symbol: "XAU/USD" },
          values: [{ datetime: "2026-08-03 00:00:00", open: "2400", high: "2401", low: "2399", close: "2400.5", volume: "5" }],
          status: "ok",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await dumpMarketDataSample({ providerId: "twelvedata", canonicalSymbol: "XAUUSD", fromMs: MONDAY, toMs: MONDAY + 60_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toMatchObject({
      provider: "twelvedata",
      canonicalSymbol: "XAUUSD",
      providerSymbol: "XAU/USD",
      contract: "XAU/USD",
      priceBasis: "AGGREGATED",
    });
  });

  it("truncates a sample larger than the diagnostic's own bound and reports it", async () => {
    // A single UTC day maxes out at 1440 one-minute bars (comfortably under
    // the 2000-row bound), so triggering truncation needs a multi-day
    // window — the Twelve Data adapter fetches one day at a time, so this
    // mocks TWO full-day responses (1440 each = 2880 total) to exceed it.
    vi.stubEnv("TWELVE_DATA_API_KEY", "key123");
    function dayValues(dayStart: number) {
      return Array.from({ length: 1440 }, (_, i) => {
        const t = new Date(dayStart + i * 60_000).toISOString().slice(0, 19).replace("T", " ");
        return { datetime: t, open: "1.1", high: "1.1001", low: "1.0999", close: "1.1", volume: "1" };
      });
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ meta: {}, values: dayValues(MONDAY), status: "ok" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ meta: {}, values: dayValues(MONDAY + DAY_MS), status: "ok" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await dumpMarketDataSample({ providerId: "twelvedata", canonicalSymbol: "EURUSD", fromMs: MONDAY, toMs: MONDAY + 2 * DAY_MS - 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.length).toBe(2000);
    expect(result.truncated).toBe(true);
  });

  it("propagates a structured provider error rather than throwing", async () => {
    vi.stubEnv("TWELVE_DATA_API_KEY", "key123");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 401, message: "bad key", status: "error" }), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await dumpMarketDataSample({ providerId: "twelvedata", canonicalSymbol: "EURUSD", fromMs: MONDAY, toMs: MONDAY + 60_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/PROVIDER_ERROR/);
  });
});

describe("formatDiagnosticTable", () => {
  it("renders a header and one row per candle with no crash on null volume/contract", () => {
    const table = formatDiagnosticTable([
      {
        timestamp: "2026-08-03T00:00:00.000Z",
        open: 1.1,
        high: 1.1001,
        low: 1.0999,
        close: 1.1,
        volume: null,
        provider: "fixture",
        canonicalSymbol: "EURUSD",
        providerSymbol: "EURUSD",
        contract: null,
        priceBasis: "synthetic",
      },
    ]);
    const lines = table.split("\n");
    expect(lines).toHaveLength(2); // header + 1 row
    expect(lines[1]).toContain("2026-08-03T00:00:00.000Z");
  });
});
