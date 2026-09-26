/**
 * Native Replay — MT5 M1 bar-history parser.
 *
 * Native Replay's own parser (it does not use the Edge Review importer in
 * `domain/mt5-import`). Same supported MT5 export shapes, but built for
 * large M1 files:
 *
 * - One pass over the text with `indexOf`, no per-file split/array-of-arrays
 *   (the Edge Review parser materialises every cell as a string: ~2GB heap
 *   for 4.2M rows).
 * - Columnar typed arrays, sized once from a cheap line count — and the row
 *   ceiling is enforced BEFORE anything is allocated.
 * - Prices parsed as exact decimal mantissas (digits, no float rounding):
 *   "1.07843" → mantissa 107843, 5 fractional digits.
 *
 * SUPPORTED FORMAT (MetaTrader 5 "Export Bars" / History Center export):
 *
 *   DATE  TIME  OPEN  HIGH  LOW  CLOSE  [TICKVOL]  [VOL]  [SPREAD]
 *
 * - DATE "YYYY.MM.DD" (also "-" or "/"), TIME "HH:MM" or "HH:MM:SS"; or one
 *   combined "YYYY.MM.DD HH:MM[:SS]" column.
 * - Tab (MT5's default) or comma delimited.
 * - Optional header row: `<DATE> <TIME> <OPEN> …` (MT5) or plain `DATE,TIME,…`.
 *   With a header, columns are mapped BY NAME; without one, positionally.
 * - TICKVOL / VOL / SPREAD optional (in that order when headerless).
 *
 * The symbol is not in the file: MT5 names exports `SYMBOL_M1_<from>_<to>.csv`,
 * so it is read from the file name when it matches, or supplied by the trader.
 */
import { wallClockMinuteOf } from "./wall-clock";

export type Mt5Delimiter = "\t" | ",";

export interface M1SourceFormat {
  delimiter: Mt5Delimiter;
  hasHeader: boolean;
  dateTimeShape: "SPLIT" | "COMBINED";
  hasTickVolume: boolean;
  hasRealVolume: boolean;
  hasSpread: boolean;
}

export type RowErrorKind = "COLUMNS" | "TIMESTAMP" | "NOT_MINUTE_ALIGNED" | "PRICE" | "VOLUME" | "SPREAD" | "LINE_TOO_LONG";

export interface RowError {
  line: number; // 1-based physical line in the file
  kind: RowErrorKind;
  message: string;
}

/** Parsed rows, columnar, in FILE order (not yet sorted/deduplicated). */
export interface ParsedM1Rows {
  count: number;
  line: Int32Array;
  minute: Int32Array;
  /** Decimal mantissas (exact integers) and their fractional digit counts. */
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  priceDigits: Uint8Array; // max fractional digits across the row's four prices
  openDigits: Uint8Array;
  highDigits: Uint8Array;
  lowDigits: Uint8Array;
  closeDigits: Uint8Array;
  tickVolume: Float64Array | null;
  realVolume: Float64Array | null;
  spread: Float64Array | null;
}

export interface M1ParseResult {
  ok: true;
  format: M1SourceFormat;
  dataLines: number;
  rows: ParsedM1Rows;
  errorCount: number;
  errorCountsByKind: Partial<Record<RowErrorKind, number>>;
  /** First `MAX_REPORTED_ROW_ERRORS` errors, for the import report. */
  errorSamples: RowError[];
}

export interface M1ParseFailure {
  ok: false;
  reason: string;
}

/** ~5 years of continuous M1 for one symbol (≈372k bars/year). Chosen with
 *  the measured import cost (see docs/NATIVE_REPLAY.md): larger histories
 *  should be imported as several datasets. Enforced before allocation. */
export const MAX_M1_ROWS = 2_000_000;
/** An MT5 bar line is ~60 characters; anything this long is not bar data. */
export const MAX_LINE_LENGTH = 512;
export const MAX_REPORTED_ROW_ERRORS = 100;
/** Prices beyond 8 decimals aren't MT5 bar data (and would overflow the
 *  exact integer representation). */
export const MAX_PRICE_DIGITS = 8;

const HEADER_ALIASES: Record<string, "DATE" | "TIME" | "OPEN" | "HIGH" | "LOW" | "CLOSE" | "TICKVOL" | "VOL" | "SPREAD"> = {
  DATE: "DATE", TIME: "TIME", OPEN: "OPEN", HIGH: "HIGH", LOW: "LOW", CLOSE: "CLOSE",
  TICKVOL: "TICKVOL", TICK_VOLUME: "TICKVOL", TICKVOLUME: "TICKVOL",
  VOL: "VOL", VOLUME: "VOL", REAL_VOLUME: "VOL", REALVOLUME: "VOL",
  SPREAD: "SPREAD",
};

function cleanCell(raw: string): string {
  let s = raw.trim();
  if (s.length >= 2 && ((s[0] === "<" && s[s.length - 1] === ">") || (s[0] === '"' && s[s.length - 1] === '"'))) s = s.slice(1, -1).trim();
  return s;
}

/** Iterates physical lines without splitting the whole text. */
function* lines(text: string): Generator<[number, string]> {
  let start = 0;
  let lineNo = 0;
  const n = text.length;
  while (start < n) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = n;
    lineNo += 1;
    let line = text.slice(start, end);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    yield [lineNo, line];
    start = end + 1;
  }
}

function countLines(text: string): number {
  let count = 0;
  let i = -1;
  while ((i = text.indexOf("\n", i + 1)) !== -1) count += 1;
  return count + 1;
}

const DATE_RE = /^(\d{4})[.\-/](\d{2})[.\-/](\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
const COMBINED_RE = /^(\d{4})[.\-/](\d{2})[.\-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

type Column = "DATE" | "TIME" | "OPEN" | "HIGH" | "LOW" | "CLOSE" | "TICKVOL" | "VOL" | "SPREAD";

interface Layout {
  format: M1SourceFormat;
  index: Partial<Record<Column, number>>;
  columnCount: number;
}

/**
 * Detects the format from the first non-empty lines only (the Edge Review
 * detector split the entire file just to read line 1).
 */
export function detectM1Format(text: string): { ok: true; layout: Layout } | M1ParseFailure {
  const sample: string[] = [];
  for (const [, line] of lines(text)) {
    if (line.trim() === "") continue;
    sample.push(line);
    if (sample.length === 2) break;
  }
  if (sample.length === 0) return { ok: false, reason: "The file is empty." };
  const first = sample[0];
  if (first.length > MAX_LINE_LENGTH) return { ok: false, reason: "This doesn't look like an MT5 bar export (the first line is far too long)." };

  const tabs = first.split("\t").length - 1;
  const commas = first.split(",").length - 1;
  if (tabs === 0 && commas === 0) return { ok: false, reason: "Couldn't find a tab or comma delimiter. Export the bars from MT5 as CSV/TXT." };
  const delimiter: Mt5Delimiter = tabs >= commas ? "\t" : ",";
  const firstCells = first.split(delimiter).map(cleanCell);

  const looksLikeData = DATE_RE.test(firstCells[0] ?? "") || COMBINED_RE.test(firstCells[0] ?? "");
  if (!looksLikeData) {
    // Header row — map by name.
    const index: Partial<Record<Column, number>> = {};
    for (let i = 0; i < firstCells.length; i += 1) {
      const key = HEADER_ALIASES[firstCells[i].toUpperCase().replace(/\s+/g, "_")];
      if (!key) return { ok: false, reason: `Unrecognised column "${firstCells[i]}". Expected MT5's DATE, TIME, OPEN, HIGH, LOW, CLOSE, TICKVOL, VOL, SPREAD.` };
      if (index[key] != null) return { ok: false, reason: `Column "${key}" appears twice.` };
      index[key] = i;
    }
    for (const required of ["DATE", "OPEN", "HIGH", "LOW", "CLOSE"] as const) {
      if (index[required] == null) return { ok: false, reason: `Missing the ${required} column.` };
    }
    if (sample.length < 2) return { ok: false, reason: "The file has a header row but no bars." };
    const dataCells = sample[1].split(delimiter).map(cleanCell);
    const dateCell = dataCells[index.DATE!] ?? "";
    let dateTimeShape: "SPLIT" | "COMBINED";
    if (index.TIME != null && DATE_RE.test(dateCell)) dateTimeShape = "SPLIT";
    else if (COMBINED_RE.test(dateCell)) dateTimeShape = "COMBINED";
    else return { ok: false, reason: `Unrecognised date/time in the first bar: "${sample[1].slice(0, 80)}".` };
    return {
      ok: true,
      layout: {
        index,
        columnCount: firstCells.length,
        format: {
          delimiter,
          hasHeader: true,
          dateTimeShape,
          hasTickVolume: index.TICKVOL != null,
          hasRealVolume: index.VOL != null,
          hasSpread: index.SPREAD != null,
        },
      },
    };
  }

  // Headerless — positional.
  let dateTimeShape: "SPLIT" | "COMBINED";
  let ohlcStart: number;
  if (COMBINED_RE.test(firstCells[0])) {
    dateTimeShape = "COMBINED";
    ohlcStart = 1;
  } else if (TIME_RE.test(firstCells[1] ?? "")) {
    dateTimeShape = "SPLIT";
    ohlcStart = 2;
  } else {
    return { ok: false, reason: `Unrecognised date/time in the first bar: "${first.slice(0, 80)}".` };
  }
  const trailing = firstCells.length - ohlcStart - 4;
  if (trailing < 0) return { ok: false, reason: `Expected OPEN, HIGH, LOW and CLOSE after the date/time; found ${firstCells.length} column(s).` };
  if (trailing > 3) return { ok: false, reason: `Too many columns (${firstCells.length}) for an MT5 bar export.` };
  const index: Partial<Record<Column, number>> = { DATE: 0, OPEN: ohlcStart, HIGH: ohlcStart + 1, LOW: ohlcStart + 2, CLOSE: ohlcStart + 3 };
  if (dateTimeShape === "SPLIT") index.TIME = 1;
  if (trailing >= 1) index.TICKVOL = ohlcStart + 4;
  if (trailing >= 2) index.VOL = ohlcStart + 5;
  if (trailing >= 3) index.SPREAD = ohlcStart + 6;
  return {
    ok: true,
    layout: {
      index,
      columnCount: firstCells.length,
      format: { delimiter, hasHeader: false, dateTimeShape, hasTickVolume: trailing >= 1, hasRealVolume: trailing >= 2, hasSpread: trailing >= 3 },
    },
  };
}

/**
 * Strict decimal parse: optional sign, digits, optional fraction. Returns the
 * exact integer mantissa and the fraction's digit count — no floating-point
 * rounding ever touches a price. Rejects exponents, hex, "Infinity", "NaN",
 * thousands separators and empty strings.
 */
export function parseDecimal(s: string): { mantissa: number; digits: number } | null {
  const n = s.length;
  if (n === 0 || n > 24) return null;
  let i = 0;
  let negative = false;
  if (s.charCodeAt(0) === 45 /* - */) {
    negative = true;
    i = 1;
  } else if (s.charCodeAt(0) === 43 /* + */) {
    i = 1;
  }
  let mantissa = 0;
  let digits = 0;
  let seenDigit = false;
  let seenDot = false;
  for (; i < n; i += 1) {
    const c = s.charCodeAt(i);
    if (c >= 48 && c <= 57) {
      mantissa = mantissa * 10 + (c - 48);
      seenDigit = true;
      if (seenDot) digits += 1;
    } else if (c === 46 /* . */ && !seenDot) {
      seenDot = true;
    } else {
      return null;
    }
  }
  if (!seenDigit || !Number.isSafeInteger(mantissa)) return null;
  return { mantissa: negative ? -mantissa : mantissa, digits };
}

function parseTimestamp(dateCell: string, timeCell: string | null): number | "BAD" | "SECONDS" {
  let y: number, mo: number, d: number, h: number, mi: number, sec: number;
  if (timeCell == null) {
    const m = COMBINED_RE.exec(dateCell);
    if (!m) return "BAD";
    [y, mo, d, h, mi, sec] = [+m[1], +m[2], +m[3], +m[4], +m[5], m[6] ? +m[6] : 0];
  } else {
    const dm = DATE_RE.exec(dateCell);
    const tm = TIME_RE.exec(timeCell);
    if (!dm || !tm) return "BAD";
    [y, mo, d, h, mi, sec] = [+dm[1], +dm[2], +dm[3], +tm[1], +tm[2], tm[3] ? +tm[3] : 0];
  }
  if (sec !== 0) return sec > 59 ? "BAD" : "SECONDS";
  const minute = wallClockMinuteOf(y, mo, d, h, mi);
  return minute == null ? "BAD" : minute;
}

export function parseM1Text(text: string, limits: { maxRows?: number } = {}): M1ParseResult | M1ParseFailure {
  const maxRows = limits.maxRows ?? MAX_M1_ROWS;
  const detected = detectM1Format(text);
  if (!detected.ok) return detected;
  const { layout } = detected;
  const { format, index } = layout;

  const physical = countLines(text);
  const capacity = physical - (format.hasHeader ? 1 : 0);
  // Checked before anything is allocated (+1: a trailing newline).
  if (capacity > maxRows + 1) {
    return { ok: false, reason: `The file has about ${capacity.toLocaleString("en-US")} lines; the limit is ${maxRows.toLocaleString("en-US")} M1 bars (about 5 years) per dataset. Split it into several exports.` };
  }

  const rows: ParsedM1Rows = {
    count: 0,
    line: new Int32Array(capacity),
    minute: new Int32Array(capacity),
    open: new Float64Array(capacity),
    high: new Float64Array(capacity),
    low: new Float64Array(capacity),
    close: new Float64Array(capacity),
    priceDigits: new Uint8Array(capacity),
    openDigits: new Uint8Array(capacity),
    highDigits: new Uint8Array(capacity),
    lowDigits: new Uint8Array(capacity),
    closeDigits: new Uint8Array(capacity),
    tickVolume: format.hasTickVolume ? new Float64Array(capacity) : null,
    realVolume: format.hasRealVolume ? new Float64Array(capacity) : null,
    spread: format.hasSpread ? new Float64Array(capacity) : null,
  };

  const errorSamples: RowError[] = [];
  const errorCountsByKind: Partial<Record<RowErrorKind, number>> = {};
  let errorCount = 0;
  let dataLines = 0;
  const fail = (line: number, kind: RowErrorKind, message: string) => {
    errorCount += 1;
    errorCountsByKind[kind] = (errorCountsByKind[kind] ?? 0) + 1;
    if (errorSamples.length < MAX_REPORTED_ROW_ERRORS) errorSamples.push({ line, kind, message });
  };

  const iDate = index.DATE!;
  const iTime = format.dateTimeShape === "SPLIT" ? index.TIME! : -1;
  const priceIdx = [index.OPEN!, index.HIGH!, index.LOW!, index.CLOSE!];
  const priceCols = [rows.open, rows.high, rows.low, rows.close];
  const digitCols = [rows.openDigits, rows.highDigits, rows.lowDigits, rows.closeDigits];
  const minColumns = Math.max(...Object.values(index).map((v) => v as number)) + 1;
  let headerSkipped = !format.hasHeader;

  for (const [lineNo, rawLine] of lines(text)) {
    if (rawLine.trim() === "") continue;
    if (!headerSkipped) {
      headerSkipped = true;
      continue;
    }
    dataLines += 1;
    if (rawLine.length > MAX_LINE_LENGTH) {
      fail(lineNo, "LINE_TOO_LONG", `Line is longer than ${MAX_LINE_LENGTH} characters.`);
      continue;
    }
    const cells = rawLine.split(format.delimiter);
    if (cells.length < minColumns || cells.length > layout.columnCount + 1) {
      fail(lineNo, "COLUMNS", `Expected ${layout.columnCount} columns, found ${cells.length}.`);
      continue;
    }

    const ts = parseTimestamp(cleanCell(cells[iDate]), iTime >= 0 ? cleanCell(cells[iTime]) : null);
    if (ts === "BAD") {
      fail(lineNo, "TIMESTAMP", `Invalid date/time "${cleanCell(cells[iDate])}${iTime >= 0 ? ` ${cleanCell(cells[iTime])}` : ""}".`);
      continue;
    }
    if (ts === "SECONDS") {
      fail(lineNo, "NOT_MINUTE_ALIGNED", "Timestamp has seconds — M1 bars open on the minute.");
      continue;
    }

    const r = rows.count;
    let priceOk = true;
    let maxDigits = 0;
    for (let k = 0; k < 4; k += 1) {
      const p = parseDecimal(cleanCell(cells[priceIdx[k]]));
      if (!p || p.mantissa <= 0 || p.digits > MAX_PRICE_DIGITS) {
        priceOk = false;
        break;
      }
      priceCols[k][r] = p.mantissa;
      digitCols[k][r] = p.digits;
      if (p.digits > maxDigits) maxDigits = p.digits;
    }
    if (!priceOk) {
      fail(lineNo, "PRICE", `Invalid price in "${rawLine.slice(0, 120)}" (prices must be positive decimals).`);
      continue;
    }

    if (rows.tickVolume) {
      const v = parseDecimal(cleanCell(cells[index.TICKVOL!]));
      if (!v || v.digits !== 0 || v.mantissa < 0) {
        fail(lineNo, "VOLUME", "Tick volume must be a non-negative whole number.");
        continue;
      }
      rows.tickVolume[r] = v.mantissa;
    }
    if (rows.realVolume) {
      const v = parseDecimal(cleanCell(cells[index.VOL!]));
      if (!v || v.mantissa < 0) {
        fail(lineNo, "VOLUME", "Volume must be a non-negative number.");
        continue;
      }
      rows.realVolume[r] = v.mantissa / 10 ** v.digits;
    }
    if (rows.spread) {
      const v = parseDecimal(cleanCell(cells[index.SPREAD!]));
      if (!v || v.digits !== 0 || v.mantissa < 0) {
        fail(lineNo, "SPREAD", "Spread must be a non-negative whole number of points.");
        continue;
      }
      rows.spread[r] = v.mantissa;
    }

    rows.line[r] = lineNo;
    rows.minute[r] = ts;
    rows.priceDigits[r] = maxDigits;
    rows.count = r + 1;
  }

  if (dataLines === 0) return { ok: false, reason: "The file has no bars." };
  return { ok: true, format, dataLines, rows, errorCount, errorCountsByKind, errorSamples };
}

const MT5_FILE_NAME = /^([A-Za-z0-9#._\-!]+?)_(M\d+|H\d+|D1|W1|MN1?)_\d{8,12}_\d{8,12}\.(csv|txt)$/i;

/** MT5's default export name is `SYMBOL_TIMEFRAME_<from>_<to>.csv`. */
export function readMt5FileName(fileName: string): { symbol: string; timeframe: string } | null {
  const m = MT5_FILE_NAME.exec(fileName.trim().split(/[\\/]/).pop() ?? "");
  return m ? { symbol: m[1], timeframe: m[2].toUpperCase() } : null;
}
