/**
 * Analytics consolidation (Stage 10 §7-15) — pure aggregators over the
 * canonical dataset (canonical-dataset.ts). Every grouped stat reuses the
 * EXISTING statistical engine (domain/performance/metrics.ts's winRate/
 * averageRR/expectancy/profitFactor) rather than re-deriving win/loss math —
 * this module only groups rows and feeds them through it. No React, no I/O.
 */
import * as metrics from "@/domain/performance/metrics";
import type { TradeMetricInput } from "@/domain/performance/metrics";
import { R_BUCKETS, type RBucket } from "@/domain/performance/breakdowns";
import type { CanonicalAnalyticsTradeRow } from "@/domain/analytics/canonical-dataset";
import type { StrategyPerformanceSummary } from "@/domain/performance/strategy-performance";

export interface RGroupStats {
  key: string;
  label: string;
  /** Executed (non-cancelled) trades in this group. */
  count: number;
  /** FULLY_CLOSED trades with a determined result — the sample size backing
   *  winRate/averageR/expectancy/profitFactor (Stage 10 §19: always shown). */
  finalizedCount: number;
  /** Sum of realizedR across the group — partial-aware, cancelled excluded. */
  totalR: number;
  averageR: number | null;
  winRate: number | null;
  expectancy: number | null;
  profitFactor: number | null;
  totalPnl: number;
}

export function toMetricInputs(rows: CanonicalAnalyticsTradeRow[]): TradeMetricInput[] {
  // Analytics V2 — `finalizedR` (canonical-dataset.ts) is already gated on
  // the canonical Performance-settled fact; re-imposing
  // reviewLifecycleStatus === "FULLY_CLOSED" here would silently exclude a
  // genuinely settled trade the trader hasn't yet manually confirmed in
  // Trade Review, undercounting win rate/profit factor/expectancy/streaks.
  // `finalizedR != null` is the complete, sufficient gate on its own.
  return rows.filter((r) => r.finalizedR != null).map((r) => ({ dateKey: r.dateKey, assetSymbol: r.assetSymbol, actualRR: r.finalizedR }));
}

/** Dashboard KPI sparkline (Analytics V2 §21 — Dashboard/canonical unification)
 *  — the running win rate, chronological, over the SAME finalized population
 *  every other canonical stat uses. Thin wrapper over `toMetricInputs` +
 *  `metrics.cumulativeWinRateSeries`; no second win/loss classification. */
export function cumulativeWinRateSeries(rows: CanonicalAnalyticsTradeRow[]): number[] {
  return metrics.cumulativeWinRateSeries(toMetricInputs(rows));
}

export function computeRGroupStats(key: string, label: string, rows: CanonicalAnalyticsTradeRow[]): RGroupStats {
  const executed = rows.filter((r) => r.isExecuted);
  const metricInputs = toMetricInputs(executed);
  return {
    key,
    label,
    count: executed.length,
    finalizedCount: metricInputs.length,
    totalR: executed.reduce((sum, r) => sum + (r.realizedR ?? 0), 0),
    averageR: metrics.averageRR(metricInputs),
    winRate: metrics.winRate(metricInputs),
    expectancy: metrics.expectancy(metricInputs),
    profitFactor: metrics.profitFactor(metricInputs),
    totalPnl: executed.reduce((sum, r) => sum + (r.pnl ?? 0), 0),
  };
}

/** Generic "group rows by a key, compute R stats per group" — every
 *  single-valued breakdown (weekday/month/strategy/setup type/validation
 *  state/bias alignment) is this same shape. */
function groupBy(
  rows: CanonicalAnalyticsTradeRow[],
  keyOf: (row: CanonicalAnalyticsTradeRow) => string | null,
  labelOf: (key: string) => string,
): RGroupStats[] {
  const byKey = new Map<string, CanonicalAnalyticsTradeRow[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key == null) continue;
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(row);
  }
  return Array.from(byKey.entries()).map(([key, groupRows]) => computeRGroupStats(key, labelOf(key), groupRows));
}

const WEEKDAY_LABEL: Record<number, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

/** Monday-Friday only (Stage 10 §7) — weekend rows (rare, e.g. crypto) are
 *  simply excluded from this specific breakdown, not from the dataset. */
export function aggregateByWeekday(rows: CanonicalAnalyticsTradeRow[]): RGroupStats[] {
  const weekdayRows = rows.filter((r) => r.weekday >= 1 && r.weekday <= 5);
  const stats = groupBy(
    weekdayRows,
    (r) => String(r.weekday),
    (key) => WEEKDAY_LABEL[Number(key)],
  );
  const order = ["1", "2", "3", "4", "5"];
  return order.map((k) => stats.find((s) => s.key === k) ?? computeRGroupStats(k, WEEKDAY_LABEL[Number(k)], []));
}

export function aggregateByMonth(rows: CanonicalAnalyticsTradeRow[]): RGroupStats[] {
  return groupBy(rows, (r) => r.monthKey, (key) => key).sort((a, b) => a.key.localeCompare(b.key));
}

/** Per-asset performance (Stage 10.5 §6) — the same canonical rows used for
 *  every other breakdown, sorted strongest-total-R first. */
export function aggregateByAsset(rows: CanonicalAnalyticsTradeRow[]): RGroupStats[] {
  return groupBy(rows, (r) => r.assetSymbol, (key) => key).sort((a, b) => b.totalR - a.totalR);
}

const DIRECTION_LABEL: Record<string, string> = { LONG: "Long", SHORT: "Short" };
/** Long vs Short (Stage 10.5 §7) — always both keys, even with zero data on
 *  one side, so the comparison never silently drops a direction. */
export function aggregateByDirection(rows: CanonicalAnalyticsTradeRow[]): RGroupStats[] {
  const stats = groupBy(rows, (r) => String(r.direction), (key) => DIRECTION_LABEL[key] ?? key);
  return (["LONG", "SHORT"] as const).map(
    (d) => stats.find((s) => s.key === d) ?? computeRGroupStats(d, DIRECTION_LABEL[d], []),
  );
}

const NO_SESSION = "__no_session__";
/** Per-session performance (Stage 10.5 §7), sorted strongest-total-R first;
 *  trades without a recorded session are grouped as "No session". */
export function aggregateBySession(rows: CanonicalAnalyticsTradeRow[]): RGroupStats[] {
  return groupBy(
    rows,
    (r) => r.session ?? NO_SESSION,
    (key) => (key === NO_SESSION ? "No session" : key),
  ).sort((a, b) => b.totalR - a.totalR);
}

const NO_STRATEGY = "__no_strategy__";
export function aggregateByStrategy(rows: CanonicalAnalyticsTradeRow[]): RGroupStats[] {
  return groupBy(
    rows,
    (r) => r.strategyName ?? NO_STRATEGY,
    (key) => (key === NO_STRATEGY ? "No strategy" : key),
  ).sort((a, b) => b.totalR - a.totalR);
}

const NO_SETUP_TYPE = "__no_setup_type__";
/** Setup Type performance (Stage 10 §10) — grouped by the FROZEN Stage 4
 *  snapshot's name, never the live Strategy Lab definition. */
export function aggregateBySetupType(rows: CanonicalAnalyticsTradeRow[]): RGroupStats[] {
  return groupBy(
    rows,
    (r) => r.setupTypeName ?? NO_SETUP_TYPE,
    (key) => (key === NO_SETUP_TYPE ? "No Setup Type" : key),
  ).sort((a, b) => b.totalR - a.totalR);
}

const VALIDATION_LABEL: Record<string, string> = {
  VALIDATED: "Validated",
  OVERRIDDEN: "Overridden",
  NOT_VALIDATED: "Not validated",
  __none__: "No Setup Type used",
};
/** Validated vs Overridden (Stage 10 §11). */
export function aggregateByValidationState(rows: CanonicalAnalyticsTradeRow[]): RGroupStats[] {
  return groupBy(
    rows,
    (r) => r.validationState ?? "__none__",
    (key) => VALIDATION_LABEL[key] ?? key,
  );
}

const OVERRIDE_REASON_LABEL: Record<string, string> = {
  ANTICIPATING_CONFIRMATION: "Anticipating confirmation",
  DISCRETIONARY_OVERRIDE: "Discretionary override",
  FOMO: "FOMO",
  MOMENTUM_FAST_MARKET: "Momentum / fast market",
  NEWS_DRIVEN: "News-driven",
  OTHER: "Other",
};
/** Overridden trades only, broken down by their override reason. */
export function aggregateByOverrideReason(rows: CanonicalAnalyticsTradeRow[]): RGroupStats[] {
  const overridden = rows.filter((r) => r.validationState === "OVERRIDDEN");
  return groupBy(overridden, (r) => r.overrideReason ?? "OTHER", (key) => OVERRIDE_REASON_LABEL[key] ?? key);
}

const BIAS_ALIGNMENT_LABEL: Record<string, string> = {
  ALIGNED: "Aligned with daily bias",
  CONFLICT: "Conflicted with daily bias",
  NEUTRAL_OR_NONE: "Neutral / no daily analysis",
};
/** Daily Bias alignment (Stage 10 §12) — observational, not a claim that
 *  alignment is inherently correct. */
export function aggregateByBiasAlignment(rows: CanonicalAnalyticsTradeRow[]): RGroupStats[] {
  return groupBy(rows, (r) => r.biasAlignment, (key) => BIAS_ALIGNMENT_LABEL[key] ?? key);
}

export interface BehaviourLabelStats extends RGroupStats {
  polarity: "POSITIVE" | "NEGATIVE";
}

/** Behaviour Label performance (Stage 10 §13) — a trade can carry multiple
 *  labels, so this is a flat-map group-by, not a single-valued one. */
export function aggregateByBehaviourLabel(rows: CanonicalAnalyticsTradeRow[]): BehaviourLabelStats[] {
  const byLabel = new Map<string, { polarity: "POSITIVE" | "NEGATIVE"; rows: CanonicalAnalyticsTradeRow[] }>();
  for (const row of rows) {
    for (const label of row.behaviourLabels) {
      const entry = byLabel.get(label.name) ?? { polarity: label.polarity, rows: [] };
      entry.rows.push(row);
      byLabel.set(label.name, entry);
    }
  }
  return Array.from(byLabel.entries())
    .map(([name, { polarity, rows: groupRows }]) => ({ ...computeRGroupStats(name, name, groupRows), polarity }))
    .sort((a, b) => b.totalR - a.totalR);
}

/** Pre-trade mood tag performance (Stage 10 §14) — same flat-map shape as
 *  behaviour labels, since a trade can carry multiple mood tags. */
export function aggregateByMoodTag(rows: CanonicalAnalyticsTradeRow[]): RGroupStats[] {
  const byTag = new Map<string, CanonicalAnalyticsTradeRow[]>();
  for (const row of rows) {
    for (const tag of row.preTradeMoodTags) {
      (byTag.get(tag) ?? byTag.set(tag, []).get(tag)!).push(row);
    }
  }
  return Array.from(byTag.entries())
    .map(([tag, groupRows]) => computeRGroupStats(tag, tag, groupRows))
    .sort((a, b) => b.totalR - a.totalR);
}

/** Mood intensity (1-5) vs performance (Stage 10 §14). */
export function aggregateByMoodIntensity(rows: CanonicalAnalyticsTradeRow[]): RGroupStats[] {
  const withIntensity = rows.filter((r) => r.moodIntensity != null);
  const stats = groupBy(withIntensity, (r) => String(r.moodIntensity), (key) => `Intensity ${key}`);
  return [1, 2, 3, 4, 5].map((n) => stats.find((s) => s.key === String(n)) ?? computeRGroupStats(String(n), `Intensity ${n}`, []));
}

export interface CumulativeRPoint {
  dateKey: string;
  tradeId: string;
  r: number;
  cumulativeR: number;
}

/**
 * Cumulative Realized R equity curve (Stage 10 §6) — chronological, from
 * legitimately realized results only. Cancelled/never-triggered ideas
 * contribute nothing (they're filtered out entirely, never a fabricated
 * -1R or 0); a partial/still-holding trade contributes its
 * realized-so-far R exactly once, at its trade date — not re-added when it
 * later fully closes (each Analytics read is a fresh snapshot of current
 * state, not an append-only ledger).
 */
export function buildCumulativeRealizedRCurve(rows: CanonicalAnalyticsTradeRow[]): CumulativeRPoint[] {
  const withResult = rows
    .filter((r) => r.isExecuted && r.realizedR != null)
    .sort((a, b) => (a.dateKey === b.dateKey ? 0 : a.dateKey.localeCompare(b.dateKey)));
  let cumulative = 0;
  return withResult.map((r) => {
    cumulative += r.realizedR!;
    return { dateKey: r.dateKey, tradeId: r.tradeId, r: r.realizedR!, cumulativeR: cumulative };
  });
}

export interface PlannedVsActualSummary {
  /** Trades with both a confirmed plan and a determined (FULLY_CLOSED) result. */
  sampleSize: number;
  averagePlannedR: number | null;
  averageRealizedR: number | null;
  /** averageRealizedR − averagePlannedR. Positive = outperformed plan on average. */
  averageGap: number | null;
  /** % of the sample whose realized R met or exceeded its planned R. */
  meetOrExceedRate: number | null;
}

/** Planned vs Actual (Stage 10 §15) — a review aid, not a discrepancy engine.
 *  A correctly-executed loss on a valid setup is normal variance, not
 *  penalized here; this only describes the plan-vs-outcome gap on average. */
export function summarizePlannedVsActual(rows: CanonicalAnalyticsTradeRow[]): PlannedVsActualSummary {
  const withBoth = rows.filter((r) => r.plannedR != null && r.finalizedR != null);
  if (withBoth.length === 0) {
    return { sampleSize: 0, averagePlannedR: null, averageRealizedR: null, averageGap: null, meetOrExceedRate: null };
  }
  const avgPlanned = withBoth.reduce((s, r) => s + r.plannedR!, 0) / withBoth.length;
  const avgRealized = withBoth.reduce((s, r) => s + r.finalizedR!, 0) / withBoth.length;
  const meetOrExceed = withBoth.filter((r) => r.finalizedR! >= r.plannedR!).length;
  return {
    sampleSize: withBoth.length,
    averagePlannedR: avgPlanned,
    averageRealizedR: avgRealized,
    averageGap: avgRealized - avgPlanned,
    meetOrExceedRate: (meetOrExceed / withBoth.length) * 100,
  };
}

/** Histogram of REAL realized R (Stage 10.5 §7/§14 — never the Performance
 *  Account contribution % this used to be built from). Only FULLY_CLOSED
 *  trades with a determined `finalizedR` are bucketed, same population as
 *  every other win/loss/expectancy stat in this module. */
export function distributionByRealizedR(rows: CanonicalAnalyticsTradeRow[]): RBucket[] {
  const finalizedRs = toMetricInputs(rows).map((m) => m.actualRR as number);
  return R_BUCKETS.map((b) => ({
    ...b,
    count: finalizedRs.filter((r) => r >= b.min && r < b.max).length,
  }));
}

/**
 * Stage 10.5 — the ONE definition of "daily" and "per-strategy" trader
 * performance, replacing the Performance-Account contribution-% math that
 * used to live in `getDailyAnalytics`/`getStrategyPerformance`
 * (analytics.service.ts). `totalTrades`/win-loss counts and `totalRR` cover
 * every executed (non-cancelled) row — partial-aware, via `realizedR` — while
 * win rate/expectancy/profit-factor/streaks/best-worst only ever look at
 * FULLY_CLOSED rows with a determined `finalizedR`, exactly like every other
 * canonical aggregator in this module.
 */
export interface PsychologyAdherenceSummary {
  averagePsychologyPercent: number | null;
  /** Mean of executed rows' `executionPercent` — the same SOT rule-adherence
   *  definition Edge Review used before Stage 12.5 (previously computed from
   *  the legacy contribution-% engine's `t.executionPercent`). */
  averageAdherencePercent: number | null;
  sampleSize: number;
}

function mean(xs: number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((s, v) => s + v, 0) / xs.length;
}

/** Edge Review's psychology/rule-adherence averages (Stage 12.5 §6) — kept
 *  separate from `CanonicalAnalyticsSummary.overview` (analytics-canonical.
 *  service.ts) rather than added to that shared shape, since Analytics
 *  itself doesn't need these two; Replay's baseline builder is the only
 *  caller. Same executed-row population as every other overview stat. */
export function summarizePsychologyAdherence(rows: CanonicalAnalyticsTradeRow[]): PsychologyAdherenceSummary {
  const executed = rows.filter((r) => r.isExecuted);
  const psych = executed.map((r) => r.psychologyPercent).filter((v): v is number => v != null);
  const adherence = executed.map((r) => r.executionPercent).filter((v): v is number => v != null);
  return {
    averagePsychologyPercent: mean(psych),
    averageAdherencePercent: mean(adherence),
    sampleSize: executed.length,
  };
}

export function toStrategyPerformanceSummary(rows: CanonicalAnalyticsTradeRow[]): StrategyPerformanceSummary {
  const executed = rows.filter((r) => r.isExecuted);
  const metricInputs = toMetricInputs(executed);
  const finalizedRs = metricInputs.map((m) => m.actualRR as number);
  const psych = executed.map((r) => r.psychologyPercent).filter((v): v is number => v != null);
  const adherence = executed.map((r) => r.adherencePercent).filter((v): v is number => v != null);
  const avg = (xs: number[]): number | null => (xs.length === 0 ? null : xs.reduce((s, v) => s + v, 0) / xs.length);

  return {
    totalTrades: executed.length,
    winningTrades: finalizedRs.filter((rr) => rr > 0).length,
    losingTrades: finalizedRs.filter((rr) => rr < 0).length,
    winRate: metrics.winRate(metricInputs),
    averageRR: metrics.averageRR(metricInputs),
    totalRR: executed.reduce((sum, r) => sum + (r.realizedR ?? 0), 0),
    profitFactor: metrics.profitFactor(metricInputs),
    expectancy: metrics.expectancy(metricInputs),
    bestRR: finalizedRs.length > 0 ? Math.max(...finalizedRs) : null,
    worstRR: finalizedRs.length > 0 ? Math.min(...finalizedRs) : null,
    longestWinStreak: metrics.longestWinStreak(metricInputs),
    longestLossStreak: metrics.longestLossStreak(metricInputs),
    averagePsychologyPercent: avg(psych),
    averageAdherencePercent: avg(adherence),
  };
}
