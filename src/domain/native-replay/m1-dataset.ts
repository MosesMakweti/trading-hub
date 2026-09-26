/**
 * Native Replay — validation and normalisation of parsed MT5 rows into
 * canonical M1 bars, plus the import report.
 *
 * Canonical bars are columnar, strictly ascending, unique per minute, with
 * prices as exact integers at the dataset's `priceScale` (price × 10^scale —
 * MT5's own "points" representation): 1.07843 at scale 5 is 107843, 2357.42
 * at scale 2 is 235742. No binary floating point ever holds a canonical price.
 *
 * Decisions (see docs/NATIVE_REPLAY.md):
 * - Any invalid row blocks the import (listed with line numbers) — the
 *   source of truth is never silently thinned.
 * - Rows out of order are sorted (their order carries no information) and
 *   reported.
 * - Duplicate timestamps with IDENTICAL values are collapsed and counted
 *   (overlapping exports concatenated); duplicates that DISAGREE block the
 *   import — there is no justified way to pick one.
 * - Gaps are reported and classified, never filled: no synthetic bars.
 */
import type { M1ParseResult, M1SourceFormat, RowError, RowErrorKind } from "./mt5-m1-parser";
import { formatWallClock, MINUTES_PER_DAY, weekdayOf, type WallClockMinute } from "./wall-clock";

/** Canonical M1 bars (ascending, unique minutes). */
export interface CanonicalM1Bars {
  count: number;
  minute: Int32Array;
  open: Int32Array;
  high: Int32Array;
  low: Int32Array;
  close: Int32Array;
  tickVolume: Int32Array | null;
  realVolume: Float64Array | null;
  spread: Int32Array | null;
}

export type GapKind = "WEEKEND" | "SHORT" | "RECURRING_DAILY" | "INTRADAY" | "MULTI_DAY";

export interface GapSummary {
  from: string; // first missing minute (wall clock)
  to: string; // last missing minute
  minutes: number;
  kind: GapKind;
}

export type ValidationIssueKind = RowErrorKind | "OHLC" | "PRICE_RANGE" | "CONFLICTING_DUPLICATE";

export interface ImportRowIssue {
  line: number;
  kind: ValidationIssueKind;
  message: string;
}

export type ImportState = "VALID" | "VALID_WITH_WARNINGS" | "INVALID";

/** JSON-serialisable import report — the preview, and what's persisted on the dataset. */
export interface HistoricalImportReport {
  state: ImportState;
  /** Blocking problems. Non-empty ⇔ state INVALID. */
  errors: string[];
  /** Non-blocking findings the trader should know about. */
  warnings: string[];
  reviewRecommended: boolean;
  source: "MT5";
  baseTimeframe: "M1";
  format: M1SourceFormat | null;
  symbol: { sourceSymbol: string | null; symbol: string | null; origin: "USER" | "FILE_NAME" | null };
  timeBasis: { basis: "BROKER_SERVER"; utcOffsetMinutes: null };
  priceScale: number | null;
  range: { firstBar: string; lastBar: string } | null;
  counts: {
    dataLines: number;
    bars: number;
    invalidRows: number;
    outOfOrderRows: number;
    exactDuplicatesCollapsed: number;
    conflictingDuplicates: number;
    invalidOhlc: number;
  };
  rowIssues: { total: number; byKind: Partial<Record<ValidationIssueKind, number>>; samples: ImportRowIssue[] };
  gaps: {
    total: number;
    missingMinutes: number;
    byKind: Record<GapKind, number>;
    /** Largest non-SHORT gaps, biggest first (capped). */
    largest: GapSummary[];
  };
  volume: { hasTickVolume: boolean; hasRealVolume: boolean; realVolumeAllZero: boolean; hasSpread: boolean };
  m1Spacing: { oneMinuteSteps: number; smallestStepMinutes: number | null };
}

const INT32_MAX = 2_147_483_647;
const SHORT_GAP_MAX_MINUTES = 5;
const RECURRING_MIN_DAYS = 3;
const MAX_REPORTED_GAPS = 20;
const MAX_ISSUE_SAMPLES = 100;

export interface BuildResult {
  bars: CanonicalM1Bars | null;
  priceScale: number | null;
  counts: HistoricalImportReport["counts"];
  rowIssues: HistoricalImportReport["rowIssues"];
  gaps: HistoricalImportReport["gaps"];
  volume: HistoricalImportReport["volume"];
  m1Spacing: HistoricalImportReport["m1Spacing"];
  errors: string[];
  warnings: string[];
}

function emptyGaps(): HistoricalImportReport["gaps"] {
  return { total: 0, missingMinutes: 0, byKind: { WEEKEND: 0, SHORT: 0, RECURRING_DAILY: 0, INTRADAY: 0, MULTI_DAY: 0 }, largest: [] };
}

/** True when [from, to] contains a Saturday 12:00 on the wall clock — i.e.
 *  the gap spans a weekend closure. */
function spansSaturday(from: WallClockMinute, to: WallClockMinute): boolean {
  for (let day = Math.floor(from / MINUTES_PER_DAY); day <= Math.floor(to / MINUTES_PER_DAY); day += 1) {
    const noon = day * MINUTES_PER_DAY + 720;
    if (weekdayOf(noon) === 6 && noon >= from && noon <= to) return true;
  }
  return false;
}

export function analyzeGaps(minute: Int32Array, count: number): HistoricalImportReport["gaps"] {
  const gaps = emptyGaps();
  type Raw = { from: number; to: number; minutes: number; kind: GapKind | null; key: string };
  const all: Raw[] = [];
  const recurring = new Map<string, Set<number>>();
  for (let i = 1; i < count; i += 1) {
    const delta = minute[i] - minute[i - 1];
    if (delta <= 1) continue;
    const from = minute[i - 1] + 1;
    const to = minute[i] - 1;
    const minutes = delta - 1;
    let kind: GapKind | null = null;
    if (minutes <= SHORT_GAP_MAX_MINUTES) kind = "SHORT";
    else if (spansSaturday(from, to)) kind = "WEEKEND";
    else if (minutes >= MINUTES_PER_DAY) kind = "MULTI_DAY";
    const key = `${from % MINUTES_PER_DAY}-${to % MINUTES_PER_DAY}`;
    if (kind == null) {
      const days = recurring.get(key) ?? new Set<number>();
      days.add(Math.floor(from / MINUTES_PER_DAY));
      recurring.set(key, days);
    }
    all.push({ from, to, minutes, kind, key });
  }
  for (const g of all) {
    if (g.kind == null) g.kind = (recurring.get(g.key)?.size ?? 0) >= RECURRING_MIN_DAYS ? "RECURRING_DAILY" : "INTRADAY";
    gaps.total += 1;
    gaps.missingMinutes += g.minutes;
    gaps.byKind[g.kind] += 1;
  }
  gaps.largest = all
    .filter((g) => g.kind !== "SHORT")
    .sort((a, b) => b.minutes - a.minutes || a.from - b.from)
    .slice(0, MAX_REPORTED_GAPS)
    .map((g) => ({ from: formatWallClock(g.from), to: formatWallClock(g.to), minutes: g.minutes, kind: g.kind! }));
  return gaps;
}

function timeframeName(minutes: number): string {
  if (minutes % 1440 === 0) return `D${minutes / 1440}`;
  if (minutes % 60 === 0) return `H${minutes / 60}`;
  return `M${minutes}`;
}

export function buildCanonicalM1(parsed: M1ParseResult): BuildResult {
  const { rows } = parsed;
  const n = rows.count;
  const errors: string[] = [];
  const warnings: string[] = [];
  const issueSamples: ImportRowIssue[] = parsed.errorSamples.map((e: RowError) => ({ line: e.line, kind: e.kind, message: e.message }));
  const issueByKind: Partial<Record<ValidationIssueKind, number>> = { ...parsed.errorCountsByKind };
  let issueTotal = parsed.errorCount;
  const issue = (line: number, kind: ValidationIssueKind, message: string) => {
    issueTotal += 1;
    issueByKind[kind] = (issueByKind[kind] ?? 0) + 1;
    if (issueSamples.length < MAX_ISSUE_SAMPLES) issueSamples.push({ line, kind, message });
  };

  // 1. Price scale = the most fractional digits the file uses.
  let priceScale = 0;
  for (let i = 0; i < n; i += 1) if (rows.priceDigits[i] > priceScale) priceScale = rows.priceDigits[i];

  // 2. Exact integer prices at that scale; 3. OHLC relationships.
  const open = new Int32Array(n), high = new Int32Array(n), low = new Int32Array(n), close = new Int32Array(n);
  const valid = new Uint8Array(n);
  let invalidOhlc = 0;
  const scaleCol = (mantissa: Float64Array, digits: Uint8Array, i: number) => mantissa[i] * 10 ** (priceScale - digits[i]);
  for (let i = 0; i < n; i += 1) {
    const o = scaleCol(rows.open, rows.openDigits, i);
    const h = scaleCol(rows.high, rows.highDigits, i);
    const l = scaleCol(rows.low, rows.lowDigits, i);
    const c = scaleCol(rows.close, rows.closeDigits, i);
    if (h > INT32_MAX) {
      issue(rows.line[i], "PRICE_RANGE", `Price too large for ${priceScale}-decimal precision.`);
      continue;
    }
    if (!(h >= o && h >= c && h >= l && l <= o && l <= c)) {
      invalidOhlc += 1;
      const s = 10 ** priceScale;
      issue(rows.line[i], "OHLC", `Invalid OHLC: O=${o / s} H=${h / s} L=${l / s} C=${c / s} (high must be ≥ open, close, low; low ≤ open, close).`);
      continue;
    }
    open[i] = o; high[i] = h; low[i] = l; close[i] = c;
    valid[i] = 1;
  }

  // 4. Order (stable by file line).
  let outOfOrderRows = 0;
  let runningMax = -Infinity;
  const order: number[] = [];
  for (let i = 0; i < n; i += 1) {
    if (!valid[i]) continue;
    if (rows.minute[i] < runningMax) outOfOrderRows += 1;
    else runningMax = rows.minute[i];
    order.push(i);
  }
  if (outOfOrderRows > 0) order.sort((a, b) => rows.minute[a] - rows.minute[b] || rows.line[a] - rows.line[b]);

  // 5. Duplicates.
  const sameValues = (a: number, b: number) =>
    open[a] === open[b] && high[a] === high[b] && low[a] === low[b] && close[a] === close[b] &&
    (rows.tickVolume == null || rows.tickVolume[a] === rows.tickVolume[b]) &&
    (rows.realVolume == null || rows.realVolume[a] === rows.realVolume[b]) &&
    (rows.spread == null || rows.spread[a] === rows.spread[b]);
  let exactDuplicates = 0;
  let conflictingDuplicates = 0;
  const kept: number[] = [];
  for (const i of order) {
    const prev = kept.length ? kept[kept.length - 1] : -1;
    if (prev >= 0 && rows.minute[prev] === rows.minute[i]) {
      if (sameValues(prev, i)) exactDuplicates += 1;
      else {
        conflictingDuplicates += 1;
        issue(rows.line[i], "CONFLICTING_DUPLICATE", `Two different bars for ${formatWallClock(rows.minute[i])} (lines ${rows.line[prev]} and ${rows.line[i]}).`);
      }
      continue;
    }
    kept.push(i);
  }

  // 6. Canonical columns.
  const count = kept.length;
  let realVolumeNonZero = false;
  if (rows.realVolume) for (const i of kept) if (rows.realVolume[i] !== 0) { realVolumeNonZero = true; break; }
  const bars: CanonicalM1Bars = {
    count,
    minute: new Int32Array(count),
    open: new Int32Array(count),
    high: new Int32Array(count),
    low: new Int32Array(count),
    close: new Int32Array(count),
    tickVolume: rows.tickVolume ? new Int32Array(count) : null,
    realVolume: rows.realVolume && realVolumeNonZero ? new Float64Array(count) : null,
    spread: rows.spread ? new Int32Array(count) : null,
  };
  for (let k = 0; k < count; k += 1) {
    const i = kept[k];
    bars.minute[k] = rows.minute[i];
    bars.open[k] = open[i];
    bars.high[k] = high[i];
    bars.low[k] = low[i];
    bars.close[k] = close[i];
    if (bars.tickVolume) bars.tickVolume[k] = Math.min(rows.tickVolume![i], INT32_MAX);
    if (bars.realVolume) bars.realVolume[k] = rows.realVolume![i];
    if (bars.spread) bars.spread[k] = Math.min(rows.spread![i], INT32_MAX);
  }

  // 7. M1 spacing.
  let oneMinuteSteps = 0;
  let smallestStep: number | null = null;
  for (let k = 1; k < count; k += 1) {
    const d = bars.minute[k] - bars.minute[k - 1];
    if (d === 1) oneMinuteSteps += 1;
    if (smallestStep == null || d < smallestStep) smallestStep = d;
  }
  const gaps = analyzeGaps(bars.minute, count);

  // Verdicts.
  if (issueTotal > 0) {
    errors.push(`${issueTotal.toLocaleString("en-US")} invalid row${issueTotal === 1 ? "" : "s"} — fix or re-export the file (nothing is imported while any row is invalid).`);
  }
  if (count === 0) errors.push("No valid bars.");
  if (count >= 3 && oneMinuteSteps === 0 && smallestStep != null) {
    errors.push(`This looks like ${timeframeName(smallestStep)} data, not M1 — no two bars are one minute apart. Native Replay builds every timeframe from M1; export M1 bars.`);
  } else if (count >= 3 && oneMinuteSteps / (count - 1) < 0.5) {
    warnings.push("Fewer than half of consecutive bars are one minute apart — sparse M1 data (an illiquid symbol or incomplete export).");
  }
  if (outOfOrderRows > 0) warnings.push(`${outOfOrderRows.toLocaleString("en-US")} row${outOfOrderRows === 1 ? " was" : "s were"} out of chronological order and have been sorted.`);
  if (exactDuplicates > 0) warnings.push(`${exactDuplicates.toLocaleString("en-US")} exact duplicate bar${exactDuplicates === 1 ? "" : "s"} (identical values) collapsed to one.`);
  const unexplained = gaps.byKind.INTRADAY + gaps.byKind.MULTI_DAY;
  if (unexplained > 0) {
    warnings.push(`${unexplained.toLocaleString("en-US")} gap${unexplained === 1 ? "" : "s"} not explained by weekends, no-tick minutes or a recurring daily break — holidays, broker pauses or missing data. Review recommended; no bars are invented.`);
  }
  // An all-zero VOL column (normal for FX/CFD) is reported via
  // `volume.realVolumeAllZero`, not as a warning — it isn't a data problem.

  return {
    bars: count > 0 ? bars : null,
    priceScale: count > 0 ? priceScale : null,
    counts: {
      dataLines: parsed.dataLines,
      bars: count,
      invalidRows: issueTotal - conflictingDuplicates,
      outOfOrderRows,
      exactDuplicatesCollapsed: exactDuplicates,
      conflictingDuplicates,
      invalidOhlc,
    },
    rowIssues: { total: issueTotal, byKind: issueByKind, samples: issueSamples.sort((a, b) => a.line - b.line) },
    gaps,
    volume: {
      hasTickVolume: bars.tickVolume != null,
      hasRealVolume: bars.realVolume != null,
      realVolumeAllZero: rows.realVolume != null && !realVolumeNonZero,
      hasSpread: bars.spread != null,
    },
    m1Spacing: { oneMinuteSteps, smallestStepMinutes: smallestStep },
    errors,
    warnings,
  };
}

export { emptyGaps };
