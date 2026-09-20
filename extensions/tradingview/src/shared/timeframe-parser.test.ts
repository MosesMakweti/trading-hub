import { describe, expect, it } from "vitest";

import { normalizeTradingViewInterval } from "./timeframe-parser";

describe("normalizeTradingViewInterval", () => {
  it("treats a bare number as minutes", () => {
    expect(normalizeTradingViewInterval("1")).toBe("1m");
    expect(normalizeTradingViewInterval("5")).toBe("5m");
    expect(normalizeTradingViewInterval("45")).toBe("45m");
  });

  it("converts minutes evenly divisible by 60 to hours", () => {
    expect(normalizeTradingViewInterval("60")).toBe("1h");
    expect(normalizeTradingViewInterval("240")).toBe("4h");
  });

  it("keeps a non-hour-aligned minute count as minutes, never a fabricated fractional hour", () => {
    expect(normalizeTradingViewInterval("90")).toBe("90m");
  });

  it("parses seconds", () => {
    expect(normalizeTradingViewInterval("1S")).toBe("1s");
    expect(normalizeTradingViewInterval("30S")).toBe("30s");
    expect(normalizeTradingViewInterval("15s")).toBe("15s");
  });

  it("parses days, with bare 'D' meaning 1 day", () => {
    expect(normalizeTradingViewInterval("D")).toBe("1D");
    expect(normalizeTradingViewInterval("1D")).toBe("1D");
    expect(normalizeTradingViewInterval("3D")).toBe("3D");
  });

  it("parses weeks, with bare 'W' meaning 1 week", () => {
    expect(normalizeTradingViewInterval("W")).toBe("1W");
    expect(normalizeTradingViewInterval("2W")).toBe("2W");
  });

  it("parses months as 'M', never confusing it with minutes", () => {
    expect(normalizeTradingViewInterval("M")).toBe("1M");
    expect(normalizeTradingViewInterval("1M")).toBe("1M");
    expect(normalizeTradingViewInterval("6M")).toBe("6M");
  });

  it("is case-insensitive for the letter suffixes", () => {
    expect(normalizeTradingViewInterval("d")).toBe("1D");
    expect(normalizeTradingViewInterval("w")).toBe("1W");
    expect(normalizeTradingViewInterval("m")).toBe("1M");
  });

  it("returns null for empty or whitespace-only input", () => {
    expect(normalizeTradingViewInterval("")).toBeNull();
    expect(normalizeTradingViewInterval("   ")).toBeNull();
  });

  it("returns null for zero or negative minute counts rather than fabricating a timeframe", () => {
    expect(normalizeTradingViewInterval("0")).toBeNull();
  });

  it("returns null for a string it cannot parse at all", () => {
    expect(normalizeTradingViewInterval("abc")).toBeNull();
    expect(normalizeTradingViewInterval("5X")).toBeNull();
  });
});
