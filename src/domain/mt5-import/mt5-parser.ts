/**
 * Stage 21.3A §5/§6 — `parseMt5HistoricalData`: the file-parsing boundary,
 * deliberately separate from normalization (`mt5-normalize.ts`, which
 * converts to canonical `Candle[]`) and persistence (`mt5-import.service.ts`).
 * This file only ever produces `Mt5RawCandleRow[]` — untouched numbers and
 * date/time STRINGS, no timezone interpretation, no symbol resolution.
 *
 * Reuses the existing, tested, encoding-safe byte decoder from the
 * prop-firms importer (`decodeText` — BOM/UTF-16/Latin-1 aware) rather than
 * reimplementing it; that function has zero prop-firm-specific coupling.
 *
 * See `types.ts`'s own doc comment for the exact supported file shape.
 */
import Papa from "papaparse";

import { decodeText } from "@/domain/prop-firms/import/source/decode-bytes";
import { isValidCandle } from "@/domain/market-data/candle";
import type { Mt5DateTimeShape, Mt5Delimiter, Mt5FormatDetection, Mt5FormatDetectionFailure, Mt5ParseResult, Mt5RawCandleRow, Mt5RowError } from "./types";

/** Stage 21.3A §16 — the explicit large-file ceiling for this stage's
 *  implementation. ~4.2M rows is roughly 8 years of M1 bars for one
 *  symbol (continuous, no gaps) — generous for a single import, and small
 *  enough to parse/normalize/hold in memory as one JS array without
 *  pathological GC behavior in a server request (each `Mt5RawCandleRow` is
 *  a small flat object; V8 handles arrays of a few million such objects
 *  without issue, but this is NOT unbounded). A file beyond this ceiling
 *  is rejected with a clear, typed reason rather than silently truncated
 *  or left to exhaust memory — true streaming/chunked ingestion (reading
 *  and normalizing the upload incrementally without ever holding the
 *  whole parsed array) is deferred; see the Stage 21.3A completion report. */
export const MAX_MT5_IMPORT_ROWS = 4_200_000;

const DATE_ONLY = /^(\d{4})[.\-/](\d{2})[.\-/](\d{2})$/;
const TIME_ONLY = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
const DATETIME_COMBINED = /^\d{4}[.\-/]\d{2}[.\-/]\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/;

function looksLikeDateOnly(cell: string): boolean {
  return DATE_ONLY.test(cell.trim());
}
function looksLikeCombinedDateTime(cell: string): boolean {
  return DATETIME_COMBINED.test(cell.trim());
}
function looksLikeTimeOnly(cell: string): boolean {
  return TIME_ONLY.test(cell.trim());
}

function sniffDelimiter(firstLine: string): Mt5Delimiter | null {
  const tabCount = (firstLine.match(/\t/g) ?? []).length;
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  if (tabCount === 0 && commaCount === 0) return null;
  return tabCount >= commaCount ? "\t" : ",";
}

/**
 * Stage 21.3A §6 — deterministic detection: delimiter, header presence,
 * date/time column shape, and which optional trailing columns are present.
 * Returns a typed failure (never throws, never guesses) when the file's
 * shape doesn't match ANY of the documented supported variants.
 */
export function detectMt5Format(text: string): Mt5FormatDetection | Mt5FormatDetectionFailure {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { ok: false, reason: "File is empty." };

  const delimiter = sniffDelimiter(lines[0]);
  if (!delimiter) return { ok: false, reason: "Could not detect a tab or comma delimiter." };

  const split = (line: string) => line.split(delimiter).map((c) => c.trim().replace(/^["<]|[">]$/g, ""));

  let dataLineIndex = 0;
  let hasHeader = false;
  let firstCells = split(lines[0]);
  if (!looksLikeDateOnly(firstCells[0] ?? "") && !looksLikeCombinedDateTime(firstCells[0] ?? "")) {
    hasHeader = true;
    dataLineIndex = 1;
    if (lines.length < 2) return { ok: false, reason: "File appears to have only a header row and no data." };
    firstCells = split(lines[dataLineIndex]);
  }

  let dateTimeShape: Mt5DateTimeShape;
  let ohlcStartIndex: number;
  if (looksLikeCombinedDateTime(firstCells[0] ?? "")) {
    dateTimeShape = "COMBINED";
    ohlcStartIndex = 1;
  } else if (looksLikeDateOnly(firstCells[0] ?? "") && looksLikeTimeOnly(firstCells[1] ?? "")) {
    dateTimeShape = "SPLIT";
    ohlcStartIndex = 2;
  } else {
    return { ok: false, reason: `Unrecognized date/time column shape in the first data row: "${lines[dataLineIndex].slice(0, 80)}"` };
  }

  const columnCount = firstCells.length;
  const trailingCount = columnCount - ohlcStartIndex - 4;
  if (trailingCount < 0) {
    return { ok: false, reason: `Expected at least OPEN/HIGH/LOW/CLOSE after the date/time column(s); found ${columnCount} column(s) total.` };
  }
  if (trailingCount > 3) {
    return { ok: false, reason: `Too many columns (${columnCount}) for the recognized MT5 bar-history shape.` };
  }

  return {
    ok: true,
    delimiter,
    hasHeader,
    dateTimeShape,
    columnCount,
    hasTickVolume: trailingCount >= 1,
    hasVolume: trailingCount >= 2,
    hasSpread: trailingCount >= 3,
  };
}

function parseNumberCell(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses every data row into `Mt5RawCandleRow[]`. A row that doesn't parse
 * as a well-formed number in any OHLC column becomes an `Mt5RowError`
 * (line number + reason) — it never throws and never drops a row silently
 * (Section 12: "do not hide dropped records"). OHLC *validity* (high<low
 * etc.) is checked here too via the SAME `isValidCandle` Stage 21.2 already
 * verified, reused rather than reimplemented — but note this is a
 * PRICE-ONLY shape check (no timestamp yet); full `Candle` validity is
 * re-checked again after timezone conversion in `mt5-normalize.ts`.
 */
export function parseMt5HistoricalData(text: string, detection: Mt5FormatDetection): Mt5ParseResult {
  // One Papa.parse call over the WHOLE text, never one call per line — for
  // a multi-million-row file, per-line parsing would mean millions of
  // separate parser invocations, each with its own overhead (§16).
  const allParsed = Papa.parse<string[]>(text, { delimiter: detection.delimiter, newline: "\n", skipEmptyLines: "greedy" }).data as string[][];
  const dataLines = detection.hasHeader ? allParsed.slice(1) : allParsed;
  const truncated = dataLines.length > MAX_MT5_IMPORT_ROWS;
  const bounded = truncated ? dataLines.slice(0, MAX_MT5_IMPORT_ROWS) : dataLines;

  const rows: Mt5RawCandleRow[] = [];
  const rowErrors: Mt5RowError[] = [];
  const ohlcStartIndex = detection.dateTimeShape === "COMBINED" ? 1 : 2;

  for (let i = 0; i < bounded.length; i += 1) {
    const lineNumber = i + 1;
    const cells = bounded[i].map((c) => (c ?? "").trim().replace(/^["<]|[">]$/g, ""));

    if (cells.length < ohlcStartIndex + 4) {
      rowErrors.push({ lineNumber, message: `Expected at least ${ohlcStartIndex + 4} columns, found ${cells.length}.` });
      continue;
    }

    const rawDate = cells[0];
    const rawTime = detection.dateTimeShape === "SPLIT" ? cells[1] : null;
    const open = parseNumberCell(cells[ohlcStartIndex]);
    const high = parseNumberCell(cells[ohlcStartIndex + 1]);
    const low = parseNumberCell(cells[ohlcStartIndex + 2]);
    const close = parseNumberCell(cells[ohlcStartIndex + 3]);

    if (open == null || high == null || low == null || close == null) {
      rowErrors.push({ lineNumber, message: "Non-numeric OHLC value." });
      continue;
    }
    if (!isValidCandle({ timestamp: 0, open, high, low, close, volume: null })) {
      rowErrors.push({ lineNumber, message: `Invalid OHLC (high<low or high/low inconsistent with open/close): O=${open} H=${high} L=${low} C=${close}` });
      continue;
    }

    let cursor = ohlcStartIndex + 4;
    const tickVolume = detection.hasTickVolume ? parseNumberCell(cells[cursor++]) : null;
    const volume = detection.hasVolume ? parseNumberCell(cells[cursor++]) : null;
    const spread = detection.hasSpread ? parseNumberCell(cells[cursor++]) : null;

    rows.push({ lineNumber, rawDate, rawTime, open, high, low, close, tickVolume, volume, spread });
  }

  return { rows, rowErrors, totalDataLines: bounded.length, truncated };
}

/** Decodes raw upload bytes to text, ready for `detectMt5Format`/
 *  `parseMt5HistoricalData`. Kept as a one-line wrapper so callers never
 *  import the byte-decoding module directly (§17 — one boundary for
 *  "untrusted bytes in, text out"). */
export function decodeMt5UploadBytes(bytes: Uint8Array): string {
  return decodeText(bytes);
}
