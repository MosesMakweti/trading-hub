/**
 * Discipline Streaks — the three independent day series (pure).
 *
 * Each track gets exactly one status per local date, built from persisted
 * facts the service loads. Tracks never read each other, so routine
 * completion stays separate from trading, and review credit stays separate
 * from trading performance.
 *
 * 🔥 ROUTINE (per date)
 *    complete routine day                       → ACTIVE
 *    today, not complete yet                    → PENDING
 *    REQUIRED date, not complete                → MISSED
 *    OPTIONAL / EXEMPT / skipped date           → REST
 *
 * 📝 REVIEW (per date; credit dated by the FIRST final-review completion)
 *    ≥ 1 trade's final review credited          → ACTIVE (many reviews still count once)
 *    today, no review yet                       → PENDING
 *    REQUIRED date with a closed trade still
 *      awaiting its final review at day's end   → MISSED
 *    otherwise (nothing to review / not owed)   → REST — no trade, no penalty
 *
 * 🎯 ADHERENCE (per TRADING date = Trade.tradeDate)
 *    no executed trade                          → REST — a no-trade day never breaks it
 *    ≥ 1 PERFECT trade                          → ACTIVE (many still count once)
 *    any trade still AWAITING_REVIEW            → PENDING
 *    executed trades, none perfect              → MISSED
 */
import type { StreakDay, StreakDayStatus } from "./streak";
import type { DayRequirement, RoutineDayEvaluation } from "./routine-day";
import type { PlanAdherenceStatus } from "./plan-adherence";
import { dateKeysBetween } from "./calendar";

export interface ReviewCreditFact {
  tradeId: string;
  /** Local date of the first completed final review; null while not (or no longer) complete. */
  creditDateKey: string | null;
  /** Local date the position fully closed (when a final review became owed); null = not closed. */
  closedDateKey: string | null;
}

export interface AdherenceTradeFact {
  tradeId: string;
  tradeDateKey: string;
  status: PlanAdherenceStatus;
}

export interface DisciplineDay {
  dateKey: string;
  requirement: DayRequirement;
  routine: StreakDayStatus;
  review: StreakDayStatus;
  adherence: StreakDayStatus;
  routinePreSession: boolean;
  routinePostSession: boolean;
  reviewsCompleted: number;
  reviewsOutstanding: number;
  tradesExecuted: number;
  perfectTrades: number;
  tradesAwaitingReview: number;
}

export interface TrackInputs {
  from: string;
  todayKey: string;
  requirement: (dateKey: string) => DayRequirement;
  skipped: ReadonlySet<string>;
  routineDays: ReadonlyMap<string, RoutineDayEvaluation>;
  reviews: readonly ReviewCreditFact[];
  adherence: readonly AdherenceTradeFact[];
}

function countBy<T>(items: readonly T[], key: (t: T) => string | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    if (k != null) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

export function buildDisciplineDays(i: TrackInputs): DisciplineDay[] {
  const credited = i.reviews.filter((r) => r.creditDateKey != null && r.creditDateKey <= i.todayKey);
  const reviewsOn = countBy(credited, (r) => r.creditDateKey);

  // Outstanding final reviews at the end of each date, as a running sum:
  // +1 the day a position closes, −1 the day its final review is credited.
  const delta = new Map<string, number>();
  let carried = 0;
  for (const r of i.reviews) {
    if (r.closedDateKey == null) continue;
    if (r.creditDateKey != null && r.creditDateKey <= r.closedDateKey) continue; // reviewed the day it closed
    if (r.closedDateKey < i.from) carried += 1;
    else delta.set(r.closedDateKey, (delta.get(r.closedDateKey) ?? 0) + 1);
    if (r.creditDateKey != null) {
      if (r.creditDateKey < i.from) carried -= 1;
      else delta.set(r.creditDateKey, (delta.get(r.creditDateKey) ?? 0) - 1);
    }
  }

  const tradesByDate = new Map<string, AdherenceTradeFact[]>();
  for (const t of i.adherence) {
    if (t.status === "NOT_APPLICABLE") continue;
    const list = tradesByDate.get(t.tradeDateKey);
    if (list) list.push(t);
    else tradesByDate.set(t.tradeDateKey, [t]);
  }

  const days: DisciplineDay[] = [];
  let outstanding = carried;
  for (const dateKey of dateKeysBetween(i.from, i.todayKey)) {
    outstanding += delta.get(dateKey) ?? 0;
    const isToday = dateKey === i.todayKey;
    const skipped = i.skipped.has(dateKey);
    const requirement: DayRequirement = skipped ? "EXEMPT" : i.requirement(dateKey);

    // 🔥 routine
    const r = i.routineDays.get(dateKey);
    let routine: StreakDayStatus;
    if (r?.complete) routine = "ACTIVE";
    else if (isToday) routine = "PENDING";
    else routine = requirement === "REQUIRED" ? "MISSED" : "REST";

    // 📝 review
    const reviewsCompleted = reviewsOn.get(dateKey) ?? 0;
    let review: StreakDayStatus;
    if (reviewsCompleted > 0) review = "ACTIVE";
    else if (isToday) review = "PENDING";
    else review = requirement === "REQUIRED" && outstanding > 0 ? "MISSED" : "REST";

    // 🎯 adherence
    const trades = tradesByDate.get(dateKey) ?? [];
    const perfectTrades = trades.filter((t) => t.status === "PERFECT").length;
    const awaiting = trades.filter((t) => t.status === "AWAITING_REVIEW").length;
    let adherence: StreakDayStatus;
    if (trades.length === 0) adherence = "REST";
    else if (perfectTrades > 0) adherence = "ACTIVE";
    else if (awaiting > 0) adherence = "PENDING";
    else adherence = "MISSED";

    days.push({
      dateKey,
      requirement,
      routine,
      review,
      adherence,
      routinePreSession: r?.preSession ?? false,
      routinePostSession: r?.postSession ?? false,
      reviewsCompleted,
      reviewsOutstanding: Math.max(0, outstanding),
      tradesExecuted: trades.length,
      perfectTrades,
      tradesAwaitingReview: awaiting,
    });
  }
  return days;
}

export type TrackKey = "routine" | "review" | "adherence";
export const TRACK_KEYS: readonly TrackKey[] = ["routine", "review", "adherence"];

export function trackSeries(days: readonly DisciplineDay[], track: TrackKey): StreakDay[] {
  return days.map((d) => ({ dateKey: d.dateKey, status: d[track] }));
}
