import { describe, expect, it } from "vitest";

import { convertMt5TimestampToUtcMs, normalizeMt5Candles } from "@/domain/mt5-import/mt5-normalize";
import type { Mt5RawCandleRow, TimeConvention } from "@/domain/mt5-import/types";

function row(overrides: Partial<Mt5RawCandleRow> = {}): Mt5RawCandleRow {
  return { lineNumber: 1, rawDate: "2024.01.02", rawTime: "00:00:00", open: 100, high: 101, low: 99, close: 100.5, tickVolume: 10, volume: 5, spread: 2, ...overrides };
}

describe("convertMt5TimestampToUtcMs — Stage 21.3A §7/§8", () => {
  it("treats a UTC convention as a direct Date.UTC mapping, no shift", () => {
    const ms = convertMt5TimestampToUtcMs("2024.01.02", "15:30:00", { kind: "UTC" });
    expect(ms).toBe(Date.UTC(2024, 0, 2, 15, 30, 0));
  });

  it("applies a fixed broker-server offset (e.g. UTC+2, no DST)", () => {
    const convention: TimeConvention = { kind: "FIXED_OFFSET", offsetMinutes: 120 };
    const ms = convertMt5TimestampToUtcMs("2024.01.02", "15:30:00", convention);
    expect(ms).toBe(Date.UTC(2024, 0, 2, 13, 30, 0));
  });

  it("applies a real IANA zone with DST correctly across a known transition", () => {
    const convention: TimeConvention = { kind: "IANA_ZONE", zone: "America/New_York" };
    const beforeFallBack = convertMt5TimestampToUtcMs("2025.11.01", "12:00:00", convention);
    const afterFallBack = convertMt5TimestampToUtcMs("2025.11.03", "12:00:00", convention);
    expect(beforeFallBack).toBe(Date.UTC(2025, 10, 1, 16, 0, 0)); // EDT, UTC-4
    expect(afterFallBack).toBe(Date.UTC(2025, 10, 3, 17, 0, 0)); // EST, UTC-5
  });

  it("rejects an invalid/unknown IANA zone rather than silently treating it as UTC", () => {
    const ms = convertMt5TimestampToUtcMs("2024.01.02", "15:30:00", { kind: "IANA_ZONE", zone: "Not/A_Real_Zone" });
    expect(ms).toBeNull();
  });

  it("handles a combined DATETIME string (rawTime null)", () => {
    const ms = convertMt5TimestampToUtcMs("2024.01.02 15:30:00", null, { kind: "UTC" });
    expect(ms).toBe(Date.UTC(2024, 0, 2, 15, 30, 0));
  });

  it("returns null for a malformed date/time rather than throwing", () => {
    expect(convertMt5TimestampToUtcMs("not-a-date", "not-a-time", { kind: "UTC" })).toBeNull();
    expect(convertMt5TimestampToUtcMs("2024.13.45", "25:99:00", { kind: "UTC" })).toBeNull();
  });
});

describe("normalizeMt5Candles — Stage 21.3A §10-12", () => {
  it("converts valid rows to canonical Candle[], ascending and deduped", () => {
    const rows = [row({ lineNumber: 2, rawTime: "00:01:00" }), row({ lineNumber: 1, rawTime: "00:00:00" })];
    const result = normalizeMt5Candles(rows, { kind: "UTC" });
    expect(result.rejections).toHaveLength(0);
    expect(result.candles.map((c) => c.timestamp)).toEqual([Date.UTC(2024, 0, 2, 0, 0, 0), Date.UTC(2024, 0, 2, 0, 1, 0)]);
  });

  it("de-duplicates two rows resolving to the exact same UTC instant", () => {
    const rows = [row({ lineNumber: 1 }), row({ lineNumber: 2 })]; // identical rawDate/rawTime
    const result = normalizeMt5Candles(rows, { kind: "UTC" });
    expect(result.candles).toHaveLength(1);
  });

  it("only populates Candle.volume from the real VOL column, never from tickVolume", () => {
    const rows = [row({ tickVolume: 999, volume: 5 })];
    const result = normalizeMt5Candles(rows, { kind: "UTC" });
    expect(result.candles[0].volume).toBe(5);
  });

  it("treats a null VOL column as null, never 0", () => {
    const rows = [row({ volume: null })];
    const result = normalizeMt5Candles(rows, { kind: "UTC" });
    expect(result.candles[0].volume).toBeNull();
  });

  it("rejects (does not fabricate a fallback for) a row with an unparseable timestamp under the given convention", () => {
    const rows = [row({ lineNumber: 7, rawDate: "bogus" })];
    const result = normalizeMt5Candles(rows, { kind: "UTC" });
    expect(result.candles).toHaveLength(0);
    expect(result.rejections).toEqual([{ lineNumber: 7, reason: expect.stringContaining("Unparseable") }]);
  });

  it("never crashes on an empty row list", () => {
    expect(normalizeMt5Candles([], { kind: "UTC" })).toEqual({ candles: [], rejections: [] });
  });
});
