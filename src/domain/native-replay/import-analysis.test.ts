import { describe, expect, it } from "vitest";

import { analyzeMt5M1Import, resolveDatasetSymbol } from "./import-analysis";
import { analyzeGaps } from "./m1-dataset";
import { detectM1Format, parseDecimal, parseM1Text, readMt5FileName } from "./mt5-m1-parser";
import { formatWallClock } from "./wall-clock";
import { mt5Text, syntheticMt5Export, wc } from "./testing/m1-fixtures";

const FILE = "EURUSD_M1_202405140000_202405142359.csv";
const analyze = (text: string, fileName: string | null = FILE, symbolOverride?: string) => analyzeMt5M1Import({ text, fileName, symbolOverride });

const clean = mt5Text([
  ["2024.05.14", "09:00:00", "1.07843", "1.07850", "1.07840", "1.07848", "35", "0", "3"],
  ["2024.05.14", "09:01:00", "1.07848", "1.07861", "1.07846", "1.07859", "9", "0", "1"],
  ["2024.05.14", "09:02:00", "1.07859", "1.07860", "1.07831", "1.07835", "34", "0", "2"],
  ["2024.05.14", "09:03:00", "1.07835", "1.07842", "1.07829", "1.07840", "41", "0", "3"],
]);

describe("MT5 format detection", () => {
  it("MT5 Export Bars: tab, <DATE> <TIME> header, TICKVOL/VOL/SPREAD", () => {
    const d = detectM1Format(clean);
    expect(d.ok && d.layout.format).toEqual({ delimiter: "\t", hasHeader: true, dateTimeShape: "SPLIT", hasTickVolume: true, hasRealVolume: true, hasSpread: true });
  });

  it("headerless tab export, comma re-save, combined date-time, OHLC only", () => {
    const headerless = mt5Text([["2024.05.14", "09:00", "1.1", "1.2", "1.0", "1.1", "5", "0", "1"]], { header: false });
    const comma = "2024.05.14,09:00,2357.42,2357.90,2356.10,2357.00,22\n";
    const combined = "2024.05.14 09:00,1.1,1.2,1.0,1.1\n";
    const r1 = detectM1Format(headerless), r2 = detectM1Format(comma), r3 = detectM1Format(combined);
    expect(r1.ok && r1.layout.format.hasHeader).toBe(false);
    expect(r2.ok && [r2.layout.format.delimiter, r2.layout.format.hasTickVolume, r2.layout.format.hasRealVolume]).toEqual([",", true, false]);
    expect(r3.ok && [r3.layout.format.dateTimeShape, r3.layout.format.hasTickVolume]).toEqual(["COMBINED", false]);
  });

  it("maps header columns by name, whatever their order", () => {
    const text = "TIME,DATE,CLOSE,OPEN,LOW,HIGH\n09:00,2024.05.14,1.5,1.2,1.1,1.6\n09:01,2024.05.14,1.4,1.5,1.3,1.55\n09:02,2024.05.14,1.45,1.4,1.39,1.46\n";
    const { report } = analyze(text);
    expect(report.state).not.toBe("INVALID");
    expect(report.priceScale).toBe(2);
  });

  it("refuses unknown shapes instead of guessing", () => {
    expect(analyze("").report.errors[0]).toMatch(/empty/i);
    expect(analyze("hello world\n").report.state).toBe("INVALID");
    expect(analyze("DATE,TIME,OPEN,HIGH,LOW,CLOSE,FOO\n2024.05.14,09:00,1,1,1,1,1\n").report.errors[0]).toMatch(/Unrecognised column "FOO"/);
    expect(analyze("2024.05.14,09:00,1,1\n").report.errors[0]).toMatch(/OPEN, HIGH, LOW and CLOSE/);
    expect(analyze("x".repeat(600) + "\n").report.errors[0]).toMatch(/too long/);
  });

  it("reads the symbol and timeframe from MT5's default export file name", () => {
    expect(readMt5FileName("EURUSD.a_M1_202401020000_202406282359.csv")).toEqual({ symbol: "EURUSD.a", timeframe: "M1" });
    expect(readMt5FileName("C:\\exports\\XAUUSDm_M5_202401020000_202401022359.txt")).toEqual({ symbol: "XAUUSDm", timeframe: "M5" });
    expect(readMt5FileName("my-data.csv")).toBeNull();
  });
});

describe("strict decimal parsing (no float rounding, no exotic numbers)", () => {
  it("keeps exact mantissas", () => {
    expect(parseDecimal("1.07843")).toEqual({ mantissa: 107843, digits: 5 });
    expect(parseDecimal("2357.42")).toEqual({ mantissa: 235742, digits: 2 });
    expect(parseDecimal("150")).toEqual({ mantissa: 150, digits: 0 });
  });
  it("rejects exponents, hex, NaN, Infinity, separators and blanks", () => {
    for (const bad of ["1e5", "0x10", "NaN", "Infinity", "1,000.5", "", "1.2.3", "--1", "."]) expect(parseDecimal(bad), bad).toBeNull();
  });
});

describe("validation", () => {
  it("clean M1: VALID, exact range and counts, symbol from file name", () => {
    const { report, bars } = analyze(clean);
    expect(report.state).toBe("VALID");
    expect(report.range).toEqual({ firstBar: "2024-05-14T09:00", lastBar: "2024-05-14T09:03" });
    expect(report.counts).toMatchObject({ dataLines: 4, bars: 4, invalidRows: 0, exactDuplicatesCollapsed: 0, conflictingDuplicates: 0 });
    expect(report.symbol).toEqual({ sourceSymbol: "EURUSD", symbol: "EURUSD", origin: "FILE_NAME" });
    expect(report.timeBasis).toEqual({ basis: "BROKER_SERVER", utcOffsetMinutes: null });
    expect(bars!.count).toBe(4);
  });

  it("decimal precision: 1.07843 / 1.26381 / 2357.42 stored as exact integers", () => {
    const eur = analyze(clean).bars!;
    expect(Array.from(eur.open)).toEqual([107843, 107848, 107859, 107835]);
    const gbp = analyze(mt5Text([["2024.05.14", "09:00", "1.26381", "1.26390", "1.26370", "1.26381"], ["2024.05.14", "09:01", "1.26381", "1.26399", "1.26380", "1.26398"]]), "GBPUSD_M1_202405140000_202405142359.csv");
    expect(gbp.report.priceScale).toBe(5);
    expect(gbp.bars!.open[0]).toBe(126381);
    const xau = analyze("2024.05.14,09:00,2357.42,2357.90,2356.10,2357.4\n2024.05.14,09:01,2357.4,2358,2357.1,2357.95\n", "XAUUSD_M1_202405140000_202405142359.csv");
    // Trailing zeros dropped by a spreadsheet re-save ("2357.4", "2358") are rescaled exactly.
    expect(xau.report.priceScale).toBe(2);
    expect(Array.from(xau.bars!.open)).toEqual([235742, 235740]);
    expect(Array.from(xau.bars!.high)).toEqual([235790, 235800]);
  });

  it("malformed timestamps (bad calendar date, seconds) block the import with line numbers", () => {
    const text = mt5Text([
      ["2024.05.14", "09:00", "1.1", "1.2", "1.0", "1.1"],
      ["2024.02.30", "09:01", "1.1", "1.2", "1.0", "1.1"],
      ["2024.05.14", "09:02:30", "1.1", "1.2", "1.0", "1.1"],
      ["2024.05.14", "25:03", "1.1", "1.2", "1.0", "1.1"],
    ]);
    const { report, bars } = analyze(text);
    expect(report.state).toBe("INVALID");
    expect(bars).toBeNull();
    expect(report.rowIssues.byKind).toEqual({ TIMESTAMP: 2, NOT_MINUTE_ALIGNED: 1 });
    expect(report.rowIssues.samples.map((s) => s.line)).toEqual([3, 4, 5]);
  });

  it("invalid OHLC and invalid numbers are reported, never repaired", () => {
    const text = mt5Text([
      ["2024.05.14", "09:00", "1.10", "1.20", "1.00", "1.10"],
      ["2024.05.14", "09:01", "1.10", "1.05", "1.00", "1.10"], // high < open
      ["2024.05.14", "09:02", "1.10", "1.20", "1.15", "1.18"], // low > open
      ["2024.05.14", "09:03", "1e0", "1.20", "1.00", "1.10"],
      ["2024.05.14", "09:04", "-1.1", "1.20", "1.00", "1.10"],
    ]);
    const { report } = analyze(text);
    expect(report.state).toBe("INVALID");
    expect(report.counts.invalidOhlc).toBe(2);
    expect(report.rowIssues.byKind).toMatchObject({ OHLC: 2, PRICE: 2 });
  });

  it("exact duplicates collapse (counted); conflicting duplicates block", () => {
    const row = ["2024.05.14", "09:01", "1.1", "1.2", "1.0", "1.1", "5"];
    const exact = analyze(mt5Text([["2024.05.14", "09:00", "1.1", "1.2", "1.0", "1.1", "5"], row, row, ["2024.05.14", "09:02", "1.1", "1.2", "1.0", "1.1", "5"]]));
    expect(exact.report.state).toBe("VALID_WITH_WARNINGS");
    expect(exact.report.counts).toMatchObject({ bars: 3, exactDuplicatesCollapsed: 1, conflictingDuplicates: 0 });
    const conflict = analyze(mt5Text([row, ["2024.05.14", "09:01", "1.1", "1.3", "1.0", "1.1", "5"], ["2024.05.14", "09:02", "1.1", "1.2", "1.0", "1.1", "5"]]));
    expect(conflict.report.state).toBe("INVALID");
    expect(conflict.report.counts.conflictingDuplicates).toBe(1);
    expect(conflict.report.rowIssues.samples[0].message).toMatch(/lines 2 and 3/);
  });

  it("out-of-order rows are sorted and reported", () => {
    const { report, bars } = analyze(mt5Text([
      ["2024.05.14", "09:02", "1.3", "1.3", "1.3", "1.3"],
      ["2024.05.14", "09:00", "1.1", "1.1", "1.1", "1.1"],
      ["2024.05.14", "09:01", "1.2", "1.2", "1.2", "1.2"],
    ]));
    expect(report.counts.outOfOrderRows).toBe(2);
    expect(report.warnings.join(" ")).toMatch(/sorted/);
    expect(Array.from(bars!.open)).toEqual([11, 12, 13]);
  });

  it("absent optional volume is fine; an all-zero VOL column is not stored", () => {
    const noVol = analyze("2024.05.14 09:00,1.1,1.2,1.0,1.1\n2024.05.14 09:01,1.1,1.2,1.0,1.1\n2024.05.14 09:02,1.1,1.2,1.0,1.1\n");
    expect(noVol.report.state).toBe("VALID");
    expect(noVol.report.volume).toEqual({ hasTickVolume: false, hasRealVolume: false, realVolumeAllZero: false, hasSpread: false });
    const zeros = analyze(clean);
    expect(zeros.report.volume).toMatchObject({ hasTickVolume: true, hasRealVolume: false, realVolumeAllZero: true, hasSpread: true });
    expect(zeros.bars!.realVolume).toBeNull();
  });

  it("refuses non-M1 data", () => {
    const m5 = mt5Text([0, 5, 10, 15].map((m) => ["2024.05.14", `09:${String(m).padStart(2, "0")}`, "1.1", "1.2", "1.0", "1.1"]));
    expect(analyze(m5).report.errors.join(" ")).toMatch(/M5 data, not M1/);
  });

  it("requires a symbol when the file name doesn't carry one; keeps the broker's name verbatim", () => {
    expect(analyze(clean, "export.csv").report.errors.join(" ")).toMatch(/Symbol unknown/);
    expect(resolveDatasetSymbol("export.csv", "EURUSD.a")).toMatchObject({ sourceSymbol: "EURUSD.a", origin: "USER" });
    expect(resolveDatasetSymbol("export.csv", "EURUSD.a").symbol).toBe("EURUSD");
    expect(resolveDatasetSymbol("XAUUSDm_M1_202401020000_202401022359.csv", null)).toMatchObject({ sourceSymbol: "XAUUSDm", symbol: "XAUUSD" });
    expect(resolveDatasetSymbol(null, "bad symbol!!")).toEqual({ sourceSymbol: null, symbol: null, origin: null });
  });

  it("row ceiling is enforced before parsing", () => {
    const r = parseM1Text(syntheticMt5Export({ startDay: "2024-05-13", days: 1 }).text, { maxRows: 100 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/limit is 100/);
  });
});

describe("gap detection and classification (never filled)", () => {
  const minutes = (list: string[]) => Int32Array.from(list.map(wc));

  it("weekend, short, recurring daily break, intraday and multi-day gaps", () => {
    const list = [
      "2024-05-10T23:58", "2024-05-10T23:59", // Fri
      "2024-05-13T00:00", // Mon — WEEKEND gap
      "2024-05-13T00:04", // 3 missing — SHORT
      "2024-05-13T22:59", "2024-05-14T00:00", // 23:00–23:59 break
      "2024-05-14T22:59", "2024-05-15T00:00", // same break
      "2024-05-15T22:59", "2024-05-16T00:00", // same break — RECURRING_DAILY ×3
      "2024-05-16T10:00", "2024-05-16T12:00", // INTRADAY
      "2024-05-20T09:00", // spans the weekend too — WEEKEND
      "2024-05-21T09:00", "2024-05-23T09:00", // Tue→Thu — MULTI_DAY
    ];
    const g = analyzeGaps(minutes(list), list.length);
    // INTRADAY: the four gaps between sparse points inside each day (only two share
    // a start/end time, below the 3-day recurrence bar) + 10:00→12:00 + Mon 09:00→Tue 08:59.
    expect(g.byKind).toEqual({ WEEKEND: 2, SHORT: 1, RECURRING_DAILY: 3, INTRADAY: 6, MULTI_DAY: 1 });
    expect(g.largest[0].kind).toBe("WEEKEND");
  });

  it("a real-looking week has only expected gaps; review recommended only for unexplained ones", () => {
    const { text, bars } = syntheticMt5Export({ startDay: "2024-05-13", days: 12 });
    const { report } = analyze(text);
    expect(report.state).toBe("VALID");
    expect(report.counts.bars).toBe(bars);
    expect(report.gaps.byKind.WEEKEND).toBe(1);
    expect(report.reviewRecommended).toBe(false);
    // Remove a Wednesday afternoon → one unexplained gap, still importable.
    const holed = text.split("\n").filter((l) => !/^2024\.05\.15\t1[34]:/.test(l)).join("\n");
    const r2 = analyze(holed).report;
    expect(r2.state).toBe("VALID_WITH_WARNINGS");
    expect(r2.reviewRecommended).toBe(true);
    expect(r2.gaps.largest.find((x) => x.kind === "INTRADAY")).toMatchObject({ from: "2024-05-15T13:00", to: "2024-05-15T14:59", minutes: 120 });
    expect(r2.counts.bars).toBe(bars - 120); // nothing synthesised
  });

  it("formats gap boundaries on the dataset clock", () => {
    const g = analyzeGaps(minutes(["2024-05-14T09:00", "2024-05-14T09:30"]), 2);
    expect(g.largest[0]).toMatchObject({ from: formatWallClock(wc("2024-05-14T09:01")), to: "2024-05-14T09:29", minutes: 29 });
  });
});
