import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { decodeBytes } from "@/domain/prop-firms/import/source/decode-bytes";
import { analyzeMt5M1Import, normalizeSymbol } from "./import-analysis";
import { readMt5FileName } from "./mt5-m1-parser";

/**
 * Regression for a genuine MT5 Market Bars export that failed to import:
 * `XAUUSD.n_M1_202606161656_202609252354` — no extension, a dotted broker
 * symbol, tab-delimited, CRLF, the full <DATE>…<SPREAD> header, VOL = 0.
 * The fixture is synthetic data in exactly that structure.
 */
const FIXTURE_NAME = "XAUUSD.n_M1_202606161656_202606161711";
const bytes = readFileSync(join(__dirname, "__fixtures__", FIXTURE_NAME));

describe("real MT5 Market Bars export (extensionless, dotted broker symbol)", () => {
  it("reads the broker symbol from the right-hand _TF_<from>_<to> suffix, with or without an extension", () => {
    const cases: [string, string][] = [
      ["EURUSD_M1_202401020000_202406282359", "EURUSD"],
      ["EURUSD.a_M1_202401020000_202406282359.csv", "EURUSD.a"],
      ["EURUSDm_M1_202401020000_202406282359.txt", "EURUSDm"],
      ["XAUUSD.n_M1_202606161656_202609252354", "XAUUSD.n"],
      ["GOLD.pro_M1_202401020000_202406282359", "GOLD.pro"],
      ["US30.cash_M1_202401020000_202406282359", "US30.cash"],
      ["C:\\\\Users\\\\me\\\\XAUUSD.n_M1_202606161656_202609252354", "XAUUSD.n"],
    ];
    for (const [name, symbol] of cases) expect(readMt5FileName(name), name).toEqual({ symbol, timeframe: "M1" });
    expect(readMt5FileName("XAUUSD.n_M5_202606161656_202609252354")?.timeframe).toBe("M5");
    expect(readMt5FileName("notes.txt")).toBeNull();
    expect(readMt5FileName("XAUUSD.n")).toBeNull(); // ".n" is not an extension, and there's no structural suffix
  });

  it("normalises broker spellings to the catalog symbol, keeping the source symbol separate", () => {
    expect(normalizeSymbol("XAUUSD.n")).toBe("XAUUSD");
    expect(normalizeSymbol("EURUSD.a")).toBe("EURUSD");
    expect(normalizeSymbol("EURUSDm")).toBe("EURUSD");
    expect(normalizeSymbol("GOLD.pro")).toBe("XAUUSD");
    expect(normalizeSymbol("US30.cash")).toBe("US30");
    expect(normalizeSymbol("MYSTERY.x")).toBe("MYSTERY.X"); // unknown root: nothing invented
  });

  it("imports the exact header, tabs, CRLF, 2-decimal gold prices, tick volume, VOL=0 and spread", () => {
    const { report, bars } = analyzeMt5M1Import({ text: decodeBytes(bytes).text, fileName: FIXTURE_NAME });
    expect(report.errors).toEqual([]);
    expect(report.state).toBe("VALID");
    expect(report.format).toEqual({ delimiter: "\t", hasHeader: true, dateTimeShape: "SPLIT", hasTickVolume: true, hasRealVolume: true, hasSpread: true });
    expect(report.symbol).toEqual({ sourceSymbol: "XAUUSD.n", symbol: "XAUUSD", origin: "FILE_NAME" });
    expect(report.priceScale).toBe(2);
    expect(report.range).toEqual({ firstBar: "2026-06-16T16:56", lastBar: "2026-06-16T17:11" });
    expect(report.counts.bars).toBe(16);
    expect(report.volume).toMatchObject({ hasTickVolume: true, hasRealVolume: false, realVolumeAllZero: true, hasSpread: true });
    expect(bars!.open[0]).toBe(433639); // 4336.39 exact
    expect(Array.from(bars!.spread!).every((s) => s === 5)).toBe(true);
  });

  it("an extensionless file is not automatically valid — its content must still be MT5 M1 bars", () => {
    const junk = analyzeMt5M1Import({ text: "hello, this is not market data\r\n", fileName: "XAUUSD.n_M1_202606161656_202609252354" });
    expect(junk.report.state).toBe("INVALID");
    expect(junk.bars).toBeNull();
  });
});
