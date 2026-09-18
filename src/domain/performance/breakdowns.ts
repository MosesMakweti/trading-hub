/**
 * Phase B breakdowns for the Analytics module: performance grouped by day-of-week,
 * month, direction, session, and hour, plus an R-multiple distribution and risk
 * stats. All pure; the service builds one per-trade point array from the same
 * Performance Account ledger everything else uses (no duplicate data source).
 *
 * `actualR` here is the trade's contribution % (the R proxy used across analytics);
 * `pnl` is realized dollars.
 *
 * Stage C.1: the caller (analytics.service.ts) now only ever pushes a point
 * for a trade whose Performance result has genuinely settled — a pending
 * trade never enters this array at all, rather than appearing as a fake
 * $0/0R point. That means every `AnalyticsTradePoint` here IS a closed
 * trade; `bucketPerf` no longer needs (and must not use) a `pnl !== 0`
 * filter to guess which ones are "real" — that filter used to also
 * incorrectly exclude a genuine $0 breakeven trade from the win-rate
 * denominator, which conflated "pending" and "breakeven" in exactly the
 * way Stage C's ledger fix was meant to end.
 */

export interface AnalyticsTradePoint {
  dateKey: string;
  monthKey: string; // YYYY-MM
  weekday: number; // 0=Sun … 6=Sat
  hour: number; // 0–23 (from executionMinutes)
  pnl: number; // $
  actualR: number; // contribution % (R proxy)
  direction: "LONG" | "SHORT";
  session: string | null;
  riskPercent: number | null;
}

export interface BucketPerf {
  trades: number;
  netPnl: number;
  winRate: number | null;
  avgR: number | null;
  expectancy: number | null;
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/** Core per-bucket performance (shared by every grouping below). */
export function bucketPerf(points: AnalyticsTradePoint[]): BucketPerf {
  const trades = points.length;
  if (trades === 0) return { trades: 0, netPnl: 0, winRate: null, avgR: null, expectancy: null };
  const netPnl = points.reduce((s, p) => s + p.pnl, 0);
  const wins = points.filter((p) => p.pnl > 0).length;
  // Every point here is already a settled trade (see the module doc
  // comment) — the denominator is every trade, matching
  // domain/performance/metrics.ts's winRate() convention of counting a
  // genuine breakeven in the denominator without crediting it as a win.
  const winRate = (wins / trades) * 100;
  const avgR = mean(points.map((p) => p.actualR));
  const winR = points.filter((p) => p.actualR > 0).map((p) => p.actualR);
  const lossR = points.filter((p) => p.actualR < 0).map((p) => p.actualR);
  const expectancy =
    (winR.length / trades) * (mean(winR) ?? 0) + (lossR.length / trades) * (mean(lossR) ?? 0);
  return { trades, netPnl, winRate, avgR, expectancy };
}

export interface DayPerf extends BucketPerf {
  weekday: number;
  label: string;
}

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon … Sun
const WEEKDAY_LABEL: Record<number, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

/** Performance per weekday, Monday-first; only weekdays with ≥ 1 trade are returned. */
export function dayOfWeekPerformance(points: AnalyticsTradePoint[]): DayPerf[] {
  const byDay = new Map<number, AnalyticsTradePoint[]>();
  for (const p of points) {
    const list = byDay.get(p.weekday) ?? [];
    list.push(p);
    byDay.set(p.weekday, list);
  }
  return WEEKDAY_ORDER.filter((wd) => byDay.has(wd)).map((weekday) => ({
    weekday,
    label: WEEKDAY_LABEL[weekday],
    ...bucketPerf(byDay.get(weekday)!),
  }));
}

export interface MonthPerf extends BucketPerf {
  monthKey: string;
  returnPercent: number;
}

/** Performance per month (chronological). `returnPercent` = Σ contribution % that month. */
export function monthlyPerformance(points: AnalyticsTradePoint[]): MonthPerf[] {
  const byMonth = new Map<string, AnalyticsTradePoint[]>();
  for (const p of points) {
    const list = byMonth.get(p.monthKey) ?? [];
    list.push(p);
    byMonth.set(p.monthKey, list);
  }
  return [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([monthKey, list]) => ({
      monthKey,
      returnPercent: list.reduce((s, p) => s + p.actualR, 0),
      ...bucketPerf(list),
    }));
}

export interface LabeledPerf extends BucketPerf {
  label: string;
}

/** Long vs Short performance. */
export function longShortPerformance(points: AnalyticsTradePoint[]): LabeledPerf[] {
  return (["LONG", "SHORT"] as const).map((direction) => ({
    label: direction === "LONG" ? "Long" : "Short",
    ...bucketPerf(points.filter((p) => p.direction === direction)),
  }));
}

/** Performance per trading session (sorted by net P&L desc). Null sessions grouped as "No session". */
export function sessionPerformance(points: AnalyticsTradePoint[]): LabeledPerf[] {
  const bySession = new Map<string, AnalyticsTradePoint[]>();
  for (const p of points) {
    const key = p.session ?? "No session";
    const list = bySession.get(key) ?? [];
    list.push(p);
    bySession.set(key, list);
  }
  return [...bySession.entries()]
    .map(([label, list]) => ({ label, ...bucketPerf(list) }))
    .sort((a, b) => b.netPnl - a.netPnl);
}

export interface HourPerf extends BucketPerf {
  hour: number;
}

/** Performance per hour of day (only hours with ≥ 1 trade, ascending). */
export function hourPerformance(points: AnalyticsTradePoint[]): HourPerf[] {
  const byHour = new Map<number, AnalyticsTradePoint[]>();
  for (const p of points) {
    const list = byHour.get(p.hour) ?? [];
    list.push(p);
    byHour.set(p.hour, list);
  }
  return [...byHour.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hour, list]) => ({ hour, ...bucketPerf(list) }));
}

export interface RBucket {
  label: string;
  min: number; // -Infinity for the tail
  max: number; // +Infinity for the tail
  count: number;
}

export const R_BUCKETS: Omit<RBucket, "count">[] = [
  { label: "≤ −3R", min: -Infinity, max: -3 },
  { label: "−3…−2R", min: -3, max: -2 },
  { label: "−2…−1R", min: -2, max: -1 },
  { label: "−1…0R", min: -1, max: 0 },
  { label: "0…1R", min: 0, max: 1 },
  { label: "1…2R", min: 1, max: 2 },
  { label: "2…3R", min: 2, max: 3 },
  { label: "≥ 3R", min: 3, max: Infinity },
];

/** Histogram of realized R (contribution %) across fixed half-open [min, max) buckets. */
export function rMultipleDistribution(points: AnalyticsTradePoint[]): RBucket[] {
  return R_BUCKETS.map((b) => ({
    ...b,
    count: points.filter((p) => p.actualR >= b.min && p.actualR < b.max).length,
  }));
}

export interface RiskStats {
  avgRisk: number | null; // %
  maxRisk: number | null; // %
  stdDev: number | null; // % (population)
  consistency: number | null; // 0–100 (100 = perfectly uniform risk)
}

/** Risk-per-trade stats from the position risk % (skips trades without a % risk). */
export function riskStats(riskPercents: number[]): RiskStats {
  const risks = riskPercents.filter((r) => Number.isFinite(r));
  if (risks.length === 0) return { avgRisk: null, maxRisk: null, stdDev: null, consistency: null };
  const avg = risks.reduce((s, r) => s + r, 0) / risks.length;
  const variance = risks.reduce((s, r) => s + (r - avg) ** 2, 0) / risks.length;
  const stdDev = Math.sqrt(variance);
  const consistency = avg > 0 ? Math.max(0, Math.min(100, 100 - (stdDev / avg) * 100)) : null;
  return { avgRisk: avg, maxRisk: Math.max(...risks), stdDev, consistency };
}
