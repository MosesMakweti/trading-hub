import { describe, expect, it } from "vitest";

import { buildMt5ImportPreview, resolveMt5Symbol, resolveMt5Timeframe } from "@/domain/mt5-import/mt5-import-preview";
import type { BuildMt5ImportPreviewParams } from "@/domain/mt5-import/mt5-import-preview";

function validM1Text(days = 1): string {
  const lines: string[] = [];
  for (let day = 2; day <= 1 + days; day += 1) {
    for (let m = 0; m < 1440; m += 1) {
      const hh = String(Math.floor(m / 60)).padStart(2, "0");
      const mm = String(m % 60).padStart(2, "0");
      lines.push(`2024.01.0${day}\t${hh}:${mm}:00\t2000.0\t2001.0\t1999.0\t2000.5\t10\t0\t5`);
    }
  }
  return lines.join("\n") + "\n";
}

function baseParams(overrides: Partial<BuildMt5ImportPreviewParams> = {}): BuildMt5ImportPreviewParams {
  return { text: validM1Text(1), sourceSymbol: "XAUUSD", timeframeHint: "M1", timeConvention: { kind: "UTC" }, ...overrides };
}

describe("resolveMt5Symbol — Stage 21.3A §10", () => {
  it("resolves an exact canonical symbol", () => {
    expect(resolveMt5Symbol("XAUUSD")).toEqual({ sourceSymbol: "XAUUSD", canonicalSymbol: "XAUUSD", resolved: true });
  });

  it("resolves a broker-suffixed symbol via the existing instrument catalog, preserving the original source symbol", () => {
    const r = resolveMt5Symbol("XAUUSD.a");
    expect(r.resolved).toBe(true);
    expect(r.canonicalSymbol).toBe("XAUUSD");
    expect(r.sourceSymbol).toBe("XAUUSD.a"); // original broker identity preserved, never discarded
  });

  it("resolves a micro-lot-suffixed symbol (e.g. Exness-style EURUSDm)", () => {
    const r = resolveMt5Symbol("EURUSDm");
    expect(r.resolved).toBe(true);
    expect(r.canonicalSymbol).toBe("EURUSD");
  });

  it("does not resolve an unknown symbol — requires confirmation rather than guessing", () => {
    const r = resolveMt5Symbol("NOTASYMBOL123");
    expect(r.resolved).toBe(false);
    expect(r.canonicalSymbol).toBeNull();
  });
});

describe("resolveMt5Timeframe — Stage 21.3A §4", () => {
  it("maps MT5 native timeframe codes to canonical Timeframe", () => {
    expect(resolveMt5Timeframe("M1")).toBe("1m");
    expect(resolveMt5Timeframe("H4")).toBe("4h");
    expect(resolveMt5Timeframe("D1")).toBe("1D");
  });

  it("accepts an already-canonical value", () => {
    expect(resolveMt5Timeframe("15m")).toBe("15m");
  });

  it("returns null for an unrecognized hint rather than guessing", () => {
    expect(resolveMt5Timeframe("W1")).toBeNull();
    expect(resolveMt5Timeframe(null)).toBeNull();
  });
});

describe("buildMt5ImportPreview — Stage 21.3A §14/§15 acceptance states", () => {
  it("READY for a clean, fully-resolved, gap-free M1 file", () => {
    const preview = buildMt5ImportPreview(baseParams());
    expect(preview.state).toBe("READY");
    expect(preview.issues).toEqual([]);
    expect(preview.symbol.canonicalSymbol).toBe("XAUUSD");
    expect(preview.nativeTimeframe).toBe("1m");
    expect(preview.rowCounts.valid).toBe(1440);
    expect(preview.quality?.coveragePercent).toBe(100);
  });

  it("INVALID when the file's shape can't be detected at all", () => {
    const preview = buildMt5ImportPreview(baseParams({ text: "not a delimited file\nat all\n" }));
    expect(preview.state).toBe("INVALID");
    expect(preview.issues.length).toBeGreaterThan(0);
  });

  it("NEEDS_USER_INPUT when the symbol cannot be resolved", () => {
    const preview = buildMt5ImportPreview(baseParams({ sourceSymbol: "TOTALLYUNKNOWN" }));
    expect(preview.state).toBe("NEEDS_USER_INPUT");
    expect(preview.issues.some((i) => i.includes("Symbol"))).toBe(true);
  });

  it("NEEDS_USER_INPUT when the timeframe hint is missing/unrecognized", () => {
    const preview = buildMt5ImportPreview(baseParams({ timeframeHint: null }));
    expect(preview.state).toBe("NEEDS_USER_INPUT");
  });

  it("NEEDS_USER_INPUT when the time convention is unknown — never silently assumes UTC", () => {
    const preview = buildMt5ImportPreview(baseParams({ timeConvention: null }));
    expect(preview.state).toBe("NEEDS_USER_INPUT");
    expect(preview.range).toBeNull(); // never normalized without a convention
    expect(preview.issues.some((i) => i.toLowerCase().includes("timezone"))).toBe(true);
  });

  it("READY_WITH_WARNINGS when the file has an unexpected gap but is otherwise usable", () => {
    // Two valid minutes, then a gap, then one more — an UNEXPECTED gap on a weekday.
    const text = "2024.01.02\t00:00:00\t100\t101\t99\t100\n2024.01.02\t00:01:00\t100\t101\t99\t100\n2024.01.02\t00:05:00\t100\t101\t99\t100\n";
    const preview = buildMt5ImportPreview(baseParams({ text }));
    expect(preview.state).toBe("READY_WITH_WARNINGS");
    expect(preview.quality?.missingIntervals.length).toBeGreaterThan(0);
  });

  it("INVALID when zero valid candles remain after normalization (e.g. every row rejected)", () => {
    const text = "2024.01.02\t00:00:00\tXX\tXX\tXX\tXX\n";
    const preview = buildMt5ImportPreview(baseParams({ text }));
    expect(preview.state).toBe("INVALID");
  });

  it("preserves the original row count vs. valid vs. rejected distinctly (never hides dropped rows)", () => {
    const text = "2024.01.02\t00:00:00\t100\t101\t99\t100\n2024.01.02\t00:01:00\tXX\t101\t99\t100\n";
    const preview = buildMt5ImportPreview(baseParams({ text }));
    expect(preview.rowCounts).toEqual({ original: 2, valid: 1, rejected: 1 });
  });

  it("is fully deterministic — identical input always produces an identical preview", () => {
    const a = buildMt5ImportPreview(baseParams());
    const b = buildMt5ImportPreview(baseParams());
    expect(a).toEqual(b);
  });
});
