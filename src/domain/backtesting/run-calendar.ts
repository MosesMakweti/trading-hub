/**
 * Backtesting (Stage 1) — the pure calendar of a Backtest Run: which
 * historical dates belong to it, which of those count as trading days, and
 * how far through them the trader has progressed. Framework-free and
 * UTC-only, operating on "YYYY-MM-DD" keys exactly like lib/date.ts, so a
 * server's local timezone can never shift a simulated date by one.
 *
 * A run's trading days are the dates in [startDate, endDate] whose UTC
 * weekday is in `tradingWeekdays` (default Mon–Fri). Weekends/non-trading
 * days never count toward progress, but the trader may still deliberately
 * open one (e.g. a Sunday futures open) — `isTradingDay` is for progress and
 * navigation defaults, not a hard gate.
 */
import { addDaysToKey, dateKeyToUtcDate, isValidDateKey } from "@/lib/date";

export const DEFAULT_TRADING_WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5];

/** Hard ceiling on a run's length — keeps calendar enumeration bounded. */
export const MAX_RUN_LENGTH_DAYS = 366 * 5;

export interface RunPeriod {
  startDateKey: string;
  endDateKey: string;
  tradingWeekdays: readonly number[];
}

export function weekdayOfKey(dateKey: string): number {
  return dateKeyToUtcDate(dateKey).getUTCDay();
}

export function isWithinRun(period: Pick<RunPeriod, "startDateKey" | "endDateKey">, dateKey: string): boolean {
  return isValidDateKey(dateKey) && dateKey >= period.startDateKey && dateKey <= period.endDateKey;
}

export function isTradingDay(period: Pick<RunPeriod, "tradingWeekdays">, dateKey: string): boolean {
  return period.tradingWeekdays.includes(weekdayOfKey(dateKey));
}

export function daysBetweenInclusive(startDateKey: string, endDateKey: string): number {
  const ms = dateKeyToUtcDate(endDateKey).getTime() - dateKeyToUtcDate(startDateKey).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/** Every trading-day key in the run, ascending. */
export function listTradingDayKeys(period: RunPeriod): string[] {
  const keys: string[] = [];
  const length = Math.min(daysBetweenInclusive(period.startDateKey, period.endDateKey), MAX_RUN_LENGTH_DAYS);
  for (let i = 0; i < length; i++) {
    const key = addDaysToKey(period.startDateKey, i);
    if (isTradingDay(period, key)) keys.push(key);
  }
  return keys;
}

/** The next trading day strictly after `dateKey` within the run, or null. */
export function nextTradingDayKey(period: RunPeriod, dateKey: string): string | null {
  let key = addDaysToKey(dateKey, 1);
  while (key <= period.endDateKey) {
    if (key >= period.startDateKey && isTradingDay(period, key)) return key;
    key = addDaysToKey(key, 1);
  }
  return null;
}

/** The previous trading day strictly before `dateKey` within the run, or null. */
export function previousTradingDayKey(period: RunPeriod, dateKey: string): string | null {
  let key = addDaysToKey(dateKey, -1);
  while (key >= period.startDateKey) {
    if (key <= period.endDateKey && isTradingDay(period, key)) return key;
    key = addDaysToKey(key, -1);
  }
  return null;
}

/** The first trading day of the run (or its start date if it has none). */
export function firstTradingDayKey(period: RunPeriod): string {
  return isTradingDay(period, period.startDateKey)
    ? period.startDateKey
    : (nextTradingDayKey(period, period.startDateKey) ?? period.startDateKey);
}

/**
 * Where "Continue" should land: the day after the last completed trading day
 * if the trader finished it, otherwise the last session date itself, falling
 * back to the run's first trading day. Always inside the run.
 */
export function resumeDateKey(
  period: RunPeriod,
  lastSessionDateKey: string | null,
  lastSessionCompleted: boolean,
): string {
  if (lastSessionDateKey == null || !isWithinRun(period, lastSessionDateKey)) return firstTradingDayKey(period);
  if (!lastSessionCompleted) return lastSessionDateKey;
  return nextTradingDayKey(period, lastSessionDateKey) ?? lastSessionDateKey;
}

export interface RunProgress {
  totalTradingDays: number;
  /** Completed (archived/closed) simulated days that are trading days. */
  completedTradingDays: number;
  /** Completed simulated days on non-trading weekdays — reported, never counted. */
  completedNonTradingDays: number;
  percentComplete: number;
}

export function computeRunProgress(period: RunPeriod, completedDateKeys: Iterable<string>): RunProgress {
  const tradingKeys = new Set(listTradingDayKeys(period));
  let completedTradingDays = 0;
  let completedNonTradingDays = 0;
  for (const key of new Set(completedDateKeys)) {
    if (!isWithinRun(period, key)) continue;
    if (tradingKeys.has(key)) completedTradingDays++;
    else completedNonTradingDays++;
  }
  const totalTradingDays = tradingKeys.size;
  return {
    totalTradingDays,
    completedTradingDays,
    completedNonTradingDays,
    percentComplete: totalTradingDays === 0 ? 0 : (completedTradingDays / totalTradingDays) * 100,
  };
}

/**
 * What counts as a COMPLETED backtesting day — the one definition used by
 * progress, resume and (later) the Backtesting Journal. A simulated day is
 * complete only once the trader has closed it (its TradingDay reached
 * `ARCHIVED` via Close Trading Day — the same finalization a live day goes
 * through). Visiting a date, planning it, or even taking trades on it does
 * NOT complete it; the run's "current position" (`lastSessionDate`) tracks
 * where the trader is, independently of completion.
 */
export function isBacktestDayComplete(day: { status: string } | null | undefined): boolean {
  return day?.status === "ARCHIVED";
}

/**
 * The date a Session request should actually open. An in-range trading day
 * is honoured as-is. An in-range NON-trading day (e.g. a weekend typed into
 * the URL) moves to the next trading day — or the previous one at the end of
 * the run — so navigation never silently lands on a day that doesn't count.
 * Anything missing, malformed or outside the run falls back to `fallback`
 * (the run's resume position).
 */
export function normalizeSessionDateKey(period: RunPeriod, requested: string | null | undefined, fallback: string): string {
  if (requested == null || !isWithinRun(period, requested)) return fallback;
  if (isTradingDay(period, requested)) return requested;
  return nextTradingDayKey(period, requested) ?? previousTradingDayKey(period, requested) ?? fallback;
}
