/**
 * Stage 21.3A — shared types for the MT5 historical-candle importer. Kept
 * in one file (mirrors `domain/prop-firms/import/types.ts`'s own
 * convention) since format detection, parsing, normalization, and preview
 * all pass the same handful of shapes back and forth.
 *
 * SUPPORTED FORMAT (documented explicitly, never silently expanded):
 * MetaTrader 5's "History Center -> Export" bar-history file — one row per
 * bar, columns in this fixed order:
 *
 *   DATE  TIME  OPEN  HIGH  LOW  CLOSE  [TICKVOL]  [VOL]  [SPREAD]
 *
 * - DATE: "YYYY.MM.DD" (also tolerates "-"/"/" as the separator).
 * - TIME: "HH:MM" or "HH:MM:SS" — OR DATE+TIME already combined into one
 *   column ("YYYY.MM.DD HH:MM[:SS]"), which some export tools produce.
 * - Delimiter: tab (MT5's own default) or comma (common when re-saved from
 *   Excel/a spreadsheet tool).
 * - A header row (`<DATE>	<TIME>	<OPEN>	...` or plain `DATE,TIME,OPEN,...`)
 *   is OPTIONAL — MT5's raw "Export" button omits it; some GUI tools add one.
 * - TICKVOL/VOL/SPREAD are optional trailing columns, in that order when
 *   present; VOL (real traded volume) is frequently 0 for FX/CFD symbols
 *   with no centralized volume — never treated as a real 0, see
 *   `mt5-normalize.ts`.
 *
 * NOT (yet) supported: MT4's own export format (subtly different — no
 * SPREAD column, different default separators in some locales), other
 * platforms' bar-history exports, or a file whose column ORDER differs
 * from the above. An unrecognized shape returns `INVALID` rather than
 * guessing — see `mt5-detect.ts`. The detection/parse boundary is
 * deliberately generic enough that an MT4 or cTrader adapter could plug in
 * beside this one later without changing `mt5-normalize.ts` or anything
 * downstream of it.
 */
import type { Timeframe } from "@/domain/market-data/timeframe";

export type Mt5Delimiter = "\t" | ",";

export type Mt5DateTimeShape =
  /** DATE and TIME are separate columns. */
  | "SPLIT"
  /** DATE+TIME already combined into one column. */
  | "COMBINED";

export interface Mt5FormatDetection {
  ok: true;
  delimiter: Mt5Delimiter;
  hasHeader: boolean;
  dateTimeShape: Mt5DateTimeShape;
  /** Column count actually observed in the first data row — used to know
   *  whether TICKVOL/VOL/SPREAD are present, never assumed. */
  columnCount: number;
  hasTickVolume: boolean;
  hasVolume: boolean;
  hasSpread: boolean;
}

export interface Mt5FormatDetectionFailure {
  ok: false;
  reason: string;
}

/** One successfully parsed source row, BEFORE timezone conversion/symbol
 *  resolution/validation — the intermediate representation Section 5 asks
 *  for, kept deliberately separate from the canonical `Candle` shape. */
export interface Mt5RawCandleRow {
  lineNumber: number; // 1-based, counting from the first DATA row (header excluded) — for error messages
  rawDate: string;
  rawTime: string | null; // null when dateTimeShape is COMBINED (rawDate already carries both)
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number | null;
  volume: number | null;
  spread: number | null;
}

export interface Mt5RowError {
  lineNumber: number;
  message: string;
}

export interface Mt5ParseResult {
  rows: Mt5RawCandleRow[];
  rowErrors: Mt5RowError[];
  /** Total data lines seen (excluding a detected header and blank lines) —
   *  `rows.length + rowErrors.length` should always equal this. */
  totalDataLines: number;
  /** True when the file was truncated at `MAX_MT5_IMPORT_ROWS` — see
   *  `mt5-parser.ts`'s own doc comment on the large-file ceiling (§16). */
  truncated: boolean;
}

/** Stage 21.3A §7/§8 — the imported feed's time convention. An explicit,
 *  closed set: never a bare string offset a caller could misinterpret. */
export type TimeConvention =
  | { kind: "UTC" }
  | { kind: "FIXED_OFFSET"; offsetMinutes: number; label?: string }
  | { kind: "IANA_ZONE"; zone: string };

export interface Mt5NormalizedRowRejection {
  lineNumber: number;
  reason: string;
}

export type Mt5ImportAcceptanceState = "READY" | "READY_WITH_WARNINGS" | "NEEDS_USER_INPUT" | "INVALID";

export interface Mt5SymbolResolution {
  sourceSymbol: string;
  canonicalSymbol: string | null;
  /** True when the mapping came from an exact/known-alias/broker-suffix
   *  match in the existing instrument catalog — false (with
   *  `canonicalSymbol: null`) means the trader must confirm one (§10). */
  resolved: boolean;
}

/** Stage 21.3A §14 — the developer/preview-facing summary of one import
 *  attempt, before persistence. Powers the (future, 21.3B) upload UI;
 *  nothing here is rendered by this stage. */
export interface Mt5ImportPreview {
  state: Mt5ImportAcceptanceState;
  /** Human-readable reasons the state isn't READY — empty when it is. */
  issues: string[];
  detection: Mt5FormatDetection | Mt5FormatDetectionFailure;
  symbol: Mt5SymbolResolution;
  nativeTimeframe: Timeframe | null; // null when it couldn't be inferred — NEEDS_USER_INPUT
  timeConvention: TimeConvention | null; // null when unknown — NEEDS_USER_INPUT
  range: { from: number; to: number } | null; // UTC ms, null when zero valid candles
  rowCounts: {
    original: number;
    valid: number;
    rejected: number;
  };
  quality: import("@/domain/market-data/quality-analysis").MarketDataQualityReport | null;
}
