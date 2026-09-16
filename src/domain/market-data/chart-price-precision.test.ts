import { describe, expect, it } from "vitest";

import { resolveChartPriceFormat } from "@/domain/market-data/chart-price-precision";

describe("resolveChartPriceFormat — Stage 21.1 §9 per-instrument precision", () => {
  it("resolves forex to 5 decimals with a derived minMove", () => {
    expect(resolveChartPriceFormat("EURUSD")).toEqual({ precision: 5, minMove: 0.00001 });
    expect(resolveChartPriceFormat("GBPUSD")).toEqual({ precision: 5, minMove: 0.00001 });
  });

  it("resolves metals to their own precision, distinct from forex", () => {
    expect(resolveChartPriceFormat("XAUUSD")).toEqual({ precision: 2, minMove: 0.01 });
  });

  it("resolves futures to their real tick size, not a derived power of ten", () => {
    expect(resolveChartPriceFormat("MES")).toEqual({ precision: 2, minMove: 0.25 });
    expect(resolveChartPriceFormat("MNQ")).toEqual({ precision: 2, minMove: 0.25 });
    expect(resolveChartPriceFormat("MGC")).toEqual({ precision: 1, minMove: 0.1 });
  });

  it("is case-insensitive, matching the catalog's own lookup convention", () => {
    expect(resolveChartPriceFormat("xauusd")).toEqual(resolveChartPriceFormat("XAUUSD"));
  });

  it("falls back to a sensible default for an unrecognized symbol, never throws", () => {
    expect(resolveChartPriceFormat("NOT_A_REAL_SYMBOL")).toEqual({ precision: 2, minMove: 0.01 });
  });
});
