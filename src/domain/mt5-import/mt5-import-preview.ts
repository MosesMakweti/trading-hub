/**
 * Stage 21.3A §14/§15 — composes detection -> parse -> symbol resolution ->
 * normalization -> quality analysis into one `Mt5ImportPreview`, and
 * derives the deterministic acceptance state. This is the ONLY place that
 * decides READY / READY_WITH_WARNINGS / NEEDS_USER_INPUT / INVALID — never
 * duplicated at the persistence layer.
 */
import { parseSymbol } from "@/domain/trade-plan/instrument-catalog";
import { analyzeMarketDataQuality } from "@/domain/market-data/quality-analysis";
import { TIMEFRAMES, type Timeframe } from "@/domain/market-data/timeframe";
import { detectMt5Format, parseMt5HistoricalData } from "./mt5-parser";
import { normalizeMt5Candles } from "./mt5-normalize";
import type { Mt5ImportPreview, Mt5SymbolResolution, TimeConvention } from "./types";

/** Resolves a source symbol (possibly broker-suffixed, e.g. "XAUUSD.a",
 *  "EURUSDm") using the EXISTING instrument catalog — §10 asks for exactly
 *  this reuse, never a second symbol-mapping table. */
export function resolveMt5Symbol(sourceSymbol: string): Mt5SymbolResolution {
  const parsed = parseSymbol(sourceSymbol);
  return { sourceSymbol, canonicalSymbol: parsed.spec?.canonicalSymbol ?? null, resolved: parsed.spec != null };
}

/** A native MT5 timeframe hint (from a filename or trader selection, e.g.
 *  "M1", "M5", "H1") mapped to Traditorium's own canonical `Timeframe`
 *  vocabulary — never accepted as a raw MT5 string past this boundary. */
const MT5_TIMEFRAME_ALIASES: Record<string, Timeframe> = {
  M1: "1m",
  M5: "5m",
  M15: "15m",
  M30: "30m",
  H1: "1h",
  H4: "4h",
  D1: "1D",
};

export function resolveMt5Timeframe(hint: string | null): Timeframe | null {
  if (!hint) return null;
  const upper = hint.trim().toUpperCase();
  if (MT5_TIMEFRAME_ALIASES[upper]) return MT5_TIMEFRAME_ALIASES[upper];
  return (TIMEFRAMES as readonly string[]).includes(hint) ? (hint as Timeframe) : null;
}

export interface BuildMt5ImportPreviewParams {
  text: string;
  sourceSymbol: string | null;
  /** e.g. "M1", or an already-canonical "1m" — see `resolveMt5Timeframe`. */
  timeframeHint: string | null;
  /** Null when the trader hasn't confirmed a time convention yet — the
   *  preview will come back NEEDS_USER_INPUT rather than guess UTC (§7). */
  timeConvention: TimeConvention | null;
}

/**
 * §4 — Preferred is M1 (`resolveMt5Timeframe` maps it exactly); a non-M1
 * native resolution is still accepted ("supported with limitations") but
 * this function never claims a coarser file contains M1 granularity — the
 * `nativeTimeframe` on the resulting preview/import IS the file's own
 * resolution, and downstream aggregation to a FINER timeframe is simply
 * never offered for it (the Replay pipeline can only aggregate UP, never
 * synthesize DOWN — unchanged Stage 21.2 architecture).
 */
export function buildMt5ImportPreview(params: BuildMt5ImportPreviewParams): Mt5ImportPreview {
  const detection = detectMt5Format(params.text);
  const symbol = params.sourceSymbol ? resolveMt5Symbol(params.sourceSymbol) : { sourceSymbol: "", canonicalSymbol: null, resolved: false };
  const nativeTimeframe = resolveMt5Timeframe(params.timeframeHint);

  const issues: string[] = [];
  if (!detection.ok) {
    return { state: "INVALID", issues: [detection.reason], detection, symbol, nativeTimeframe, timeConvention: params.timeConvention, range: null, rowCounts: { original: 0, valid: 0, rejected: 0 }, quality: null };
  }
  if (!symbol.resolved) issues.push(`Symbol "${symbol.sourceSymbol}" could not be mapped to a known instrument — trader confirmation required.`);
  if (!nativeTimeframe) issues.push("Native timeframe could not be determined — trader confirmation required.");
  if (!params.timeConvention) issues.push("Source timezone/session convention is unknown — trader confirmation required before import.");

  const parsed = parseMt5HistoricalData(params.text, detection);
  if (parsed.truncated) issues.push(`File exceeds the supported row ceiling — only the first ${parsed.rows.length + parsed.rowErrors.length} rows were processed.`);

  // Cannot normalize (timestamps need a convention) without one — report
  // everything else already known and stop at NEEDS_USER_INPUT rather than
  // guessing UTC to "finish" the preview.
  if (!params.timeConvention) {
    return {
      state: "NEEDS_USER_INPUT",
      issues,
      detection,
      symbol,
      nativeTimeframe,
      timeConvention: null,
      range: null,
      rowCounts: { original: parsed.totalDataLines, valid: 0, rejected: parsed.rowErrors.length },
      quality: null,
    };
  }

  const normalized = normalizeMt5Candles(parsed.rows, params.timeConvention);
  const totalRejected = parsed.rowErrors.length + normalized.rejections.length;
  const range = normalized.candles.length > 0 ? { from: normalized.candles[0].timestamp, to: normalized.candles[normalized.candles.length - 1].timestamp } : null;

  const quality = range && nativeTimeframe ? analyzeMarketDataQuality(normalized.candles, nativeTimeframe, range.from, range.to) : null;
  if (quality && quality.longestUnexpectedGapIntervals > 0) issues.push(`${quality.missingIntervals.filter((g) => g.classification === "UNEXPECTED").length} unexpected gap(s) found (longest: ${quality.longestUnexpectedGapIntervals} interval(s)).`);
  if (quality && quality.invalidCandleCount > 0) issues.push(`${quality.invalidCandleCount} invalid row(s) rejected.`);
  if (totalRejected > 0 && !(quality && quality.invalidCandleCount > 0)) issues.push(`${totalRejected} row(s) could not be parsed/normalized.`);

  let state: Mt5ImportPreview["state"];
  if (!symbol.resolved || !nativeTimeframe) {
    state = "NEEDS_USER_INPUT";
  } else if (normalized.candles.length === 0) {
    state = "INVALID";
    issues.push("No valid candles could be produced from this file.");
  } else if (issues.length > 0) {
    state = "READY_WITH_WARNINGS";
  } else {
    state = "READY";
  }

  return {
    state,
    issues,
    detection,
    symbol,
    nativeTimeframe,
    timeConvention: params.timeConvention,
    range,
    rowCounts: { original: parsed.totalDataLines, valid: normalized.candles.length, rejected: totalRejected },
    quality,
  };
}
