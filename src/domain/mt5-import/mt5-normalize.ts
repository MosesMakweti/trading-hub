/**
 * Stage 21.3A §7/§8/§10/§11/§12 — converts `Mt5RawCandleRow[]` (date/time
 * STRINGS, no timezone applied yet) into canonical `Candle[]`, using the
 * EXACT SAME `Candle` type, `isValidCandle`, and `mergeCandles`
 * (ordering + dedup) Stage 21.2 already verified — this file adapts MT5
 * data TO the canonical pipeline, never the other way around (§2).
 *
 * Timezone conversion never guesses: a row is rejected (not silently
 * treated as UTC) when `TimeConvention` is missing entirely — the caller
 * (the preview builder) is responsible for only calling this once a
 * convention has been explicitly chosen (UTC / fixed offset / trader-
 * supplied IANA zone) — see `types.ts`'s `TimeConvention`.
 */
import { fixedOffsetWallClockToUtc, isValidIanaTimeZone, localWallClockToUtc } from "@/lib/timezone";
import { isValidCandle, mergeCandles, type Candle } from "@/domain/market-data/candle";
import type { Mt5NormalizedRowRejection, Mt5RawCandleRow, TimeConvention } from "./types";

const MT_DATE_PATTERN = /^(\d{4})[.\-/](\d{2})[.\-/](\d{2})$/;
const MT_TIME_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
const MT_COMBINED_PATTERN = /^(\d{4})[.\-/](\d{2})[.\-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** The regexes above only check DIGIT COUNT, not calendar validity —
 *  "2024.13.45" matches the shape but isn't a real date. `Date.UTC`
 *  silently normalizes an out-of-range component (month 13 rolls into
 *  next year, hour 25 rolls into the next day) instead of rejecting it,
 *  which would let a genuinely corrupted row masquerade as some other,
 *  unrelated valid instant. Reject explicitly instead. */
function isPlausibleCalendarValue(mo: number, d: number, h: number, mi: number, s: number): boolean {
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h >= 0 && h <= 23 && mi >= 0 && mi <= 59 && s >= 0 && s <= 59;
}

/** Parses `rawDate`(+`rawTime`) into UTC ms under `convention` — the ONE
 *  place a `TimeConvention` is actually applied. Returns null (never
 *  throws) on anything unparseable, so callers can reject the row with a
 *  clear reason rather than crash the whole import. */
export function convertMt5TimestampToUtcMs(rawDate: string, rawTime: string | null, convention: TimeConvention): number | null {
  let y: number, mo: number, d: number, h: number, mi: number, s: number;

  if (rawTime == null) {
    const m = MT_COMBINED_PATTERN.exec(rawDate.trim());
    if (!m) return null;
    y = Number(m[1]);
    mo = Number(m[2]);
    d = Number(m[3]);
    h = Number(m[4]);
    mi = Number(m[5]);
    s = Number(m[6] ?? "0");
  } else {
    const dm = MT_DATE_PATTERN.exec(rawDate.trim());
    const tm = MT_TIME_PATTERN.exec(rawTime.trim());
    if (!dm || !tm) return null;
    y = Number(dm[1]);
    mo = Number(dm[2]);
    d = Number(dm[3]);
    h = Number(tm[1]);
    mi = Number(tm[2]);
    s = Number(tm[3] ?? "0");
  }
  if (!isPlausibleCalendarValue(mo, d, h, mi, s)) return null;

  let ms: number;
  if (convention.kind === "UTC") {
    ms = Date.UTC(y, mo - 1, d, h, mi, s);
  } else if (convention.kind === "FIXED_OFFSET") {
    ms = fixedOffsetWallClockToUtc(y, mo, d, h, mi, s, convention.offsetMinutes).getTime();
  } else {
    if (!isValidIanaTimeZone(convention.zone)) return null;
    ms = localWallClockToUtc(y, mo, d, h, mi, s, convention.zone).getTime();
  }
  return Number.isFinite(ms) ? ms : null;
}

export interface Mt5NormalizeResult {
  candles: Candle[];
  rejections: Mt5NormalizedRowRejection[];
}

/**
 * `sourceVolumeField` (§ this stage's own resolution of Section 11 doc):
 * MT5's TICKVOL (count of price changes) is a poor proxy for real traded
 * volume and its own VOL column is frequently a literal 0 for FX/CFD
 * symbols with no centralized tape — never fabricate a nonzero value.
 * `Candle.volume` is populated ONLY from the real VOL column, and only
 * when it's actually nonzero-capable (i.e. present); TICKVOL is currently
 * discarded rather than mislabeled as volume — a future stage could carry
 * it through as a distinct field if a real use for it emerges.
 */
export function normalizeMt5Candles(rows: Mt5RawCandleRow[], convention: TimeConvention): Mt5NormalizeResult {
  const candles: Candle[] = [];
  const rejections: Mt5NormalizedRowRejection[] = [];

  for (const row of rows) {
    const timestamp = convertMt5TimestampToUtcMs(row.rawDate, row.rawTime, convention);
    if (timestamp == null) {
      rejections.push({ lineNumber: row.lineNumber, reason: `Unparseable date/time: "${row.rawDate}${row.rawTime ? ` ${row.rawTime}` : ""}"` });
      continue;
    }
    const candle: Candle = { timestamp, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume };
    if (!isValidCandle(candle)) {
      rejections.push({ lineNumber: row.lineNumber, reason: "Invalid OHLC after timestamp conversion." });
      continue;
    }
    candles.push(candle);
  }

  // Ascending order + exact-timestamp dedup — reusing Stage 21.2's own
  // merge rule (`mergeCandles([], rows)` is exactly "sort + dedupe one
  // array"), never a second, divergent ordering implementation.
  return { candles: mergeCandles([], candles), rejections };
}
