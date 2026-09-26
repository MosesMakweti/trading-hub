/**
 * Native Replay — the whole pure import pipeline:
 *
 *   text → parse (mt5-m1-parser) → validate/normalise (m1-dataset) → report
 *
 * Used identically by the preview (nothing persisted) and by the import
 * (which re-runs it server-side — a preview is never trusted).
 */
import { parseSymbol } from "@/domain/trade-plan/instrument-catalog";

import { buildCanonicalM1, emptyGaps, type CanonicalM1Bars, type HistoricalImportReport } from "./m1-dataset";
import { parseM1Text, readMt5FileName } from "./mt5-m1-parser";
import { formatWallClock } from "./wall-clock";

const SYMBOL_PATTERN = /^[A-Za-z0-9#._\-!]{1,32}$/;

export interface SymbolResolution {
  sourceSymbol: string | null;
  symbol: string | null;
  origin: "USER" | "FILE_NAME" | null;
}

/**
 * The broker's symbol is kept verbatim as `sourceSymbol` ("EURUSD.a",
 * "XAUUSDm", "GOLD"); `symbol` is the normalised identity — the instrument
 * catalog's canonical symbol when it recognises the broker name (suffixes,
 * known aliases), otherwise the source symbol upper-cased. Nothing is lost:
 * the source name is always recoverable.
 */
/** The normalised identity for any symbol spelling ("EURUSD.a" → "EURUSD").
 *  Used for both dataset symbols and Backtest Run assets so they compare alike. */
export function normalizeSymbol(raw: string): string {
  const parsed = parseSymbol(raw);
  return parsed.spec?.canonicalSymbol ?? parsed.cleanedSymbol;
}

export function resolveDatasetSymbol(fileName: string | null, override: string | null | undefined): SymbolResolution {
  const fromUser = override?.trim() || null;
  const fromFile = fileName ? readMt5FileName(fileName)?.symbol ?? null : null;
  const sourceSymbol = fromUser ?? fromFile;
  if (!sourceSymbol || !SYMBOL_PATTERN.test(sourceSymbol)) return { sourceSymbol: null, symbol: null, origin: null };
  return { sourceSymbol, symbol: normalizeSymbol(sourceSymbol), origin: fromUser ? "USER" : "FILE_NAME" };
}

export interface ImportAnalysis {
  report: HistoricalImportReport;
  /** Present only when the report is not INVALID. */
  bars: CanonicalM1Bars | null;
}

export function analyzeMt5M1Import(input: { text: string; fileName: string | null; symbolOverride?: string | null }): ImportAnalysis {
  const symbol = resolveDatasetSymbol(input.fileName, input.symbolOverride);
  const nameInfo = input.fileName ? readMt5FileName(input.fileName) : null;
  const base: Omit<HistoricalImportReport, "state" | "errors" | "warnings" | "reviewRecommended"> = {
    source: "MT5",
    baseTimeframe: "M1",
    format: null,
    symbol,
    timeBasis: { basis: "BROKER_SERVER", utcOffsetMinutes: null },
    priceScale: null,
    range: null,
    counts: { dataLines: 0, bars: 0, invalidRows: 0, outOfOrderRows: 0, exactDuplicatesCollapsed: 0, conflictingDuplicates: 0, invalidOhlc: 0 },
    rowIssues: { total: 0, byKind: {}, samples: [] },
    gaps: emptyGaps(),
    volume: { hasTickVolume: false, hasRealVolume: false, realVolumeAllZero: false, hasSpread: false },
    m1Spacing: { oneMinuteSteps: 0, smallestStepMinutes: null },
  };

  const parsed = parseM1Text(input.text);
  if (!parsed.ok) {
    return { report: { ...base, state: "INVALID", errors: [parsed.reason], warnings: [], reviewRecommended: false }, bars: null };
  }

  const built = buildCanonicalM1(parsed);
  const errors = [...built.errors];
  const warnings = [...built.warnings];
  if (!symbol.symbol) errors.push("Symbol unknown — enter it (MT5 export file names normally start with it, e.g. EURUSD_M1_…).");
  if (nameInfo && nameInfo.timeframe !== "M1") warnings.push(`The file name says ${nameInfo.timeframe}; the data itself was checked for M1 spacing.`);

  const bars = built.bars;
  const report: HistoricalImportReport = {
    ...base,
    format: parsed.format,
    priceScale: built.priceScale,
    range: bars ? { firstBar: formatWallClock(bars.minute[0]), lastBar: formatWallClock(bars.minute[bars.count - 1]) } : null,
    counts: built.counts,
    rowIssues: built.rowIssues,
    gaps: built.gaps,
    volume: built.volume,
    m1Spacing: built.m1Spacing,
    state: errors.length > 0 ? "INVALID" : warnings.length > 0 ? "VALID_WITH_WARNINGS" : "VALID",
    errors,
    warnings,
    reviewRecommended: built.gaps.byKind.INTRADAY + built.gaps.byKind.MULTI_DAY > 0,
  };
  return { report, bars: errors.length > 0 ? null : bars };
}
