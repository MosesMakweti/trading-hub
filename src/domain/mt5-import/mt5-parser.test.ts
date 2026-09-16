import { describe, expect, it } from "vitest";

import { decodeMt5UploadBytes, detectMt5Format, MAX_MT5_IMPORT_ROWS, parseMt5HistoricalData } from "@/domain/mt5-import/mt5-parser";
import type { Mt5FormatDetection } from "@/domain/mt5-import/types";

function requireOk(d: ReturnType<typeof detectMt5Format>): asserts d is Mt5FormatDetection {
  if (!d.ok) throw new Error(`Expected detection to succeed, got: ${d.reason}`);
}

describe("detectMt5Format — Stage 21.3A §6", () => {
  it("detects MT5's native tab-delimited export WITH the <DATE> <TIME> header", () => {
    const text = "<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>\n2024.01.02\t00:00:00\t2062.30\t2063.10\t2061.80\t2062.90\t145\t0\t12\n";
    const d = detectMt5Format(text);
    requireOk(d);
    expect(d.delimiter).toBe("\t");
    expect(d.hasHeader).toBe(true);
    expect(d.dateTimeShape).toBe("SPLIT");
    expect(d.hasTickVolume).toBe(true);
    expect(d.hasVolume).toBe(true);
    expect(d.hasSpread).toBe(true);
  });

  it("detects a headerless tab-delimited export (MT5's raw Export button)", () => {
    const text = "2024.01.02\t00:00:00\t2062.30\t2063.10\t2061.80\t2062.90\t145\t0\t12\n2024.01.02\t00:01:00\t2062.90\t2063.20\t2062.70\t2063.00\t98\t0\t10\n";
    const d = detectMt5Format(text);
    requireOk(d);
    expect(d.hasHeader).toBe(false);
    expect(d.dateTimeShape).toBe("SPLIT");
  });

  it("detects a comma-delimited variant with a plain-text header", () => {
    const text = "DATE,TIME,OPEN,HIGH,LOW,CLOSE,TICKVOL,VOL,SPREAD\n2024.01.02,00:00:00,2062.30,2063.10,2061.80,2062.90,145,0,12\n";
    const d = detectMt5Format(text);
    requireOk(d);
    expect(d.delimiter).toBe(",");
    expect(d.hasHeader).toBe(true);
  });

  it("detects a combined DATETIME column shape", () => {
    const text = "DATETIME,OPEN,HIGH,LOW,CLOSE,VOLUME\n2024.01.02 00:00:00,2062.30,2063.10,2061.80,2062.90,145\n";
    const d = detectMt5Format(text);
    requireOk(d);
    expect(d.dateTimeShape).toBe("COMBINED");
    expect(d.hasTickVolume).toBe(true);
    expect(d.hasVolume).toBe(false);
  });

  it("detects a minimal OHLC-only export with no volume/spread columns at all", () => {
    const text = "2024.01.02\t00:00:00\t2062.30\t2063.10\t2061.80\t2062.90\n";
    const d = detectMt5Format(text);
    requireOk(d);
    expect(d.hasTickVolume).toBe(false);
    expect(d.hasVolume).toBe(false);
    expect(d.hasSpread).toBe(false);
  });

  it("returns a typed failure for an empty file", () => {
    const d = detectMt5Format("");
    expect(d.ok).toBe(false);
  });

  it("returns a typed failure when neither tab nor comma delimiter is found", () => {
    const d = detectMt5Format("this is not a delimited file at all\nanother line\n");
    expect(d.ok).toBe(false);
  });

  it("returns a typed failure for an unrecognized date/time shape (never guesses)", () => {
    const d = detectMt5Format("01/02/2024,00:00,2062.30,2063.10,2061.80,2062.90\n"); // US-style date — not MT5's own format
    expect(d.ok).toBe(false);
  });

  it("returns a typed failure for a binary file masquerading as CSV", () => {
    const binaryish = decodeMt5UploadBytes(new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00, 0x00, 0x10, 0x20]));
    const d = detectMt5Format(binaryish);
    expect(d.ok).toBe(false);
  });
});

describe("parseMt5HistoricalData — Stage 21.3A §5/§11/§12/§17", () => {
  it("parses a valid multi-row M1 export into raw rows with 1-based line numbers", () => {
    const text = "2024.01.02\t00:00:00\t2062.30\t2063.10\t2061.80\t2062.90\t145\t0\t12\n2024.01.02\t00:01:00\t2062.90\t2063.20\t2062.70\t2063.00\t98\t0\t10\n";
    const d = detectMt5Format(text);
    requireOk(d);
    const result = parseMt5HistoricalData(text, d);
    expect(result.rows).toHaveLength(2);
    expect(result.rowErrors).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({ lineNumber: 1, rawDate: "2024.01.02", rawTime: "00:00:00", open: 2062.3, high: 2063.1, low: 2061.8, close: 2062.9, tickVolume: 145, volume: 0, spread: 12 });
    expect(result.rows[1].lineNumber).toBe(2);
  });

  it("skips the header row correctly when counting line numbers for data rows", () => {
    const text = "<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\n2024.01.02\t00:00:00\t2062.30\t2063.10\t2061.80\t2062.90\n";
    const d = detectMt5Format(text);
    requireOk(d);
    const result = parseMt5HistoricalData(text, d);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].lineNumber).toBe(1); // first DATA line, header already excluded
  });

  it("reports (never silently drops) a non-numeric OHLC row", () => {
    const text = "2024.01.02\t00:00:00\tXX\t2063.10\t2061.80\t2062.90\n2024.01.02\t00:01:00\t2062.90\t2063.20\t2062.70\t2063.00\n";
    const d = detectMt5Format(text);
    requireOk(d);
    const result = parseMt5HistoricalData(text, d);
    expect(result.rows).toHaveLength(1);
    expect(result.rowErrors).toHaveLength(1);
    expect(result.rowErrors[0].lineNumber).toBe(1);
  });

  it("reports an invalid OHLC relationship (high < low) rather than silently repairing it", () => {
    const text = "2024.01.02\t00:00:00\t2062.30\t2061.00\t2063.00\t2062.90\n"; // high < low
    const d = detectMt5Format(text);
    requireOk(d);
    const result = parseMt5HistoricalData(text, d);
    expect(result.rows).toHaveLength(0);
    expect(result.rowErrors).toHaveLength(1);
    expect(result.rowErrors[0].message).toMatch(/invalid ohlc/i);
  });

  it("preserves out-of-order and duplicate rows AS-IS (ordering/dedup happens in normalization, not here)", () => {
    const text = "2024.01.02\t00:01:00\t1\t1\t1\t1\n2024.01.02\t00:00:00\t2\t2\t2\t2\n2024.01.02\t00:00:00\t3\t3\t3\t3\n";
    const d = detectMt5Format(text);
    requireOk(d);
    const result = parseMt5HistoricalData(text, d);
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((r) => r.rawTime)).toEqual(["00:01:00", "00:00:00", "00:00:00"]);
  });

  it("handles a combined DATETIME shape with tickVolume-only trailing column", () => {
    const text = "2024.01.02 00:00:00,2062.30,2063.10,2061.80,2062.90,145\n";
    const d = detectMt5Format(text);
    requireOk(d);
    const result = parseMt5HistoricalData(text, d);
    expect(result.rows[0]).toMatchObject({ rawDate: "2024.01.02 00:00:00", rawTime: null, tickVolume: 145, volume: null, spread: null });
  });

  it("truncates and flags a file beyond the documented row ceiling rather than exhausting memory", () => {
    const header = "2024.01.02\t00:00:00\t100\t101\t99\t100\n";
    const text = header.repeat(MAX_MT5_IMPORT_ROWS + 10);
    const d = detectMt5Format(text);
    requireOk(d);
    const result = parseMt5HistoricalData(text, d);
    expect(result.truncated).toBe(true);
    expect(result.rows.length + result.rowErrors.length).toBe(MAX_MT5_IMPORT_ROWS);
  }, 30_000);
});
