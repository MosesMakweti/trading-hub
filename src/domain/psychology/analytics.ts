import { gradeFromPercent, type PsychologyGrade } from "./scoring";

export interface PsychologyDataPoint {
  dateKey: string;
  percent: number;
  rawScore: number;
  assetSymbol: string;
  accountName: string;
  sessionName: string | null;
  actualRR: number | null;
  ruleAdherencePercent: number | null;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function averagePsychologyPercent(points: PsychologyDataPoint[]): number | null {
  return average(points.map((p) => p.percent));
}

export function averagePsychologyScore(points: PsychologyDataPoint[]): number | null {
  return average(points.map((p) => p.rawScore));
}

export function averagePsychologyGrade(points: PsychologyDataPoint[]): PsychologyGrade | null {
  const percent = averagePsychologyPercent(points);
  return percent === null ? null : gradeFromPercent(percent);
}

export interface TrendPoint {
  key: string;
  averagePercent: number;
  count: number;
}

function groupByKey(points: PsychologyDataPoint[], keyFn: (p: PsychologyDataPoint) => string): TrendPoint[] {
  const groups = new Map<string, PsychologyDataPoint[]>();
  for (const p of points) {
    const key = keyFn(p);
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      averagePercent: average(group.map((p) => p.percent))!,
      count: group.length,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function trendByMonth(points: PsychologyDataPoint[]): TrendPoint[] {
  return groupByKey(points, (p) => p.dateKey.slice(0, 7));
}

/** Week key = the Monday of that week, as a date key — avoids ISO week-number year-boundary edge cases. */
export function trendByWeek(points: PsychologyDataPoint[]): TrendPoint[] {
  return groupByKey(points, (p) => {
    const date = new Date(`${p.dateKey}T00:00:00Z`);
    const dayOfWeek = date.getUTCDay();
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    date.setUTCDate(date.getUTCDate() - daysSinceMonday);
    return date.toISOString().slice(0, 10);
  });
}

export function bestMonth(points: PsychologyDataPoint[]): TrendPoint | null {
  const months = trendByMonth(points);
  if (months.length === 0) return null;
  return months.reduce((best, m) => (m.averagePercent > best.averagePercent ? m : best));
}

export function worstMonth(points: PsychologyDataPoint[]): TrendPoint | null {
  const months = trendByMonth(points);
  if (months.length === 0) return null;
  return months.reduce((worst, m) => (m.averagePercent < worst.averagePercent ? m : worst));
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function byAsset(points: PsychologyDataPoint[]): TrendPoint[] {
  return groupByKey(points, (p) => p.assetSymbol);
}

export function byAccount(points: PsychologyDataPoint[]): TrendPoint[] {
  return groupByKey(points, (p) => p.accountName);
}

export function bySession(points: PsychologyDataPoint[]): TrendPoint[] {
  return groupByKey(points, (p) => p.sessionName ?? "No session");
}

/** Per-day average — backs the psychology heatmap (a day can have multiple trades/scores). */
export function byDay(points: PsychologyDataPoint[]): TrendPoint[] {
  return groupByKey(points, (p) => p.dateKey);
}

export function byDayOfWeek(points: PsychologyDataPoint[]): TrendPoint[] {
  const grouped = groupByKey(points, (p) => {
    const date = new Date(`${p.dateKey}T00:00:00Z`);
    return String(date.getUTCDay());
  });
  return grouped
    .map((g) => ({ ...g, key: DAY_NAMES[Number(g.key)] }))
    .sort((a, b) => DAY_NAMES.indexOf(a.key) - DAY_NAMES.indexOf(b.key));
}

/**
 * Standard Pearson correlation coefficient, -1 to 1. Null when there are
 * fewer than 2 pairs or either series has zero variance (undefined slope).
 * Callers must present this as "correlation, not causation" — a handful of
 * trades correlating psychology with profitability says nothing about which
 * one drives the other, or whether either is even causal.
 */
export function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const n = xs.length;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;

  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX === 0 || varY === 0) return null;
  return cov / Math.sqrt(varX * varY);
}

export function correlationWithProfitability(points: PsychologyDataPoint[]): number | null {
  const closed = points.filter((p) => p.actualRR !== null);
  return pearsonCorrelation(closed.map((p) => p.percent), closed.map((p) => p.actualRR!));
}

/** Point-biserial correlation (win=1/loss=0 vs psychology%) — the standard
 * Pearson formula applied to a binary variable. */
export function correlationWithWinRate(points: PsychologyDataPoint[]): number | null {
  const closed = points.filter((p) => p.actualRR !== null);
  return pearsonCorrelation(
    closed.map((p) => p.percent),
    closed.map((p) => (p.actualRR! > 0 ? 1 : 0)),
  );
}

export function correlationWithRuleAdherence(points: PsychologyDataPoint[]): number | null {
  const withAdherence = points.filter((p) => p.ruleAdherencePercent !== null);
  return pearsonCorrelation(
    withAdherence.map((p) => p.percent),
    withAdherence.map((p) => p.ruleAdherencePercent!),
  );
}
