/**
 * Weekly Trade Audit — calendar rules (pure). Reuses the app's existing
 * conventions rather than inventing new ones:
 *  - a week is Monday-start (lib/date `weekStartKey`), the same as the old
 *    Edge weekly review and Replay periods;
 *  - which days are trading days comes from the trader's own Preparation
 *    Schedule (`dayApplicability`: scheduled weekdays + DAY_OFF/EXTRA_DAY
 *    exceptions), falling back to Monday–Friday only when the trader has no
 *    schedule for that date yet;
 *  - date keys are trader-calendar dates (Trade.tradeDate is already one), so
 *    nothing here does timezone arithmetic.
 */
import { addDaysToKey, isValidDateKey, weekStartKey } from "@/lib/date";
import { weekdayOfDateKey } from "@/domain/time/trader-calendar";
import {
  DEFAULT_PREPARATION_SCHEDULE,
  dayApplicability,
  type PreparationDayException,
  type PreparationScheduleVersion,
} from "@/domain/discipline/preparation-schedule";
import type { DayScheduleKind } from "@/types/trade-audit";

export interface AuditWeek {
  weekStart: string;
  weekEnd: string;
}

export function auditWeekFor(anyDateKey: string): AuditWeek {
  const weekStart = weekStartKey(anyDateKey);
  return { weekStart, weekEnd: addDaysToKey(weekStart, 6) };
}

export function weekDateKeys(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysToKey(weekStart, i));
}

/** How the trader's schedule classifies a date (fallback: Mon–Fri). */
export function scheduleKindFor(
  versions: readonly PreparationScheduleVersion[],
  exceptions: readonly PreparationDayException[],
  dateKey: string,
): DayScheduleKind {
  const a = dayApplicability(versions, exceptions, dateKey);
  if (a.kind === "SCHEDULED") return "SCHEDULED";
  if (a.kind === "DAY_OFF") return "DAY_OFF";
  if (a.kind === "NOT_SCHEDULED") return "UNSCHEDULED";
  return DEFAULT_PREPARATION_SCHEDULE.weekdays.includes(weekdayOfDateKey(dateKey)) ? "SCHEDULED" : "UNSCHEDULED";
}

/**
 * The days an audit shows: every scheduled day and DAY_OFF day of the week
 * (a day off still deserves a "not trading" acknowledgement), plus ANY day
 * that has activity (a trade, a missed setup, or review work) even if it
 * wasn't scheduled — a Saturday trade must never silently disappear from its
 * week's audit. Always in calendar order.
 */
export function auditDays(
  weekStart: string,
  versions: readonly PreparationScheduleVersion[],
  exceptions: readonly PreparationDayException[],
  activeDateKeys: Iterable<string>,
): { dateKey: string; schedule: DayScheduleKind }[] {
  const active = new Set(activeDateKeys);
  return weekDateKeys(weekStart)
    .map((dateKey) => ({ dateKey, schedule: scheduleKindFor(versions, exceptions, dateKey) }))
    .filter((d) => d.schedule !== "UNSCHEDULED" || active.has(d.dateKey));
}

/**
 * The week Edge Review opens on by default — the most recently COMPLETED
 * trading week, because this is a weekend-review tool. The current week
 * counts as completed once today is past its last scheduled trading day
 * (so Saturday/Sunday open the week just traded; Monday–Friday open last
 * week, whose days are all done).
 */
export function defaultAuditWeekStart(
  todayKey: string,
  versions: readonly PreparationScheduleVersion[],
  exceptions: readonly PreparationDayException[] = [],
): string {
  const current = weekStartKey(todayKey);
  const scheduled = weekDateKeys(current).filter((d) => scheduleKindFor(versions, exceptions, d) === "SCHEDULED");
  const lastScheduled = scheduled.length > 0 ? scheduled[scheduled.length - 1] : addDaysToKey(current, 4);
  return todayKey > lastScheduled ? current : addDaysToKey(current, -7);
}

/** Normalized scope identity — part of the audit's unique key. */
export function auditScopeKey(strategyId: string | null, assetSymbols: readonly string[]): string {
  const assets = [...new Set(assetSymbols.map((a) => a.trim().toUpperCase()).filter(Boolean))].sort();
  return `${strategyId ?? "*"}|${assets.length > 0 ? assets.join(",") : "*"}`;
}

export function normalizeAssets(assetSymbols: readonly string[]): string[] {
  return [...new Set(assetSymbols.map((a) => a.trim().toUpperCase()).filter(Boolean))].sort();
}

/** A date key that belongs to the audit's week (server-side guard). */
export function isInWeek(week: AuditWeek, dateKey: string): boolean {
  return isValidDateKey(dateKey) && dateKey >= week.weekStart && dateKey <= week.weekEnd;
}

/** Does a trade fall in the audit's scope? Empty filters = all. */
export function inScope(
  scope: { strategyId: string | null; assetSymbols: readonly string[] },
  trade: { strategyId: string | null; assetSymbol: string },
): boolean {
  if (scope.strategyId && trade.strategyId !== scope.strategyId) return false;
  if (scope.assetSymbols.length > 0 && !scope.assetSymbols.includes(trade.assetSymbol.toUpperCase())) return false;
  return true;
}
