import { describe, expect, it } from "vitest";

import { computeDistance, computePercentDistance } from "@/domain/trade-plan/distance";
import { lookupInstrument } from "@/domain/trade-plan/instrument-catalog";

describe("computeDistance", () => {
  it("computes EURUSD pip distance (spec §6 example: 20 pips)", () => {
    const spec = lookupInstrument("EURUSD");
    const result = computeDistance("1.10000", "1.09800", spec);
    expect(result.unit).toBe("PIP");
    expect(result.distance.toNumber()).toBeCloseTo(20, 6);
  });

  it("computes USDJPY pip distance with its 2-decimal pip size (spec §6 example: 50 pips)", () => {
    const spec = lookupInstrument("USDJPY");
    const result = computeDistance("150.00", "149.50", spec);
    expect(result.unit).toBe("PIP");
    expect(result.distance.toNumber()).toBeCloseTo(50, 6);
  });

  it("computes futures tick distance (spec §6 example: 40 ticks)", () => {
    const spec = lookupInstrument("NQ");
    const result = computeDistance("20000", "19990", spec);
    expect(result.unit).toBe("TICK");
    expect(result.distance.toNumber()).toBeCloseTo(40, 6);
  });

  it("computes an index/CFD point distance", () => {
    const spec = lookupInstrument("NAS100");
    const result = computeDistance("20050", "20000", spec);
    expect(result.unit).toBe("POINT");
    expect(result.distance.toNumber()).toBeCloseTo(50, 6);
  });

  it("computes metals point distance", () => {
    const spec = lookupInstrument("XAUUSD");
    const result = computeDistance("2650.00", "2640.00", spec);
    expect(result.unit).toBe("POINT");
    expect(result.distance.toNumber()).toBeCloseTo(10, 6);
  });

  it("uses raw price movement for crypto (preferred unit is PRICE, not pips/ticks/points)", () => {
    const spec = lookupInstrument("BTCUSD");
    const result = computeDistance("65000", "64500", spec);
    expect(result.unit).toBe("PRICE");
    expect(result.distance.toNumber()).toBeCloseTo(500, 6);
  });

  it("falls back to raw PRICE distance for an unmapped instrument rather than guessing a unit", () => {
    const result = computeDistance("100.5", "99.5", null);
    expect(result.unit).toBe("PRICE");
    expect(result.distance.toNumber()).toBeCloseTo(1, 6);
  });

  it("is direction-agnostic (absolute distance) regardless of which price is passed first", () => {
    const spec = lookupInstrument("EURUSD");
    const a = computeDistance("1.10000", "1.09800", spec);
    const b = computeDistance("1.09800", "1.10000", spec);
    expect(a.distance.toNumber()).toBe(b.distance.toNumber());
  });
});

describe("computePercentDistance", () => {
  it("computes a percentage price move", () => {
    const result = computePercentDistance(100, 105);
    expect(result.toNumber()).toBeCloseTo(5, 6);
  });

  it("is zero-safe", () => {
    const result = computePercentDistance(0, 10);
    expect(result.toNumber()).toBe(0);
  });
});
