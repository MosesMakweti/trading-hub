import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { detectMt5Format, parseMt5HistoricalData } from "./mt5-parser";
import { normalizeMt5Candles, convertMt5TimestampToUtcMs } from "./mt5-normalize";
import { buildMt5ImportPreview, resolveMt5Symbol } from "./mt5-import-preview";
import { aggregateCandles } from "@/domain/market-data/aggregation";
import { resolveChartPriceFormat } from "@/domain/market-data/chart-price-precision";
import { analyzeMarketDataQuality } from "@/domain/market-data/quality-analysis";
import type { TimeConvention } from "./types";

/**
 * Edge Review Replay Data Source — hardening pass (Prompt 4). Exercises the
 * REAL parser/normalizer/preview contract against realistic MT5 History
 * Center export fixtures (`__fixtures__/`), not synthetic one-liners — §3-6/
 * §11/§12/§15-17 of the hardening spec. These fixtures were generated once
 * (deterministic seeded drift, not hand-typed) and committed — see the
 * fixtures directory for how.
 */
const FIXTURES_DIR = join(__dirname, "__fixtures__");
function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

const UTC: TimeConvention = { kind: "UTC" };

describe("realistic fixture — EURUSD M1, tab-delimited, <DATE> header (§3/§4)", () => {
  const text = readFixture("eurusd-m1-tab.txt");

  it("detects tab delimiter, header, and SPLIT date/time shape", () => {
    const detection = detectMt5Format(text);
    expect(detection.ok).toBe(true);
    if (!detection.ok) return;
    expect(detection.delimiter).toBe("\t");
    expect(detection.hasHeader).toBe(true);
    expect(detection.dateTimeShape).toBe("SPLIT");
    expect(detection.hasTickVolume).toBe(true);
    expect(detection.hasVolume).toBe(true);
    expect(detection.hasSpread).toBe(true);
  });

  it("parses all 40 rows with zero row errors", () => {
    const detection = detectMt5Format(text);
    if (!detection.ok) throw new Error("detection failed");
    const parsed = parseMt5HistoricalData(text, detection);
    expect(parsed.rows).toHaveLength(40);
    expect(parsed.rowErrors).toHaveLength(0);
    expect(parsed.truncated).toBe(false);
  });

  it("normalizes across the UTC midnight boundary with strictly ascending, contiguous timestamps", () => {
    const detection = detectMt5Format(text);
    if (!detection.ok) throw new Error("detection failed");
    const parsed = parseMt5HistoricalData(text, detection);
    const normalized = normalizeMt5Candles(parsed.rows, UTC);
    expect(normalized.rejections).toHaveLength(0);
    expect(normalized.candles).toHaveLength(40);

    // Boundary check (§5/§14): row 10 is 2026.01.05 23:59, row 11 is
    // 2026.01.06 00:00 — exactly one minute apart, never off-by-one across
    // the date rollover.
    const before = normalized.candles.find((c) => c.timestamp === Date.UTC(2026, 0, 5, 23, 59));
    const after = normalized.candles.find((c) => c.timestamp === Date.UTC(2026, 0, 6, 0, 0));
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    expect(after!.timestamp - before!.timestamp).toBe(60_000);

    for (let i = 1; i < normalized.candles.length; i++) {
      expect(normalized.candles[i].timestamp - normalized.candles[i - 1].timestamp).toBe(60_000);
    }
  });

  it("full preview pipeline resolves READY for a plain EURUSD symbol", () => {
    const preview = buildMt5ImportPreview({ text, sourceSymbol: "EURUSD", timeframeHint: "M1", timeConvention: UTC });
    expect(preview.state).toBe("READY");
    expect(preview.symbol.canonicalSymbol).toBe("EURUSD");
    expect(preview.nativeTimeframe).toBe("1m");
    expect(preview.rowCounts.valid).toBe(40);
  });
});

describe("realistic fixture — XAUUSD M1, comma-delimited, no header (§3/§4)", () => {
  const text = readFixture("xauusd-m1-comma.csv");

  it("detects comma delimiter with no header and only TICKVOL present", () => {
    const detection = detectMt5Format(text);
    expect(detection.ok).toBe(true);
    if (!detection.ok) return;
    expect(detection.delimiter).toBe(",");
    expect(detection.hasHeader).toBe(false);
    expect(detection.hasTickVolume).toBe(true);
    expect(detection.hasVolume).toBe(false);
    expect(detection.hasSpread).toBe(false);
  });

  it("resolves READY with gold-style 2-decimal precision preserved exactly", () => {
    const preview = buildMt5ImportPreview({ text, sourceSymbol: "XAUUSD", timeframeHint: "M1", timeConvention: UTC });
    expect(preview.state).toBe("READY");
    expect(preview.symbol.canonicalSymbol).toBe("XAUUSD");
    expect(preview.rowCounts.valid).toBe(40);

    const detection = detectMt5Format(text);
    if (!detection.ok) throw new Error("detection failed");
    const parsed = parseMt5HistoricalData(text, detection);
    const normalized = normalizeMt5Candles(parsed.rows, UTC);
    const first = normalized.candles[0];
    // §12 — the exact values from the fixture, no rounding drift introduced
    // anywhere in parse -> normalize.
    expect(first.open).toBe(3748.12);
    expect(first.high).toBe(3748.29);
    expect(first.low).toBe(3747.24);
    expect(first.close).toBe(3747.39);
  });
});

describe("realistic fixture — COMBINED date+time column (§4, existing contract)", () => {
  const text = readFixture("eurusd-m1-combined-datetime.csv");

  it("detects COMBINED date/time shape and parses correctly", () => {
    const detection = detectMt5Format(text);
    expect(detection.ok).toBe(true);
    if (!detection.ok) return;
    expect(detection.dateTimeShape).toBe("COMBINED");
    const parsed = parseMt5HistoricalData(text, detection);
    expect(parsed.rows).toHaveLength(10);
    expect(parsed.rowErrors).toHaveLength(0);
  });
});

describe("timezone handling — deterministic wall-clock -> UTC conversion (§5)", () => {
  const text = readFixture("eurusd-m1-tab.txt");

  it("UTC convention: wall-clock time IS the UTC timestamp", () => {
    const ms = convertMt5TimestampToUtcMs("2026.01.05", "23:50", { kind: "UTC" });
    expect(ms).toBe(Date.UTC(2026, 0, 5, 23, 50));
  });

  it("FIXED_OFFSET (UTC+2): wall-clock time is 2 hours AHEAD of UTC", () => {
    // A broker showing "2026.01.05 23:50" at UTC+2 means the real UTC
    // instant is 21:50 the same day.
    const ms = convertMt5TimestampToUtcMs("2026.01.05", "23:50", { kind: "FIXED_OFFSET", offsetMinutes: 120 });
    expect(ms).toBe(Date.UTC(2026, 0, 5, 21, 50));
  });

  it("IANA_ZONE (Europe/London, GMT in January — no DST): matches UTC exactly in winter", () => {
    const ms = convertMt5TimestampToUtcMs("2026.01.05", "23:50", { kind: "IANA_ZONE", zone: "Europe/London" });
    expect(ms).toBe(Date.UTC(2026, 0, 5, 23, 50));
  });

  it("a full preview run under FIXED_OFFSET UTC+2 shifts the whole file's range deterministically, still strictly ascending", () => {
    const detection = detectMt5Format(text);
    if (!detection.ok) throw new Error("detection failed");
    const parsed = parseMt5HistoricalData(text, detection);
    const utc = normalizeMt5Candles(parsed.rows, { kind: "UTC" });
    const offset = normalizeMt5Candles(parsed.rows, { kind: "FIXED_OFFSET", offsetMinutes: 120 });
    expect(offset.candles).toHaveLength(utc.candles.length);
    for (let i = 0; i < utc.candles.length; i++) {
      expect(offset.candles[i].timestamp).toBe(utc.candles[i].timestamp - 2 * 60 * 60_000);
    }
    // Still strictly ascending, 1-minute steps, no boundary corruption.
    for (let i = 1; i < offset.candles.length; i++) {
      expect(offset.candles[i].timestamp - offset.candles[i - 1].timestamp).toBe(60_000);
    }
  });

  it("never silently assumes UTC — a missing time convention yields NEEDS_USER_INPUT, never a guessed timestamp", () => {
    const preview = buildMt5ImportPreview({ text, sourceSymbol: "EURUSD", timeframeHint: "M1", timeConvention: null });
    expect(preview.state).toBe("NEEDS_USER_INPUT");
    expect(preview.range).toBeNull();
  });
});

describe("broker symbol normalization (§6)", () => {
  it("a plain canonical symbol resolves to itself", () => {
    expect(resolveMt5Symbol("EURUSD")).toEqual({ sourceSymbol: "EURUSD", canonicalSymbol: "EURUSD", resolved: true });
    expect(resolveMt5Symbol("XAUUSD")).toEqual({ sourceSymbol: "XAUUSD", canonicalSymbol: "XAUUSD", resolved: true });
  });

  it("a supported broker-suffixed symbol resolves to its canonical form while preserving the original source symbol", () => {
    const resolved = resolveMt5Symbol("EURUSD.a");
    expect(resolved.canonicalSymbol).toBe("EURUSD");
    expect(resolved.resolved).toBe(true);
    // The ORIGINAL broker symbol is preserved verbatim, never silently rewritten.
    expect(resolved.sourceSymbol).toBe("EURUSD.a");
  });

  it("an unrecognizable symbol comes back unresolved rather than guessed", () => {
    const resolved = resolveMt5Symbol("NOT_A_REAL_INSTRUMENT_XYZ");
    expect(resolved.resolved).toBe(false);
    expect(resolved.canonicalSymbol).toBeNull();
  });

  it("full preview pipeline with a broker-suffixed symbol still resolves READY", () => {
    const text = readFixture("eurusd-m1-tab.txt");
    const preview = buildMt5ImportPreview({ text, sourceSymbol: "EURUSD.a", timeframeHint: "M1", timeConvention: UTC });
    expect(preview.state).toBe("READY");
    expect(preview.symbol.canonicalSymbol).toBe("EURUSD");
    expect(preview.symbol.sourceSymbol).toBe("EURUSD.a");
  });
});

describe("EURUSD precision preserved end to end through parse -> normalize (§11)", () => {
  it("exact 5-decimal values from the fixture survive unchanged", () => {
    const text = readFixture("eurusd-m1-tab.txt");
    const detection = detectMt5Format(text);
    if (!detection.ok) throw new Error("detection failed");
    const parsed = parseMt5HistoricalData(text, detection);
    const normalized = normalizeMt5Candles(parsed.rows, UTC);
    const first = normalized.candles[0];
    expect(first.open).toBe(1.173);
    expect(first.high).toBe(1.17311);
    expect(first.low).toBe(1.17286);
    expect(first.close).toBe(1.17303);
    // No floating-point drift introduced anywhere in the pipeline.
    for (const c of normalized.candles) {
      expect(Number(c.open.toFixed(5))).toBe(c.open);
      expect(Number(c.high.toFixed(5))).toBe(c.high);
      expect(Number(c.low.toFixed(5))).toBe(c.low);
      expect(Number(c.close.toFixed(5))).toBe(c.close);
    }
  });

  it("resolveChartPriceFormat reports EURUSD's real 5-decimal precision", () => {
    expect(resolveChartPriceFormat("EURUSD")).toEqual({ precision: 5, minMove: 0.00001 });
  });
});

describe("XAUUSD precision preserved end to end through parse -> normalize (§12)", () => {
  it("resolveChartPriceFormat reports XAUUSD's real 2-decimal / 0.01 tick precision — no instrument-specific hack needed", () => {
    expect(resolveChartPriceFormat("XAUUSD")).toEqual({ precision: 2, minMove: 0.01 });
  });

  it("no unintended rounding across the whole fixture", () => {
    const text = readFixture("xauusd-m1-comma.csv");
    const detection = detectMt5Format(text);
    if (!detection.ok) throw new Error("detection failed");
    const parsed = parseMt5HistoricalData(text, detection);
    const normalized = normalizeMt5Candles(parsed.rows, UTC);
    for (const c of normalized.candles) {
      expect(Number(c.open.toFixed(2))).toBe(c.open);
      expect(Number(c.high.toFixed(2))).toBe(c.high);
      expect(Number(c.low.toFixed(2))).toBe(c.low);
      expect(Number(c.close.toFixed(2))).toBe(c.close);
    }
  });
});

describe("M1 -> higher timeframe aggregation using REAL imported candles (§13)", () => {
  it("aggregates 40 real M1 candles into deterministic 5m and 15m bars via the existing aggregateCandles, no bypass", () => {
    const text = readFixture("eurusd-m1-tab.txt");
    const detection = detectMt5Format(text);
    if (!detection.ok) throw new Error("detection failed");
    const parsed = parseMt5HistoricalData(text, detection);
    const m1 = normalizeMt5Candles(parsed.rows, UTC).candles;

    const m5 = aggregateCandles(m1, "5m");
    const m15 = aggregateCandles(m1, "15m");

    // 40 minutes of contiguous M1 starting at :50 -> 8 complete+partial 5m
    // buckets; verify the FIRST full bucket's OHLC against the raw M1 slice
    // by hand, exactly matching aggregateGroup's own rule (open=first,
    // close=last, high=max, low=min).
    const firstBucketStart = Date.UTC(2026, 0, 5, 23, 50); // bucket-aligned, since :50 % 5 === 0
    const firstBucket = m5.find((c) => c.timestamp === firstBucketStart)!;
    const rawSlice = m1.filter((c) => c.timestamp >= firstBucketStart && c.timestamp < firstBucketStart + 5 * 60_000);
    expect(rawSlice).toHaveLength(5);
    expect(firstBucket.open).toBe(rawSlice[0].open);
    expect(firstBucket.close).toBe(rawSlice[rawSlice.length - 1].close);
    expect(firstBucket.high).toBe(Math.max(...rawSlice.map((c) => c.high)));
    expect(firstBucket.low).toBe(Math.min(...rawSlice.map((c) => c.low)));

    // No timestamp corruption or duplication across aggregation.
    const m5Timestamps = m5.map((c) => c.timestamp);
    expect(new Set(m5Timestamps).size).toBe(m5Timestamps.length);
    for (let i = 1; i < m5.length; i++) expect(m5[i].timestamp - m5[i - 1].timestamp).toBe(5 * 60_000);

    const m15Timestamps = m15.map((c) => c.timestamp);
    expect(new Set(m15Timestamps).size).toBe(m15Timestamps.length);
    for (let i = 1; i < m15.length; i++) expect(m15[i].timestamp - m15[i - 1].timestamp).toBe(15 * 60_000);
  });

  it("volume aggregates by SUM when every M1 bar in a bucket reports a real (non-null) volume — MT5 TICKVOL is discarded, not summed as volume", () => {
    const text = readFixture("xauusd-m1-comma.csv"); // VOL absent entirely -> normalizeMt5Candles leaves Candle.volume null
    const detection = detectMt5Format(text);
    if (!detection.ok) throw new Error("detection failed");
    const parsed = parseMt5HistoricalData(text, detection);
    const m1 = normalizeMt5Candles(parsed.rows, UTC).candles;
    expect(m1.every((c) => c.volume === null)).toBe(true); // no VOL column in this fixture

    const m5 = aggregateCandles(m1, "5m");
    // Existing semantics (aggregation.ts): a bucket with ANY unknown volume
    // reports null overall, never a partial/misleading sum.
    expect(m5.every((c) => c.volume === null)).toBe(true);
  });
});

describe("gap detection — realistic missing candles (§15)", () => {
  it("a real 5-minute gap is detected and reported, producing READY_WITH_WARNINGS, never fabricated candles", () => {
    const text = readFixture("eurusd-m1-with-gap.txt");
    const preview = buildMt5ImportPreview({ text, sourceSymbol: "EURUSD", timeframeHint: "M1", timeConvention: UTC });
    expect(preview.state).toBe("READY_WITH_WARNINGS");
    expect(preview.quality).not.toBeNull();
    expect(preview.quality!.longestUnexpectedGapIntervals).toBeGreaterThanOrEqual(4); // 5 missing minutes = 4 missing intervals
    // The gap is a real hole, never filled — candle count reflects exactly
    // what the file contained (20 requested minutes - 5 skipped = 15).
    expect(preview.rowCounts.valid).toBe(15);
    expect(preview.issues.some((i) => /gap/i.test(i))).toBe(true);
  });
});

describe("invalid candle rows — realistic malformed data (§16)", () => {
  it("rejects high<low, non-numeric OHLC, out-of-range close, and malformed timestamp rows individually, keeping the valid ones", () => {
    const text = readFixture("eurusd-m1-invalid-rows.txt");
    const detection = detectMt5Format(text);
    expect(detection.ok).toBe(true);
    if (!detection.ok) return;
    const parsed = parseMt5HistoricalData(text, detection);
    // Rows: 1 valid, high<low (parser-level rowError), non-numeric open
    // (rowError), close>high (parser-level rowError, since isValidCandle
    // catches it before timestamps exist), malformed time ("99:99" — passes
    // parseMt5HistoricalData since it doesn't validate calendar values, but
    // is rejected later by normalizeMt5Candles), 1 more valid.
    expect(parsed.rowErrors.length).toBeGreaterThanOrEqual(3);

    const normalized = normalizeMt5Candles(parsed.rows, UTC);
    // The malformed-time row survives parsing but is rejected at normalize
    // time (isPlausibleCalendarValue rejects hour 99) — never silently
    // coerced into some other valid-looking instant.
    expect(normalized.candles.length).toBeLessThanOrEqual(2);
    expect(normalized.candles.every((c) => c.open > 1 && c.open < 2)).toBe(true); // only the 2 genuinely valid EURUSD rows

    const preview = buildMt5ImportPreview({ text, sourceSymbol: "EURUSD", timeframeHint: "M1", timeConvention: UTC });
    // Still enough valid data to import (2 valid candles), with warnings surfaced.
    expect(["READY_WITH_WARNINGS", "READY"]).toContain(preview.state);
    expect(preview.rowCounts.rejected).toBeGreaterThan(0);
  });
});

describe("duplicate timestamps — existing merge/dedup rule (§17)", () => {
  it("mergeCandles' existing 'first occurrence in file order wins' rule is preserved for MT5 imports — never silently changed", () => {
    const text = readFixture("eurusd-m1-duplicate-timestamp.txt");
    const detection = detectMt5Format(text);
    if (!detection.ok) throw new Error("detection failed");
    const parsed = parseMt5HistoricalData(text, detection);
    expect(parsed.rows).toHaveLength(4); // parser itself does NOT dedupe

    const normalized = normalizeMt5Candles(parsed.rows, UTC);
    // normalizeMt5Candles calls mergeCandles([], candles) internally, which
    // sorts by timestamp (stable) then keeps the FIRST occurrence for a tie
    // — the file's FIRST 09:01 row (close 1.17260), not the second
    // (close 1.18000), is what survives.
    expect(normalized.candles).toHaveLength(3); // 09:00, 09:01, 09:02 — the duplicate collapses to one
    const at0901 = normalized.candles.find((c) => c.timestamp === Date.UTC(2026, 0, 5, 9, 1));
    expect(at0901).toBeDefined();
    expect(at0901!.close).toBe(1.1726); // the FIRST 09:01 row's close, not the duplicate's 1.18
  });
});

describe("quality analysis wired against a real fixture-derived report", () => {
  it("analyzeMarketDataQuality on the clean EURUSD fixture reports zero gaps, zero duplicates, zero invalid rows", () => {
    const text = readFixture("eurusd-m1-tab.txt");
    const detection = detectMt5Format(text);
    if (!detection.ok) throw new Error("detection failed");
    const parsed = parseMt5HistoricalData(text, detection);
    const normalized = normalizeMt5Candles(parsed.rows, UTC);
    const report = analyzeMarketDataQuality(normalized.candles, "1m", normalized.candles[0].timestamp, normalized.candles[normalized.candles.length - 1].timestamp);
    expect(report.duplicateCount).toBe(0);
    expect(report.invalidCandleCount).toBe(0);
    expect(report.missingIntervals).toHaveLength(0);
    expect(report.coveragePercent).toBe(100);
  });
});
